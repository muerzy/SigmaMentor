import { aggregateClass, diagnose } from "@sigma/agent-core";
import bcrypt from "bcryptjs";
/**
 * 演示种子数据（模拟班级，非真实学生信息）：
 * - 1 教师（teacher / demo12345）+ 1 班 52 学生（李明 = liming / demo12345）
 * - 10 道 JS 题 × 5 用例（第 1–3 教学周），P-03 循环求和 = 原型主叙事题
 * - 52 名学生的提交/过程事件（6 名高危带完整原型轨迹），诊断由规则引擎实时算出
 *   （seed 不伪造诊断——保证「看板 = 底表 SQL」的对账口径天然成立）
 * - analytics_snapshots 由 aggregateClass 物化
 *
 * 幂等：清空后重建。bun run db:seed
 */
/* eslint-disable no-await-in-loop -- 种子必须按时间序串行写入：提交/事件的 seq 与 createdAt 单调递增，并行会乱序 */
import { eq } from "drizzle-orm";

import { db } from "./client";
import {
  analyticsSnapshots,
  assignments,
  classes,
  diagnoses,
  evidenceSignals,
  guidanceSessions,
  interventions,
  submissionEvents,
  submissions,
  users,
  type CaseRow,
  type Submission,
  type SubmissionEvent,
} from "./schema";
import { students } from "./schema";

/* ---------- 确定性伪随机（可重复 seed）---------- */
let rngState = 20260816;
function rnd(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}

/* ---------- 时间锚点 ---------- */
const NOW = Date.now();
const MIN = 60_000;
/** 第 3 周（本周）事件相对 now；第 1/2 周用固定过去日期 */
const W1 = new Date("2026-08-10T19:00:00").getTime();
const W2 = new Date("2026-08-13T19:00:00").getTime();

/* ---------- 题库（10 题 × 5 用例）---------- */

interface ProblemDef {
  code: string;
  title: string;
  description: string;
  funcName: string;
  weekNo: number;
  kps: { key: string; name: string }[];
  cases: { input: unknown; expected: unknown }[];
  starter: string;
  /** 错误形态：partial(边界差) / crash(运行错) / const(偏移) / type(格式) —— 用于生成失败提交 */
  failShape: "boundary" | "crash" | "const" | "type" | "mixed";
  solution: string;
  buggy: string;
}

const KP = {
  loop: { key: "loop-boundary", name: "循环边界" },
  acc: { key: "accumulator-init", name: "累加器初值" },
  out: { key: "output-format", name: "输入输出格式" },
  arr: { key: "array-bound", name: "数组越界" },
  fn: { key: "func-args", name: "函数参数传递" },
  rec: { key: "recursion-base", name: "递归终止条件" },
  cond: { key: "condition", name: "条件分支" },
  float: { key: "float-compare", name: "浮点比较" },
  var: { key: "var-assign", name: "变量与赋值" },
} as const;

