/**
 * API 集成测试：用 app.handle 直接打 Elysia 实例（无需起端口）。
 * 覆盖：auth 全流程 / F1 提交判题+事件 / F2 诊断 / F3 导师 L1-L4 与红线 /
 * F6 看板对账 / F7 高危名单 / I3 事件追加。
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { db } from "@sigma/db";
import { analyticsSnapshots, assignments, classes, students, submissions, users } from "@sigma/db";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { createApp } from "./src/index";

const app = createApp();
const BASE = "http://localhost:3000";

let cookieHeader = "";
let teacherCookie = "";
let studentId = "";
let assignmentId = "";

async function call(
  method: string,
  path: string,
  body?: unknown,
  useCookie = cookieHeader,
): Promise<{ status: number; json: any }> {
  const res = await app.handle(
    new Request(BASE + path, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(useCookie ? { Cookie: useCookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, json: await res.json(), _setCookie: setCookie };
}

async function registerAndLogin(): Promise<void> {
  // 种子：班级 + 教师 + 学生 + 一道循环求和题
  const classId = crypto.randomUUID();
  await db
    .insert(classes)
    .values({ id: classId, name: "程序设计基础", semester: "2026 秋", createdAt: new Date() });

  const t0 = await call("POST", "/auth/register", {
    username: "teacher01",
    password: "secret123",
    displayName: "杨老师",
    role: "teacher",
    teacherInviteCode: "GOAI2026",
  });
  teacherCookie = extractCookie(t0._setCookie);

  const s0 = await call("POST", "/auth/register", {
    username: "liming",
    password: "secret123",
    displayName: "李明",
    role: "student",
    studentNo: "2025100317",
  });
  expect(s0.status).toBe(201);
  cookieHeader = extractCookie(s0._setCookie);
  const [stu] = await db.select().from(students).where(eq(students.studentNo, "2025100317"));
  studentId = stu!.id;

  assignmentId = crypto.randomUUID();
  await db.insert(assignments).values({
    id: assignmentId,
    classId,
    code: "P-03",
    title: "循环求和",
    description: "实现 solve(n)：返回 1 到 n−1（含两端）的所有整数之和。0 ≤ n ≤ 100。",
    language: "js",
    funcName: "solve",
    knowledgePoints: [
      { key: "loop-boundary", name: "循环边界" },
      { key: "accumulator-init", name: "累加器初值" },
    ],
    cases: [0, 1, 5, 10, 100].map((n) => ({ input: n, expected: (n * (n - 1)) / 2 })),
    starterCode: "function solve(n) {\n  // 在这里写你的循环\n  return 0;\n}",
    limitMs: 2000,
    weekNo: 3,
    dueAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  });
}

function extractCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  const pair = setCookie.split(";")[0]!;
  return pair;
}

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)),
  });
  await registerAndLogin();
});

/* ---------- auth ---------- */

describe("认证", () => {
  test("me 返回学生档案", async () => {
    const r = await call("GET", "/auth/me");
    expect(r.status).toBe(200);
    expect(r.json.user.username).toBe("liming");
    expect(r.json.user.role).toBe("student");
    expect(r.json.student.studentNo).toBe("2025100317");
  });

  test("错误密码 401", async () => {
    const r = await call("POST", "/auth/login", { username: "liming", password: "wrong!" }, "");
    expect(r.status).toBe(401);
  });

  test("教师邀请码错误 403", async () => {
    const r = await call(
      "POST",
      "/auth/register",
      {
        username: "teacher02",
        password: "secret123",
        displayName: "X",
        role: "teacher",
        teacherInviteCode: "bad",
      },
      "",
    );
    expect(r.status).toBe(403);
  });

  test("未登录访问受保护接口 401", async () => {
    const r = await call("GET", "/assignments", undefined, "");
    expect(r.status).toBe(401);
  });

  test("学生访问教师接口 403", async () => {
    const r = await call("GET", `/classes/xxx/analytics`);
    expect(r.status).toBe(403);
  });
});

