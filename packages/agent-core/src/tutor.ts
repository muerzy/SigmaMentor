/**
 * A2 导师 Agent：L1–L4 分级引导状态机（规则版 + LLM 增强接口）。
 *
 * 升级策略按规则触发，不跳级、不降级（F3 验收 2，单测覆盖）：
 *   L1 →(仍卡/明确求助)→ L2 →(仍卡)→ L3 →(解出)→ L4
 * 意图分类（规则版）：refuse / solve / upgrade / free。
 * 红线 ① 双保险：提示词层（tutorSystemPrompt）+ 输出过滤层（applyRedline）。
 */
import type { SigmaLlmClient } from "@sigma/llm";

import {
  L4_ASK,
  L4_DONE,
  LEVEL_PROMPTS,
  REFUSAL_AGAIN,
  REFUSAL_FIRST,
  SOLVED_EARLY,
  tutorSystemPrompt,
} from "./prompts";
import { applyRedline } from "./redline";

export interface TutorState {
  level: 1 | 2 | 3 | 4;
  solved: boolean;
  finished: boolean;
  refusalCount: number;
  genericIdx: number;
}

export type TutorIntent = "refuse" | "solve" | "upgrade" | "free" | "finish";

export interface TutorContext {
  funcName: string;
  problemTitle: string;
  kpKey: string;
  kpName: string;
}

export interface TutorReply {
  text: string;
  meta?: string;
  level: 1 | 2 | 3 | 4;
  state: TutorState;
  redlineBlocked: boolean;
  engine: "rule" | "llm";
}

export function initialState(): TutorState {
  return { level: 1, solved: false, finished: false, refusalCount: 0, genericIdx: 0 };
}

/* ---------- 意图分类（规则版）---------- */

export function classifyIntent(text: string): TutorIntent {
  const t = text.trim();
  if (/(改好|通过|对了|过了|全对|ac|all\s*pass|\d\s*\/\s*\d.*(通过|全对))/i.test(t)) return "solve";
  if (
    /(直接给|给我(完整)?代码|帮我写|写(一)?(个|份|段)完整|把代码(发|贴|写)|代写|答案代码|抄)/i.test(
      t,
    )
  )
    return "refuse";
  if (/(再提示|没思路|还是不会|还是不懂|下一层|升级|更具体|再讲深)/.test(t)) return "upgrade";
  if (/(复盘|我总结|这次错在)/.test(t)) return "finish";
  return "free";
}

/* ---------- 规则版回复 ---------- */

function ruleReply(state: TutorState, ctx: TutorContext, custom?: string): TutorReply {
  const lp = LEVEL_PROMPTS[state.level - 1]!;
  const script =
    custom ?? lp.ruleScripts[ctx.kpKey] ?? lp.ruleScripts["generic"] ?? lp.genericPool[0]!;
  return {
    text: script,
    meta: lp.meta,
    level: state.level,
    state,
    redlineBlocked: false,
    engine: "rule",
  };
}

function nextGeneric(state: TutorState): string {
  const pool = LEVEL_PROMPTS[Math.min(state.level, 3) - 1]!.genericPool;
  const text = pool[state.genericIdx % pool.length]!;
  state.genericIdx += 1;
  return text;
}

/** 开场白：L1 主话术 */
export function opening(state: TutorState, ctx: TutorContext): TutorReply {
  return ruleReply({ ...state }, ctx);
}

/**
 * 处理一条学生消息，返回导师回复（状态机推进 + 红线过滤）。
 * LLM 可用时对 free/upgrade 意图走 LLM 生成，失败自动回退规则版。
 */
export async function respond(
  text: string,
  stateIn: TutorState,
  ctx: TutorContext,
  llm?: SigmaLlmClient,
  history: { role: "user" | "tutor"; content: string }[] = [],
): Promise<TutorReply> {
  const state: TutorState = { ...stateIn };
  const intent = classifyIntent(text);

  if (state.finished) {
    return { ...ruleReply(state, ctx, "本次会话已完成复盘，结论已回流画像。开始下一题吧。") };
  }

  if (intent === "refuse") {
    state.refusalCount += 1;
    const t = state.refusalCount > 1 ? REFUSAL_AGAIN : REFUSAL_FIRST;
    return {
      text: t,
      meta: "产品红线 ① · 永不给答案",
      level: state.level,
      state,
      redlineBlocked: false,
      engine: "rule",
    };
  }

  if (intent === "solve") {
    if (state.level >= 4 && state.solved) {
      // 已在 L4，等待复盘结论
      return { text: SOLVED_EARLY, level: 4, state, redlineBlocked: false, engine: "rule" };
    }
    state.solved = true;
    state.level = 4;
    return {
      text: L4_ASK,
      meta: LEVEL_PROMPTS[3]!.meta,
      level: 4,
      state,
      redlineBlocked: false,
      engine: "rule",
    };
  }

  if (intent === "upgrade") {
    if (state.solved) {
      return {
        text: L4_ASK,
        meta: LEVEL_PROMPTS[3]!.meta,
        level: 4,
        state,
        redlineBlocked: false,
        engine: "rule",
      };
    }
    // 不跳级：逐级 +1，L3 封顶（L4 只能由「解出」触发）
    if (state.level < 3) {
      state.level = (state.level + 1) as 2 | 3;
      const lp = LEVEL_PROMPTS[state.level - 1]!;
      const script = lp.ruleScripts[ctx.kpKey] ?? lp.ruleScripts["generic"] ?? nextGeneric(state);
      return {
        text: script,
        meta: lp.meta,
        level: state.level,
        state,
        redlineBlocked: false,
        engine: "rule",
      };
    }
    const t = nextGeneric(state);
    return {
      text: t,
      meta: LEVEL_PROMPTS[2]!.meta,
      level: 3,
      state,
      redlineBlocked: false,
      engine: "rule",
    };
  }

  // free / finish：LLM 增强优先，规则版兜底（I1 验收 2）
  if (intent === "finish" || state.solved) {
    // finish 在 api 层调用 finishL4，这里只给 L4 提问
    const t = nextGeneric({ ...state, level: 4 });
    return {
      text: t,
      meta: LEVEL_PROMPTS[3]!.meta,
      level: 4,
      state,
      redlineBlocked: false,
      engine: "rule",
    };
  }

  if (llm?.available()) {
    try {
      const res = await llm.complete({
        messages: [
          {
            role: "system",
            content: tutorSystemPrompt(ctx.funcName, ctx.kpName, state.level, ctx.problemTitle),
          },
          ...history.slice(-6),
          { role: "user", content: text },
        ],
        temperature: 0.3,
        maxTokens: 400,
      });
      const guarded = applyRedline(res.text, { funcName: ctx.funcName }, REFUSAL_FIRST);
      return {
        text: guarded.text,
        meta: guarded.blocked ? "产品红线 ① · 输出已过滤" : LEVEL_PROMPTS[state.level - 1]!.meta,
        level: state.level,
        state,
        redlineBlocked: guarded.blocked,
        engine: "llm",
      };
    } catch (err) {
      console.warn(`[tutor] LLM 失败，回退规则版: ${err instanceof Error ? err.message : err}`);
    }
  }

  return ruleReply(state, ctx, nextGeneric(state));
}

/** L4 复盘收尾：结论回流诊断画像（api 层落库） */
export function finishL4(summary: string, state: TutorState): TutorReply {
  const finished: TutorState = { ...state, finished: true, level: 4 };
  return {
    text: L4_DONE(summary),
    meta: "闭环：诊断 → 干预 → 再诊断验证",
    level: 4,
    state: finished,
    redlineBlocked: false,
    engine: "rule",
  };
}
