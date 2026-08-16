import { aggregateClass, detectRisk } from "@sigma/agent-core";
import type { RiskItem } from "@sigma/agent-core";
import { db } from "@sigma/db";
import {
  analyticsSnapshots,
  assignments,
  diagnoses,
  evidenceSignals,
  students,
  submissionEvents,
  submissions,
  users,
  type AnalyticsSnapshot,
} from "@sigma/db";
/**
 * 学情服务（A4）：按班级全量重算 → 物化到 analytics_snapshots（对账口径唯一）。
 */
import { eq } from "drizzle-orm";

export interface RiskEntry extends RiskItem {
  name: string;
  studentNo: string;
}

/** 知识点 → 卡点学生明细（热力单元格点开用）：最新诊断 top=该知识点且该题仍未通过 */
export async function computeKpStudents(
  classId: string,
): Promise<
  Record<string, { name: string; studentNo: string; minutes: number; sameErrorCount: number }[]>
> {
  const classStudents = await db.select().from(students).where(eq(students.classId, classId));
  if (classStudents.length === 0) return {};
  const studentIds = new Set(classStudents.map((s) => s.id));
  const users_ = await db.select().from(users);
  const nameById = new Map(users_.map((u) => [u.id, u.displayName]));
  const noByStudent = new Map(classStudents.map((s) => [s.id, s.studentNo]));

  const allDiag = (await db.select().from(diagnoses)).filter((d) => studentIds.has(d.studentId));
  // 每生每题取最新诊断（跨题不能互相覆盖）
  const latestByPairDiag = new Map<string, (typeof allDiag)[number]>();
  for (const d of allDiag) {
    const key = `${d.studentId}:${d.assignmentId}`;
    const cur = latestByPairDiag.get(key);
    if (!cur || d.createdAt > cur.createdAt) latestByPairDiag.set(key, d);
  }

  // 卡点口径：该生该题当前仍未通过（与热力图一致）
  const allSubs = (await db.select().from(submissions)).filter((s) => studentIds.has(s.studentId));
  const latestByPair = new Map<string, (typeof allSubs)[number]>();
  for (const s of allSubs) {
    const key = `${s.studentId}:${s.assignmentId}`;
    const cur = latestByPair.get(key);
    if (!cur || s.createdAt > cur.createdAt) latestByPair.set(key, s);
  }
  const stillStuck = (sid: string, aid: string) =>
    latestByPair.get(`${sid}:${aid}`)?.status !== "pass";

  const out: Record<
    string,
    { name: string; studentNo: string; minutes: number; sameErrorCount: number }[]
  > = {};
  for (const [pairKey, d] of latestByPairDiag) {
    const [sid, aid] = pairKey.split(":");
    const top = d.stuckPoints[0];
    if (!top || top.confidence < 0.3) continue;
    if (!stillStuck(sid!, aid!)) continue;
    const userId = classStudents.find((s) => s.id === sid)?.userId;
    const arr = out[top.kpKey] ?? [];
    arr.push({
      name: userId ? (nameById.get(userId) ?? "未知") : "未知",
      studentNo: noByStudent.get(sid!) ?? "",
      minutes: d.stuckMinutes,
      sameErrorCount: d.sameErrorCount,
    });
    out[top.kpKey] = arr;
  }
  for (const k of Object.keys(out)) out[k]!.sort((a, b) => b.minutes - a.minutes);
  return out;
}

