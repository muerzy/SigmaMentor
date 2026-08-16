import { describe, expect, test } from "bun:test";

import { getRunner, supportedLanguages } from "./src/index";

const runner = getRunner("js");
const CASES = [
  { input: 0, expected: 0 },
  { input: 1, expected: 0 },
  { input: 5, expected: 10 },
  { input: 10, expected: 45 },
  { input: 100, expected: 4950 },
];

const judge = (code: string, cases = CASES, limitMs = 3000) =>
  runner.judge({ code, funcName: "solve", cases, limitMs });

describe("JSRunner 判题", () => {
  test("正确解 → pass 100 分", async () => {
    const out = await judge(`function solve(n){ let s=0; for(let i=1;i<n;i++) s+=i; return s; }`);
    expect(out.status).toBe("pass");
    expect(out.score).toBe(100);
    expect(out.passCount).toBe(5);
  });

  test("i <= n 边界错误 → partial 1/5（只有 n=0 过，n=1 多加 1）", async () => {
    const out = await judge(`function solve(n){ let s=0; for(let i=1;i<=n;i++) s+=i; return s; }`);
    expect(out.status).toBe("partial");
    expect(out.passCount).toBe(1);
    // 失败用例 got-expected 恒等于输入 n → 边界多算一项
    const row5 = out.detail.rows?.find((r) => r.input === 5);
    expect(row5?.got).toBe(15);
  });

  test("语法错误 → compile_error 且带信息", async () => {
    const out = await judge(`function solve(n){ let s=0 for(;;) }`);
    expect(out.status).toBe("compile_error");
    expect(out.detail.message).toBeTruthy();
  });

  test("未定义函数 → run_error，崩溃行含错误信息", async () => {
    const out = await judge(`function notSolve(n){ return n; }`);
    expect(out.status).toBe("run_error");
    const row = out.detail.rows?.[0];
    const got = row?.got as { error: string } | undefined;
    expect(got?.error).toContain("ReferenceError");
  });

  test("死循环被超时终止，且不影响下一次执行（F1 验收 3）", async () => {
    const startedAt = Date.now();
    const out = await judge(`function solve(n){ while(true){} }`, CASES.slice(0, 1), 1200);
    expect(out.status).toBe("timeout");
    expect(Date.now() - startedAt).toBeLessThan(4000);
    // 紧接着的正常执行不受影响
    const ok = await judge(`function solve(n){ return 0; }`, CASES.slice(0, 1));
    expect(ok.status).toBe("pass");
  });

  test("类型不匹配（返回字符串）→ 全部失败", async () => {
    const out = await judge(`function solve(n){ return String(n); }`);
    expect(out.status).toBe("run_error");
    expect(out.passCount).toBe(0);
  });

  test("学生代码里的 console.log 不污染判题结果通道", async () => {
    const out = await judge(
      `function solve(n){ console.log("debug", n); return n===0?0:n===1?0:n*(n-1)/2; }`,
    );
    expect(out.status).toBe("pass");
  });
});

