import { Card, PageHead, unwrap, useAuth, useToast } from "@sigma/ui";
/**
 * 导师对话页（F3 · A2）：L1–L4 分级引导。
 * 左：题目/卡点/策略上下文 + 红线卡；右：对话 + 快捷回复 + L4 复盘收尾。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api } from "../main";

interface SessionData {
  session: {
    id: string;
    assignmentId: string;
    level: number;
    status: string;
    summary: string | null;
    messages: { role: "user" | "tutor"; text: string; level: number; meta?: string; at: number }[];
  };
  created?: boolean;
}

interface TutorContextData {
  assignment: { code: string; title: string };
  diagnosis: {
    stuckPoints: { kpName: string; confidence: number }[];
    stuckMinutes: number;
    sameErrorCount: number;
  } | null;
}

const LEVELS = [
  { l: 1, name: "定向提示", desc: "指出检查方向，不给改法" },
  { l: 2, name: "策略提示", desc: "对比样例，暴露差异" },
  { l: 3, name: "同类样例", desc: "结构相同、数据不同的解法" },
  { l: 4, name: "复盘提炼", desc: "解出后总结，回流画像" },
];

export function TutorPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const list = useQuery({
    queryKey: ["assignments"],
    queryFn: async () => unwrap(await api.assignments.get()),
  });
  const assignmentId =
    params.get("assignmentId") ?? (list.data as { id: string }[] | undefined)?.at(-1)?.id;

  // 创建/复用会话
  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.tutor.sessions.post({ assignmentId: assignmentId! })) as SessionData,
  });

  useEffect(() => {
    if (assignmentId && !session && !create.isPending) create.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const session = create.data?.session;
  const sessionId = session?.id ?? "";

  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [session?.messages.length, pending]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      setPending(true);
      try {
        return unwrap(await api.tutor.sessions({ id: sessionId }).messages.post({ text }));
      } finally {
        setPending(false);
      }
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      create.mutate(); // 重新拉会话（含新消息与等级）
      const r = res as { verifiedSolved?: boolean };
      if (r.verifiedSolved === false) {
        toast({
          kicker: "闭环校验",
          title: "先去沙箱验证",
          body: "导师核对判题记录后才会进入 L4——去作业页跑一次全部用例。",
          duration: 8000,
        });
      }
    },
    onError: (err) =>
      toast({ kicker: "对话", title: "发送失败", body: err.message, duration: 6000 }),
  });

  const finish = useMutation({
    mutationFn: async (summary: string) =>
      unwrap(await api.tutor.sessions({ id: sessionId }).finish.post({ summary })),
    onSuccess: () => create.mutate(),
  });

  function doSend(text?: string) {
    const t = (text ?? input).trim();
    if (!t || !sessionId || pending) return;
    if (!text) setInput("");
    send.mutate(t);
  }

  // 上下文（题目 + 最新诊断）
  const ctx = useQuery({
    queryKey: ["diagnosis", assignmentId],
    enabled: !!assignmentId,
    queryFn: async () =>
      unwrap(await api.diagnosis({ assignmentId: assignmentId! }).get()) as TutorContextData,
  });
  const topKp = ctx.data?.diagnosis?.stuckPoints[0];

  const finished = session?.status === "completed";
  const solved = session?.status === "solved";
  const level = finished ? 4 : (session?.level ?? 1);

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker="F3 · 四级苏格拉底辅导 / Scaffolding Dialogue"
        title="导师对话"
        meta={
          <>
            <span>会话写入 guidance_sessions</span>
            <span>上下文：{ctx.data?.assignment.code ?? "—"} + 最新诊断</span>
          </>
        }
        actions={
          assignmentId ? (
            <Link to={`/assignment/${assignmentId}`} className="btn btn-ghost btn-sm">
              返回作业
            </Link>
          ) : undefined
        }
      />
      <div className="page-body">
        <div className="tutor-grid">
          {/* 左：上下文 */}
          <div className="stack">
            <Card title="当前题目" kicker={ctx.data?.assignment.code ?? "—"} bodyClassName="pt-3.5">
              <div className="ctx-kv">
                <span className="k">题目</span>
                <span className="v">{ctx.data?.assignment.title ?? "—"}</span>
                <span className="k">状态</span>
                <span className="v">
                  {finished ? "复盘完成" : solved ? "L4 复盘中" : `当前 L${level}`}
                </span>
              </div>
            </Card>

            <Card title="我的卡点" kicker="From Diagnosis" bodyClassName="pt-3.5">
              <div className="ctx-kv">
                <span className="k">知识点</span>
                <span className="v">
                  {topKp
                    ? `${topKp.kpName}（置信度 ${topKp.confidence.toFixed(2)}）`
                    : "暂无未解卡点"}
                </span>
                <span className="k">复发</span>
                <span className="v">同型错误 {ctx.data?.diagnosis?.sameErrorCount ?? 0} 次</span>
              </div>
            </Card>

            <Card title="会话策略" kicker="A2 · 导师 Agent" bodyClassName="pt-3.5">
              <div className="levels">
                {LEVELS.map((lv) => (
                  <div
                    key={lv.l}
                    className={`lv ${lv.l === level && !finished ? "on" : ""} ${lv.l < level || (finished && lv.l === 4) ? "done" : ""}`}
                  >
                    <b>L{lv.l}</b>
                    {lv.name}
                  </div>
                ))}
              </div>
              <div className="lv-desc">
                {LEVELS.map((lv) => (
                  <div key={lv.l} className={`li ${lv.l === level ? "on" : ""}`}>
                    <b>L{lv.l}</b>
                    <span>
                      {lv.name} —— {lv.desc}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <div className="redline">
              <b className="text-ink">产品红线 ①</b> — 导师 Agent 在 L1–L4 任何一级都
              <b className="text-ink">不产出完整可提交代码</b>。 依据：Generation Effect（Slamecka
              &amp; Graf 1982）——自己生成的答案记忆更牢。
            </div>
          </div>

          {/* 右：对话 */}
          <section className="card chat-card flex flex-col rounded-[3px] border border-line bg-surface">
            <div className="chat-h">
              <span className="who">
                <span className="n">导师 · 2σ</span>
                <span className="m">Socratic Mode · 规则版+LLM</span>
              </span>
              <span className="card-k font-[var(--mono)] text-[10px] tracking-[0.22em] text-fg-faint uppercase">
                {finished ? "已回流画像" : solved ? "L4 · 复盘中" : `当前 L${level}`}
              </span>
            </div>

            <div className="chat-interv">
              <span className="pulse" />
              <span>
                导师就绪 —— 检测到{topKp ? `你在「${topKp.kpName}」` : "你"}的卡点（诊断驱动）·
                对话上下文已携带题目与最近诊断
              </span>
            </div>

            <div className="chat-wrap">
              <div className="chat-log" ref={logRef} aria-live="polite">
                {session?.messages.map((m, i) => (
                  <div key={i} className={`msg ${m.role === "user" ? "msg-user" : "msg-bot"}`}>
                    {m.text}
                    <div className="m-meta">
                      {m.role === "tutor" && <span className="lv-tag">L{m.level}</span>}
                      {m.meta && <span>{m.meta}</span>}
                      {m.role === "user" && <span>{me?.user.displayName}</span>}
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className="msg msg-bot">
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
                {!session && <div className="note">会话创建中…</div>}
              </div>

              <div className="quick">
                {finished ? (
                  <>
                    <Link
                      className="chip"
                      to={assignmentId ? `/diagnosis?assignmentId=${assignmentId}` : "/diagnosis"}
                    >
                      查看更新后的诊断画像 →
                    </Link>
                    <Link
                      className="chip"
                      to={assignmentId ? `/assignment/${assignmentId}` : "/assignment"}
                    >
                      返回作业
                    </Link>
                  </>
                ) : solved ? (
                  <>
                    {["循环边界", "累加器初值", "输出格式"].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="chip"
                        onClick={() => finish.mutate(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => doSend("还是没思路，再提示一下")}
                    >
                      还是没思路，再提示一下
                    </button>
                    <button type="button" className="chip" onClick={() => doSend("直接给我代码")}>
                      直接给我代码
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => doSend("我改好了，全部通过了")}
                    >
                      我改好了，全部通过了
                    </button>
                  </>
                )}
              </div>

              {!finished && (
                <div className="chat-input">
                  <textarea
                    value={input}
                    placeholder="输入你的回答，或点击下方快捷回复…"
                    aria-label="对话输入"
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        doSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => doSend()}
                    disabled={pending}
                  >
                    发送
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
