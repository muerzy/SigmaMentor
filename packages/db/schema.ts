/**
 * SigmaMentor 数据模型（PRD §6.2）
 *
 * MVP：drizzle sqlite-core，JSON 列用 text({ mode: "json" })（sqlite-core 无 json() 导出）。
 * 生产（PRD I4，复赛前切换）：pg-core + jsonb()，SQL 写法已避免 SQLite 特有语法。
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/* ---------- 公共类型 ---------- */

/** 知识点（题目标注） */
export type KnowledgePoint = { key: string; name: string };

/** 测试用例：input 为传给学生函数的实参，expected 为期望返回值 */
export type JudgeCase = { input: unknown; expected: unknown };

/** 判题明细：逐用例比对结果 */
export type CaseRow = { input: unknown; expected: unknown; got: unknown; ok: boolean };

/** 事件类型（F1）：编辑/编译错/运行错/部分通过/通过/放弃 */
export type EventType = "edit" | "compile" | "run" | "partial" | "pass" | "drop";

/** 提交状态 */
export type SubmissionStatus = "compile_error" | "run_error" | "timeout" | "partial" | "pass";

/** 诊断卡点条目 */
export type StuckPoint = { kpKey: string; kpName: string; confidence: number };

/** 诊断证据链：可回溯到具体提交（产品红线 ⑤） */
export type EvidenceRef = {
  submissionSeq: number;
  submissionId: string;
  eventType: EventType;
  note: string;
};

/** 错误演化路径节点 */
export type EvolutionNode = {
  time: number;
  type: EventType | "stuck";
  title: string;
  detail: string;
  submissionSeq?: number;
};

/** 辅导消息 */
export type GuidanceMessage = {
  role: "user" | "tutor";
  text: string;
  level: 1 | 2 | 3 | 4;
  meta?: string;
  at: number;
};

/** 代写三类过程信号（P1/F8，表结构与口径先落地） */
export type EvidenceSignal = {
  kind: "edit_trace" | "version_seq" | "rhythm";
  label: string;
  detail: string;
  anomalous: boolean;
};

/** 干预触发条件 */
export type InterventionTrigger = {
  rule: "stuck_timeout" | "same_error_repeat" | "drop";
  kpKey?: string;
  minutes?: number;
  count?: number;
};

/** 班级学情快照（F6 热力图数据源） */
export type AnalyticsSnapshot = {
  stats: {
    submits: number;
    stuckCount: number;
    stuckMedianMin: number;
    riskCount: number;
    passRate: number;
  };
  /** 知识点 × 周：n=卡点人数，m=中位卡点分钟 */
  kps: { key: string; name: string; weeks: ({ n: number; m: number } | null)[] }[];
  topKps: { key: string; name: string; n: number; m: number; delta: number | null }[];
};

/* ---------- 表 ---------- */

/** 用户（登录注册，第 10 张表） */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** student | teacher */
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("users_username_uq").on(t.username)],
);

/** 班级 */
export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  semester: text("semester").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** 学生档案（带匿名编号，面向未来脱敏开源数据集） */
export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    studentNo: text("student_no").notNull(),
    anonNo: text("anon_no").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("students_user_uq").on(t.userId),
    uniqueIndex("students_no_uq").on(t.classId, t.studentNo),
  ],
);

/** 作业 */
export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** 判题语言（LanguageRunner 适配器 id），MVP 为 js */
    language: text("language").notNull(),
    /** 学生需完成的函数名 */
    funcName: text("func_name").notNull(),
    knowledgePoints: text("knowledge_points", { mode: "json" }).$type<KnowledgePoint[]>().notNull(),
    cases: text("cases", { mode: "json" }).$type<JudgeCase[]>().notNull(),
    starterCode: text("starter_code").notNull(),
    limitMs: integer("limit_ms").notNull(),
    weekNo: integer("week_no").notNull(),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("assignments_class_idx").on(t.classId)],
);

/** 提交 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    /** 该生该题第几次提交（从 1 起） */
    seq: integer("seq").notNull(),
    code: text("code").notNull(),
    language: text("language").notNull(),
    status: text("status").$type<SubmissionStatus>().notNull(),
    score: integer("score").notNull(),
    passCount: integer("pass_count").notNull(),
    totalCount: integer("total_count").notNull(),
    /** 判题明细：逐用例行 / 编译错误信息 */
    detail: text("detail", { mode: "json" })
      .$type<{ rows?: CaseRow[]; message?: string }>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("submissions_student_assignment_idx").on(t.studentId, t.assignmentId),
    uniqueIndex("submissions_seq_uq").on(t.studentId, t.assignmentId, t.seq),
  ],
);

