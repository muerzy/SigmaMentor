/**
 * SigmaMentor API（Elysia · :3000）。
 *
 * 特性栈：t.* 校验 / guard + resolve 守卫链 / 插件组合 / 签名 Cookie /
 * OpenAPI 文档（/swagger）/ Eden 端到端类型（export type App）。
 */
import { openapi } from "@elysiajs/openapi";
import { db, sqlite } from "@sigma/db";
import { createSigmaLlm } from "@sigma/llm";
import { Elysia, t } from "elysia";

import { analyticsRoutes } from "./routes/analytics";
import { assignmentRoutes } from "./routes/assignments";
import { authRoutes } from "./routes/auth";
import { diagnosisRoutes } from "./routes/diagnosis";
import { submissionRoutes, eventRoutes } from "./routes/submissions";
import { tutorRoutes } from "./routes/tutor";
import "./env";

export function createApp() {
  return new Elysia()
    .use(
      openapi({
        documentation: { info: { title: "SigmaMentor API", version: "0.1.0" } },
        path: "/openapi",
      }),
    )
    .get(
      "/health",
      () => {
        let dbOk = true;
        try {
          sqlite.query("SELECT 1").get();
        } catch {
          dbOk = false;
        }
        return {
          ok: dbOk,
          db: dbOk,
          llm: createSigmaLlm().available() ? process.env.LLM_MODE : "off(rule)",
          time: new Date().toISOString(),
        };
      },
      {
        detail: { summary: "健康检查" },
        response: t.Object({ ok: t.Boolean(), db: t.Boolean(), llm: t.String(), time: t.String() }),
      },
    )
    .use(authRoutes)
    .use(assignmentRoutes)
    .use(submissionRoutes)
    .use(eventRoutes)
    .use(diagnosisRoutes)
    .use(tutorRoutes)
    .use(analyticsRoutes)
    .onError(({ code, error, status, set }) => {
      if (code === "VALIDATION")
        return status(422, { error: "参数校验失败", detail: error.all ?? String(error) });
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "接口不存在" };
      }
      console.error(`[api] ${code}:`, error instanceof Error ? error.stack : error);
      return status(500, { error: "服务器内部错误" });
    });
}

export const app = createApp();
export type App = typeof app;

// 直接运行（非被 import）时监听
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port);
  console.info(`[api] SigmaMentor API listening on http://localhost:${port} · OpenAPI: /openapi`);
  void db; // db 已在 @sigma/db client 初始化（显式引用避免 tree-shake 误删）
}
