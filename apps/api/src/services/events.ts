import { db } from "@sigma/db";
import { submissionEvents, type EventType } from "@sigma/db";
/**
 * 过程事件服务（I3）：只追加、异步不阻塞、失败进重试队列保证最终一致。
 */
import { and, desc, eq } from "drizzle-orm";

/** 内存重试队列（MVP；I4 切 PG 时换 Redis 队列，口径不变） */
const retryQueue: (() => Promise<void>)[] = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;

function ensureRetryLoop(): void {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    const pending = retryQueue.splice(0, retryQueue.length);
    for (const job of pending) {
      try {
        await job();
      } catch {
        retryQueue.push(job); // 最终一致：失败回到队列
      }
    }
  }, 5000);
}

export interface AppendEventInput {
  studentId: string;
  assignmentId: string;
  submissionId?: string | null;
  eventType: EventType;
  text: string;
  extra?: Record<string, unknown>;
  /** 事件发生时刻（客户端时钟或服务器时钟） */
  at: number;
}

/**
 * 追加一条事件：seq 取该生该题 max+1，intervalMs = at − 上一事件时刻。
 * 提交主流程调用时传 { async: true }——写入失败不抛错，进重试队列
 * （F1/I3 验收：事件写入失败时提交仍成功返回）。
 */
export async function appendEvent(
  input: AppendEventInput,
  opts: { async?: boolean } = {},
): Promise<void> {
  const write = async (): Promise<void> => {
    const [last] = await db
      .select({ seq: submissionEvents.seq, createdAt: submissionEvents.createdAt })
      .from(submissionEvents)
      .where(
        and(
          eq(submissionEvents.studentId, input.studentId),
          eq(submissionEvents.assignmentId, input.assignmentId),
        ),
      )
      .orderBy(desc(submissionEvents.seq))
      .limit(1);

    const seq = (last?.seq ?? 0) + 1;
    const intervalMs = last ? Math.max(0, input.at - last.createdAt.getTime()) : 0;

    await db.insert(submissionEvents).values({
      id: crypto.randomUUID(),
      studentId: input.studentId,
      assignmentId: input.assignmentId,
      submissionId: input.submissionId ?? null,
      seq,
      eventType: input.eventType,
      detail: { text: input.text, extra: input.extra },
      intervalMs,
      createdAt: new Date(input.at),
    });
  };

  try {
    await write();
  } catch (err) {
    console.error(`[events] 写入失败（进重试队列）: ${err instanceof Error ? err.message : err}`);
    if (!opts.async) throw err;
    ensureRetryLoop();
    retryQueue.push(write);
  }
}