/**
 * 过程事件（I3 · 产品地基表）——只追加、不可篡改。
 * 编辑/放弃事件可无 submissionId（发生在提交前后）。
 */
export const submissionEvents = sqliteTable(
  "submission_events",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    submissionId: text("submission_id").references(() => submissions.id, {
      onDelete: "cascade",
    }),
    /** 该生该题内事件序号（从 1 起，只增） */
    seq: integer("seq").notNull(),
    eventType: text("event_type").$type<EventType>().notNull(),
    detail: text("detail", { mode: "json" }).$type<{ text: string; extra?: unknown }>().notNull(),
    /** 与上一事件间隔毫秒（F1 验收：与真实操作误差 < 1s） */
    intervalMs: integer("interval_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("events_student_assignment_idx").on(t.studentId, t.assignmentId),
    uniqueIndex("events_seq_uq").on(t.studentId, t.assignmentId, t.seq),
  ],
);

/** 诊断画像（A1 输出，F2 展示） */
export const diagnoses = sqliteTable(
  "diagnoses",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    stuckPoints: text("stuck_points", { mode: "json" }).$type<StuckPoint[]>().notNull(),
    conclusion: text("conclusion").notNull(),
    evolution: text("evolution", { mode: "json" }).$type<EvolutionNode[]>().notNull(),
    evidence: text("evidence", { mode: "json" }).$type<EvidenceRef[]>().notNull(),
    stuckMinutes: integer("stuck_minutes").notNull(),
    sameErrorCount: integer("same_error_count").notNull(),
    /** rule | llm（LLM 增强解释不改证据链结构） */
    engine: text("engine").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("diagnoses_student_assignment_idx").on(t.studentId, t.assignmentId)],
);

/** 辅导会话（A2 · L1–L4 状态机） */
export const guidanceSessions = sqliteTable(
  "guidance_sessions",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    diagnosisId: text("diagnosis_id").references(() => diagnoses.id, { onDelete: "set null" }),
    /** 当前引导级别 1–4 */
    level: integer("level").notNull(),
    /** active | solved | completed（L4 复盘完成） */
    status: text("status").notNull(),
    messages: text("messages", { mode: "json" }).$type<GuidanceMessage[]>().notNull(),
    /** L4 复盘结论（回流诊断画像） */
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sessions_student_assignment_idx").on(t.studentId, t.assignmentId)],
);

/** 代写过程证据（A3 · P1 呈现完整证据页，表与三类信号口径先落地；红线：只呈现不定罪） */
export const evidenceSignals = sqliteTable(
  "evidence_signals",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** low | mid | high（疑似度分级，不定罪） */
    suspicion: text("suspicion").notNull(),
    signals: text("signals", { mode: "json" }).$type<EvidenceSignal[]>().notNull(),
    note: text("note").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("evidence_student_idx").on(t.studentId)],
);

/** 干预记录（F5 · P1 完整推送，本阶段记录触发） */
export const interventions = sqliteTable(
  "interventions",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    trigger: text("trigger", { mode: "json" }).$type<InterventionTrigger>().notNull(),
    /** drop | same_error_repeat | stuck_timeout */
    kind: text("kind").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("interventions_student_idx").on(t.studentId, t.createdAt)],
);

/** 班级学情快照（A4 聚合输出，F6 看板数据源） */
export const analyticsSnapshots = sqliteTable(
  "analytics_snapshots",
  {
    id: text("id").primaryKey(),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    weekNo: integer("week_no").notNull(),
    data: text("data", { mode: "json" }).$type<AnalyticsSnapshot>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("analytics_class_week_uq").on(t.classId, t.weekNo)],
);

/* ---------- 行类型导出 ---------- */

export type User = typeof users.$inferSelect;
export type Class = typeof classes.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type SubmissionEvent = typeof submissionEvents.$inferSelect;
export type Diagnosis = typeof diagnoses.$inferSelect;
export type GuidanceSession = typeof guidanceSessions.$inferSelect;
export type EvidenceSignalRow = typeof evidenceSignals.$inferSelect;
export type Intervention = typeof interventions.$inferSelect;
export type AnalyticsSnapshotRow = typeof analyticsSnapshots.$inferSelect;