const PROBLEMS: ProblemDef[] = [
  {
    code: "P-01",
    title: "两数交换",
    funcName: "swap2",
    weekNo: 1,
    description: "实现 swap2(pair)：pair 是 { a, b }，返回交换后的对象 { a: 原b, b: 原a }。",
    kps: [KP.var],
    failShape: "mixed",
    cases: [
      { input: { a: 1, b: 2 }, expected: { a: 2, b: 1 } },
      { input: { a: 5, b: 0 }, expected: { a: 0, b: 5 } },
      { input: { a: -3, b: 7 }, expected: { a: 7, b: -3 } },
      { input: { a: 9, b: 9 }, expected: { a: 9, b: 9 } },
      { input: { a: 100, b: -100 }, expected: { a: -100, b: 100 } },
    ],
    starter: "function swap2(pair) {\n  // 返回交换后的对象\n  return pair;\n}",
    solution: "function swap2(p){ return { a: p.b, b: p.a }; }",
    buggy: "function swap2(p){ const t = p.a; p.a = p.b; return p; }",
  },
  {
    code: "P-02",
    title: "奇偶判断",
    funcName: "parity",
    weekNo: 1,
    description: "实现 parity(n)：偶数返回 'even'，奇数返回 'odd'（注意返回的是字符串）。",
    kps: [KP.cond, KP.out],
    failShape: "type",
    cases: [
      [0, "even"],
      [1, "odd"],
      [7, "odd"],
      [10, "even"],
      [99, "odd"],
    ].map(([i, e]) => ({ input: i, expected: e })),
    starter: "function parity(n) {\n  return '';\n}",
    solution: "function parity(n){ return n % 2 === 0 ? 'even' : 'odd'; }",
    buggy: "function parity(n){ return n % 2 === 0 ? 0 : 1; }",
  },
  {
    code: "P-04",
    title: "成绩分级",
    funcName: "grade",
    weekNo: 1,
    description: "实现 grade(score)：≥90 返回 'A'，≥80 'B'，≥70 'C'，其余 'D'。0 ≤ score ≤ 100。",
    kps: [KP.cond, KP.out],
    failShape: "mixed",
    cases: [
      [95, "A"],
      [85, "B"],
      [70, "C"],
      [69, "D"],
      [100, "A"],
    ].map(([i, e]) => ({ input: i, expected: e })),
    starter: "function grade(score) {\n  return '';\n}",
    solution: "function grade(s){ return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : 'D'; }",
    buggy: "function grade(s){ return s > 90 ? 'A' : s > 80 ? 'B' : s > 70 ? 'C' : 'D'; }",
  },
  {
    code: "P-05",
    title: "数组求和",
    funcName: "sumAll",
    weekNo: 2,
    description: "实现 sumAll(arr)：返回数组所有元素之和，空数组返回 0。",
    kps: [KP.acc],
    failShape: "const",
    cases: [[], [5], [1, 2], [1, 2, 3], [10, -10, 7]].map((a) => ({
      input: a,
      expected: a.reduce((x, y) => x + y, 0),
    })),
    starter: "function sumAll(arr) {\n  let s;\n  for (const x of arr) s += x;\n  return s;\n}",
    solution: "function sumAll(a){ return a.reduce((x,y)=>x+y,0); }",
    buggy: "function sumAll(a){ let s = 1; for (const x of a) s += x; return s; }",
  },
  {
    code: "P-06",
    title: "数组最大值",
    funcName: "maxOf",
    weekNo: 2,
    description: "实现 maxOf(arr)：返回数组中的最大值（数组非空）。",
    kps: [KP.arr, KP.fn],
    failShape: "crash",
    cases: [
      [3, 3],
      [1, 5, 5],
      [-1, -5, -1],
      [7, 7, 3, 7],
      [0, -2, 9, 9],
    ].map(([a, e]) => ({ input: a, expected: e })),
    starter: "function maxOf(arr) {\n  // 提示：下标从 0 开始\n  return arr[0];\n}",
    solution: "function maxOf(a){ return Math.max(...a); }",
    buggy: "function maxOf(a){ return a[a.length]; }",
  },
  {
    code: "P-07",
    title: "字符串反转",
    funcName: "reverseStr",
    weekNo: 2,
    description: "实现 reverseStr(s)：返回反转后的字符串。",
    kps: [KP.fn, KP.arr],
    failShape: "crash",
    cases: [
      ["", ""],
      ["a", "a"],
      ["ab", "ba"],
      ["abc", "cba"],
      ["abcde", "edcba"],
    ].map(([i, e]) => ({ input: i, expected: e })),
    starter: "function reverseStr(s) {\n  return '';\n}",
    solution: "function reverseStr(s){ return [...s].reverse().join(''); }",
    buggy: "function reverseStr(s){ return s.split().reverse().join(''); }",
  },
  {
    code: "P-03",
    title: "循环求和",
    funcName: "solve",
    weekNo: 3,
    description:
      "实现 solve(n)：返回 1 到 n−1（含两端）的所有整数之和。0 ≤ n ≤ 100。注意边界：n−1 要被加进去。",
    kps: [KP.loop, KP.acc],
    failShape: "boundary",
    cases: [0, 1, 5, 10, 100].map((n) => ({ input: n, expected: (n * (n - 1)) / 2 })),
    starter:
      "function solve(n) {\n  let s = 0;\n  for (let i = 1; i <= n; i++) {\n    s += i;\n  }\n  return s;\n}",
    solution: "function solve(n){ let s=0; for(let i=1;i<n;i++) s+=i; return s; }",
    buggy: "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
  },
  {
    code: "P-08",
    title: "斐波那契",
    funcName: "fib",
    weekNo: 3,
    description: "实现 fib(n)：返回第 n 项斐波那契数（fib(0)=0, fib(1)=1）。",
    kps: [KP.rec, KP.cond],
    failShape: "mixed",
    cases: [
      [0, 0],
      [1, 1],
      [2, 1],
      [7, 13],
      [12, 144],
    ].map(([i, e]) => ({ input: i, expected: e })),
    starter: "function fib(n) {\n  if (n < 2) return n;\n  // 递归或循环皆可\n  return 0;\n}",
    solution:
      "function fib(n){ if(n<2) return n; let a=0,b=1; for(let i=2;i<=n;i++) [a,b]=[b,a+b]; return b; }",
    buggy:
      "function fib(n){ if(n<=2) return n; let a=0,b=1; for(let i=2;i<=n;i++) [a,b]=[b,a+b]; return a; }",
  },
  {
    code: "P-09",
    title: "去重保序",
    funcName: "dedup",
    weekNo: 3,
    description: "实现 dedup(arr)：去掉重复元素，保持首次出现的顺序。",
    kps: [KP.arr],
    failShape: "mixed",
    cases: [
      [1, [1]],
      [1, 1, [1]],
      [1, 2, 1, [1, 2]],
      [3, 3, 3, [3]],
      [1, 2, 2, 1, [1, 2]],
    ].map(([a, e]) => ({ input: a, expected: e })),
    starter: "function dedup(arr) {\n  return arr;\n}",
    solution: "function dedup(a){ return [...new Set(a)]; }",
    buggy: "function dedup(a){ return a.filter((x,i)=>a.indexOf(x)!==i); }",
  },
  {
    code: "P-10",
    title: "二次判别",
    funcName: "rootCount",
    weekNo: 3,
    description: "实现 rootCount(q)：q = { a, b, c }，返回判别式 b²−4ac 的根的个数（0/1/2）。",
    kps: [KP.cond, KP.float],
    failShape: "mixed",
    cases: [
      { input: { a: 1, b: -3, c: 2 }, expected: 2 },
      { input: { a: 1, b: 0, c: -4 }, expected: 2 },
      { input: { a: 1, b: 2, c: 1 }, expected: 1 },
      { input: { a: 1, b: 0, c: 1 }, expected: 0 },
      { input: { a: 2, b: -4, c: 2 }, expected: 1 },
    ],
    starter: "function rootCount(q) {\n  return 0;\n}",
    solution:
      "function rootCount(q){ const d=q.b*q.b-4*q.a*q.c; if(d<0) return 0; if(d===0) return 1; return 2; }",
    buggy:
      "function rootCount(q){ const d=q.b*q.b-4*q.a*q.c; if(d<0) return 1; if(d===0) return 0; return 2; }",
  },
];

