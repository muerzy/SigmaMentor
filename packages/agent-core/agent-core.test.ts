import { describe, expect, test } from "bun:test";

import type { Submission, SubmissionEvent } from "@sigma/db";

import { aggregateClass } from "./src/analytics";
import { assessSubmission } from "./src/assessor";
import { diagnose } from "./src/diagnosis";
import { INDUCE_SAMPLES, applyRedline, violatesRedline } from "./src/redline";
import { detectRisk } from "./src/risk";
import { classifyIntent, initialState, opening, respond, finishL4 } from "./src/tutor";

/* ---------- 测试工厂 ---------- */

const T0 = new Date("2026-08-15T14:00:00").getTime();

function mkSub(over: Partial<Submission> & { seq: number }): Submission {
  return {
    id: `s-${over.seq}`,
    studentId: "stu-1",
    assignmentId: "a-1",
    code: "…",
    language: "js",
    status: "run_error",
    score: 0,
    passCount: 0,
    totalCount: 5,
    detail: { rows: [] },
    createdAt: new Date(T0 + over.seq * 60_000),
    ...over,
  } as Submission;
}

function mkEvt(
  seq: number,
  type: SubmissionEvent["eventType"],
  intervalMs: number,
  over: Partial<SubmissionEvent> = {},
): SubmissionEvent {
  return {
    id: `e-${seq}`,
    studentId: "stu-1",
    assignmentId: "a-1",
    submissionId: null,
    seq,
    eventType: type,
    detail: { text: `事件 ${seq}` },
    intervalMs,
    createdAt: new Date(T0 + seq * 60_000),
    ...over,
  } as SubmissionEvent;
}

const ASSIGNMENT = {
  id: "a-1",
  code: "P-03",
  funcName: "solve",
  knowledgePoints: [
    { key: "loop-boundary", name: "循环边界" },
    { key: "accumulator-init", name: "累加器初值" },
  ],
};

/* ---------- A1 诊断 ---------- */

describe("A1 诊断 Agent（规则版）", () => {
  test("边界多算一项 → 循环边界为 top 知识点，证据链含失败提交", () => {
    // 用例 n=0..4：小输入过、大输入全多加 n（i <= n 的经典错误）
    const rows = (mult: number) =>
      [0, 1, 5, 10, 100].map((n, i) => ({
        input: n,
        expected: n === 0 ? 0 : n === 1 ? 0 : (n * (n - 1)) / 2,
        got: n <= 1 ? (n === 1 ? 0 : 0) : (n * (n - 1)) / 2 + n * mult,
        ok: n <= 1,
        i,
      }));
    const subs = [
      mkSub({ seq: 1, status: "partial", passCount: 2, detail: { rows: rows(1) } }),
      mkSub({ seq: 2, status: "partial", passCount: 2, detail: { rows: rows(1) } }),
      mkSub({ seq: 3, status: "partial", passCount: 2, detail: { rows: rows(1) } }),
    ];
    const evts = [
      mkEvt(1, "edit", 0),
      mkEvt(2, "run", 6 * 60_000),
      mkEvt(3, "edit", 60_000),
      mkEvt(4, "partial", 30 * 60_000),
    ];
    const r = diagnose({
      assignment: ASSIGNMENT,
      submissions: subs,
      events: evts,
      now: T0 + 60 * 60_000,
    });
    expect(r.stuckPoints[0]?.kpKey).toBe("loop-boundary");
    expect(r.sameErrorCount).toBe(3);
    expect(r.evidence.length).toBe(3);
    expect(r.evidence.every((e) => e.submissionSeq > 0)).toBe(true); // 红线 ⑤：可回溯
    expect(r.conclusion).toContain("循环边界");
  });

  test("恒定偏移 → 累加器初值", () => {
    const rows = [0, 1, 5, 10, 100].map((n) => ({
      input: n,
      expected: (n * (n - 1)) / 2,
      got: (n * (n - 1)) / 2 - 1,
      ok: false,
    }));
    const subs = [mkSub({ seq: 1, status: "run_error", detail: { rows } })];
    const r = diagnose({
      assignment: ASSIGNMENT,
      submissions: subs,
      events: [mkEvt(1, "run", 60_000)],
      now: T0,
    });
    expect(r.stuckPoints[0]?.kpKey).toBe("accumulator-init");
  });

  test("全部通过 → 无未解缺陷结论", () => {
    const subs = [
      mkSub({ seq: 1, status: "pass", passCount: 5, score: 100, detail: { rows: [] } }),
    ];
    const r = diagnose({
      assignment: ASSIGNMENT,
      submissions: subs,
      events: [mkEvt(1, "pass", 60_000)],
      now: T0,
    });
    expect(r.conclusion).toContain("暂无未解决");
  });
});

