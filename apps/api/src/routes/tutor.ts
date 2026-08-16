import { SOLVED_EARLY, finishL4, initialState, opening, respond } from "@sigma/agent-core";
import { db } from "@sigma/db";
import { assignments, diagnoses, guidanceSessions, submissions } from "@sigma/db";
import { createSigmaLlm } from "@sigma/llm";
/**
 * 导师会话路由（F3 · A2）：创建/查看会话、发消息（L1–L4 状态机 + 红线双保险）、
 * L4 复盘收尾（结论回流诊断画像）。
 *
 * 「解出」走闭环校验：学生声称通过时核对真实判题记录，不让状态机脱离事实。
 */
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireStudent } from "../auth";

const llm = createSigmaLlm();

async function loadContext(studentId: string, assignmentId: string) {
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) return null;
  const [diag] = await db
    .select()
    .from(diagnoses)
    .where(and(eq(diagnoses.studentId, studentId), eq(diagnoses.assignmentId, assignmentId)))
    .orderBy(desc(diagnoses.createdAt))
    .limit(1);
  const topKp = diag?.stuckPoints[0] ?? assignment.knowledgePoints[0] ?? null;
  return { assignment, diagnosis: diag ?? null, topKp };
}

export const tutorRoutes = new Elysia({ prefix: "/tutor", tags: ["导师"] })
  .use(requireStudent)
  .post(
    "/sessions",
    async ({ body, student, status }) => {
      const ctx = await loadContext(student.id, body.assignmentId);
      if (!ctx) return status(404, { error: "作业不存在" });

      // 已有活跃会话则复用（同一题不重复开会话）
      const [existing] = await db
        .select()
        .from(guidanceSessions)
        .where(
          and(
            eq(guidanceSessions.studentId, student.id),
            eq(guidanceSessions.assignmentId, body.assignmentId),
          ),
        )
        .orderBy(desc(guidanceSessions.createdAt))
        .limit(1);
      if (existing && existing.status === "active") {
        return { session: serialize(existing), created: false };
      }

      const tutorCtx = {
        funcName: ctx.assignment.funcName,
        problemTitle: ctx.assignment.title,
        kpKey: ctx.topKp?.kpKey ?? "generic",
        kpName: ctx.topKp?.kpName ?? "综合",
      };
      const st = initialState();
      const open = opening(st, tutorCtx);
      const id = crypto.randomUUID();
      const now = new Date();
      await db.insert(guidanceSessions).values({
        id,
        studentId: student.id,
        assignmentId: body.assignmentId,
        diagnosisId: ctx.diagnosis?.id ?? null,
        level: 1,
        status: "active",
        messages: [
          { role: "tutor", text: open.text, level: 1, meta: open.meta, at: now.getTime() },
        ],
        createdAt: now,
        updatedAt: now,
      });
      const [row] = await db
        .select()
        .from(guidanceSessions)
        .where(eq(guidanceSessions.id, id))
        .limit(1);
      return { session: serialize(row!), created: true };
    },
    {
      body: t.Object({ assignmentId: t.String() }),
      detail: { summary: "创建/复用导师会话（开场 = L1 定向提示）" },
    },
  )
  .get(
    "/sessions/:id",
    async ({ params, student, status }) => {
      const [row] = await db
        .select()
        .from(guidanceSessions)
        .where(and(eq(guidanceSessions.id, params.id), eq(guidanceSessions.studentId, student.id)))
        .limit(1);
      if (!row) return status(404, { error: "会话不存在" });
      return { session: serialize(row) };
    },
    { params: t.Object({ id: t.String() }), detail: { summary: "查看会话" } },
  )
  .post(
    "/sessions/:id/messages",
    async ({ params, body, student, status }) => {
      const [row] = await db
        .select()
        .from(guidanceSessions)
        .where(and(eq(guidanceSessions.id, params.id), eq(guidanceSessions.studentId, student.id)))
        .limit(1);
      if (!row) return status(404, { error: "会话不存在" });
      if (row.status === "completed") return status(409, { error: "会话已完成复盘" });

      const ctx = await loadContext(student.id, row.assignmentId);
      if (!ctx) return status(404, { error: "作业不存在" });

      // 闭环校验：声称「通过了」→ 核对该题最近一次真实提交
      const claimsSolved = /(改好|通过|对了|过了|全对|ac)/i.test(body.text);
      let verifiedSolved = false;
      if (claimsSolved) {
        const [latestSub] = await db
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.studentId, student.id),
              eq(submissions.assignmentId, row.assignmentId),
            ),
          )
          .orderBy(desc(submissions.seq))
          .limit(1);
        verifiedSolved = latestSub?.status === "pass";
      }

      const tutorCtx = {
        funcName: ctx.assignment.funcName,
        problemTitle: ctx.assignment.title,
        kpKey: ctx.topKp?.kpKey ?? "generic",
        kpName: ctx.topKp?.kpName ?? "综合",
      };
      const state = {
        level: row.level as 1 | 2 | 3 | 4,
        solved: row.status === "solved",
        finished: false,
        refusalCount: row.messages.filter((m) => m.meta?.includes("红线")).length,
        genericIdx: row.messages.filter((m) => m.role === "tutor").length,
      };

      const history = row.messages.slice(-6).map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }));

      // 声称通过但判题记录未通过 → 不进 L4，先引导去沙箱验证（闭环：状态机不脱离事实）
      if (claimsSolved && !verifiedSolved) {
        const now0 = new Date();
        await db
          .update(guidanceSessions)
          .set({
            messages: [
              ...row.messages,
              { role: "user" as const, text: body.text, level: state.level, at: now0.getTime() },
              {
                role: "tutor" as const,
                text: SOLVED_EARLY,
                level: state.level,
                meta: "闭环校验 · 未经判题确认",
                at: now0.getTime(),
              },
            ],
            updatedAt: now0,
          })
          .where(eq(guidanceSessions.id, row.id));
        return {
          reply: {
            text: SOLVED_EARLY,
            meta: "闭环校验 · 未经判题确认",
            level: state.level,
            engine: "rule",
          },
          status: row.status,
          verifiedSolved: false,
        };
      }

      const effText = verifiedSolved ? "我改好了，5/5 通过了" : body.text;
      const reply = await respond(effText, state, tutorCtx, llm, history);

      const now = new Date();
      const messages = [
        ...row.messages,
        { role: "user" as const, text: body.text, level: state.level, at: now.getTime() },
        {
          role: "tutor" as const,
          text: reply.text,
          level: reply.level,
          meta: reply.meta,
          at: now.getTime(),
        },
      ];
      const nextStatus = reply.state.finished
        ? "completed"
        : reply.state.solved
          ? "solved"
          : "active";
      await db
        .update(guidanceSessions)
        .set({
          level: reply.state.level,
          status: nextStatus,
          messages,
          updatedAt: now,
        })
        .where(eq(guidanceSessions.id, row.id));

      return {
        reply: { text: reply.text, meta: reply.meta, level: reply.level, engine: reply.engine },
        status: nextStatus,
        verifiedSolved: claimsSolved ? verifiedSolved : undefined,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ text: t.String({ minLength: 1, maxLength: 2000 }) }),
      detail: { summary: "发送消息（L1–L4 升级状态机；红线 ① 双保险）" },
    },
  )
  .post(
    "/sessions/:id/finish",
    async ({ params, body, student, status }) => {
      const [row] = await db
        .select()
        .from(guidanceSessions)
        .where(and(eq(guidanceSessions.id, params.id), eq(guidanceSessions.studentId, student.id)))
        .limit(1);
      if (!row) return status(404, { error: "会话不存在" });
      if (row.status !== "solved" && row.status !== "active") {
        return status(409, { error: "会话状态不允许复盘" });
      }

      const reply = finishL4(body.summary, { ...initialState(), solved: true });
      const now = new Date();
      const messages = [
        ...row.messages,
        { role: "user" as const, text: body.summary, level: 4 as const, at: now.getTime() },
        {
          role: "tutor" as const,
          text: reply.text,
          level: 4 as const,
          meta: reply.meta,
          at: now.getTime(),
        },
      ];
      await db
        .update(guidanceSessions)
        .set({ status: "completed", summary: body.summary, messages, updatedAt: now })
        .where(eq(guidanceSessions.id, row.id));

      // L4 复盘结论回流诊断画像：新版本诊断，结论前缀标注复盘
      const [diag] = await db
        .select()
        .from(diagnoses)
        .where(
          and(eq(diagnoses.studentId, student.id), eq(diagnoses.assignmentId, row.assignmentId)),
        )
        .orderBy(desc(diagnoses.createdAt))
        .limit(1);
      if (diag) {
        await db.insert(diagnoses).values({
          id: crypto.randomUUID(),
          studentId: student.id,
          assignmentId: row.assignmentId,
          stuckPoints: diag.stuckPoints.map((p) => ({
            ...p,
            confidence: Math.max(0, p.confidence - 0.2),
          })),
          conclusion: `【L4 复盘回流】学生自述：${body.summary}｜${diag.conclusion}`,
          evolution: diag.evolution,
          evidence: diag.evidence,
          stuckMinutes: diag.stuckMinutes,
          sameErrorCount: 0,
          engine: "rule",
          createdAt: new Date(),
        });
      }

      return { reply: reply.text, status: "completed" };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ summary: t.String({ minLength: 2, maxLength: 200 }) }),
      detail: { summary: "L4 复盘收尾（结论回流 diagnoses）" },
    },
  );

function serialize(row: typeof guidanceSessions.$inferSelect) {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    level: row.level,
    status: row.status,
    summary: row.summary,
    messages: row.messages,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