/* ---------- 判题模拟（与沙箱口径一致的行构造）---------- */

/** 自定义变体代码的判题形态（与真实执行语义一致） */
type Shape = "boundary" | "boundaryMinus" | "const1" | "crash" | "type";

function rowsFor(
  problem: ProblemDef,
  code: string,
  shape?: Shape,
): { rows: CaseRow[]; status: "pass" | "partial" | "run_error" | "compile_error"; score: number } {
  if (code === "SYNTAX") {
    return { rows: [], status: "compile_error", score: 0 };
  }
  const rows: CaseRow[] = problem.cases.map((c) => {
    if (code === problem.solution)
      return { input: c.input, expected: c.expected, got: c.expected, ok: true };
    // 显式形态（自定义变体代码）优先
    if (shape === "boundary") {
      const n = c.input as number;
      return { input: c.input, expected: c.expected, got: (c.expected as number) + n, ok: false };
    }
    if (shape === "boundaryMinus") {
      const n = c.input as number;
      const got = (c.expected as number) + n - 1; // 初值 -1 + i<=n：偏移 n-1
      return { input: c.input, expected: c.expected, got, ok: got === (c.expected as number) };
    }
    if (shape === "const1") {
      return { input: c.input, expected: c.expected, got: (c.expected as number) + 1, ok: false };
    }
    if (shape === "crash") {
      return {
        input: c.input,
        expected: c.expected,
        got: { error: "TypeError: Cannot read properties of undefined" },
        ok: false,
      };
    }
    if (shape === "type") {
      return {
        input: c.input,
        expected: c.expected,
        got: (c.expected as string) === "even" ? 0 : 1,
        ok: false,
      };
    }
    if (code === problem.buggy) {
      // 按错误形态构造与真实执行一致的 got
      if (problem.failShape === "boundary") {
        const n = c.input as number;
        const got = (c.expected as number) + n; // i <= n 多加一个 n
        return { input: c.input, expected: c.expected, got, ok: got === (c.expected as number) };
      }
      if (problem.failShape === "const") {
        return { input: c.input, expected: c.expected, got: (c.expected as number) + 1, ok: false };
      }
      if (problem.failShape === "crash") {
        return {
          input: c.input,
          expected: c.expected,
          got: { error: "TypeError: Cannot read properties of undefined" },
          ok: false,
        };
      }
      if (problem.failShape === "type") {
        return {
          input: c.input,
          expected: c.expected,
          got: (c.expected as string) === "even" ? 0 : 1,
          ok: false,
        };
      }
      // mixed：部分对（前 2 组对，后 3 组错）
      const idx = problem.cases.indexOf(c);
      if (idx < 2) return { input: c.input, expected: c.expected, got: c.expected, ok: true };
      return {
        input: c.input,
        expected: c.expected,
        got: { error: "Error: 输出与期望不符" },
        ok: false,
      };
    }
    return { input: c.input, expected: c.expected, got: c.expected, ok: true };
  });
  const pass = rows.filter((r) => r.ok).length;
  const total = rows.length;
  if (pass === total) return { rows, status: "pass", score: 100 };
  if (pass > 0) return { rows, status: "partial", score: Math.round((pass / total) * 100) };
  return { rows, status: "run_error", score: 0 };
}

/* ---------- 主流程 ---------- */

