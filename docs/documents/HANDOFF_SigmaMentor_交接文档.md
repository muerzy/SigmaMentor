# SigmaMentor × GOAI 2026 参赛项目 · AI 交接文档

> 用途：把本文件完整丢给下一个 AI，即可接手继续。自包含，无需原对话。
> 更新至 2026-08-16：初赛已提交完毕；旧脚手架代码已删除；用户将删除 GitHub 仓库并同名重建，从零起全新脚手架。
> 给新 AI 的三件套：**本文档（决策与红线）+ PRD.md（需求与验收标准）+ README.md（新仓库门面母本）**。起脚手架时以 PRD §4.2 P0 和 §6.1 技术栈为准。

---

## 一、项目背景（一段话说清）

用户参加 **GOAI 2026 世界人工智能开源大赛**（goaihz.com，杭州市开源人工智能基金会主办，总奖池 500 万），选 **无界应用（apps）赛道 · AI+教育赛题**，目标明确：**奔着第一名去做**。

## 二、已定方案（全部是终版决策，不要再翻案）

### 产品：SigmaMentor · 2σ 导师

- **一句话**：编程课的一对一 AI 导师 / 学情诊断系统（高校场景）。
- **理论支点**：Bloom 1984 "2 Sigma Problem"（一对一辅导比传统课堂高 2 个标准差），产品名由此来。
- **定位演进史**（了解即可）：工业方向 → 软件开发偏好 → 编程教学 Agent → "AI 助教"被用户两次否决 → 翻转为"一对一 AI 导师"。
- **主打**：官方五词中的 **学情诊断 + 作业辅导**；其余三词（个性化学习、教师备课、学习陪伴）挂路线图。
- **格局**：平台愿景（高校课程 AI 导师平台）+ 编程课垂直楔子切入。引用官方金句支撑："一个证据完整的小闭环，胜过功能庞杂的大平台"。

### 四 Agent 闭环（核心架构叙事）

1. **诊断 Agent**：分析提交轨迹（submission_events），定位卡点
2. **导师 Agent**：四级苏格拉底引导 L1-L4，**永不直接给答案**
3. **评估 Agent**：三类代写过程信号（编辑轨迹 / 版本序列 / 提交节奏），**只辅助教师判断，不自动定罪**
4. **学情 Agent**：班级热力图聚合

`submission_events` 表是产品地基——传统 OJ 丢弃的过程数据，被我们存下来做诊断。这是对评审讲的技术故事核心。

### 学术弹药（简介/文档里已引用）

- Watson & Li 2014：CS1 挂科率元分析 28-33%
- ITiCSE 2024：ChatGPT 作弊研究
- Kestin 2025：哈佛 AI tutor RCT
- Khanmigo non-event 教训
- Generation Effect、worked example fading（样例渐隐）、Vygotsky ZPD

### 比赛情报（已考古确认）

- 评审权重：场景价值 25% / Agent 闭环 25% / Demo 完成度 20% / 技术深度 15% / 合规 10% / 开放 5%
- 官方三能力：可运行 / 可解释 / 可控
- 教育赛题边界（手册 4.3.4）：因材施教、经授权脱敏数据、**不得替代教师最终教育评价**
- 团队人数上限 3 人（手册 4.2），**初赛提交后成员锁定**
- 决赛 9.22 ≈ 校内试点第 3 周 → 时间窗红利：决赛时正好有真实试点数据可讲

## 三、技术栈（终版，已落地到脚手架）

```
bun monorepo（workspaces）—— 目标结构，新脚手架从零搭建
├─ apps/api        Elysia + Eden（端到端类型安全，export type App）
├─ apps/student    React19 + Tailwind4 + TanStack Query（开发与构建一律 Bun 原生 bundler，不用 Vite）
├─ apps/teacher    同上
├─ packages/db     Drizzle：MVP 用 bun:sqlite（sqlite-core / text-json），生产 PostgreSQL 18（复赛前切换，PRD I4），9 表核心 schema
├─ packages/llm    SigmaLlmClient 接口 + resolveLlmConfig(LLM_MODE=cloud|local) + OpenAI 兼容实现 + pi-ai 适配器
├─ packages/agent-core  四 Agent（诊断/导师/评估/学情），规则打底 + LLM 增强
└─ services/sandbox    判题沙箱（第一版 Bun.spawn 开发版 + 红线注释；生产目标一次性容器隔离）
```

- **构建（用户明令 2026-08-16）**：**不用 Vite**。开发与构建一律 Bun 原生（bun 的 bundler / dev server），Tailwind4 改用 CLI 或 PostCSS 接入（不能再用 `@tailwindcss/vite` 插件）。新脚手架严禁再引入 Vite
- **推理**：llama.cpp 主力（llama-server 吐 OpenAI 兼容协议，与云端 API 一行切换），vLLM 预留（GPU 高并发场景）
- **pi-ai**（@earendil-works/pi-ai，约 0.84+）：TS 统一 LLM 调用层，与 llama.cpp 是调用层 vs 推理引擎的互补关系，**不是替代**。packages/llm 里留了适配器 TODO，复赛前对接
- **部署**：全私有化，不用 CloudBase（用户已否决）
- **开源**：Apache 2.0（代码）+ CC BY 4.0（数据集）双协议
- **规范**：oxlint + oxfmt（项目级规则已配好）

