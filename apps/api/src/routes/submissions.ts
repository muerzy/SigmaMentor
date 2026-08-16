import type { EventType } from "@sigma/db";
/**
 * 提交与过程事件路由（F1 / I3）：
 *   POST /submissions        判题 + 落库 + 事件 + 触发诊断
 *   POST /events             客户端事件批量上报（编辑/放弃），intervalMs 由上一事件时刻推算
 */
import { Elysia, t } from "elysia";

import { requireStudent } from "../auth";
import { submitAndDiagnose } from "../services/diagnosis";
import { appendEvent } from "../services/events";

export const submissionRoutes = new Elysia({ prefix: "/submissions", tags: ["提交"] })
  .use(requireStudent)
  .post(
    "/",
    async ({ body, student, status }) => {
      try {
        const result = await submitAndDiagnose(student.id, body.assignmentId, body.code);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "判题失败";
        return status(400, { error: message });
      }
    },
    {
      body: t.Object({
        assignmentId: t.String(),
        code: t.String({ minLength: 1, maxLength: 64_000 }),
      }),
      detail: { summary: "提交代码到沙箱判题（返回判题结果 + 诊断摘要）" },
    },
  );

export const eventRoutes = new Elysia({ prefix: "/events", tags: ["过程事件"] })
  .use(requireStudent)
  .post(
    "/",
    async ({ body, student }) => {
      for (const e of body.events) {
        await appendEvent(
          {
            studentId: student.id,
            assignmentId: body.assignmentId,
            eventType: e.type as EventType,
            text: e.text,
            extra: e.chars !== undefined ? { chars: e.chars } : undefined,
            at: e.at,
          },
          { async: true },
        );
      }
      return { ok: true, accepted: body.events.length };
    },
    {
      body: t.Object({
        assignmentId: t.String(),
        events: t.Array(
          t.Object({
            type: t.Union([t.Literal("edit"), t.Literal("drop")]),
            text: t.String({ maxLength: 200 }),
            chars: t.Optional(t.Number()),
            at: t.Number(),
          }),
          { maxItems: 50 },
        ),
      }),
      detail: { summary: "过程事件批量上报（编辑/放弃；只追加）" },
    },
  );
