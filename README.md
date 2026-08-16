# SigmaMentor · 2σ 导师

> One-to-one AI mentor for every student in the programming classroom.

为每个学生配一位一对一 AI 导师。用过程数据把 AI 时代的高校学情重新变得可见，并自动干预。

![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Datasets](https://img.shields.io/badge/datasets-CC%20BY%204.0-green)
![Runtime](https://img.shields.io/badge/runtime-Bun-f9f1e5)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6)

**参赛** GOAI 2026 世界人工智能开源大赛 · 无界应用赛道 · AI+教育

## 目录

- [🎯 它要解决的问题](#-它要解决的问题)
- [🧩 系统架构](#-系统架构)
- [📸 界面一览](#-界面一览)
- [🗂 过程数据，被丢弃五十年的地基](#-过程数据被丢弃五十年的地基)
- [🧭 四个核心设计决策](#-四个核心设计决策)
- [⚙️ 技术栈](#️-技术栈)
- [🚀 快速开始](#-快速开始)
- [🔌 LLM 配置](#-llm-配置)
- [📁 数据库模型](#-数据库模型)
- [🧪 判题沙箱](#-判题沙箱)
- [🗺️ 路线图](#-路线图)
- [🎁 开源计划](#-开源计划)
- [📚 学术依据](#-学术依据)
- [👥 团队](#-团队)
- [📜 许可证](#-许可证)
- [🏆 参赛信息](#-参赛信息)

## 🎯 它要解决的问题

1984 年，Bloom 发表了一项后来被反复引用的研究。接受一对一辅导的学生，学习效果比传统课堂平均高出 2 个标准差，实验组 98% 的学生超过传统课堂平均水平。效果没有争议，争议在价格。四十年来，一对一辅导一直是少数家庭的教育特权。

今天的情况更复杂了。

- 全球程序设计入门课的挂科退课率长期在 28% 到 33% 之间（Watson & Li 2014，161 门课的元分析，部分课程达到 50%）
- 中国大学生 AI 使用率已达 99.2%，AI 代写让传统作业查重整体失效（ITiCSE 2024 证实 ChatGPT 能从题目描述直接生成通过评测的完整代码）
- 一个老师面对一百多个学生，过程性反馈成了奢侈品

学生卡住的那一刻，没有人看见。SigmaMentor 想改变这件事。

## 🧩 系统架构

四个课程无关的教学 Agent 构成"诊断、干预、再诊断验证"的循环，编程课工具包是第一个插上的场景包。

![SigmaMentor 系统架构](docs/images/architecture.png)

| 组件 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| 编排器（apps/api） | 驱动"诊断 → 干预 → 再诊断验证"循环 | 各 Agent 输出 | 干预触发、数据回流 |
| 诊断 Agent | 还原卡点轨迹 | 提交序列、编译错误演化、测试覆盖 | 知识缺陷画像（可回溯到具体提交） |
| 导师 Agent | 分级引导，永不给答案 | 诊断结果 + 对话历史 | L1 定向 → L2 策略 → L3 样例 → L4 复盘 |
| 评估 Agent | 重建 AI 代写时代的评估 | 编辑轨迹、版本序列、提交节奏 | 过程证据信号（只辅助教师判断） |
| 学情 Agent | 班级聚合与干预建议 | 全班诊断数据 | 卡点热力图、高危名单、针对性练习 |

## 📸 界面一览

以下截图全部来自种子数据演示环境（52 名学生 · 10 题 · 816 次提交 · 1690 条过程事件）。学生端墨黑主题，教师端中性灰主题，同一套 Ink Classic 设计系统。

### 学生端

**作业中心（F1）** — 按教学周分组的题目列表，实时判题状态与提交次数：

![学生端 · 作业中心](docs/images/screenshots/student-assignments.png)

**作业工作台（F1）** — 题面 / 在线编辑器 / 判题结果三栏布局，右侧过程事件流只追加写入 `submission_events`：

![学生端 · 作业工作台](docs/images/screenshots/student-workspace.png)

**卡点诊断（F2）** — 错误演化时间线、知识缺陷置信度、每条结论可回溯到具体提交的证据链：

![学生端 · 卡点诊断](docs/images/screenshots/student-diagnosis.png)

**导师对话（F3）** — L1–L4 分级引导状态机，产品红线 ①：任何一级都不产出完整可提交代码：

![学生端 · 导师对话](docs/images/screenshots/student-tutor.png)

**登录 / 注册** — 学生以学号自注册：

![学生端 · 登录](docs/images/screenshots/student-login.png)

![学生端 · 注册](docs/images/screenshots/student-register.png)

### 教师端

**班级学情看板（F6）** — 知识点 × 教学周卡点热力图，点击单元格展开该知识点的卡点学生明细：

![教师端 · 班级学情看板](docs/images/screenshots/teacher-dashboard.png)

**高危名单（F7）** — 每人可展开完整证据链（提交轨迹 + 同型错误序列 + 干预建议），只呈现不定罪：

![教师端 · 高危名单](docs/images/screenshots/teacher-students.png)

**登录 / 注册** — 教师凭邀请码注册：

![教师端 · 登录](docs/images/screenshots/teacher-login.png)

![教师端 · 注册](docs/images/screenshots/teacher-register.png)

## 🗂 过程数据，被丢弃五十年的地基

传统评测平台（OJ）只保存最终判定，对了还是错了。学生在到达终点的路上经历了什么，第几次提交开始错、错在哪个知识点、卡了四十分钟还是三小时、有没有人管，全部丢弃。

SigmaMentor 把这条路记录下来。`submission_events` 表捕获每一次编辑、编译错误、运行错误、部分通过、求助和放弃，连同时间间隔。诊断 Agent 的输入、代写证据的来源、未来开源数据集的核心，全在这一张表上。

## 🧭 四个核心设计决策

**1. 永不给答案。** Generation Effect 的结论很明确，自己生成的答案才记得牢。直接给完整代码是在帮学生挂掉期末考试。

**2. 主动干预，不做被动问答。** Khanmigo 被公开承认的教训是"只给学生访问权限是 non-event"。我们的导师由诊断触发推送，连续多次同型错误或超时未提交时主动出现。

**3. 评估靠过程证据，不靠查重。** 查重已死（AI 生成代码人人不同）。编辑轨迹、版本序列、提交节奏才是可信信号。系统红线是辅助教师判断而非替代决策，误判学生是教学事故。

**4. 数据不出校。** 从诊断到批改的全部流程都支持开源大模型（GLM、Qwen、DeepSeek）本地量化部署。这是高校教育数据合规的硬约束，也是云端 SaaS 方案覆盖不到的地方。

## ⚙️ 技术栈

| 模块 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 运行时 | Bun | 1.3 | 包管理、脚本运行时 |
| 语言 | TypeScript | 5.9 | strict 模式，前后端类型贯通 |
| Monorepo | bun workspaces | - | apps / packages / services 三区 |
| 前端框架 | React | 19 | 学生端与教师端共用组件基础 |
| 构建工具 | Bun 原生 bundler | - | 开发与构建统一 Bun，不引入 Vite |
| CSS | Tailwind CSS | 4 | CLI 接入，零配置文件 |
| UI 组件 | shadcn/ui 风格 + Radix | - | 代码进仓库，Ink Classic 主题定制 |
| 数据请求 | TanStack Query | 5 | 异步状态、缓存与轮询 |
| 服务框架 | Elysia | 1.4 | 高性能、端到端类型校验 |
| API 客户端 | Eden Treaty | 1.4 | 从 `App` 类型自动推导，前端零手写接口 |
| ORM | Drizzle ORM | 0.45 | 类型安全 schema、关系查询 |
| 数据库 | SQLite（bun:sqlite） | - | 当前开发与演示形态，零部署依赖 |
| 数据库（生产） | PostgreSQL | 18 | 生产主库；JSONB 列；复赛前切换 |
| 迁移 | drizzle-kit | 0.31 | Schema 即代码，版本化迁移 |
| LLM 调用 | pi-ai | 0.84 | 统一 provider 接口与模型发现 |
| LLM 协议 | OpenAI 兼容 | - | 云端 API 与本地推理共用一套实现 |
| 本地推理 | llama.cpp（llama-server） | - | GGUF 量化，消费级 GPU 即可运行 |
| 高并发推理 | vLLM（预留） | - | 全校规模时切换，仅改服务地址 |
| 判题沙箱（开发版） | Bun.spawn | - | 超时控制；生产换一次性容器隔离 |
| Lint | oxlint | 1.78 | correctness 级 error 零容忍 |
| Formatter | oxfmt | 0.63 | printWidth 100，import 排序 |

调用层与推理引擎解耦是关键设计。业务代码只依赖统一的 LLM 接口，云端 API 与 llama.cpp 本地推理之间是一行配置的切换，将来并发规模上来换 vLLM 也只是改一个服务地址。

## 🚀 快速开始

```bash
bun install          # 安装全部 workspace 依赖（已配 npmmirror 镜像）
bun run db:generate  # 生成迁移（schema → SQL）
bun run db:migrate   # 建表（SQLite，开箱即用，无需 Docker）
bun run db:seed      # 演示数据：1 教师 + 52 学生班级 + 10 题 + 三周学情快照
bun run dev:api      # 启动 API :3000（OpenAPI 文档 → /openapi）
bun run dev:student  # 学生端 :5183
bun run dev:teacher  # 教师端 :5184
```

运行需要 [Bun](https://bun.sh) 1.3 以上。全过程 SQLite 零外部依赖，无网络可离线演示。

**演示账号**（seed 生成，密码均为 `demo12345`）：

| 端 | 地址 | 账号 | 身份 |
| --- | --- | --- | --- |
| 教师端 | http://localhost:5184 | `teacher` | 主讲教师，看板 + 高危名单 |
| 学生端 | http://localhost:5183 | `liming` | 卡点学生（循环边界 · 原型主叙事） |

教师注册需邀请码（`.env` 的 `TEACHER_INVITE_CODE`，默认 `GOAI2026`）。

质量基线：`bun test`（60 项断言测试）/ `bun run lint`（零 error）/ `bun run fmt:check`。

## 🔌 LLM 配置

复制 `.env.example` 为 `.env`，按需切换三种模式。`off` 为默认——全部走规则引擎，零配置可跑；LLM 失败时自动降级规则版，服务不中断。

云端模式（开发与在线 Demo）：

```bash
LLM_MODE=cloud
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
```

本地模式（私有化部署与离线演示）：

```bash
LLM_MODE=local
LLM_LOCAL_URL=http://127.0.0.1:8080/v1
LLM_LOCAL_MODEL=qwen2.5-7b-instruct-q4_k_m
```

本地推理一条命令即可启动，单张消费级 GPU 就能支撑一个学院的编程课吞吐。

```bash
llama-server -m models/qwen2.5-7b-instruct-q4_k_m.gguf --port 8080
```

## 📁 数据库模型

当前为 SQLite（bun:sqlite 内置，Drizzle sqlite-core，JSON 列 text-json）。生产形态为 PostgreSQL 18（pg-core + JSONB，docker 一行起库），切换只改 `packages/db` 的 schema 方言与连接层，SQL 写法已保持迁移平滑。

| 表 | 角色 |
| --- | --- |
| `submission_events` | **产品地基**。提交轨迹事件，诊断与证据的原料（只追加、不可篡改） |
| `submissions` | 每次作业提交的代码与判定状态 |
| `assignments` / `classes` / `students` | 课程作业与班级学生（学生带匿名编号） |
| `users` | 登录注册（bcrypt + 签名 Cookie 会话） |
| `diagnoses` | 诊断 Agent 的画像输出（含证据链，版本化） |
| `guidance_sessions` | 导师对话会话（当前引导级别 + 消息历史） |
| `evidence_signals` | 评估 Agent 的代写证据信号（只呈现不定罪） |
| `interventions` / `analytics_snapshots` | 干预记录与班级学情快照 |

## 🧪 判题沙箱

`services/sandbox` 按**语言运行时适配器**（LanguageRunner）设计：新增判题语言只需注册一个适配器，不动架构。当前实现 JavaScript（bun 原生运行，零编译器依赖）与超时终止。

它当前是开发环境实现（子进程 + 超时控制 + 用例对比），并在代码中标注了红线：没有文件系统、网络与资源隔离，只能跑可信代码，不能直接暴露给真实课堂。生产方案是一次性容器（CPU、内存、网络全限制），安排在复赛阶段落地。

## 🗺️ 路线图

- **2026.08** 初赛方案提交，仓库建立，脚手架就绪
- **2026.08.25 - 09.03** 复赛，交付四 Agent 可运行 Demo 与完整流程视频，沙箱升级容器隔离，引入 Redis 会话与事件队列，数据层切换 PostgreSQL 18
- **2026.09** 秋季学期，产品嵌入团队主讲课程的每周实验课开始真实试点（学院报备、学生知情同意）
- **2026.09.22** 决赛答辩，携带三周真实课堂数据
- **之后** 课程工具包沿高数、物理、写作扩展，演进为高校课程 AI 导师平台

## 🎁 开源计划

三件套，随复赛和决赛分批释放。

| 组件 | 说明 | 状态 |
| --- | --- | --- |
| 高校编程课学习过程轨迹数据集 | 脱敏真实提交轨迹，SIGCSE 社区稀缺的中文语料 | 试点后发布 |
| 提交轨迹分析框架 | 诊断引擎、卡点识别算法、沙箱执行流水线，可复用于任何 OJ 数据 | 复赛开源 |
| 分级引导策略库 | 四级提示 Prompt 模板与课程知识库构建方法 | 复赛开源 |

数据集脱敏标准按个人信息保护的最严口径执行，宁慢勿错。未脱敏的原始数据永远不进入仓库。

## 📚 学术依据

- Bloom, B. S. (1984). _The 2 Sigma Problem: The Search for Methods of Group Instruction as Effective as One-to-one Tutoring_. Educational Researcher.
- Watson, C., & Li, F. W. B. (2014). _Failure Rates in Introductory Programming Revisited_. ACM SIGCSE.
- Kestin, G., et al. (2025). _AI tutoring outperforms in-class active learning_. Scientific Reports.
- Renkl, A., & Atkinson, R. K. — 样例渐隐（worked example fading）与引导分级
- ITiCSE 2024 — CS1 场景下的 ChatGPT 作弊检测研究
- Slamecka, N. J., & Graf, P. (1982). _The Generation Effect_ — 生成效应

## 👥 团队

SigmaMentor 是一支来自高校一线的教学与工程团队。成员包括人工智能课程教师、AI 大模型工作室指导教师，以及多个已上线 AI 产品的独立全栈开发者。

既懂怎么教，也懂怎么造。

## 📜 许可证

- 代码采用 [Apache License 2.0](./LICENSE)
- 数据集（发布时）采用 CC BY 4.0

## 🏆 参赛信息

本作品参加 GOAI 2026 世界人工智能开源大赛（无界应用赛道 · AI+教育），主办方为杭州市开源人工智能基金会。欢迎高校教师同行交流试点合作，Issue 或邮件均可。
