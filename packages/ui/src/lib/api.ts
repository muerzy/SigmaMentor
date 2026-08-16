/**
 * Eden Treaty 客户端工厂：前端零手写接口，端到端类型安全。
 * baseURL 走各应用自身的 /api 代理（Bun.serve fetch → :3000），同源携带会话 Cookie。
 */
import { treaty } from "@elysiajs/eden";
import type { App } from "@sigma/api";

export function createApiClient(base: string = `${location.origin}/api`) {
  return treaty<App>(base);
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** treaty 返回 {data,error} → 解包；错误时 throw（TanStack Query 接管状态） */
export function unwrap<T>(res: {
  data: T;
  error: { message?: string; value?: unknown } | null;
}): T {
  if (res.error) {
    const detail =
      typeof res.error.value === "object" && res.error.value !== null && "error" in res.error.value
        ? String((res.error.value as { error: unknown }).error)
        : (res.error.message ?? "请求失败");
    throw new Error(detail);
  }
  return res.data;
}