/* ---------- A2 导师 + 红线（F3 验收）---------- */

const CTX = {
  funcName: "solve",
  problemTitle: "循环求和",
  kpKey: "loop-boundary",
  kpName: "循环边界",
};

describe("A2 导师 Agent 状态机", () => {
  test("升级不跳级：L1→L2→L3，L3 封顶", async () => {
    let st = initialState();
    const lv: number[] = [st.level];
    for (const _ of [1, 2, 3, 4]) {
      const r = await respond("还是没思路，再提示一下", st, CTX);
      st = r.state;
      lv.push(st.level);
    }
    expect(lv).toEqual([1, 2, 3, 3, 3]);
  });

  test("解出才进 L4，复盘完成后会话结束", async () => {
    let st = initialState();
    const r1 = await respond("我改好了，5/5 通过了", st, CTX);
    expect(r1.state.level).toBe(4);
    expect(r1.state.solved).toBe(true);
    const r2 = finishL4("循环边界：包含与不包含的判断", r1.state);
    expect(r2.state.finished).toBe(true);
    expect(r2.text).toContain("回流");
  });

  test("10 组诱导话术 100% 不给完整代码（F3 验收 1）", async () => {
    let st = initialState();
    let blocked = 0;
    for (const msg of INDUCE_SAMPLES) {
      const r = await respond(msg, st, CTX);
      st = r.state;
      // 规则版拒绝话术本身不含代码；再过一遍红线过滤器双检
      const check = applyRedline(r.text, { funcName: "solve" }, "不应出现");
      if (check.blocked) blocked += 1;
      expect(violatesRedline(r.text, { funcName: "solve" })).toBe(false);
      expect(r.state.level).toBeLessThanOrEqual(3); // 拒绝不改变等级
    }
    expect(blocked).toBe(0); // 拒绝话术自身不触发过滤
  });

  test("意图分类", () => {
    expect(classifyIntent("直接给我代码")).toBe("refuse");
    expect(classifyIntent("帮我写完整代码")).toBe("refuse");
    expect(classifyIntent("我改好了，全对")).toBe("solve");
    expect(classifyIntent("ac 了")).toBe("solve");
    expect(classifyIntent("还是没思路")).toBe("upgrade");
    expect(classifyIntent("我觉得是变量没初始化")).toBe("free");
  });

  test("开场白是 L1 提问且不含代码", () => {
    const r = opening(initialState(), CTX);
    expect(r.level).toBe(1);
    expect(r.text).toContain("n = 5");
    expect(violatesRedline(r.text, { funcName: "solve" })).toBe(false);
  });
});

describe("红线过滤器", () => {
  test("3 行以上代码围栏被拦截", () => {
    const bad =
      "这样写：\n```\nfunction solve(n) {\n  let s = 0;\n  for (let i = 1; i <= n; i++) s += i;\n  return s;\n}\n```";
    expect(violatesRedline(bad, { funcName: "solve" })).toBe(true);
  });
  test("规则陈述（含 < 与 <=）放行", () => {
    const ok = "包含用 <=，不包含用 <。对照着改一个字符就够了。";
    expect(violatesRedline(ok, { funcName: "solve" })).toBe(false);
  });
  test("单行内联提示放行", () => {
    const ok = "检查你的 for (let i = 1; i <= n; i++) 这一行的结束条件。";
    expect(violatesRedline(ok, { funcName: "solve" })).toBe(false);
  });
});

/* ---------- A3 评估 ---------- */

describe("A3 评估 Agent", () => {
  test("一次粘贴成型 + 首交即通过 → 两信号异常，措辞不定罪", () => {
    const target = mkSub({
      seq: 1,
      status: "pass",
      passCount: 5,
      score: 100,
      code: "x".repeat(500),
    });
    const evts = [mkEvt(1, "edit", 60_000, { detail: { text: "粘贴", extra: { chars: 80 } } })];
    const out = assessSubmission({ submissions: [target], events: evts, target });
    const anomalous = out.signals.filter((s) => s.anomalous).length;
    expect(anomalous).toBeGreaterThanOrEqual(2);
    expect(out.suspicion).toBe("high");
    expect(out.note).toContain("不构成代写认定"); // 红线 ②
  });

  test("逐步演化轨迹 → 低疑似", () => {
    const fails = [1, 2].map((seq) =>
      mkSub({ seq, status: "run_error", detail: { rows: [] }, code: "x".repeat(200) }),
    );
    const target = mkSub({
      seq: 3,
      status: "pass",
      passCount: 5,
      score: 100,
      code: "x".repeat(300),
    });
    const evts = Array.from({ length: 12 }, (_, i) =>
      mkEvt(i + 1, "edit", 30_000, { detail: { text: "编辑", extra: { chars: 60 } } }),
    );
    const out = assessSubmission({ submissions: [...fails, target], events: evts, target });
    expect(out.suspicion).toBe("low");
  });
});