async function main() {
  // 幂等清空（FK 安全顺序）
  for (const t of [
    submissionEvents,
    submissions,
    diagnoses,
    guidanceSessions,
    evidenceSignals,
    interventions,
    analyticsSnapshots,
    students,
    assignments,
    users,
    classes,
  ]) {
    await db.delete(t);
  }

  const passwordHash = await bcrypt.hash("demo12345", 10);

  // 班级 + 教师
  const classId = crypto.randomUUID();
  await db.insert(classes).values({
    id: classId,
    name: "程序设计基础 · 计算机 2025-3 班",
    semester: "2026 秋",
    createdAt: new Date(W1),
  });
  await db.insert(users).values({
    id: crypto.randomUUID(),
    username: "teacher",
    passwordHash,
    role: "teacher",
    displayName: "杨老师",
    createdAt: new Date(W1),
  });

  // 学生名单：6 名高危实名（原型口径）+ 46 名生成名
  const RISK_NAMES = ["李明", "王雪", "陈宇", "赵磊", "孙婷", "周豪"];
  const SURNAMES =
    "张刘陈杨赵黄周吴徐孙马朱胡郭何高林郑谢罗梁宋唐许韩冯邓曹彭曾萧田董潘袁蔡蒋余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
  const GIVENS = [
    "浩然",
    "雨桐",
    "子涵",
    "佳怡",
    "博文",
    "思远",
    "静怡",
    "俊杰",
    "梦琪",
    "天宇",
    "欣怡",
    "皓轩",
    "紫萱",
    "宇轩",
    "诗涵",
    "明轩",
    "雅静",
    "志强",
    "雪梅",
    "建国",
    "海燕",
    "春华",
    "秋实",
    "冬梅",
    "夏荷",
    "文博",
    "若曦",
    "浩宇",
    "晓彤",
    "晨曦",
  ];
  const studentNames = [...RISK_NAMES];
  let gi = 0;
  while (studentNames.length < 52) {
    const surname = SURNAMES[studentNames.length % SURNAMES.length]!;
    const given = GIVENS[gi % GIVENS.length]!;
    const name = surname + given;
    if (!studentNames.includes(name)) studentNames.push(name);
    gi++;
  }

  interface StudentRow {
    id: string;
    userId: string;
    name: string;
    studentNo: string;
    risk: boolean;
  }
  const studentRows: StudentRow[] = [];
  for (let i = 0; i < studentNames.length; i++) {
    const name = studentNames[i]!;
    const risk = i < RISK_NAMES.length;
    const studentNo = i === 0 ? "2025100317" : `2025100${String(200 + i)}`;
    const userId = crypto.randomUUID();
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      username: i === 0 ? "liming" : `s${String(i + 1).padStart(2, "0")}`,
      passwordHash,
      role: "student",
      displayName: name,
      createdAt: new Date(W1),
    });
    await db.insert(students).values({
      id,
      userId,
      classId,
      studentNo,
      anonNo: `anon-${String(i + 1).padStart(3, "0")}`,
      createdAt: new Date(W1),
    });
    studentRows.push({ id, userId, name, studentNo, risk });
  }

  // 作业
  const assignmentByCode = new Map<string, string>();
  for (const p of PROBLEMS) {
    const id = crypto.randomUUID();
    assignmentByCode.set(p.code, id);
    await db.insert(assignments).values({
      id,
      classId,
      code: p.code,
      title: p.title,
      description: p.description,
      language: "js",
      funcName: p.funcName,
      knowledgePoints: p.kps,
      cases: p.cases,
      starterCode: p.starter,
      limitMs: 2000,
      weekNo: p.weekNo,
      dueAt: new Date(
        p.weekNo === 1
          ? W1 + 3 * 24 * 3600_000
          : p.weekNo === 2
            ? W2 + 3 * 24 * 3600_000
            : NOW + 24 * 3600_000,
      ),
      createdAt: new Date(p.weekNo === 1 ? W1 : p.weekNo === 2 ? W2 : NOW - 3 * 24 * 3600_000),
    });
  }

  /* ---------- 提交/事件生成器 ---------- */

  async function addSubmission(
    studentId: string,
    problem: ProblemDef,
    seq: number,
    code: string,
    at: number,
    shape?: Shape,
  ): Promise<{ id: string; sub: Submission }> {
    const judged = rowsFor(problem, code, shape);
    const id = crypto.randomUUID();
    const sub: Submission = {
      id,
      studentId,
      assignmentId: assignmentByCode.get(problem.code)!,
      seq,
      code: code === "SYNTAX" ? `${problem.starter.split("\n")[0]} (缺少分号` : code,
      language: "js",
      status: judged.status,
      score: judged.score,
      passCount: judged.rows.filter((r) => r.ok).length,
      totalCount: judged.rows.length || problem.cases.length,
      detail:
        judged.status === "compile_error"
          ? {
              message: `${problem.funcName}.js:6:1 error: Unexpected token, expected ";" (缺少分号)`,
            }
          : { rows: judged.rows },
      createdAt: new Date(at),
    } as Submission;
    await db.insert(submissions).values(sub);
    return { id, sub };
  }

  let eventSeqCounter = new Map<string, number>();
  async function addEvent(
    studentId: string,
    problem: ProblemDef,
    type: SubmissionEvent["eventType"],
    text: string,
    at: number,
    submissionId?: string,
    intervalMs?: number,
  ) {
    const key = `${studentId}:${problem.code}`;
    const seq = (eventSeqCounter.get(key) ?? 0) + 1;
    eventSeqCounter.set(key, seq);
    await db.insert(submissionEvents).values({
      id: crypto.randomUUID(),
      studentId,
      assignmentId: assignmentByCode.get(problem.code)!,
      submissionId: submissionId ?? null,
      seq,
      eventType: type,
      detail: { text, extra: submissionId ? { chars: Math.floor(rnd() * 80 + 30) } : undefined },
      intervalMs: intervalMs ?? Math.floor(rnd() * 5 * MIN),
      createdAt: new Date(at),
    });
    return seq;
  }

  /** 普通学生轨迹：f 次失败（含编辑事件）→ 是否最终通过 */
  async function genNormal(
    stu: StudentRow,
    problem: ProblemDef,
    weekBase: number,
    fails: number,
    finallyPass: boolean,
  ) {
    let t = weekBase + Math.floor(rnd() * 3 * 3600_000);
    await addEvent(stu.id, problem, "edit", "开始编辑题目", t, undefined, 0);
    for (let i = 1; i <= fails; i++) {
      t += Math.floor(rnd() * 8 * MIN + 2 * MIN);
      const useSyntax = i === 1 && problem.weekNo === 1 && rnd() < 0.5;
      const { id, sub } = await addSubmission(
        stu.id,
        problem,
        i,
        useSyntax ? "SYNTAX" : problem.buggy,
        t,
      );
      const evtType =
        sub.status === "compile_error" ? "compile" : sub.status === "partial" ? "partial" : "run";
      const label =
        sub.status === "compile_error"
          ? "缺少分号"
          : `${sub.passCount}/${sub.totalCount} 用例未通过`;
      await addEvent(stu.id, problem, evtType, `提交 #${i} · ${label}`, t, id);
      t += Math.floor(rnd() * 4 * MIN + MIN);
      await addEvent(stu.id, problem, "edit", "编辑代码", t);
    }
    if (finallyPass) {
      t += Math.floor(rnd() * 10 * MIN + 3 * MIN);
      const { id } = await addSubmission(stu.id, problem, fails + 1, problem.solution, t);
      await addEvent(
        stu.id,
        problem,
        "pass",
        `提交 #${fails + 1} · ${problem.cases.length}/${problem.cases.length} 用例通过`,
        t,
        id,
      );
    }
  }

  /* ---------- 李明完整原型轨迹（P-03）---------- */

  const liming = studentRows[0]!;
  const P03 = PROBLEMS.find((p) => p.code === "P-03")!;
  {
    // seq 1-11 与原型 assignment.html 一致；本周事件锚定 now-41min
    const t7 = NOW - 41 * MIN; // 提交 #7（部分通过）时刻
    const t6 = t7 - 24 * MIN;
    const t5 = t6 - 18 * 60_000;
    const t4 = t5 - 2 * MIN;
    const d2 = new Date("2026-08-12T20:41:00").getTime();
    const s1 = d2,
      s2 = s1 + 26 * MIN,
      s3 = s2 + 37 * MIN;

    await addEvent(liming.id, P03, "edit", "开始编辑题目 P-03", s1, undefined, 0);
    const sub1 = await addSubmission(liming.id, P03, 1, "SYNTAX", s1 + 6.2 * MIN);
    await addEvent(
      liming.id,
      P03,
      "compile",
      "提交 #1 · main.js:6: 缺少分号",
      s1 + 6.2 * MIN,
      sub1.id,
      372_000,
    );
    await addEvent(
      liming.id,
      P03,
      "edit",
      "编辑代码（+2 行）",
      s1 + 6.2 * MIN + 26_000,
      undefined,
      26_000,
    );
    const sub2 = await addSubmission(liming.id, P03, 2, "SYNTAX", s2);
    await addEvent(liming.id, P03, "compile", "提交 #2 · main.js:6: 缺少分号", s2, sub2.id, 63_000);
    await addEvent(liming.id, P03, "edit", "重写循环段", s2 + 37_000, undefined, 37_000);
    const sub3 = await addSubmission(
      liming.id,
      P03,
      3,
      "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
      s3,
    );
    await addEvent(liming.id, P03, "run", "提交 #3 · 0/5 用例未通过", s3, sub3.id, 114_000);
    await addEvent(
      liming.id,
      P03,
      "drop",
      "超时无活动 22 分钟 · 放弃",
      s3 + 6_960_000,
      undefined,
      6_960_000,
    );
    await addEvent(
      liming.id,
      P03,
      "edit",
      "重新打开题目 · 修改输入解析段",
      t4,
      undefined,
      2 * 24 * 3600_000 + 14 * 3600_000,
    );
    const sub5 = await addSubmission(liming.id, P03, 4, "SYNTAX", t5);
    await addEvent(liming.id, P03, "compile", "提交 #5 · 变量未声明", t5, sub5.id, 126_000);
    const sub6 = await addSubmission(
      liming.id,
      P03,
      5,
      "function solve(n){ let s=-1; for(let i=1;i<=n;i++) s+=i; return s; }",
      t6,
      "boundaryMinus",
    );
    await addEvent(liming.id, P03, "run", "提交 #6 · 0/5 · 全部偏移 1", t6, sub6.id, 18_000);
    const sub7 = await addSubmission(
      liming.id,
      P03,
      6,
      "function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }",
      t7,
    );
    await addEvent(
      liming.id,
      P03,
      "partial",
      "提交 #7 · 1/5 用例通过（仅 n=0）",
      t7,
      sub7.id,
      24 * MIN,
    );
  }

  /* ---------- 其余 5 名高危轨迹（数据取自原型 data.js，压缩落地）---------- */

  const byName = (n: string) => studentRows.find((s) => s.name === n)!;
  // 王雪：数组越界（P-06）三度深夜放弃
  {
    const stu = byName("王雪");
    const p = PROBLEMS.find((x) => x.code === "P-06")!;
    const base = W2;
    await addEvent(stu.id, p, "edit", "开始编辑", base, undefined, 0);
    const s1 = await addSubmission(stu.id, p, 1, p.buggy, base + 38 * MIN);
    await addEvent(
      stu.id,
      p,
      "run",
      "提交 #1 · 运行错误（undefined）",
      base + 38 * MIN,
      s1.id,
      38 * MIN,
    );
    await addEvent(
      stu.id,
      p,
      "drop",
      "超时无活动 19 分钟 · 放弃 ①",
      base + 57 * MIN,
      undefined,
      19 * MIN,
    );
    const t2 = W2 + 26 * 3600_000;
    const s2 = await addSubmission(stu.id, p, 2, p.buggy, t2);
    await addEvent(stu.id, p, "run", "提交 #2 · 运行错误", t2, s2.id, 2 * 3600_000);
    await addEvent(
      stu.id,
      p,
      "drop",
      "超时无活动 14 分钟 · 放弃 ②",
      t2 + 14 * MIN,
      undefined,
      14 * MIN,
    );
    const t3 = W2 + 2 * 24 * 3600_000 + 4 * 3600_000;
    const s3 = await addSubmission(stu.id, p, 3, p.buggy, t3);
    await addEvent(stu.id, p, "run", "提交 #3 · 运行错误 ×2", t3, s3.id, 3 * 3600_000);
    await addEvent(
      stu.id,
      p,
      "drop",
      "超时无活动 31 分钟 · 放弃 ③",
      t3 + 31 * MIN,
      undefined,
      31 * MIN,
    );
    // 本周继续卡
    const p3 = P03;
    const tn = NOW - 44 * MIN;
    await addEvent(stu.id, p3, "edit", "开始编辑", tn - 2 * 3600_000, undefined, 0);
    const s4 = await addSubmission(stu.id, p3, 1, p3.buggy, tn);
    await addEvent(stu.id, p3, "partial", "提交 #1 · 1/5 用例未通过", tn, s4.id, 2 * 3600_000);
  }
  // 陈宇：函数参数传递 + 一次粘贴成型（A3 证据）
  {
    const stu = byName("陈宇");
    const p = PROBLEMS.find((x) => x.code === "P-07")!;
    // 前史：有失败演化
    for (let i = 1; i <= 3; i++) {
      await genNormal(
        stu,
        PROBLEMS.find((x) => x.code === (i === 1 ? "P-01" : i === 2 ? "P-02" : "P-04"))!,
        W1,
        1,
        true,
      );
    }
    for (let i = 1; i <= 3; i++) {
      await genNormal(
        stu,
        PROBLEMS.find((x) => x.code === (i === 1 ? "P-05" : i === 2 ? "P-06" : "P-07"))!,
        W2,
        2,
        true,
      );
    }
    // 本周：P-03 一次粘贴成型 92%，首交通过
    const t = NOW - 3 * 3600_000;
    await addEvent(stu.id, P03, "edit", "打开题目", t, undefined, 0);
    await addEvent(stu.id, P03, "edit", "粘贴成型 92%", t + 30_000, undefined, 30_000);
    const s = await addSubmission(stu.id, P03, 1, P03.solution, t + 71_000);
    await addEvent(stu.id, P03, "pass", "提交 #1 · 5/5 用例通过 +41s", t + 71_000, s.id, 41_000);
    void p;
  }
  // 赵磊：累加器初值同型 4 次（P-05）
  {
    const stu = byName("赵磊");
    const p = PROBLEMS.find((x) => x.code === "P-05")!;
    let t = W2 + 3600_000;
    await addEvent(stu.id, p, "edit", "开始编辑", t, undefined, 0);
    for (let i = 1; i <= 4; i++) {
      t += (i - 1) * 24 * 3600_000 + 53 * MIN;
      const s = await addSubmission(stu.id, p, i, p.buggy, t);
      await addEvent(stu.id, p, "partial", `提交 #${i} · 部分通过（恒偏移 1）`, t, s.id, 53 * MIN);
    }
    // 本周 P-03 也卡累加器+边界
    const tn = NOW - 29 * MIN;
    await addEvent(stu.id, P03, "edit", "开始编辑", tn - 90 * MIN, undefined, 0);
    const s = await addSubmission(
      stu.id,
      P03,
      1,
      "function solve(n){ let s=1; for(let i=1;i<n;i++) s+=i; return s; }",
      tn,
      "const1",
    );
    await addEvent(stu.id, P03, "partial", "提交 #1 · 全部用例偏移 1", tn, s.id, 90 * MIN);
  }
  // 孙婷：字符串结束符/数组边界连续卡 3 次 + 放弃 2 次（P-07）
  {
    const stu = byName("孙婷");
    const p = PROBLEMS.find((x) => x.code === "P-07")!;
    let t = W2 + 44 * MIN;
    await addEvent(stu.id, p, "edit", "开始编辑", t, undefined, 0);
    for (let i = 1; i <= 3; i++) {
      t += 47 * MIN;
      const s = await addSubmission(stu.id, p, i, p.buggy, t);
      await addEvent(stu.id, p, "run", `提交 #${i} · 运行错误（undefined）`, t, s.id, 47 * MIN);
      if (i < 3) {
        t += 27 * MIN;
        await addEvent(
          stu.id,
          p,
          "drop",
          `超时无活动 27 分钟 · 放弃 ${i === 1 ? "①" : "②"}`,
          t,
          undefined,
          27 * MIN,
        );
      }
    }
    // 本周 P-09 继续卡
    const p9 = PROBLEMS.find((x) => x.code === "P-09")!;
    const tn = NOW - 43 * MIN;
    await addEvent(stu.id, p9, "edit", "开始编辑", tn - 80 * MIN, undefined, 0);
    const s = await addSubmission(stu.id, p9, 1, p9.buggy, tn);
    await addEvent(stu.id, p9, "run", "提交 #1 · 输出与期望不符", tn, s.id, 80 * MIN);
  }
  // 周豪：提交节奏突变（前两周通过率低，本周 5 题连续通过）
  {
    const stu = byName("周豪");
    const w1p = [PROBLEMS[0]!, PROBLEMS[1]!, PROBLEMS[2]!];
    for (const p of w1p) await genNormal(stu, p, W1, 3, rnd() < 0.4);
    const w2p = [PROBLEMS[3]!, PROBLEMS[4]!, PROBLEMS[5]!];
    for (const p of w2p) await genNormal(stu, p, W2, 2, rnd() < 0.4);
    // 本周 4 题 8 分钟内全对（间隔 <3 分钟）
    const w3 = [
      P03,
      PROBLEMS.find((x) => x.code === "P-08")!,
      PROBLEMS.find((x) => x.code === "P-09")!,
      PROBLEMS.find((x) => x.code === "P-10")!,
    ];
    let t = NOW - 4 * 3600_000;
    for (const p of w3) {
      await addEvent(stu.id, p, "edit", "粘贴成型", t, undefined, 0);
      const s = await addSubmission(stu.id, p, 1, p.solution, t + 90_000);
      await addEvent(stu.id, p, "pass", "提交 #1 · 5/5 用例通过", t + 90_000, s.id, 90_000);
      t += 2.1 * MIN;
    }
  }

  /* ---------- 其余 46 名学生（画像分布 → 热力图有真实梯度）---------- */

  for (let i = 6; i < studentRows.length; i++) {
    const stu = studentRows[i]!;
    const ability = rnd(); // 0 弱 → 1 强
    for (const p of PROBLEMS) {
      const weekBase = p.weekNo === 1 ? W1 : p.weekNo === 2 ? W2 : NOW - 30 * 3600_000;
      const r = rnd();
      let fails = 0;
      let finallyPass = true;
      if (ability > 0.7) {
        fails = r < 0.7 ? 0 : 1; // 强者大多一次过
      } else if (ability > 0.4) {
        fails = r < 0.55 ? 1 : 0;
        finallyPass = r < 0.92;
      } else {
        fails = r < 0.6 ? 1 : r < 0.9 ? 2 : 0;
        finallyPass = r < 0.75;
      }
      // 本周 P-03 卡在循环边界的比例略高（教学叙事：循环边界连续两周居首）
      if (p.code === "P-03" && ability < 0.5 && rnd() < 0.6) {
        fails = Math.max(fails, 2);
        finallyPass = rnd() < 0.4;
      }
      if (fails === 0 && finallyPass) {
        const t = weekBase + Math.floor(rnd() * 5 * 3600_000);
        await addEvent(stu.id, p, "edit", "开始编辑", t, undefined, 0);
        const s = await addSubmission(stu.id, p, 1, p.solution, t + Math.floor(rnd() * 20 * MIN));
        await addEvent(
          stu.id,
          p,
          "pass",
          `提交 #1 · ${p.cases.length}/${p.cases.length} 用例通过`,
          s.sub.createdAt.getTime(),
          s.id,
        );
      } else {
        await genNormal(stu, p, weekBase, fails, finallyPass);
      }
    }
  }

  /* ---------- 李明其余作业（普通但挣扎的轨迹）---------- */
  for (const p of PROBLEMS.filter((x) => x.code !== "P-03")) {
    await genNormal(
      liming,
      p,
      p.weekNo === 1 ? W1 : p.weekNo === 2 ? W2 : NOW - 26 * 3600_000,
      p.weekNo === 3 ? 2 : 1,
      p.weekNo !== 3 || rnd() < 0.5,
    );
  }

  /* ---------- 诊断：规则引擎实时计算（口径 = 看板）---------- */

  const diagCount = { n: 0 };
  for (const stu of studentRows) {
    for (const p of PROBLEMS) {
      const assignmentId = assignmentByCode.get(p.code)!;
      const subs = (
        await db.select().from(submissions).where(eq(submissions.studentId, stu.id))
      ).filter((s) => s.assignmentId === assignmentId);
      if (subs.length === 0) continue;
      const evts = (
        await db.select().from(submissionEvents).where(eq(submissionEvents.studentId, stu.id))
      ).filter((e) => e.assignmentId === assignmentId);
      if (subs.every((s) => s.status === "pass") && evts.length === 0) continue;
      const result = diagnose({
        assignment: {
          id: assignmentId,
          code: p.code,
          knowledgePoints: p.kps,
          funcName: p.funcName,
        },
        submissions: subs as Submission[],
        events: evts as SubmissionEvent[],
        now: NOW,
      });
      if (result.stuckPoints.length === 0) continue;
      await db.insert(diagnoses).values({
        id: crypto.randomUUID(),
        studentId: stu.id,
        assignmentId,
        stuckPoints: result.stuckPoints,
        conclusion: result.conclusion,
        evolution: result.evolution,
        evidence: result.evidence,
        stuckMinutes: result.stuckMinutes,
        sameErrorCount: result.sameErrorCount,
        engine: "rule",
        createdAt: new Date(NOW),
      });
      diagCount.n++;
    }
  }

  /* ---------- A3 证据（陈宇/周豪 的一次成型提交）---------- */
  for (const name of ["陈宇", "周豪"]) {
    const stu = byName(name);
    const subs = (
      await db.select().from(submissions).where(eq(submissions.studentId, stu.id))
    ).filter((s) => s.status === "pass");
    const latest = subs.at(-1);
    if (!latest) continue;
    await db.insert(evidenceSignals).values({
      id: crypto.randomUUID(),
      studentId: stu.id,
      submissionId: latest.id,
      suspicion: "high",
      signals: [
        {
          kind: "edit_trace",
          label: "编辑轨迹",
          detail: "代码一次粘贴成型（编辑累计 <30%），无逐步演化",
          anomalous: true,
        },
        { kind: "version_seq", label: "版本序列", detail: "无失败记录的完美提交", anomalous: true },
        {
          kind: "rhythm",
          label: "提交节奏",
          detail: "多题短间隔连续通过，与历史卡点画像不符",
          anomalous: name === "周豪",
        },
      ],
      note: "三类过程信号中 ≥2 项异常——仅为辅助教师判断的证据，不构成代写认定（红线 ②）。",
      createdAt: new Date(NOW),
    });
  }

  /* ---------- 学情快照（aggregateClass 物化）---------- */

  const allStudents = await db.select().from(students).where(eq(students.classId, classId));
  const studentIds = new Set(allStudents.map((s) => s.id));
  const allSubs = (await db.select().from(submissions)).filter((s) =>
    studentIds.has(s.studentId),
  ) as Submission[];
  const allDiag = (await db.select().from(diagnoses)).filter((d) => studentIds.has(d.studentId));
  const allEvts = (await db.select().from(submissionEvents)).filter((e) =>
    studentIds.has(e.studentId),
  );

  // 高危人数（与 detectRisk 同口径：连续同型 ≥3 / 放弃 ≥2 / A3 异常名单）
  const anomalyIds = new Set(["陈宇", "周豪"]);
  let riskCount = 0;
  for (const stu of allStudents) {
    const nameById = studentRows.find((r) => r.id === stu.id)?.name ?? "";
    const subs = allSubs.filter((s) => s.studentId === stu.id);
    const evts = allEvts.filter((e) => e.studentId === stu.id);
    const kpFails = new Map<string, number>();
    for (const p of PROBLEMS) {
      const fails = subs.filter(
        (x) => x.assignmentId === assignmentByCode.get(p.code) && x.status !== "pass",
      ).length;
      if (fails > 0) {
        const key = `${p.code}:${p.kps[0]!.key}`;
        kpFails.set(key, (kpFails.get(key) ?? 0) + fails);
      }
    }
    const drops = evts.filter((e) => e.eventType === "drop").length;
    const continuous = kpFails.size ? Math.max(...kpFails.values()) : 0;
    if (continuous >= 3 || drops >= 2 || anomalyIds.has(nameById)) riskCount++;
  }

  const kpMap = new Map<string, string>();
  for (const p of PROBLEMS)
    for (const kp of p.kps) if (!kpMap.has(kp.key)) kpMap.set(kp.key, kp.name);
  // 卡点口径：当前仍未通过的组合
  const passedPairs = new Set<string>();
  const latestByPair = new Map<string, (typeof allSubs)[number]>();
  for (const s of allSubs) {
    const key = `${s.studentId}:${s.assignmentId}`;
    const cur = latestByPair.get(key);
    if (!cur || s.createdAt > cur.createdAt) latestByPair.set(key, s);
  }
  for (const [key, s] of latestByPair) if (s.status === "pass") passedPairs.add(key);
  const snapshots = aggregateClass({
    allKpKeys: [...kpMap.entries()].map(([key, name]) => ({ key, name })),
    weekCount: 3,
    submissions: allSubs,
    diagnoses: allDiag as never,
    assignmentWeek: new Map(PROBLEMS.map((p) => [assignmentByCode.get(p.code)!, p.weekNo])),
    diagnosisStudent: new Map(allDiag.map((d) => [d.id, d.studentId])),
    riskCount,
    passedPairs,
  });
  for (let w = 1; w <= snapshots.length; w++) {
    await db.insert(analyticsSnapshots).values({
      id: crypto.randomUUID(),
      classId,
      weekNo: w,
      data: snapshots[w - 1]!,
      createdAt: new Date(NOW),
    });
  }

  const totalSubs = (await db.select().from(submissions)).length;
  const totalEvents = (await db.select().from(submissionEvents)).length;
  console.info(`
[seed] 完成：
  班级 1 · 教师 teacher/demo12345 · 学生 52（李明 liming/demo12345，全部密码 demo12345）
  作业 10 题 × 5 用例（第 1–3 周）· 提交 ${totalSubs} · 事件 ${totalEvents} · 诊断 ${diagCount.n}
  快照 3 周 · 高危 ${riskCount} 人
  登录入口 → 学生端 :5183 ｜ 教师端 :5184（teacher / demo12345）`);
}

await main();
