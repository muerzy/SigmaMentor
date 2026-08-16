/**
 * A1 诊断 Agent（规则版 + LLM 增强接口）。
 *
 * 输入 = 该生该题的全部提交与过程事件（submission_events 是地基表）；
 * 输出 = 知识缺陷画像：卡点知识点（置信度）、卡点时长、错误演化路径、
 * 证据链（产品红线 ⑤：每条结论可回溯到具体提交）。
 */
import type {
  Assignment,
  EvolutionNode,
  EvidenceRef,
  Submission,
  SubmissionEvent,
  StuckPoint,
} from "@sigma/db";

import { classifySubmission, extractFailureSignals, kpName } from "./knowledge-points";

export interface DiagnosisInput {
  assignment: Pick<Assignment, "id" | "code" | "knowledgePoints" | "funcName">;
  submissions: Submission[];
  events: SubmissionEvent[];
  now?: number;
}

export interface DiagnosisResult {
  stuckPoints: StuckPoint[];
  conclusion: string;
  evolution: EvolutionNode[];
  evidence: EvidenceRef[];
  /** 当前会话卡点分钟 */
  stuckMinutes: number;
  /** 累计卡点分钟（跨会话） */
  totalStuckMinutes: number;
  sameErrorCount: number;
}

/* ---------- 会话切分与卡点时长 ---------- */

const SESSION_GAP_MS = 30 * 60 * 1000; // 间隔超 30 分钟视为新会话
const STUCK_CAP_MS = 15 * 60 * 1000; // 单段间隔最多记 15 分钟（防跨天虚增）

