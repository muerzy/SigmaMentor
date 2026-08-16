/**
 * OpenAI 兼容 fetch 实现：云端 API 与 llama-server（llama.cpp，OpenAI 兼容协议）
 * 共用一套代码——这正是「调用层与推理引擎解耦」的落地（README 技术栈表口径）。
 * 带一次简单重试（网络抖动），失败抛错由调用方降级规则版。
 */
import type { LlmRequest, SigmaLlmClient } from "./types";

export interface FetchDeps {
  fetchFn?: typeof fetch;
  retries?: number;
}

export function createOpenAiFetchClient(
  baseUrl: string,
  apiKey: string,
  model: string,
  deps: FetchDeps = {},
): SigmaLlmClient {
  const doFetch = deps.fetchFn ?? fetch;
  const retries = deps.retries ?? 1;

  return {
    providerKind: "openai-fetch",
    available() {
      return baseUrl.length > 0 && apiKey.length > 0;
    },
    async complete(req: LlmRequest) {
      const startedAt = Date.now();
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await doFetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              messages: req.messages,
              temperature: req.temperature ?? 0.3,
              max_tokens: req.maxTokens ?? 1024,
              stream: false,
            }),
          });
          if (!res.ok)
            throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
          const json = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const text = json.choices?.[0]?.message?.content;
          if (!text) throw new Error("LLM 返回空 content");
          return { text, model, elapsedMs: Date.now() - startedAt };
        } catch (err) {
          lastError = err;
          if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}
