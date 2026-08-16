import { db } from "@sigma/db";
import { classes, students } from "@sigma/db";
/**
 * 教师端路由（F6 / F7）：班级学情看板 + 高危名单。
 */
import { Elysia, t } from "elysia";

import { requireTeacher } from "../auth";
import { computeClassAnalytics, computeClassRisk, computeKpStudents } from "../services/analytics";

export const analyticsRoutes = new Elysia({ prefix: "/classes", tags: ["教师端"] })
  .use(requireTeacher)
  .get(
    "/",
    async () => {
      const cls = await db.select().from(classes);
      const stus = await db.select().from(students);
      return cls.map((c) => ({
        id: c.id,
        name: c.name,
        semester: c.semester,
        studentCount: stus.filter((s) => s.classId === c.id).length,
      }));
    },
    { detail: { summary: "班级列表（教师）" } },
  )
  .get(
    "/:id/analytics",
    async ({ params }) => {
      const { weeks } = await computeClassAnalytics(params.id);
      const kpStudents = await computeKpStudents(params.id);
      return {
        classId: params.id,
        weeks: weeks.map((w, i) => ({ weekNo: i + 1, ...w })),
        kpStudents,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "班级学情看板（热力图 + 周统计 + TOP 卡点，口径 = analytics_snapshots）" },
    },
  )
  .get(
    "/:id/risk",
    async ({ params }) => {
      const risk = await computeClassRisk(params.id);
      return { classId: params.id, count: risk.length, items: risk };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "高危名单（红线 ②：仅教师可见，不通知学生、不自动定罪）" },
    },
  );
