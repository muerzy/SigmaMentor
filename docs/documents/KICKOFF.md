# SigmaMentor MVP 开发指令（AI Agent 必读）

> 本文件是给 AI Agent 的项目级指令。放在项目根目录（Claude Code 改名为 `CLAUDE.md`，ZCode 改名为 `AGENTS.md`）。

## 你在做什么

SigmaMentor · 2σ 导师——高校编程课的一对一 AI 导师与学情诊断系统。你负责开发 MVP（P0 范围），目标：**2026-08-25 至 09-03 复赛可运行 Demo**（提交→沙箱→诊断→分级引导→看板全链路 + 演示视频脚本）。

## 必读文档（按序读完再动工，缺一不可）

1. `HANDOFF_SigmaMentor_交接文档.md` — 全部产品决策、产品红线、技术约定、踩坑记录（第十节踩坑表必看）
2. `PRD.md` — 需求与验收标准。**你的开发范围 = §4.2 P0 全部：F1/F2/F3/F6/F7 + I1/I2/I3/I4**；§6.2 是数据模型
3. `README.md` — 仓库门面母本（放仓库根目录；其中"快速开始"命令必须与你交付的实际命令一致）

## 硬约束（违反任何一条 = 返工）

- 一律 `bun` / `bunx`，**禁用 npm / npx**；node 不作脚本运行器
- 前端**不用 Vite**：开发与构建用 Bun 原生 bundler（HTML imports / dev server）；Tailwind4 用 `@tailwindcss/cli` 或 `@tailwindcss/postcss` 接入，**禁用 `@tailwindcss/vite`**
- 数据层分两档：**MVP 用 SQLite（bun:sqlite 内置，零部署依赖，Demo 离线可跑）；生产环境 PostgreSQL 18**（切换任务见 PRD I4，复赛前完成）。MVP 实现要点：schema 用 drizzle sqlite-core；JSON 列用 `text("x", { mode: "json" })`（sqlite-core 没有 json() 导出）；SQLite 文件路径用 `new URL()` 锚定 + Windows 盘符修正（详见 HANDOFF 踩坑表）；迁移用 drizzle-kit generate + drizzle-orm/bun-sqlite/migrator。SQL 写法避免 SQLite 特有语法，保持向 PG 迁移的平滑度
- lint / fmt：`oxlint` + `oxfmt`，correctness 级 error 零容忍
- 仓库 README 匿名：**不出现**真实姓名、llama.cpp 贡献信息、企业项目名、竞赛获奖数字（直接用提供的 README.md 即可）
- 产品红线（必须体现在代码与提示词里）：导师 Agent 永不输出完整答案代码；代写证据只呈现不定罪；诊断结论必须可回溯到具体提交

## 开发顺序（每步可验证再进下一步）

1. 环境验证：bun ≥1.1（MVP 阶段无需 Docker/PG，SQLite 开箱即用）
2. monorepo 骨架：bun workspaces + 根 package.json + `.oxlintrc.json` + `.oxfmtrc.json` + tsconfig + `.env.example`
3. `packages/db`：9 表 schema（sqlite-core / text json）+ 迁移跑通（`bun run db:generate` / `db:migrate`）
4. `packages/llm`：SigmaLlmClient 接口 + pi-ai 适配器 + `LLM_MODE=cloud|local` 一行切换
5. `packages/agent-core`：四 Agent（诊断/导师/评估/学情）规则版 + LLM 增强接口 + 四级引导提示词（L1–L4）
6. `apps/api`：Elysia + Eden，起步三接口 `/health`、`POST /submissions`、`GET /classes/:id/analytics`，`export type App`
7. `services/sandbox`：Bun.spawn 开发版 runCode/judge + 超时控制 + 红线注释（容器隔离是复赛任务，本阶段不做）
8. `apps/student`（:5183）+ `apps/teacher`（:5184）：React19 + Tailwind4 + shadcn/ui + TanStack Query，proxy `/api` → :3000
9. 全链路冒烟：提交 → 沙箱判题 → 事件入库 → 诊断 → 分级引导 → 教师看板
10. 对照 PRD §4.2 每个 P0 的验收标准**逐项对账**，输出对账清单

## 交付标准

以 PRD 各 P0 的「验收标准」为准。最终必须通过：`bun run lint`（零 error）、`bun run fmt:check`、全链路冒烟。README 快速开始命令逐条可复现。

## 环境说明

Windows + Git Bash。全程简体中文回复。改 schema 后必须重新生成迁移并验证，不手写 SQL。