export async function computeClassAnalytics(classId: string) {
  // 全班素材
  const classStudents = await db.select().from(students).where(eq(students.classId, classId));
  const studentIds = new Set(classStudents.map((s) => s.id));
  const classAssignments = await db
    .select()
    .from(assignments)
    .where(eq(assignments.classId, classId));

  const allSubs = (await db.select().from(submissions)).filter((s) => studentIds.has(s.studentId));
  const allDiag = (await db.select().from(diagnoses)).filter((d) => studentIds.has(d.studentId));

  const assignmentWeek = new Map(classAssignments.map((a) => [a.id, a.weekNo]));
  const diagnosisStudent = new Map(allDiag.map((d) => [d.id, d.studentId]));

  // 知识点全集（按标注顺序去重）
  const kpMap = new Map<string, string>();
  for (const a of classAssignments) {
    for (const kp of a.knowledgePoints) if (!kpMap.has(kp.key)) kpMap.set(kp.key, kp.name);
  }
  const allKpKeys = [...kpMap.entries()].map(([key, name]) => ({ key, name }));
  const weekCount = Math.max(1, ...classAssignments.map((a) => a.weekNo));

  // 高危名单（riskCount 供快照 stats）
  const risk = await computeClassRisk(classId);

  // 卡点口径：当前仍未通过（最新提交非 pass）的组合
  const passedPairs = new Set<string>();
  const latestByPair = new Map<string, (typeof allSubs)[number]>();
  for (const s of allSubs) {
    const key = `${s.studentId}:${s.assignmentId}`;
    const cur = latestByPair.get(key);
    if (!cur || s.createdAt > cur.createdAt) latestByPair.set(key, s);
  }
  for (const [key, s] of latestByPair) if (s.status === "pass") passedPairs.add(key);

  const snapshots = aggregateClass({
    allKpKeys,
    weekCount,
    submissions: allSubs,
    diagnoses: allDiag,
    assignmentWeek,
    diagnosisStudent,
    riskCount: risk.length,
    passedPairs,
  });

  // 物化快照（classId+weekNo 唯一：删旧插新）
  await db.delete(analyticsSnapshots).where(eq(analyticsSnapshots.classId, classId));
  for (let w = 1; w <= snapshots.length; w++) {
    await db.insert(analyticsSnapshots).values({
      id: crypto.randomUUID(),
      classId,
      weekNo: w,
      data: snapshots[w - 1]!,
      createdAt: new Date(),
    });
  }

  return { weeks: snapshots, risk };
}

/** F7：全班高危名单（连续卡点/放弃/轨迹异常），附学生姓名与证据链 */
export async function computeClassRisk(classId: string): Promise<RiskEntry[]> {
  const classStudents = await db.select().from(students).where(eq(students.classId, classId));
  if (classStudents.length === 0) return [];
  const studentIds = new Set(classStudents.map((s) => s.id));

  const classAssignments = await db
    .select()
    .from(assignments)
    .where(eq(assignments.classId, classId));
  const assignmentKpKeys = new Map(
    classAssignments.map((a) => [a.id, a.knowledgePoints.map((k) => k.key)]),
  );

  const allSubs = (await db.select().from(submissions)).filter((s) => studentIds.has(s.studentId));
  const allEvents = (await db.select().from(submissionEvents)).filter((e) =>
    studentIds.has(e.studentId),
  );
  const allDiag = (await db.select().from(diagnoses)).filter((d) => studentIds.has(d.studentId));

  // A3 轨迹异常学生集合（mid/high 信号）
  const signals = await db.select().from(evidenceSignals);
  const anomalyStudentIds = new Set(
    signals
      .filter((s) => studentIds.has(s.studentId) && s.suspicion !== "low")
      .map((s) => s.studentId),
  );

  const users_ = await db.select().from(users);
  const userById = new Map(users_.map((u) => [u.id, u]));

  const items: RiskEntry[] = [];
  for (const stu of classStudents) {
    const subs = allSubs.filter((s) => s.studentId === stu.id);
    const evts = allEvents.filter((e) => e.studentId === stu.id);
    const diags = allDiag.filter((d) => d.studentId === stu.id);
    const item = detectRisk({
      studentId: stu.id,
      submissions: subs,
      events: evts,
      diagnoses: diags,
      assignmentKpKeys,
      anomalyStudentIds,
    });
    if (item) {
      const user = userById.get(stu.userId);
      items.push({ ...item, name: user?.displayName ?? "未知", studentNo: stu.studentNo });
    }
  }
  return items;
}

export type { AnalyticsSnapshot };