/** F1 验收 2：10 道题 × 每题 5 组用例回归——判题结果与标准答案用例集一致 */
describe("10 题 × 5 用例回归", () => {
  const problems = [
    {
      name: "循环求和",
      cases: [0, 1, 5, 10, 100].map((n) => ({ input: n, expected: (n * (n - 1)) / 2 })),
      ok: `function solve(n){let s=0;for(let i=1;i<n;i++)s+=i;return s;}`,
      bad: `function solve(n){let s=0;for(let i=1;i<=n;i++)s+=i;return s;}`,
    },
    {
      name: "阶乘",
      cases: [0, 1, 3, 5, 10].map((n) => ({
        input: n,
        expected: [1, 1, 6, 120, 3628800][[0, 1, 3, 5, 10].indexOf(n)]!,
      })),
      ok: `function solve(n){let r=1;for(let i=2;i<=n;i++)r*=i;return r;}`,
      bad: `function solve(n){let r=0;for(let i=2;i<=n;i++)r*=i;return r;}`,
    },
    {
      name: "数组求和",
      cases: [[], [1], [1, 2], [1, 2, 3], Array.from({ length: 5 }, (_, i) => i + 1)].map((a) => ({
        input: a,
        expected: a.reduce((x, y) => x + y, 0),
      })),
      ok: `function solve(a){return a.reduce((x,y)=>x+y,0);}`,
      bad: `function solve(a){return a.length;}`,
    },
    {
      name: "数组最大值",
      cases: [[3], [1, 5], [5, 1], [-1, -5], [7, 7, 3]].map((a) => ({
        input: a,
        expected: Math.max(...a),
      })),
      ok: `function solve(a){return Math.max(...a);}`,
      bad: `function solve(a){return Math.min(...a);}`,
    },
    {
      name: "反转数组",
      cases: [[1], [1, 2], [1, 2, 3], [3, 2, 1], []].map((a) => ({
        input: a,
        expected: [...a].reverse(),
      })),
      ok: `function solve(a){return [...a].reverse();}`,
      bad: `function solve(a){return a;}`,
    },
    {
      name: "计数偶数",
      cases: [[], [1], [2], [1, 2, 3, 4], [2, 4, 6, 8, 10]].map((a) => ({
        input: a,
        expected: a.filter((x) => x % 2 === 0).length,
      })),
      ok: `function solve(a){return a.filter(x=>x%2===0).length;}`,
      bad: `function solve(a){return a.filter(x=>x%2!==0).length;}`,
    },
    {
      name: "字符串反转",
      cases: ["", "a", "ab", "abc", "abcde"].map((s) => ({
        input: s,
        expected: [...s].reverse().join(""),
      })),
      ok: `function solve(s){return [...s].reverse().join("");}`,
      bad: `function solve(s){return s;}`,
    },
    {
      name: "斐波那契",
      cases: [0, 1, 2, 7, 12].map((n) => ({
        input: n,
        expected: [0, 1, 1, 13, 144][[0, 1, 2, 7, 12].indexOf(n)]!,
      })),
      ok: `function solve(n){if(n<2)return n;let a=0,b=1;for(let i=2;i<=n;i++)[a,b]=[b,a+b];return b;}`,
      bad: `function solve(n){if(n<2)return n;let a=0,b=1;for(let i=2;i<=n;i++)[a,b]=[b,a+b];return a;}`,
    },
    {
      name: "去重保序",
      cases: [[1], [1, 1], [1, 2, 1], [3, 3, 3], [1, 2, 2, 1]].map((a) => ({
        input: a,
        expected: [...new Set(a)],
      })),
      ok: `function solve(a){return [...new Set(a)];}`,
      bad: `function solve(a){return a.filter((x,i)=>a.indexOf(x)!==a.length-1-i);}`,
    },
    {
      name: "二次判别",
      cases: [
        { input: { a: 1, b: -3, c: 2 }, expected: 2 },
        { input: { a: 1, b: 0, c: -4 }, expected: 2 },
        { input: { a: 1, b: 2, c: 1 }, expected: 1 },
        { input: { a: 1, b: 0, c: 1 }, expected: 0 },
        { input: { a: 2, b: -4, c: 2 }, expected: 1 },
      ],
      ok: `function solve(q){const d=q.b*q.b-4*q.a*q.c;if(d<0)return 0;if(d===0)return 1;return 2;}`,
      bad: `function solve(q){const d=q.b*q.b-4*q.a*q.c;if(d<0)return 1;if(d===0)return 0;return 2;}`,
    },
  ];

  for (const p of problems) {
    test(`「${p.name}」标准解通过 / 错误解不通过`, async () => {
      const good = await runner.judge({
        code: p.ok,
        funcName: "solve",
        cases: p.cases,
        limitMs: 3000,
      });
      expect(good.status).toBe("pass");
      const bad = await runner.judge({
        code: p.bad,
        funcName: "solve",
        cases: p.cases,
        limitMs: 3000,
      });
      expect(bad.status).not.toBe("pass");
    });
  }

  test("语言注册表：js 已注册，未注册语言报错", () => {
    expect(supportedLanguages()).toContain("js");
    expect(() => getRunner("cobol")).toThrow("未注册");
  });
});
