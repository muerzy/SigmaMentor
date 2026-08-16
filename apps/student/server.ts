/**
 * 学生端开发服务器（Bun 原生 bundler，不用 Vite——KICKOFF 硬约束）：
 * - HTML imports 打包 React SPA，development:true 开 HMR
 * - /api 反向代理到 Elysia API（:3000）——同源携带会话 Cookie
 * - SPA 路由显式映射到 index.html
 */
import index from "./index.html";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3000";
const PORT = Number(process.env.PORT ?? 5183);

const server = Bun.serve({
  port: PORT,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/login": index,
    "/register": index,
    "/assignment": index,
    "/assignment/:id": index,
    "/diagnosis": index,
    "/tutor": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      // 手动重构请求：原样转发 Request 会带 host/connection 等 hop-by-hop 头，
      // Bun fetch 会挂起（10s idle 超时）——实测踩坑
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("connection");
      headers.delete("content-length");
      const body =
        req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      // 剥掉 /api 前缀（Elysia 路由无前缀）
      const target = API_ORIGIN + url.pathname.replace(/^\/api/, "") + url.search;
      return fetch(target, { method: req.method, headers, body });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.info(`[student] 学生端 http://localhost:${server.port} · API 代理 → ${API_ORIGIN}`);
