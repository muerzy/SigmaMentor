import { createHmac, timingSafeEqual } from "node:crypto";

import { db } from "@sigma/db";
import { students, users, type Student, type User } from "@sigma/db";
/**
 * 会话与鉴权（Elysia 特性：签名 Cookie + guard + resolve + scoped 插件组合）。
 *
 * 会话：httpOnly Cookie「sigma_session」，值 = userId，Elysia 用 SESSION_SECRET
 * 自动签名/验签（篡改与伪造在框架层被拒）。
 * 密码：bcryptjs 哈希存储。
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";

import "./env";

export const SESSION_COOKIE = "sigma_session";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "sigmamentor-dev-secret-change-me";
export const TEACHER_INVITE_CODE = process.env.TEACHER_INVITE_CODE ?? "GOAI2026";

/** 会话签名：userId + "." + base64url(HMAC-SHA256)，去掉填充符 */
function signSessionValue(userId: string): string {
  const sig = createHmac("sha256", SESSION_SECRET)
    .update(userId)
    .digest("base64url")
    .replace(/=+$/, "");
  return `${userId}.${sig}`;
}

/** 验签：格式错/签名不符 → null */
function verifySessionValue(raw: string): string | null {
  const decoded = raw.includes("%") ? decodeURIComponent(raw) : raw;
  const dot = decoded.lastIndexOf(".");
  if (dot === -1) return null;
  const userId = decoded.slice(0, dot);
  const sig = decoded.slice(dot + 1);
  const expected = createHmac("sha256", SESSION_SECRET)
    .update(userId)
    .digest("base64url")
    .replace(/=+$/, "");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId.length > 0 ? userId : null;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionUser {
  user: User;
  /** 学生档案（教师为 null） */
  student: Student | null;
}

export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  let student: Student | null = null;
  if (user.role === "student") {
    const [s] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
    student = s ?? null;
  }
  return { user, student };
}

/* ---------- 会话守卫 ----------
 * Elysia 作用域要点：guard() 不传导 derive/resolve；要给「消费方路由」注入
 * 上下文，必须用钩子形式 resolve({ as: "scoped" })——scoped = 作用于
 * use() 该插件的父实例的路由。resolve 返回 status() 即短路（≥1.2）。
 * Cookie 签名完全自管（signSessionValue/verifySessionValue），
 * 不依赖框架的按路由 cookie 推断。
 */

export const requireAuth = new Elysia({ name: "model:auth" }).resolve(
  { as: "scoped" },
  ({ cookie, status }) => {
    const result = sessionUserIdFrom(cookie);
    if (!result.ok) return status(result.status, { error: result.error });
    return { userId: result.value };
  },
);

/** 学生守卫：自包含验签 + 加载档案（scoped resolve 只传导一层，不能链 use） */
export const requireStudent = new Elysia({ name: "model:student" }).resolve(
  { as: "scoped" },
  async ({ cookie, status }) => {
    const userId = sessionUserIdFrom(cookie);
    if (!userId.ok) return status(userId.status, { error: userId.error });
    const session = await loadSessionUser(userId.value);
    if (!session) return status(401, { error: "用户不存在" });
    if (session.user.role !== "student" || !session.student) {
      return status(403, { error: "需要学生账号" });
    }
    return { user: session.user, student: session.student };
  },
);

/** 教师守卫（同样自包含） */
export const requireTeacher = new Elysia({ name: "model:teacher" }).resolve(
  { as: "scoped" },
  async ({ cookie, status }) => {
    const userId = sessionUserIdFrom(cookie);
    if (!userId.ok) return status(userId.status, { error: userId.error });
    const session = await loadSessionUser(userId.value);
    if (!session) return status(401, { error: "用户不存在" });
    if (session.user.role !== "teacher") return status(403, { error: "需要教师账号" });
    return { user: session.user };
  },
);

/** 从 cookie jar 提取并验签 userId 的公共实现 */
function sessionUserIdFrom(cookie: Record<string, { value?: unknown }>):
  | {
      ok: true;
      value: string;
    }
  | { ok: false; status: 401; error: string } {
  const raw = cookie[SESSION_COOKIE]?.value;
  if (!raw) return { ok: false, status: 401, error: "未登录或会话过期" };
  const userId = verifySessionValue(String(raw));
  if (!userId) return { ok: false, status: 401, error: "会话签名无效" };
  return { ok: true, value: userId };
}

/** 登录后写会话 Cookie（自管 HMAC 签名） */
import type { Cookie } from "elysia";

export function setSessionCookie(session: Cookie<string | undefined>, userId: string): void {
  session.set({
    value: signSessionValue(userId),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
}

export function clearSessionCookie(session: Cookie<string | undefined>): void {
  session.remove();
}