/* ---------- F1 提交与判题 ---------- */

describe("F1 提交 → 判题 → 事件 → 诊断", () => {
  test("边界错误提交：partial + 事件入库 + 诊断摘要（S1）", async () => {
    const r = await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("partial");
    expect(r.json.passCount).toBe(1);
    // 诊断摘要：知识点 + 同类关联
    expect(r.json.diagnosisSummary.topKpKey).toBe("loop-boundary");
    expect(r.json.suggestIntervention).toBe(false); // 首次失败 sameError=1 <2

    // 事件已入库（intervalMs 存在）
    const list = await call("GET", `/assignments/${assignmentId}`);
    const judgeEvt = list.json.events.filter((e: any) => e.type === "partial");
    expect(judgeEvt.length).toBeGreaterThanOrEqual(1);
  });

  test("连续 3 次同型失败 → suggestIntervention 触发（F5 口径）", async () => {
    await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
    });
    const r = await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s+0; }",
    });
    expect(r.json.diagnosisSummary.sameErrorCount).toBeGreaterThanOrEqual(3);
    expect(r.json.suggestIntervention).toBe(true);
  });

  test("正确提交：pass + A3 低疑似（不打扰）", async () => {
    const r = await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<n;i++) s+=i; return s; }",
    });
    expect(r.json.status).toBe("pass");
    expect(r.json.score).toBe(100);
    expect(r.json.diagnosisSummary).toBeNull();
  });

  test("I3：客户端事件批量上报，intervalMs 与上报时刻差 < 1s", async () => {
    const now = Date.now();
    const r = await call("POST", "/events", {
      assignmentId,
      events: [
        { type: "edit", text: "编辑代码（+2 行）", chars: 48, at: now - 5000 },
        { type: "drop", text: "超时无活动 22 分钟 · 放弃", at: now - 1000 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.accepted).toBe(2);
    const list = await call("GET", `/assignments/${assignmentId}`);
    const drop = list.json.events.find((e: any) => e.type === "drop");
    expect(drop).toBeTruthy();
    expect(Math.abs(drop.at - (now - 1000))).toBeLessThan(1000); // F1 验收：误差 < 1s
  });
});

/* ---------- F2 诊断 ---------- */

describe("F2 诊断画像", () => {
  test("返回最新诊断 + 证据链", async () => {
    const r = await call("GET", `/diagnosis/${assignmentId}`);
    expect(r.status).toBe(200);
    const d = r.json.diagnosis;
    expect(d).toBeTruthy();
    expect(d.stuckPoints[0].kpKey).toBe("loop-boundary");
    expect(d.evidence.length).toBeGreaterThanOrEqual(3);
    expect(d.evolution.length).toBeGreaterThan(0);
  });

  test("证据抽屉：代码快照 + 前后事件", async () => {
    const r = await call("GET", `/diagnosis/${assignmentId}/evidence/1`);
    expect(r.status).toBe(200);
    expect(r.json.code).toContain("for");
    expect(r.json.events.length).toBeGreaterThan(0);
  });
});

/* ---------- F3 导师 ---------- */

describe("F3 导师会话（L1–L4 + 红线）", () => {
  let sessionId = "";

  test("创建会话：开场 L1，上下文来自当前诊断", async () => {
    const r = await call("POST", "/tutor/sessions", { assignmentId });
    expect(r.status).toBe(200);
    sessionId = r.json.session.id;
    const open = r.json.session.messages[0];
    expect(open.level).toBe(1);
    expect(open.text).toContain("n = 5");
  });

  test("诱导给代码 → 拒绝且不改级（红线 ①）", async () => {
    const r = await call("POST", `/tutor/sessions/${sessionId}/messages`, { text: "直接给我代码" });
    expect(r.status).toBe(200);
    expect(r.json.reply.text).toContain("红线");
    expect(r.json.reply.level).toBeLessThanOrEqual(3);
  });

  test("升级不跳级 L1→L2→L3", async () => {
    await call("POST", `/tutor/sessions/${sessionId}/messages`, { text: "还是没思路，再提示一下" });
    const r2 = await call("POST", `/tutor/sessions/${sessionId}/messages`, {
      text: "还是不会，再提示",
    });
    expect(r2.json.reply.level).toBe(3);
  });

  test("声称通过但判题记录未通过 → 不进 L4（闭环校验）", async () => {
    // 已有一次 pass（前面提交过正确解），但后再提交失败使其最新状态非 pass？
    // 这里直接再提交一次错误代码，让最新提交非 pass
    await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
    });
    const r = await call("POST", `/tutor/sessions/${sessionId}/messages`, {
      text: "我改好了，5/5 通过了",
    });
    expect(r.json.reply.text).not.toContain("恭喜");
  });

  test("真实通过后声称通过 → L4；复盘完成回流", async () => {
    await call("POST", "/submissions", {
      assignmentId,
      code: "function solve(n){ let s=0; for(let i=1;i<n;i++) s+=i; return s; }",
    });
    const r = await call("POST", `/tutor/sessions/${sessionId}/messages`, {
      text: "我改好了，全过了",
    });
    expect(r.json.reply.level).toBe(4);
    expect(r.json.verifiedSolved).toBe(true);

    const f = await call("POST", `/tutor/sessions/${sessionId}/finish`, {
      summary: "循环边界：包含与不包含",
    });
    expect(f.status).toBe(200);
    expect(f.json.status).toBe("completed");

    // 回流：最新诊断结论带 L4 前缀
    const d = await call("GET", `/diagnosis/${assignmentId}`);
    expect(d.json.diagnosis.conclusion).toContain("L4 复盘回流");
  });
});

