/**
 * A4 学情 Agent（规则版）：班级聚合——热力图、周统计、TOP 卡点。
 *
 * F6 验收 1：看板数据与底表 SQL 直查结果一致——本模块是唯一聚合口径，
 * 快照（analytics_snapshots）只是它的物化缓存，对账测试保证两者一致。
 */
import type { AnalyticsSnapshot, Diagnosis, Submission } from "@sigma/db";

export interface AnalyticsInput {
  /** 班级知识点全集（来自全部作业的标注，去重） */
  allKpKeys: { key: string; name: string }[];
  weekCount: number;
  /** 班级全部提交 */
  submissions: Submission[];
  /** 班级全部诊断 */
  diagnoses: Diagnosis[];
  /** assignmentId → weekNo */
  assignmentWeek: Map<string, number>;
  /** diagnosisId → studentId */
  diagnosisStudent: Map<string, string>;
  /** 高危人数（risk 模块给出） */
  riskCount: number;
  /** 已通过组合 `${studentId}:${assignmentId}`——卡点口径：当前仍卡着（最新提交未通过）才计入 */
  passedPairs: Set<string>;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

export function aggregateClass(input: AnalyticsInput): AnalyticsSnapshot[] {
  const {
    allKpKeys,
    weekCount,
    submissions,
    diagnoses,
    assignmentWeek,
    diagnosisStudent,
    riskCount,
    passedPairs,
  } = input;

  // ---- 每周素材 ----
  type WeekCell = { students: Set<string>; minutes: number[] };
  const kpIdx = new Map(allKpKeys.map((k, i) => [k.key, i]));
  const cells: WeekCell[][] = Array.from({ length: weekCount }, () =>
    allKpKeys.map(() => ({ students: new Set<string>(), minutes: [] as number[] })),
  );
  const stuckMedianPool: number[][] = Array.from({ length: weekCount }, () => []);
  const stuckPairs = Array.from({ length: weekCount }, () => new Set<string>());

  for (const d of diagnoses) {
    const week = assignmentWeek.get(d.assignmentId);
    const sid = diagnosisStudent.get(d.id);
    const top = d.stuckPoints[0];
    if (week == null || !sid || !top) continue;
    if (top.confidence < 0.3) continue;
    // 卡点口径：该生该题当前仍未通过（历史失败已解决的不再计入热力图）
    if (passedPairs.has(`${sid}:${d.assignmentId}`)) continue;
    const idx = kpIdx.get(top.kpKey);
    if (idx == null) continue;
    cells[week - 1]![idx]!.students.add(sid);
    cells[week - 1]![idx]!.minutes.push(d.stuckMinutes);
    stuckMedianPool[week - 1]!.push(d.stuckMinutes);
    stuckPairs[week - 1]!.add(`${sid}:${top.kpKey}`);
  }

  // ---- 周统计 + 是否开课 ----
  const weekStats = Array.from({ length: weekCount }, (_, i) => {
    const subs = submissions.filter((s) => assignmentWeek.get(s.assignmentId) === i + 1);
    const passes = subs.filter((s) => s.status === "pass");
    return {
      submits: subs.length,
      passRate: subs.length ? Math.round((passes.length / subs.length) * 100) : 0,
      active: subs.length > 0 || stuckPairs[i]!.size > 0,
    };
  });

  // ---- 热力矩阵（未开课周 = null）----
  const kps: AnalyticsSnapshot["kps"] = allKpKeys.map((kp, i) => ({
    key: kp.key,
    name: kp.name,
    weeks: weekStats.map((w, wi) =>
      w.active ? { n: cells[wi]![i]!.students.size, m: median(cells[wi]![i]!.minutes) } : null,
    ),
  }));

  // ---- 组装快照（周序 1..N）----
  return weekStats.map((w, wi) => {
    const rows = kps
      .map((kp) => ({ kp, cur: kp.weeks[wi], prev: kp.weeks[wi - 1] }))
      .filter((r) => r.cur !== null)
      .toSorted((a, b) => b.cur!.n - a.cur!.n || b.cur!.m - a.cur!.m)
      .slice(0, 3);

    return {
      stats: {
        submits: w.submits,
        stuckCount: stuckPairs[wi]!.size,
        stuckMedianMin: median(stuckMedianPool[wi]!),
        riskCount,
        passRate: w.passRate,
      },
      kps,
      topKps: rows.map((r) => ({
        key: r.kp.key,
        name: r.kp.name,
        n: r.cur!.n,
        m: r.cur!.m,
        delta: r.prev ? r.cur!.n - r.prev.n : null,
      })),
    };
  });
}
