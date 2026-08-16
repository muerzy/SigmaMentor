/**
 * 教师端开发服务器（:5184，Bun 原生 bundler）：同学生端结构，/api → :3000。
 */
import index from "./index.html";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3000";
const PORT = Number(process.env.PORT ?? 5184);

const server = Bun.serve({
  port: PORT,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/login": index,
    "/register": index,
    "/dashboard": index,
    "/students": index,
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

console.info(`[teacher] 教师端 http://localhost:${server.port} · API 代理 → ${API_ORIGIN}`);
