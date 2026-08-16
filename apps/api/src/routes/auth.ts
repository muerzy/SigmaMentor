import { db } from "@sigma/db";
import { classes, students, users } from "@sigma/db";
/**
 * 认证路由：注册 / 登录 / 登出 / 我。
 * 学生注册即入班（MVP 单班演示口径：默认加入第一个班）；教师注册需邀请码。
 */
import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
  SESSION_COOKIE,
  TEACHER_INVITE_CODE,
  clearSessionCookie,
  hashPassword,
  loadSessionUser,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from "../auth";

function publicUser(u: { id: string; username: string; role: string; displayName: string }) {
  return { id: u.id, username: u.username, role: u.role, displayName: u.displayName };
}

export const authRoutes = new Elysia({ prefix: "/auth", tags: ["认证"] })
  .post(
    "/register",
    async ({ body, cookie, status }) => {
      const { username, password, displayName, role, teacherInviteCode, studentNo } = body;

      const [exists] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (exists) return status(409, { error: "用户名已存在" });

      if (role === "teacher" && teacherInviteCode !== TEACHER_INVITE_CODE) {
        return status(403, { error: "教师邀请码不正确" });
      }

      const userId = crypto.randomUUID();
      const [created] = await db
        .insert(users)
        .values({
          id: userId,
          username,
          passwordHash: await hashPassword(password),
          role,
          displayName,
          createdAt: new Date(),
        })
        .returning();

      let studentProfile = null;
      if (role === "student") {
        const [firstClass] = await db
          .select()
          .from(classes)
          .orderBy(asc(classes.createdAt))
          .limit(1);
        if (!firstClass) return status(409, { error: "尚无班级，请联系教师先创建" });
        const no = studentNo?.trim() || `S${String(Date.now()).slice(-6)}`;
        await db.insert(students).values({
          id: crypto.randomUUID(),
          userId,
          classId: firstClass.id,
          studentNo: no,
          anonNo: `anon-${crypto.randomUUID().slice(0, 8)}`,
          createdAt: new Date(),
        });
        studentProfile = { classId: firstClass.id, studentNo: no };
      }

      setSessionCookie(cookie[SESSION_COOKIE]!, userId);
      return status(201, { user: publicUser(created!), student: studentProfile });
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 32, pattern: "^[a-zA-Z0-9_]+$" }),
        password: t.String({ minLength: 6, maxLength: 64 }),
        displayName: t.String({ minLength: 1, maxLength: 24 }),
        role: t.Union([t.Literal("student"), t.Literal("teacher")]),
        teacherInviteCode: t.Optional(t.String()),
        studentNo: t.Optional(t.String()),
      }),
      detail: { summary: "注册（学生即入班；教师需邀请码）" },
    },
  )
  .post(
    "/login",
    async ({ body, cookie, status }) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1);
      if (!user) return status(401, { error: "用户名或密码错误" });
      if (!(await verifyPassword(body.password, user.passwordHash))) {
        return status(401, { error: "用户名或密码错误" });
      }
      setSessionCookie(cookie[SESSION_COOKIE]!, user.id);
      let student = null;
      if (user.role === "student") {
        const [s] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
        student = s ? { classId: s.classId, studentNo: s.studentNo } : null;
      }
      return { user: publicUser(user), student };
    },
    {
      body: t.Object({ username: t.String(), password: t.String() }),
      detail: { summary: "登录（签名 httpOnly Cookie）" },
    },
  )
  .post(
    "/logout",
    ({ cookie }) => {
      clearSessionCookie(cookie[SESSION_COOKIE]!);
      return { ok: true };
    },
    { detail: { summary: "登出" } },
  )
  .use(requireAuth)
  .get(
    "/me",
    async ({ userId, status }) => {
      const session = await loadSessionUser(userId);
      if (!session) return status(401, { error: "用户不存在" });
      return {
        user: publicUser(session.user),
        student: session.student
          ? {
              id: session.student.id,
              classId: session.student.classId,
              studentNo: session.student.studentNo,
              anonNo: session.student.anonNo,
            }
          : null,
      };
    },
    { detail: { summary: "当前登录者" } },
  );