function sessions(events: SubmissionEvent[]): SubmissionEvent[][] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const out: SubmissionEvent[][] = [];
  let cur: SubmissionEvent[] = [];
  for (const e of sorted) {
    if (cur.length > 0 && e.intervalMs > SESSION_GAP_MS) {
      out.push(cur);
      cur = [];
    }
    cur.push(e);
    if (e.eventType === "drop") {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function stuckMinutesOf(sess: SubmissionEvent[]): number {
  return Math.round(sess.reduce((acc, e) => acc + Math.min(e.intervalMs, STUCK_CAP_MS), 0) / 60000);
}

/* ---------- 演化路径 ---------- */

const EVT_TITLE: Record<string, string> = {
  edit: "编辑",
  compile: "编译错误",
  run: "运行错误",
  partial: "部分通过",
  pass: "通过",
  drop: "放弃",
};

function buildEvolution(
  events: SubmissionEvent[],
  submissions: Submission[],
  now: number,
): EvolutionNode[] {
  const subBySeq = new Map(submissions.map((s) => [s.seq, s]));
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const nodes: EvolutionNode[] = [];

  for (const e of sorted) {
    // 连续同类编译错误合并展示（原型口径：编译错误 ×2）
    const prev = nodes.at(-1);
    if (
      prev &&
      prev.type === e.eventType &&
      (e.eventType === "compile" || e.eventType === "edit")
    ) {
      prev.title = `${EVT_TITLE[e.eventType] ?? e.eventType} ×2`;
      continue;
    }
    const sub = e.submissionId ? subBySeq.get(Number(e.detail.extra?.["seq"] ?? -1)) : undefined;
    nodes.push({
      time: e.createdAt.getTime(),
      type: e.eventType,
      title: EVT_TITLE[e.eventType] ?? e.eventType,
      detail: e.detail.text,
      submissionSeq: sub?.seq,
    });
  }

  // 末尾卡点持续节点：最后一次失败事件距今 > 5 分钟且未通过
  const lastFail = [...sorted]
    .reverse()
    .find((e) => e.eventType !== "edit" && e.eventType !== "pass");
  const passed = sorted.some((e) => e.eventType === "pass");
  if (lastFail && !passed) {
    const minutes = Math.round((now - lastFail.createdAt.getTime()) / 60000);
    if (minutes >= 5) {
      nodes.push({
        time: now,
        type: "stuck",
        title: `卡点持续 · ${minutes} 分钟`,
        detail: "同型错误未解 · 已触发导师主动干预（F5）",
      });
    }
  }
  return nodes;
}

/* ---------- 主入口 ---------- */

export function diagnose(input: DiagnosisInput): DiagnosisResult {
  const { assignment, submissions, events } = input;
  const now = input.now ?? Date.now();
  const chron = [...submissions].sort((a, b) => a.seq - b.seq);
  const kpKeys = assignment.knowledgePoints.map((k) => k.key);

  // 1. 知识点置信度：模式命中强度 + 复发次数 + 卡点时长
  const sess = sessions(events);
  const currentSession = sess.at(-1) ?? [];
  const stuckMinutes = stuckMinutesOf(currentSession);
  const totalStuckMinutes = sess.reduce((acc, s) => acc + stuckMinutesOf(s), 0);

  const kpHits = new Map<string, { strength: number; count: number; lastSeq: number }>();
  for (const sub of chron) {
    for (const hit of classifySubmission(sub, kpKeys)) {
      const cur = kpHits.get(hit.key) ?? { strength: 0, count: 0, lastSeq: sub.seq };
      cur.strength = Math.max(cur.strength, hit.strength);
      cur.count += 1;
      cur.lastSeq = sub.seq;
      kpHits.set(hit.key, cur);
    }
  }

  const stuckPoints: StuckPoint[] = [...kpHits.entries()]
    .map(([key, h]) => ({
      kpKey: key,
      kpName: kpName(key),
      confidence: Math.min(
        0.95,
        0.3 * h.strength + 0.12 * Math.min(h.count, 3) + Math.min(0.12, stuckMinutes / 400),
      ),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = stuckPoints[0];
  const sameErrorCount = top ? (kpHits.get(top.kpKey)?.count ?? 0) : 0;

  // 2. 证据链：全部命中 top 知识点的失败提交（可点击回溯，红线 ⑤）
  const evidence: EvidenceRef[] = chron
    .filter(
      (s) =>
        s.status !== "pass" &&
        classifySubmission(s, kpKeys).some((h) => !top || h.key === top.kpKey),
    )
    .map((s) => ({
      submissionSeq: s.seq,
      submissionId: s.id,
      eventType:
        s.status === "compile_error"
          ? "compile"
          : s.status === "pass"
            ? "pass"
            : s.status === "partial"
              ? "partial"
              : "run",
      note: s.detail.message ?? `${s.passCount}/${s.totalCount} 用例`,
    }));

  // 3. 结论（模板版；LLM 增强由 api 层调用 enhanceConclusion，证据链结构不变）
  const latest = chron.at(-1);
  let conclusion: string;
  if (!top || chron.every((s) => s.status === "pass")) {
    conclusion = "该题暂无未解决的知识缺陷——保持当前节奏，解出后可进入 L4 复盘沉淀方法论。";
  } else {
    const firstFail = chron.find((s) => s.status !== "pass");
    const patternDesc = describePattern(latest);
    conclusion =
      `该生自第 ${firstFail?.seq ?? 1} 次提交起，${top.kpName}类错误持续复现 ${sameErrorCount} 次，` +
      `累计卡点 ${totalStuckMinutes} 分钟；最近一次${statusZh(latest?.status)}${patternDesc}。` +
      `建议：接受 L1 定向提示自主修正；解出后进入 L4 复盘回流画像。`;
  }

  return {
    stuckPoints,
    conclusion,
    evolution: buildEvolution(events, chron, now),
    evidence,
    stuckMinutes,
    totalStuckMinutes,
    sameErrorCount,
  };
}

function statusZh(status?: string): string {
  switch (status) {
    case "compile_error":
      return "为编译错误";
    case "partial":
      return "为部分通过";
    case "timeout":
      return "为超时";
    case "run_error":
      return "为运行错误";
    default:
      return "";
  }
}

function describePattern(sub?: Submission): string {
  if (!sub) return "";
  const rows = sub.detail.rows;
  if (!rows) return sub.detail.message ? `（${sub.detail.message}）` : "";
  const signals = extractFailureSignals(rows);
  if (signals.inputOffset) return "——失败用例全部多算一项，指向边界取值";
  if (signals.constOffset !== null) return `——全部结果恒偏移 ${signals.constOffset}，指向初值残留`;
  if (signals.crashes > 0) return "——运行异常，指向索引/调用问题";
  return "";
}

/**
 * LLM 增强结论（F2 复赛版）：用自然语言重写规则版结论。
 * 约束：只改写表达，不改证据链结构（stuckPoints/evidence/evolution 原样保留）；
 * LLM 失败或未配置时回退规则版文本（I1 验收 2）。
 */
export async function enhanceConclusion(
  llm: {
    available(): boolean;
    complete(req: {
      messages: { role: "system" | "user" | "assistant"; content: string }[];
      temperature?: number;
      maxTokens?: number;
    }): Promise<{ text: string }>;
  },
  result: DiagnosisResult,
  studentName: string,
): Promise<{ conclusion: string; engine: "llm" | "rule" }> {
  if (!llm.available()) return { conclusion: result.conclusion, engine: "rule" };
  const top = result.stuckPoints[0];
  const system = [
    "你是编程课学情诊断助手。把规则引擎的结论改写成给这名学生看的一段话。",
    "要求：温暖但直接，先说事实（哪类错误、复现几次、卡了多久），再给一个可执行的下一步。",
    "禁止给出任何代码或具体改法。不超过 140 字。引用证据时保留「第 N 次提交」这类可回溯措辞。",
  ].join("\n");
  const user = [
    `学生：${studentName}`,
    `卡点知识点：${top?.kpName ?? "无"}（置信度 ${top ? top.confidence.toFixed(2) : "-"})`,
    `同型错误 ${result.sameErrorCount} 次，当前会话卡点 ${result.stuckMinutes} 分钟，累计 ${result.totalStuckMinutes} 分钟`,
    `证据提交：${result.evidence.map((e) => `#${e.submissionSeq}`).join(" · ") || "无"}`,
    `规则版结论：${result.conclusion}`,
  ].join("\n");
  try {
    const res = await llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      maxTokens: 300,
    });
    if (!res.text.trim()) return { conclusion: result.conclusion, engine: "rule" };
    return { conclusion: res.text.trim(), engine: "llm" };
  } catch (err) {
    console.warn(
      `[diagnosis] LLM 增强失败，回退规则版: ${err instanceof Error ? err.message : err}`,
    );
    return { conclusion: result.conclusion, engine: "rule" };
  }
}
