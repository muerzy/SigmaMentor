import { diagnose } from "@sigma/agent-core";
import { assessSubmission } from "@sigma/agent-core";
import { db } from "@sigma/db";
import {
  assignments,
  diagnoses,
  evidenceSignals,
  students,
  submissionEvents,
  submissions,
  type Assignment,
} from "@sigma/db";
import { getRunner } from "@sigma/sandbox";
/**
 * 提交服务：判题 → 落库 → 事件追加 → 触发诊断 → A3 评估（通过时）。
 * 全链路 = F1 的服务端主干。
 */
import { and, eq } from "drizzle-orm";

import { appendEvent } from "./events";

const STATUS_TO_EVENT: Record<string, "compile" | "run" | "partial" | "pass"> = {
  compile_error: "compile",
  run_error: "run",
  timeout: "run",
  partial: "partial",
  pass: "pass",
};

export async function loadStudentAssignmentData(studentId: string, assignmentId: string) {
  const [subs, evts] = await Promise.all([
    db
      .select()
      .from(submissions)
      .where(and(eq(submissions.studentId, studentId), eq(submissions.assignmentId, assignmentId))),
    db
      .select()
      .from(submissionEvents)
      .where(
        and(
          eq(submissionEvents.studentId, studentId),
          eq(submissionEvents.assignmentId, assignmentId),
        ),
      ),
  ]);
  return { subs, evts };
}

/** 触发诊断：重算并写入新版本诊断（规则版 <1s；LLM 增强在路由层叠加） */
export async function recomputeDiagnosis(
  studentId: string,
  assignment: Assignment,
): Promise<Awaited<ReturnType<typeof diagnose>> & { diagnosisId: string }> {
  const { subs, evts } = await loadStudentAssignmentData(studentId, assignment.id);
  const result = diagnose({ assignment, submissions: subs, events: evts });

  const id = crypto.randomUUID();
  await db.insert(diagnoses).values({
    id,
    studentId,
    assignmentId: assignment.id,
    stuckPoints: result.stuckPoints,
    conclusion: result.conclusion,
    evolution: result.evolution,
    evidence: result.evidence,
    stuckMinutes: result.stuckMinutes,
    sameErrorCount: result.sameErrorCount,
    engine: "rule",
    createdAt: new Date(),
  });
  return { ...result, diagnosisId: id };
}

export interface SubmitResult {
  submissionSeq: number;
  status: string;
  score: number;
  passCount: number;
  totalCount: number;
  detail: {
    rows?: { input: unknown; expected: unknown; got: unknown; ok: boolean }[];
    message?: string;
  };
  judgeElapsedMs: number;
  /** S1：失败时给「错在哪个知识点 + 同类关联」摘要 */
  diagnosisSummary: {
    topKpKey: string | null;
    topKpName: string | null;
    sameErrorCount: number;
    relatedSubmissions: number[];
    conclusion: string;
  } | null;
  /** F5 演示口径：失败后是否应触发主动干预（每日 ≤3 次在客户端控制） */
  suggestIntervention: boolean;
}

export async function submitAndDiagnose(
  studentId: string,
  assignmentId: string,
  code: string,
): Promise<SubmitResult> {
  // 1. 判题（沙箱）
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) throw new Error("作业不存在");
  const runner = getRunner(assignment.language);
  const judged = await runner.judge({
    code,
    funcName: assignment.funcName,
    cases: assignment.cases,
    limitMs: assignment.limitMs,
  });

  // 2. 提交落库
  const prior = await loadStudentAssignmentData(studentId, assignmentId);
  const seq = prior.subs.length + 1;
  const submissionId = crypto.randomUUID();
  await db.insert(submissions).values({
    id: submissionId,
    studentId,
    assignmentId,
    seq,
    code,
    language: assignment.language,
    status: judged.status,
    score: judged.score,
    passCount: judged.passCount,
    totalCount: judged.totalCount,
    detail: judged.detail,
    createdAt: new Date(),
  });

  // 3. 事件追加（异步不阻塞；失败进重试队列——I3 验收）
  const eventType = STATUS_TO_EVENT[judged.status] ?? "run";
  const eventText =
    judged.status === "pass"
      ? `提交 #${seq} · ${judged.passCount}/${judged.totalCount} 用例通过`
      : judged.status === "partial"
        ? `提交 #${seq} · ${judged.passCount}/${judged.totalCount} 用例通过`
        : judged.status === "compile_error"
          ? `提交 #${seq} · ${judged.detail.message?.slice(0, 80) ?? "编译错误"}`
          : judged.status === "timeout"
            ? `提交 #${seq} · 执行超时（疑似死循环）`
            : `提交 #${seq} · ${judged.passCount}/${judged.totalCount} 用例未通过`;
  await appendEvent(
    {
      studentId,
      assignmentId,
      submissionId,
      eventType,
      text: eventText,
      extra: { seq },
      at: Date.now(),
    },
    { async: true },
  );

  // 4. 触发诊断（规则版重算，新版本入库）
  const diagnosis = await recomputeDiagnosis(studentId, assignment);

  // 5. A3 评估：通过的提交跑三类信号，≥mid 疑似度入库（只呈现不定罪）
  if (judged.status === "pass") {
    const allSubs = await db.select().from(submissions).where(eq(submissions.studentId, studentId));
    const allEvts = await db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.studentId, studentId));
    const target = allSubs.find((s) => s.id === submissionId)!;
    const assessment = assessSubmission({ submissions: allSubs, events: allEvts, target });
    if (assessment.suspicion !== "low") {
      await db.insert(evidenceSignals).values({
        id: crypto.randomUUID(),
        studentId,
        submissionId,
        suspicion: assessment.suspicion,
        signals: assessment.signals,
        note: assessment.note,
        createdAt: new Date(),
      });
    }
  }

  const top = diagnosis.stuckPoints[0] ?? null;
  const failed = judged.status !== "pass";

  return {
    submissionSeq: seq,
    status: judged.status,
    score: judged.score,
    passCount: judged.passCount,
    totalCount: judged.totalCount,
    detail: judged.detail,
    judgeElapsedMs: judged.elapsedMs,
    diagnosisSummary:
      failed && top
        ? {
            topKpKey: top.kpKey,
            topKpName: top.kpName,
            sameErrorCount: diagnosis.sameErrorCount,
            relatedSubmissions: diagnosis.evidence.map((e) => e.submissionSeq),
            conclusion: diagnosis.conclusion,
          }
        : null,
    suggestIntervention: failed && diagnosis.sameErrorCount >= 2,
  };
}

/** 学生档案工具：取学生（教师端组装名单用） */
export async function getStudent(studentId: string) {
  const rows = await db
    .select({ student: students })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  return rows[0]?.student ?? null;
}