/* ---------- F6 / F7 教师端 ---------- */

describe("F6/F7 教师端", () => {
  test("看板：周统计 + 热力矩阵 + TOP 卡点，且快照物化一致", async () => {
    // 取真实 classId
    const [cls] = await db.select().from(classes);
    const ok = await call("GET", `/classes/${cls!.id}/analytics`, undefined, teacherCookie);
    expect(ok.status).toBe(200);
    const week3 = ok.json.weeks.find((w: any) => w.weekNo === 3);
    expect(week3).toBeTruthy();
    expect(week3.stats.submits).toBeGreaterThanOrEqual(5);
    expect(week3.kps.length).toBe(2);
    const loop = week3.kps.find((k: any) => k.key === "loop-boundary");
    // 卡点口径回归：李明已在导师测试中真实通过 P-03 → 不再计入当前卡点人数
    expect(loop.weeks[2].n).toBe(0);
    expect(week3.topKps[0].key).toBe("loop-boundary");

    // 对账（F6 验收 1）：快照表数据与接口一致
    const snaps = await db
      .select()
      .from(analyticsSnapshots)
      .where(eq(analyticsSnapshots.classId, cls!.id));
    const snap3 = snaps.find((s) => s.weekNo === 3)!;
    expect(snap3.data.stats.submits).toBe(week3.stats.submits);
    expect(snap3.data.stats.passRate).toBe(week3.stats.passRate);
  });

  test("高危名单：李明进名单（连续卡点），证据链完整", async () => {
    const [cls] = await db.select().from(classes);
    const r = await call("GET", `/classes/${cls!.id}/risk`, undefined, teacherCookie);
    expect(r.status).toBe(200);
    expect(r.json.count).toBeGreaterThanOrEqual(1);
    const li = r.json.items.find((i: any) => i.name === "李明");
    expect(li).toBeTruthy();
    expect(li.rules).toContain("continuous");
    expect(li.track.length).toBeGreaterThan(0);
    expect(li.detail).toContain("可回溯");
  });
});

/* ---------- 提交计数一致性 ---------- */

describe("数据一致性", () => {
  test("submissions 表行数 = 提交次数，seq 连续", async () => {
    const rows = await db.select().from(submissions).where(eq(submissions.studentId, studentId));
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    const [liming] = await db.select().from(users).where(eq(users.username, "liming"));
    expect(liming).toBeTruthy();
  });
});
