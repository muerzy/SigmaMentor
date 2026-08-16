import { db } from "@sigma/db";
import { assignments, submissions } from "@sigma/db";
/**
 * 作业路由（学生端 F1 数据源）：列表 / 详情（含我的提交与事件流）。
 */
import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireStudent } from "../auth";
import { loadStudentAssignmentData } from "../services/diagnosis";

export const assignmentRoutes = new Elysia({ prefix: "/assignments", tags: ["作业"] })
  .use(requireStudent)
  .get(
    "/",
    async ({ student }) => {
      const rows = await db
        .select()
        .from(assignments)
        .where(eq(assignments.classId, student.classId))
        .orderBy(asc(assignments.weekNo), asc(assignments.code));

      const mySubs = await db
        .select()
        .from(submissions)
        .where(eq(submissions.studentId, student.id));
      return rows.map((a) => {
        const subs = mySubs.filter((s) => s.assignmentId === a.id);
        const latest = subs.at(-1);
        return {
          id: a.id,
          code: a.code,
          title: a.title,
          weekNo: a.weekNo,
          dueAt: a.createdAt.getTime(),
          knowledgePoints: a.knowledgePoints.map((k) => k.name),
          language: a.language,
          submitCount: subs.length,
          latestStatus: latest?.status ?? null,
          latestScore: latest?.score ?? null,
        };
      });
    },
    { detail: { summary: "本班作业列表" } },
  )
  .get(
    "/:id",
    async ({ params, student, status }) => {
      const [a] = await db.select().from(assignments).where(eq(assignments.id, params.id)).limit(1);
      if (!a || a.classId !== student.classId) return status(404, { error: "作业不存在" });

      const { subs, evts } = await loadStudentAssignmentData(student.id, a.id);
      // 学生可见用例：前 2 组完整（示例），其余只给输入（防白盒作弊）
      const sampleCases = a.cases
        .slice(0, 2)
        .map((c) => ({ input: c.input, expected: c.expected }));
      const hiddenInputs = a.cases.slice(2).map((c) => ({ input: c.input }));

      return {
        assignment: {
          id: a.id,
          code: a.code,
          title: a.title,
          description: a.description,
          language: a.language,
          funcName: a.funcName,
          knowledgePoints: a.knowledgePoints,
          starterCode: a.starterCode,
          limitMs: a.limitMs,
          weekNo: a.weekNo,
          dueAt: a.dueAt.getTime(),
        },
        sampleCases,
        hiddenInputCount: hiddenInputs.length,
        submissions: subs
          .sort((x, y) => x.seq - y.seq)
          .map((s) => ({
            seq: s.seq,
            status: s.status,
            score: s.score,
            passCount: s.passCount,
            totalCount: s.totalCount,
            code: s.code,
            message: s.detail.message ?? null,
            at: s.createdAt.getTime(),
          })),
        events: evts
          .sort((x, y) => x.seq - y.seq)
          .map((e) => ({
            seq: e.seq,
            type: e.eventType,
            text: e.detail.text,
            intervalMs: e.intervalMs,
            at: e.createdAt.getTime(),
          })),
        starterCodeOrDefault: subs.at(-1)?.code ?? a.starterCode,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "作业详情 + 我的提交历史 + 过程事件" },
    },
  );
