/**
 * resolveLlmConfig：LLM_MODE=cloud|local|off 一行切换（I1 验收 1），
 * 业务代码零改动。默认 off——无 key 环境直接走规则版，服务照常可跑。
 */
import type { LlmConfig } from "./types";

export function resolveLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const mode = (env.LLM_MODE ?? "off") as LlmConfig["mode"];

  if (mode === "local") {
    return {
      mode,
      baseUrl: env.LLM_LOCAL_URL ?? "http://127.0.0.1:8080/v1",
      apiKey: env.LLM_LOCAL_API_KEY ?? "no-key",
      model: env.LLM_LOCAL_MODEL ?? "qwen2.5-7b-instruct-q4_k_m",
    };
  }
  if (mode === "cloud") {
    return {
      mode,
      baseUrl: env.LLM_BASE_URL ?? "https://api.deepseek.com/v1",
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL ?? "deepseek-chat",
    };
  }
  return { mode: "off", baseUrl: "", apiKey: "", model: "rule-engine" };
}
