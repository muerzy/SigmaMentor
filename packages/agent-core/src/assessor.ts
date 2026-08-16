/**
 * A3 评估 Agent（规则版）：三类代写过程信号——编辑轨迹 / 版本序列 / 提交节奏。
 *
 * 红线 ②：只呈现过程证据辅助教师判断，不自动定罪、不通知学生。
 * P0 阶段产出高危名单的「轨迹异常」规则；完整证据页是 P1（F8）。
 */
import type { Submission, SubmissionEvent } from "@sigma/db";
import type { EvidenceSignal } from "@sigma/db";

export interface AssessorInput {
  submissions: Submission[]; // 该生全部提交（跨题，按时间）
  events: SubmissionEvent[]; // 该生全部过程事件
  target: Submission; // 被评估的提交
}

export interface AssessorOutput {
  suspicion: "low" | "mid" | "high";
  signals: EvidenceSignal[];
  note: string;
}

export function assessSubmission(input: AssessorInput): AssessorOutput {
  const { target, submissions, events } = input;
  const signals: EvidenceSignal[] = [];

  // 信号一：编辑轨迹——一次粘贴成型 vs 逐步演化
  // 编辑事件携带 extra.chars（本次新增字符量，客户端采集）；总量远小于代码体积 → 一次性粘贴
  const editChars = events
    .filter((e) => e.eventType === "edit")
    .reduce((acc, e) => {
      const chars = (e.detail.extra as { chars?: number } | undefined)?.chars;
      return acc + (typeof chars === "number" ? chars : 40);
    }, 0);
  const codeLen = target.code.length;
  if (target.status === "pass" && editChars > 0 && editChars < codeLen * 0.3) {
    signals.push({
      kind: "edit_trace",
      label: "编辑轨迹",
      detail: `代码 ${codeLen} 字符，编辑累计仅 ${editChars} 字符（<30%）——疑似一次粘贴成型，无逐步演化`,
      anomalous: true,
    });
  } else {
    signals.push({
      kind: "edit_trace",
      label: "编辑轨迹",
      detail: `编辑累计 ${editChars} 字符 / 代码 ${codeLen} 字符，轨迹正常`,
      anomalous: false,
    });
  }

  // 信号二：版本序列——无失败记录的完美提交 vs 同题历史
  const sameProblem = submissions.filter(
    (s) =>
      s.assignmentId === target.assignmentId &&
      s.id !== target.id &&
      s.createdAt < target.createdAt,
  );
  const hasFailureHistory = sameProblem.some((s) => s.status !== "pass");
  const firstTryPass = target.status === "pass" && sameProblem.length === 0;
  if (firstTryPass || (target.status === "pass" && !hasFailureHistory && sameProblem.length > 0)) {
    signals.push({
      kind: "version_seq",
      label: "版本序列",
      detail: firstTryPass
        ? "首交即通过，无任何编译/运行失败记录"
        : "该题全部提交无失败记录，版本序列过于完美",
      anomalous: true,
    });
  } else {
    signals.push({
      kind: "version_seq",
      label: "版本序列",
      detail: `提交 ${sameProblem.length + 1} 次，含失败演化记录，序列正常`,
      anomalous: false,
    });
  }

  // 信号三：提交节奏——与能力画像不符的突变
  const passes = submissions
    .filter((s) => s.status === "pass")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let rhythmAnomalous = false;
  let rhythmDetail = "节奏与历史画像一致";
  const recentPasses = passes.filter(
    (p) => Math.abs(p.createdAt.getTime() - target.createdAt.getTime()) < 15 * 60 * 1000,
  );
  if (recentPasses.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < recentPasses.length; i++) {
      gaps.push(recentPasses[i]!.createdAt.getTime() - recentPasses[i - 1]!.createdAt.getTime());
    }
    const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    if (medianGap < 3 * 60 * 1000) {
      rhythmAnomalous = true;
      rhythmDetail = `${recentPasses.length} 题在短时间内连续通过（中位间隔 ${Math.round(medianGap / 1000)} 秒）——与历史卡点画像不符的突变`;
    }
  }
  signals.push({
    kind: "rhythm",
    label: "提交节奏",
    detail: rhythmDetail,
    anomalous: rhythmAnomalous,
  });

  const anomalousCount = signals.filter((s) => s.anomalous).length;
  const suspicion = anomalousCount >= 2 ? "high" : anomalousCount === 1 ? "mid" : "low";

  return {
    suspicion,
    signals,
    // 措辞红线：辅助判断，不定罪
    note:
      suspicion === "low"
        ? "三类过程信号未见异常。"
        : `${anomalousCount} 项过程信号异常——仅为辅助教师判断的证据，不构成代写认定（红线 ②）。`,
  };
}
