/**
 * pi-ai 适配器（I1）：统一走 @earendil-works/pi-ai 调用。
 * pi-ai 是调用层聚合（provider/模型目录/成本统计），llama.cpp 与云端 API 都以
 * OpenAI 兼容端点接入——与 README「调用层与推理引擎解耦」口径一致。
 * 高并发切 vLLM 时仅改 baseUrl/model，业务代码不动。
 */
import { createModels, createProvider, type Model, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type { LlmConfig, LlmRequest, SigmaLlmClient } from "../types";

const PROVIDER_ID = "sigma-endpoint";

function buildModel(config: LlmConfig): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 8192,
  };
}

function buildModels(config: LlmConfig): Models {
  const provider = createProvider({
    id: PROVIDER_ID,
    name: "SigmaMentor LLM endpoint",
    baseUrl: config.baseUrl,
    // 本地 llama-server 无需鉴权；云端 API 由 openai-completions 实现转为 Bearer 头
    auth: {
      apiKey: { name: "SigmaMentor", resolve: async () => ({ auth: { apiKey: config.apiKey } }) },
    },
    models: [buildModel(config)],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

export function createPiAiClient(config: LlmConfig): SigmaLlmClient {
  return {
    providerKind: "pi-ai",
    available() {
      return config.mode !== "off" && config.baseUrl.length > 0 && config.apiKey.length > 0;
    },
    async complete(req: LlmRequest) {
      const startedAt = Date.now();
      const models = buildModels(config);
      const model = models.getModel(PROVIDER_ID, config.model);
      if (!model) throw new Error(`pi-ai 模型未注册: ${config.model}`);

      const [system, ...rest] = req.messages;
      const hasSystem = system?.role === "system";
      const context = {
        ...(hasSystem ? { systemPrompt: system.content } : {}),
        messages: (hasSystem ? rest : req.messages).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: Date.now(),
        })),
      };
      const response = await models.completeSimple(model, context, {
        maxTokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
      });
      const text = response.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) throw new Error("pi-ai 返回空 content");
      return { text, model: config.model, elapsedMs: Date.now() - startedAt };
    },
  };
}
