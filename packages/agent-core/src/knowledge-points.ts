/**
 * 知识点注册表（编程课工具包层）。
 *
 * 四 Agent 本身课程无关（PRD §6.3）——知识点如何从失败轨迹中被识别，
 * 属于「编程课工具包」的能力。换课程包时替换这份注册表即可，Agent 内核不动。
 *
 * 识别基于判题明细的通用信号（数值/崩溃/类型），不绑定具体题目。
 */
import type { CaseRow, Submission } from "@sigma/db";

/* ---------- 判题明细 → 信号 ---------- */

export interface FailureSignals {
  totalCases: number;
  passed: number;
  /** 数值输入按大小排序后：小输入通过数 / 大输入通过数 */
  passSmall: number;
  passLarge: number;
  /** 全部失败行的 got−expected 恒等于同一非零常数（初值残留） */
  constOffset: number | null;
  /** got−expected 随输入线性变化（边界多算/少算一项） */
  inputOffset: boolean;
  /** 崩溃（运行异常）行数 */
  crashes: number;
  /** 松散相等但严格不等（数值对但类型/格式错：'10' vs 10） */
  typeMismatch: boolean;
  /** 崩溃错误信息样本（小写） */
  crashText: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 沙箱崩溃行约定：got = { error: string } */
export function isCrashRow(row: CaseRow): boolean {
  return typeof row.got === "object" && row.got !== null && "error" in (row.got as object);
}

export function extractFailureSignals(rows: CaseRow[]): FailureSignals {
  const numericInputs = rows.filter((r) => isNum(r.input)).map((r) => r.input as number);
  const sorted = [...numericInputs].sort((a, b) => a - b);
  const smallMax = sorted.length > 2 ? sorted[Math.floor(sorted.length / 2) - 1] : sorted[0];

  let passSmall = 0;
  let passLarge = 0;
  const failing = rows.filter((r) => !r.ok);
  const rowOffsets: { off: number; n: number }[] = [];
  let crashes = 0;
  let crashText = "";
  let typeMismatch = false;

  for (const r of rows) {
    if (r.ok) {
      if (isNum(r.input) && smallMax !== undefined && (r.input as number) <= smallMax)
        passSmall += 1;
      else passLarge += 1;
      continue;
    }
    if (isCrashRow(r)) {
      crashes += 1;
      const err = (r.got as { error: string }).error;
      crashText = crashText || err.toLowerCase();
      continue;
    }
    // 松散相等但严格不等 → 类型/格式问题
    if (
      r.got != null &&
      r.expected != null &&
      // biome-ignore lint: 此处故意用松散相等检测类型不匹配
      r.got == r.expected &&
      r.got !== r.expected
    ) {
      typeMismatch = true;
      continue;
    }
    if (isNum(r.got) && isNum(r.expected) && isNum(r.input)) {
      const off = (r.got as number) - (r.expected as number);
      if (off === 0) continue;
      rowOffsets.push({ off, n: r.input as number });
    }
  }

  // 偏移分类：全行恒等 → 初值残留（常数）；随输入变化且匹配输入量级 → 边界多算一项
  const distinct = new Set(rowOffsets.map((r) => r.off));
  const matchesInput = (r: { off: number; n: number }) =>
    Math.abs(r.off) === r.n || Math.abs(r.off) === r.n + 1 || Math.abs(r.off) === r.n - 1;
  const matchCount = rowOffsets.filter(matchesInput).length;

  let constOffset: number | null = null;
  let inputOffset = false;
  if (rowOffsets.length >= 2 && distinct.size === 1) {
    constOffset = rowOffsets[0]!.off;
  } else if (rowOffsets.length === 1 && matchesInput(rowOffsets[0]!)) {
    inputOffset = true;
  } else if (distinct.size > 1 && matchCount >= 2) {
    inputOffset = true;
  }

  return {
    totalCases: rows.length,
    passed: rows.length - failing.length,
    passSmall,
    passLarge,
    constOffset,
    inputOffset,
    crashes,
    typeMismatch,
    crashText,
  };
}

/* ---------- 知识点注册表 ---------- */

export interface KpClassifier {
  key: string;
  name: string;
  /** 从单次失败提交的信号打分（0=不命中，1=强命中） */
  detect: (s: FailureSignals, sub: Submission) => number;
}

export const KP_REGISTRY: KpClassifier[] = [
  {
    key: "loop-boundary",
    name: "循环边界",
    detect: (s) => {
      if (s.inputOffset) return 1;
      if (s.passSmall > 0 && s.passLarge === 0 && s.crashes === 0) return 0.8;
      return 0;
    },
  },
  {
    key: "accumulator-init",
    name: "累加器初值",
    detect: (s) => (s.constOffset !== null ? 1 : 0),
  },
  {
    key: "output-format",
    name: "输入输出格式",
    detect: (s) => (s.typeMismatch ? 1 : 0),
  },
  {
    key: "array-bound",
    name: "数组越界",
    detect: (s) =>
      s.crashes > 0 && /undefined|length|index|not defined|null/.test(s.crashText) ? 0.9 : 0,
  },
  {
    key: "func-args",
    name: "函数参数传递",
    detect: (s) => (s.crashes > 0 && /is not a function|nan|argument/.test(s.crashText) ? 0.9 : 0),
  },
  {
    key: "recursion-base",
    name: "递归终止条件",
    detect: (s) =>
      s.crashes > 0 && /call stack|rangeerror|too much recursion/.test(s.crashText) ? 1 : 0,
  },
  {
    key: "float-compare",
    name: "浮点比较",
    detect: (s) => {
      // 全部数值都对、仅末位微小偏差（epsilon 级）——直接相等比对导致的浮点问题
      if (s.crashes > 0 || s.constOffset !== null) return 0;
      return s.passSmall + s.passLarge >= s.totalCases - 1 &&
        s.passSmall + s.passLarge < s.totalCases
        ? 0.6
        : 0;
    },
  },
  {
    key: "condition",
    name: "条件分支",
    detect: (s) => {
      if (s.crashes > 0 || s.constOffset !== null || s.inputOffset) return 0;
      // 无规律的混合失败（小大输入都挂、无常数偏移）→ 分支逻辑
      return s.passSmall === 0 && s.passLarge === 0 ? 0.5 : 0;
    },
  },
  {
    key: "var-assign",
    name: "变量与赋值",
    detect: (_s, sub) => {
      const msg = sub.detail.message ?? "";
      return /referenceerror|is not defined|assignment/.test(msg.toLowerCase()) ? 0.8 : 0;
    },
  },
];

export const KP_BY_KEY = new Map(KP_REGISTRY.map((k) => [k.key, k]));

export function kpName(key: string): string {
  return KP_BY_KEY.get(key)?.name ?? key;
}

/**
 * 把一次失败提交归类到知识点：返回命中的 key 列表（带强度）。
 * 只在题目标注的知识点范围内归类——诊断不发明题目外的缺陷。
 */
export function classifySubmission(
  sub: Submission,
  assignmentKpKeys: string[],
): { key: string; strength: number }[] {
  if (sub.status === "pass") return [];
  const rows = sub.detail.rows ?? [];
  const signals = extractFailureSignals(rows);
  const hits: { key: string; strength: number }[] = [];

  for (const key of assignmentKpKeys) {
    const cls = KP_BY_KEY.get(key);
    if (!cls) continue;
    const strength = cls.detect(signals, sub);
    if (strength > 0) hits.push({ key, strength });
  }
  // 题目标注里没有注册表 key 时：失败落到题目首个知识点（弱信号），保证证据链完整
  if (hits.length === 0 && rows.length > 0 && assignmentKpKeys[0]) {
    hits.push({ key: assignmentKpKeys[0], strength: 0.35 });
  }
  return hits;
}
