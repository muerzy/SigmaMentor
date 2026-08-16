import { createPiAiClient } from "./adapters/pi-ai";
/**
 * packages/llm 入口：SigmaLlmClient 工厂。
 * 默认走 pi-ai 适配器（I1：统一走 pi-ai）；SIGMA_LLM_IMPL=fetch 切 OpenAI 兼容
 * fetch 实现（轻量、测试友好）。LLM_MODE=off 或未配置 key 时返回不可用客户端，
 * 业务侧自动降级规则版（I1 验收 2：服务不中断）。
 */
import { resolveLlmConfig } from "./config";
import { createOpenAiFetchClient } from "./openai-fetch";
import type { LlmConfig, SigmaLlmClient } from "./types";

export * from "./types";
export { resolveLlmConfig } from "./config";
export { createOpenAiFetchClient } from "./openai-fetch";
export { createPiAiClient } from "./adapters/pi-ai";

const OFF_CLIENT: SigmaLlmClient = {
  providerKind: "off",
  available: () => false,
  complete: () => Promise.reject(new Error("LLM 已关闭（LLM_MODE=off）——请走规则版")),
};

export function createSigmaLlm(
  config: LlmConfig = resolveLlmConfig(),
  impl: "pi-ai" | "fetch" = (process.env.SIGMA_LLM_IMPL as "pi-ai" | "fetch") ?? "pi-ai",
): SigmaLlmClient {
  if (config.mode === "off" || !config.apiKey) return OFF_CLIENT;
  if (impl === "fetch") {
    return createOpenAiFetchClient(config.baseUrl, config.apiKey, config.model);
  }
  return createPiAiClient(config);
}

/** LLM 增强 + 降级包装：失败或未配置时回退 ruleFallback()，服务不中断 */
export async function withRuleFallback(
  llm: SigmaLlmClient,
  req: Parameters<SigmaLlmClient["complete"]>[0],
  ruleFallback: () => string,
): Promise<{ text: string; engine: "llm" | "rule" }> {
  if (!llm.available()) return { text: ruleFallback(), engine: "rule" };
  try {
    const r = await llm.complete(req);
    if (!r.text.trim()) return { text: ruleFallback(), engine: "rule" };
    return { text: r.text, engine: "llm" };
  } catch (err) {
    console.warn(`[llm] 调用失败，已降级规则版: ${err instanceof Error ? err.message : err}`);
    return { text: ruleFallback(), engine: "rule" };
  }
}
