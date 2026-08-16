/** SigmaLlmClient 统一接口：业务代码只依赖这里，云端/本地/适配器实现可替换 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** 摄氏温度，教学对话默认 0.3（稳定、可复现） */
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResult {
  text: string;
  /** 实际使用的模型标识（诊断/演示用） */
  model: string;
  /** 耗时 ms */
  elapsedMs: number;
}

export interface SigmaLlmClient {
  readonly providerKind: "openai-fetch" | "pi-ai" | "off";
  /** 是否已配置可用（未配置时调用方直接走规则版） */
  available(): boolean;
  /** 单轮补全。失败抛错，由调用方降级（I1 验收：服务不中断） */
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface LlmConfig {
  mode: "cloud" | "local" | "off";
  baseUrl: string;
  apiKey: string;
  model: string;
}
