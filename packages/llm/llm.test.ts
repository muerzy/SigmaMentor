import { describe, expect, test } from "bun:test";

import { createOpenAiFetchClient, resolveLlmConfig, withRuleFallback } from "./src/index";

describe("resolveLlmConfig", () => {
  test("默认 off——零配置可跑", () => {
    expect(resolveLlmConfig({}).mode).toBe("off");
  });
  test("cloud 模式读云端三件套", () => {
    const c = resolveLlmConfig({
      LLM_MODE: "cloud",
      LLM_BASE_URL: "https://api.x/v1",
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
    });
    expect(c).toMatchObject({
      mode: "cloud",
      baseUrl: "https://api.x/v1",
      apiKey: "k",
      model: "m",
    });
  });
  test("local 模式默认指向 llama-server", () => {
    const c = resolveLlmConfig({ LLM_MODE: "local" });
    expect(c).toMatchObject({ mode: "local", baseUrl: "http://127.0.0.1:8080/v1" });
  });
});

describe("openai-fetch 客户端", () => {
  test("重试后成功，透传文本", async () => {
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      if (calls === 1) return new Response("boom", { status: 500 });
      return Response.json({ choices: [{ message: { content: "答案" } }] });
    }) as typeof fetch;
    const client = createOpenAiFetchClient("https://x/v1", "k", "m", { fetchFn: fake, retries: 1 });
    const r = await client.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("答案");
    expect(calls).toBe(2);
  });
  test("重试耗尽后抛错", async () => {
    const fake = (async () => new Response("err", { status: 503 })) as typeof fetch;
    const client = createOpenAiFetchClient("https://x/v1", "k", "m", { fetchFn: fake, retries: 1 });
    await expect(client.complete({ messages: [] })).rejects.toThrow("503");
  });
});

describe("withRuleFallback 降级", () => {
  const off = {
    providerKind: "off" as const,
    available: () => false,
    complete: async () => ({ text: "", model: "", elapsedMs: 0 }),
  };
  test("不可用直接回退规则版", async () => {
    const r = await withRuleFallback(off, { messages: [] }, () => "规则答案");
    expect(r).toEqual({ text: "规则答案", engine: "rule" });
  });
  test("LLM 抛错也回退，服务不中断", async () => {
    const broken = {
      ...off,
      available: () => true,
      complete: async () => {
        throw new Error("网络炸了");
      },
    };
    const r = await withRuleFallback(broken, { messages: [] }, () => "规则答案");
    expect(r.engine).toBe("rule");
  });
});