/* ---------- A4 学情 ---------- */

describe("A4 学情 Agent 聚合", () => {
  test("热力矩阵与 TOP 卡点口径一致", () => {
    const diagnoses = [
      {
        id: "d1",
        studentId: "stu-1",
        assignmentId: "a-1",
        stuckPoints: [{ kpKey: "loop-boundary", kpName: "循环边界", confidence: 0.8 }],
        conclusion: "",
        evolution: [],
        evidence: [],
        stuckMinutes: 30,
        sameErrorCount: 3,
        engine: "rule",
        createdAt: new Date(T0),
      },
      {
        id: "d2",
        studentId: "stu-2",
        assignmentId: "a-1",
        stuckPoints: [{ kpKey: "loop-boundary", kpName: "循环边界", confidence: 0.7 }],
        conclusion: "",
        evolution: [],
        evidence: [],
        stuckMinutes: 20,
        sameErrorCount: 2,
        engine: "rule",
        createdAt: new Date(T0),
      },
    ] as never as import("@sigma/db").Diagnosis[];
    const subs = [
      mkSub({ seq: 1, status: "pass", passCount: 5, score: 100 }),
      mkSub({ seq: 2, status: "run_error" }),
    ];
    const snaps = aggregateClass({
      allKpKeys: [
        { key: "loop-boundary", name: "循环边界" },
        { key: "accumulator-init", name: "累加器初值" },
      ],
      weekCount: 2,
      submissions: subs,
      diagnoses,
      assignmentWeek: new Map([["a-1", 1]]),
      diagnosisStudent: new Map([
        ["d1", "stu-1"],
        ["d2", "stu-2"],
      ]),
      riskCount: 1,
      passedPairs: new Set(),
    });
    expect(snaps).toHaveLength(2);
    expect(snaps[0]!.stats.submits).toBe(2);
    expect(snaps[0]!.stats.passRate).toBe(50);
    const loopWeek1 = snaps[0]!.kps.find((k) => k.key === "loop-boundary")!;
    expect(loopWeek1.weeks[0]!.n).toBe(2);
    expect(loopWeek1.weeks[0]!.m).toBe(25); // median(30,20)
    // 第 2 周未开课 → null
    expect(snaps[1]!.kps[0]!.weeks[1]).toBeNull();
    expect(snaps[0]!.topKps[0]!.key).toBe("loop-boundary");
    expect(snaps[0]!.topKps[0]!.delta).toBeNull(); // 首周无对比
  });
});

/* ---------- F7 高危规则 ---------- */

describe("F7 高危名单规则", () => {
  test("连续同型 ≥3 + 放弃 ≥2 同时命中，证据链完整", () => {
    const rows = [0, 1, 5].map((n) => ({ input: n, expected: 0, got: n, ok: n <= 1 }));
    const subs = [1, 2, 3].map((seq) =>
      mkSub({ seq, status: "partial", passCount: 2, detail: { rows } }),
    );
    const evts = [
      mkEvt(1, "edit", 0),
      mkEvt(2, "run", 60_000),
      mkEvt(3, "drop", 22 * 60_000),
      mkEvt(4, "edit", 2 * 24 * 60 * 60 * 1000),
      mkEvt(5, "run", 60_000),
      mkEvt(6, "drop", 20 * 60_000),
    ];
    const item = detectRisk({
      studentId: "stu-1",
      submissions: subs,
      events: evts,
      diagnoses: [],
      assignmentKpKeys: new Map([["a-1", ["loop-boundary"]]]),
      anomalyStudentIds: new Set(),
    });
    expect(item).not.toBeNull();
    expect(item!.rules).toContain("continuous");
    expect(item!.rules).toContain("drop");
    expect(item!.track.length).toBeGreaterThan(0);
    expect(item!.detail).toContain("可回溯"); // 红线 ⑤ 措辞
  });

  test("正常学生不进名单", () => {
    const subs = [mkSub({ seq: 1, status: "pass", passCount: 5, score: 100 })];
    const item = detectRisk({
      studentId: "stu-2",
      submissions: subs,
      events: [mkEvt(1, "pass", 60_000)],
      diagnoses: [],
      assignmentKpKeys: new Map([["a-1", ["loop-boundary"]]]),
      anomalyStudentIds: new Set(),
    });
    expect(item).toBeNull();
  });
});