### 代码关键约定（新脚手架必读）

- `packages/db`（MVP 期，用户 2026-08-16 拍板分层策略：开发 SQLite → 生产 PostgreSQL 18，复赛前切换即 PRD I4）：schema 用 drizzle **sqlite-core**，JSON 列用 `text("x", { mode: "json" })`（sqlite-core 无 json() 导出）；SQLite 路径用 `new URL("../xxx.sqlite", import.meta.url)` 锚定（相对解析以文件所在目录为基准）+ Windows 盘符修正 `.pathname.replace(/^\/([A-Za-z]:)/, "$1")`；迁移用 drizzle-kit generate + drizzle-orm/bun-sqlite/migrator（别用 drizzle-kit migrate，它要 node driver）。SQL 避免特有语法，保持向 PG 迁移平滑
- 构建：**一律 Bun 原生**（bun 的 bundler / dev server 跑 React SPA），不用 Vite；Tailwind4 用 `@tailwindcss/cli` 或 `@tailwindcss/postcss` 接入，**禁用** `@tailwindcss/vite`
- lint 约定：`toSorted()` 不用 `.sort()`、循环内 await 改 `Promise.all`、CSS 副作用导入在 `.oxlintrc.json` 里 allow 白名单（`"import/no-unassigned-import": ["warn", { "allow": ["**/*.css"] }]`）

## 四、GitHub 仓库（将删除重建）

- **地址**：github.com/muerzy/SigmaMentor（地址不变——初赛表单填的就是它）。用户会删除旧仓库并同名重建，推送新脚手架代码，commit 历史清零
- 旧脚手架（46 源文件，SQLite + Vite 版）已于 8.16 本地删除，删除前已确认与远端完全同步
- 新仓库 README 直接用工作目录 `README.md`（最新口径：六层架构 / PostgreSQL / Bun 原生构建 / 无 Vite）；repo description 和 topics 用户自己填

### 匿名化硬要求（新仓库 README 同样适用，用户明令）

以下信息 **README 里一律不出现**，但**参赛材料（简介/PPT）保留实名实绩**：

- ❌ 姓名（杨智宇）
- ❌ llama.cpp 官方合并贡献者
- ❌ 企业项目：江铃 AI 视觉、化工园区数字孪生、省工信厅 AI+AR 巡检
- ❌ 指导学生国家级竞赛奖 16 项（一等奖 10 项）

## 五、提交物状态（本工作目录）

