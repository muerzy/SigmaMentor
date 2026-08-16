/**
 * F7 高危名单规则（规则版）：
 *   continuous 连续同型卡点 ≥ 3 ｜ drop 放弃 ≥ 2 ｜ anomaly 提交轨迹异常（A3 信号）
 * 验收：20 名模拟学生轨迹召回率 ≥ 90%；每名高危学生附可展开的证据链。
 * 红线 ②：名单与证据仅教师可见，不通知学生、不自动定罪。
 */
import type { Diagnosis, Submission, SubmissionEvent } from "@sigma/db";

import { classifySubmission, kpName } from "./knowledge-points";

export type RiskRule = "continuous" | "drop" | "anomaly";

export interface RiskTrackNode {
  t: string;
  type: string;
  label: string;
}

export interface RiskItem {
  studentId: string;
  rules: RiskRule[];
  summary: string;
  track: RiskTrackNode[];
  sameList: string[];
  detail: string;
  advice: string[];
}

export interface RiskInput {
  studentId: string;
  submissions: Submission[]; // 该生全部提交
  events: SubmissionEvent[]; // 该生全部事件
  diagnoses: Diagnosis[]; // 该生全部诊断
  assignmentKpKeys: Map<string, string[]>; // assignmentId → kpKeys
  anomalyStudentIds: Set<string>; // A3 标记的轨迹异常学生
}

export const RISK_RULE_LABELS: Record<RiskRule, { label: string; cls: string }> = {
  continuous: { label: "连续卡点", cls: "b-fail" },
  drop: { label: "多次放弃", cls: "b-warn" },
  anomaly: { label: "轨迹异常", cls: "b-info" },
};

export function detectRisk(input: RiskInput): RiskItem | null {
  const { studentId, submissions, events, diagnoses, assignmentKpKeys, anomalyStudentIds } = input;
  const rules: RiskRule[] = [];

  // 连续同型卡点：同一知识点在同一题上失败提交 ≥ 3（原型口径：李明 P-03 循环边界 ×3）
  const kpFailCount = new Map<string, number>();
  for (const sub of submissions) {
    if (sub.status === "pass") continue;
    const keys = assignmentKpKeys.get(sub.assignmentId) ?? [];
    for (const hit of classifySubmission(sub, keys)) {
      const key = `${sub.assignmentId}:${hit.key}`;
      kpFailCount.set(key, (kpFailCount.get(key) ?? 0) + 1);
    }
  }
  const topKpEntry = [...kpFailCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const topKp = topKpEntry
    ? { key: topKpEntry[0]!.split(":")[1]!, count: topKpEntry[1]! }
    : undefined;
  const continuous = (topKp?.count ?? 0) >= 3;
  if (continuous) rules.push("continuous");

  // 放弃 ≥ 2
  const dropEvents = events.filter((e) => e.eventType === "drop");
  if (dropEvents.length >= 2) rules.push("drop");

  // 轨迹异常（A3）
  if (anomalyStudentIds.has(studentId)) rules.push("anomaly");

  if (rules.length === 0) return null;

  // ---- 证据链 ----
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const track: RiskTrackNode[] = [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => e.eventType !== "edit")
    .map((e) => ({
      t: fmt(e.createdAt),
      type: e.eventType,
      label: e.detail.text.replace(/^提交 #\d+ · /, ""),
    }));

  const sameList: string[] = [];
  if (topKp && continuous) {
    sameList.push(`${kpName(topKp.key)} 同型失败 ${topKp.count} 次`);
  }
  if (dropEvents.length > 0) {
    const nights = dropEvents.filter(
      (e) => e.createdAt.getHours() >= 21 || e.createdAt.getHours() < 6,
    ).length;
    sameList.push(`放弃 ${dropEvents.length} 次${nights > 0 ? `（其中 ${nights} 次在夜间）` : ""}`);
  }
  if (anomalyStudentIds.has(studentId)) {
    sameList.push("轨迹异常信号（A3 · 仅呈现不定罪）");
  }

  const latestDiag = [...diagnoses].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const stuckMin = latestDiag?.stuckMinutes ?? 0;
  const summary = buildSummary(
    rules,
    topKp ? kpName(topKp.key) : undefined,
    topKp?.count ?? 0,
    stuckMin,
    dropEvents.length,
  );

  const detail =
    (topKp && continuous
      ? `「${kpName(topKp.key)}」类错误在同一题上持续复现（${topKp.count} 次），错误演化路径呈「失败→修正→同型再失败」特征，`
      : "") +
    (dropEvents.length >= 2 ? `期间记录放弃 ${dropEvents.length} 次（超时无活动）。` : "") +
    `诊断依据全部可回溯到具体提交记录（红线 ⑤）。`;

  const advice: string[] = [];
  if (continuous) advice.push("升级 L2 策略提示（对比样例）");
  if (rules.includes("drop")) advice.push("实验课安排面对面走查");
  if (rules.includes("anomaly")) advice.push("核对实验课出勤与现场过程记录（仅呈现证据，不定罪）");
  advice.push("暂缓追加新题量");

  return { studentId, rules, summary, track, sameList, detail, advice };
}

function buildSummary(
  rules: RiskRule[],
  kpName: string | undefined,
  failCount: number,
  stuckMin: number,
  drops: number,
): string {
  const parts: string[] = [];
  if (kpName && failCount > 0) parts.push(`${kpName}同型错误 ${failCount} 次`);
  if (stuckMin > 0) parts.push(`当前卡点 ${stuckMin} 分钟`);
  if (drops >= 2) parts.push(`放弃 ${drops} 次`);
  return parts.join(" · ") + (rules.includes("anomaly") ? " · 轨迹异常信号" : "");
}
