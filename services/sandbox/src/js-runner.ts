/**
 * JSRunner：MVP 判题语言 JavaScript（bun 原生运行，零编译器依赖）。
 *
 * 执行模型：学生代码 + 生成 harness 拼成单文件，Bun.spawn 子进程运行，
 * 结果写 out.json（不走 stdout——学生代码里的 console.log 不会污染结果通道）。
 * 超时 → kill 进程 → timeout 状态；下一次执行完全独立（F1 验收 3）。
 *
 * ⛔ 开发版红线同 types.ts：无隔离，只跑可信代码，不可暴露真实课堂。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CaseRow, SubmissionStatus } from "@sigma/db";

import type { JudgeInput, JudgeOutput, LanguageRunner } from "./types";

const HARNESS = (funcName: string, casesJson: string) => `
const __cases = ${casesJson};
const __out = [];
for (const c of __cases) {
  try {
    const got = ${funcName}(c.input);
    if (got instanceof Promise) {
      __out.push({ error: "Promise: 本课程题目的函数需同步返回结果" });
    } else {
      __out.push({ got });
    }
  } catch (e) {
    __out.push({ error: e instanceof Error ? \`\${e.name}: \${e.message}\` : String(e) });
  }
}
require("node:fs").writeFileSync(__OUT_PATH__, JSON.stringify(__out));
`;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createJsRunner(): LanguageRunner {
  return {
    id: "js",
    async judge(input: JudgeInput): Promise<JudgeOutput> {
      const startedAt = Date.now();

      // 1. 语法检查（等价于编译期）：Transpiler 解析失败 → compile_error
      try {
        new Bun.Transpiler({ loader: "js" }).transformSync(input.code);
      } catch (err) {
        return {
          status: "compile_error",
          score: 0,
          passCount: 0,
          totalCount: input.cases.length,
          detail: { message: err instanceof Error ? err.message : String(err) },
          elapsedMs: Date.now() - startedAt,
        };
      }

      // 2. 逐用例运行（当前为整批一进程；用例数 ≤10、每题限额内不影响验收口径）
      const rows: CaseRow[] = [];
      let crashed = false;
      let timedOut = false;

      for (const c of input.cases) {
        const r = await runSingle(input, c.input, c.expected);
        if (r.timeout) timedOut = true;
        if (
          r.row.got !== null &&
          typeof r.row.got === "object" &&
          "error" in (r.row.got as object)
        ) {
          crashed = true;
        }
        rows.push(r.row);
      }

      const passCount = rows.filter((r) => r.ok).length;
      const totalCount = rows.length;
      let status: SubmissionStatus;
      if (timedOut) status = "timeout";
      else if (crashed) status = "run_error";
      else if (passCount === totalCount && totalCount > 0) status = "pass";
      else if (passCount > 0) status = "partial";
      else status = "run_error";

      return {
        status,
        score: totalCount ? Math.round((passCount / totalCount) * 100) : 0,
        passCount,
        totalCount,
        detail: { rows },
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}

interface SingleResult {
  row: CaseRow;
  timeout: boolean;
}

async function runSingle(
  input: JudgeInput,
  caseInput: unknown,
  expected: unknown,
): Promise<SingleResult> {
  const dir = await mkdtemp(join(tmpdir(), "sigma-judge-"));
  const entry = join(dir, "main.js");
  const outPath = join(dir, "out.json");
  const code =
    input.code +
    "\n;" +
    HARNESS(input.funcName, JSON.stringify([{ input: caseInput }])).replace(
      "__OUT_PATH__",
      JSON.stringify(outPath),
    );

  await Bun.write(entry, code);

  let timedOut = false;
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", entry],
    cwd: dir,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, input.limitMs);

  try {
    await proc.exited;
  } finally {
    clearTimeout(timer);
  }

  try {
    const raw = await Bun.file(outPath).text();
    const parsed = JSON.parse(raw) as { got?: unknown; error?: string }[];
    const entry0 = parsed[0]!;
    if (entry0.error !== undefined) {
      return {
        row: { input: caseInput, expected, got: { error: entry0.error }, ok: false },
        timeout: false,
      };
    }
    const got = entry0.got ?? null;
    return {
      row: { input: caseInput, expected, got, ok: deepEqual(got, expected) },
      timeout: false,
    };
  } catch {
    // 进程被杀（超时/死循环）或未产出 out.json
    return {
      row: {
        input: caseInput,
        expected,
        got: timedOut
          ? { error: "执行超时（可能存在死循环）" }
          : { error: "进程异常退出，未产出结果" },
        ok: false,
      },
      timeout: timedOut,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------- 语言注册表（新增语言在这里挂适配器）---------- */

const RUNNERS = new Map<string, LanguageRunner>([["js", createJsRunner()]]);

export function getRunner(language: string): LanguageRunner {
  const r = RUNNERS.get(language);
  if (!r) throw new Error(`未注册的判题语言: ${language}（语言适配器见 LanguageRunner 接口）`);
  return r;
}

export function supportedLanguages(): string[] {
  return [...RUNNERS.keys()];
}