工作目录：`C:\Users\YZY\.zcode\workspace\default\`

| 文件                                  | 状态                                  |
| ----------------------------------- | ----------------------------------- |
| `submit_pkg/`                       | **初赛材料存档**（六文件，PDF 版 PPT + PostgreSQL 口径），已随 zip 提交组委会；zip 本体已删 |
| `PRD.md`                            | 新脚手架的需求与验收基线                         |
| `README.md`                         | 新仓库门面母本（六层架构 / PG / Bun 原生 / 无 Vite）  |
| `ppt_prompt.md`                     | PPT 纯内容版（历史母本）                       |
| `GOAI2026_作品简介_完整版.md` / `_报名表用.md` | 参赛简介母本（历史存档）                    |

zip 内六文件：

1. `01_作品简介_500字.docx` — 483 汉字，覆盖官方八要素
2. `02_作品介绍文档_完整版.docx` — 2200 字排版版（封面 + 七节 + 页码 + 首行缩进 0.85cm）
3. `03_数据来源与合规说明.md` — 793 字重写版，human-writing 全绿
4. `04_方案PPT_SigmaMentor.pdf` — 用户 AI 工具生成的 13 页版（整页图片无文字层，本地核不了内容，已让用户自查 P3 表格/P6 占位/数字）
5. `05_README_部署与依赖.md`
6. `06_LICENSE_Apache2.0.txt`

### ppt_prompt.md 内容概要（若需重写）

全局设计规范：深藏蓝 #1B2A4A + 金色 #C9A24B、Cambria/思源黑体、章节徽章母题、负面清单；13 页逐页指令含全部文案版式；生成后自查清单。**P6 有真实轨迹截图占位框，不能被 AI 工具填掉**。

## 六、PPT 待办（已完成）

用户已于 8.15 晚用 AI 工具生成 13 页 PDF 并放入 submit_pkg（04_方案PPT_SigmaMentor.pdf）。zip 已重打包验证。`ppt_prompt.md` 已重写为纯内容版（设计交给 AI 工具），含设计指令的旧版备份在 `ppt_prompt_旧版_含设计指令.md`。

## 七、初赛提交清单（✅ 已于 8.16 完成提交）

- 作品名称：**SigmaMentor · 2σ 导师**（注意别漏 "2σ 导师"）
- 参赛赛题：AI+教育
- 代码仓库：github.com/muerzy/SigmaMentor
- Demo 链接：留空
- 作品附件：SigmaMentor_submission.zip
- 单位/职务：按用户实际填（参赛侧不匿名）
- **截止：2026-08-16 23:59**

## 八、复赛前任务清单（初赛提交后启动）

1. **数据层切换 PostgreSQL 18 + 引入 Redis**（PRD I4：MVP 用 SQLite，复赛前切 pg-core / jsonb / postgres.js / docker 起库，保证 README 快速开始可复现）
2. pi-ai 适配器对接（验证自定义 baseURL 指 llama-server + 多模态能力）
3. 沙箱升级：isolated-vm / 容器隔离（红线：现版 Bun.spawn 不可暴露真实课堂）
4. api `/submissions` 接入沙箱判题 → 写 submission_events → 触发诊断 Agent
5. 学院/教务试点报备 + 学生知情同意书（对应合规 10% 权重 + 手册 4.3.4）
6. 真实轨迹截图替换 P6 占位框
7. 团队成员确认（上限 3 人，初赛后锁定）

## 九、用户协作偏好（必须遵守）

- **始终简体中文回复**
- **有二义性就停下来问用户确认**，不要自己往下操作（用户 AGENTS.md 明令）
- 文档类产出用 human-writing skill 润色，但**不丢失专业性**（破折号清零、提示性冒号改写、翻案腔拆掉、黑话禁用）
- 工具链：JS/TS 一律 bun/bunx 不用 npm/npx；Python 用 uv；查库文档优先 context7 MCP；lint/fmt 用 oxlint/oxfmt
- 用户风格：节奏快、决策果断、会自己动手（建仓库、填 description/topics、做 PPT）；AI 负责调研、写文档、搭代码、打包

## 十、踩坑记录（避免重蹈）

| 坑                                   | 解法                                                         |
| ----------------------------------- | ---------------------------------------------------------- |
| officecli 间歇性 System.Private.Xml 崩溃 | retry 容错函数模式重试                                             |
| bash 里表格值含空格被吞                      | 全部引号包裹                                                     |
| Compress-Archive 报文件占用              | 先 `officecli close <文件路径>`（close 必须带文件参数）再打包；顺序：统计→close→打包，别再 view/validate 拉起 resident |
| zip 中文名乱码风险（unzip 显示层乱码≠真乱码）       | 一律英文名；验证用 .NET ZipFile 按 UTF-8 读                              |
| docx 内存字面 `\uXXXX` 转义文本（view text 显示 `\uXXXX` 是警报信号，勿当作显示层转义放过） | 用 PowerShell ZipFile 直读 word/document.xml 字节级核实；修复用 regex 替换 `[char][Convert]::ToInt32(hex,16)` 写回。grep 管道可能漏检 |
| sed 批量替换误删整行                        | 敏感文件用 Edit 工具逐处改，别用 sed 正则批量                               |
| drizzle sqlite-core 无 json() 导出          | JSON 列用 `text("x", { mode: "json" })`                                    |
| drizzle-kit migrate 要 node driver          | 改用 bun 原生 migrator（drizzle-orm/bun-sqlite/migrator）                   |
| SQLite 相对 cwd 导致 api 连空库（no such table） | 路径用 `new URL()` 锚定 + Windows 盘符修正；注意 URL 相对解析以文件所在目录为基准 |
| Windows rm 目录报 Device or resource busy | 先 cd 出该目录再删；仍失败用 `cmd //c "rd /s /q"`；删前验证远端同步          |
| Tailwind v4 任意显式 `@source` 会关闭自动扫描 | 多目录扫描时把**所有**源码目录显式列出（`@source "../"` 本 app + ui 目录），否则任意值类（`p-[18px]` 等）静默丢失 |
| unlayered `* { margin:0; padding:0 }` 碾压 Tailwind 工具类 | CSS 级联层：unlayered 永远赢 `@layer utilities`。reset 必须包进 `@layer base`（packages/ui base.css 已修） |
| Bun.serve 代理原样转发 Request 挂起（10s idle 超时） | 手动重构请求：删 host/connection/content-length 头 + body 用 arrayBuffer；并剥 `/api` 前缀 |
| Eden treaty 集合根不是 `.index` | `api.assignments.get()` 直接属性链；`.index.get()` 会拼出 `/assignments/index` 404 |
| ESM import 提升：`process.env.X=...` 写在 import 前也最后执行 | 用命令行环境变量（`SIGMA_DB_PATH=x bun run`）或 bunfig preload；debug 脚本曾因此污染开发库 |
