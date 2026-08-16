/**
 * 判题沙箱类型：LanguageRunner 可插拔语言适配器（PRD I2 / 技术栈「语言适配器」口径）。
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ ⛔ 红线（PRD I2）：本实现为开发版——Bun.spawn 子进程 + 超时终止，  │
 * │ 无文件系统/网络/资源隔离，只能跑可信代码，不可暴露给真实课堂。    │
 * │ 生产方案：一次性容器（CPU/内存/网络全限制 + 进程数限制）。        │
 * └──────────────────────────────────────────────────────────────────┘
 */
import type { CaseRow, JudgeCase, SubmissionStatus } from "@sigma/db";

export interface JudgeInput {
  code: string;
  /** 学生需完成的函数名 */
  funcName: string;
  cases: JudgeCase[];
  /** 单用例运行时限 ms */
  limitMs: number;
}

export interface JudgeOutput {
  status: SubmissionStatus;
  /** 0–100，按通过用例比例 */
  score: number;
  passCount: number;
  totalCount: number;
  detail: { rows?: CaseRow[]; message?: string };
  elapsedMs: number;
}

/** 语言运行时适配器：新增语言 = 新增一个本接口实现并注册，不动架构 */
export interface LanguageRunner {
  id: string;
  judge(input: JudgeInput): Promise<JudgeOutput>;
}
