import { enhanceConclusion } from "@sigma/agent-core";
import { db } from "@sigma/db";
import { assignments, diagnoses, submissions } from "@sigma/db";
import { createSigmaLlm } from "@sigma/llm";
/**
 * 诊断路由（F2）：学生查看自己的诊断画像 + 证据抽屉数据（代码快照 + 前后事件）。
 * LLM 增强结论：有配置时对最新诊断叠加自然语言重写（证据链结构不变）。
 */
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireStudent } from "../auth";
import { loadStudentAssignmentData } from "../services/diagnosis";

export const diagnosisRoutes = new Elysia({ prefix: "/diagnosis", tags: ["诊断"] })
  .use(requireStudent)
  .get(
    "/:assignmentId",
    async ({ params, student, status }) => {
      const [assignment] = await db
        .select()
        .from(assignments)
        .where(eq(assignments.id, params.assignmentId))
        .limit(1);
      if (!assignment || assignment.classId !== student.classId) {
        return status(404, { error: "作业不存在" });
      }

      const [latest] = await db
        .select()
        .from(diagnoses)
        .where(and(eq(diagnoses.studentId, student.id), eq(diagnoses.assignmentId, assignment.id)))
        .orderBy(desc(diagnoses.createdAt))
        .limit(1);

      if (!latest) {
        return {
          assignment: { id: assignment.id, code: assignment.code, title: assignment.title },
          diagnosis: null,
          message: "暂无诊断——提交一次代码后生成",
        };
      }

      // LLM 增强结论（失败自动回退规则版文本）
      const llm = createSigmaLlm();
      const base = {
        ...latest,
        createdAt: latest.createdAt.getTime(),
      } as const;
      const enhanced = await enhanceConclusion(
        llm,
        {
          stuckPoints: latest.stuckPoints,
          conclusion: latest.conclusion,
          evolution: latest.evolution,
          evidence: latest.evidence,
          stuckMinutes: latest.stuckMinutes,
          totalStuckMinutes: latest.stuckMinutes,
          sameErrorCount: latest.sameErrorCount,
        },
        student.userId,
      );

      return {
        assignment: { id: assignment.id, code: assignment.code, title: assignment.title },
        diagnosis: { ...base, conclusion: enhanced.conclusion, engine: enhanced.engine },
      };
    },
    {
      params: t.Object({ assignmentId: t.String() }),
      detail: { summary: "我的最新诊断画像（红线 ⑤：证据可回溯）" },
    },
  )
  .get(
    "/:assignmentId/evidence/:seq",
    async ({ params, student, status }) => {
      const [sub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.studentId, student.id),
            eq(submissions.assignmentId, params.assignmentId),
            eq(submissions.seq, Number(params.seq)),
          ),
        )
        .limit(1);
      if (!sub) return status(404, { error: "提交不存在" });

      const { evts } = await loadStudentAssignmentData(student.id, params.assignmentId);
      const around = evts
        .filter((e) => Math.abs(e.createdAt.getTime() - sub.createdAt.getTime()) < 30 * 60 * 1000)
        .slice(-6);

      return {
        seq: sub.seq,
        status: sub.status,
        score: sub.score,
        passCount: sub.passCount,
        totalCount: sub.totalCount,
        code: sub.code,
        message: sub.detail.message ?? null,
        rows: sub.detail.rows ?? null,
        events: around.map((e) => ({
          seq: e.seq,
          type: e.eventType,
          text: e.detail.text,
          at: e.createdAt.getTime(),
        })),
        at: sub.createdAt.getTime(),
      };
    },
    {
      params: t.Object({ assignmentId: t.String(), seq: t.String() }),
      detail: { summary: "证据抽屉：某次提交的代码快照与前后事件" },
    },
  );
