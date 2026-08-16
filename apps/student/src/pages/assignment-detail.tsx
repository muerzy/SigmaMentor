import {
  Badge,
  Button,
  Card,
  EventBadge,
  PageHead,
  Sheet,
  SheetContent,
  useToast,
  unwrap,
} from "@sigma/ui";
/**
 * 作业工作台（F1 核心 · 三栏）：题面 ｜ 编辑器+判题 ｜ 历史+过程事件。
 * 全过程事件（编辑 debounce / 判题 / 放弃监测 40s 演示阈值）写入 submission_events；
 * 失败时诊断摘要直接呈现（S1），通过时引导 L4 复盘。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { api } from "../main";

/* ---------- 类型 ---------- */

interface AssignmentDetail {
  assignment: {
    id: string;
    code: string;
    title: string;
    description: string;
    language: string;
    funcName: string;
    knowledgePoints: { key: string; name: string }[];
    starterCode: string;
    limitMs: number;
    weekNo: number;
  };
  sampleCases: { input: unknown; expected: unknown }[];
  hiddenInputCount: number;
  submissions: {
    seq: number;
    status: string;
    score: number;
    passCount: number;
    totalCount: number;
    code: string;
    message: string | null;
    at: number;
  }[];
  events: { seq: number; type: string; text: string; intervalMs: number; at: number }[];
  starterCodeOrDefault: string;
}

interface SubmitResult {
  submissionSeq: number;
  status: string;
  score: number;
  passCount: number;
  totalCount: number;
  detail: {
    rows?: { input: unknown; expected: unknown; got: unknown; ok: boolean }[];
    message?: string;
  };
  judgeElapsedMs: number;
  diagnosisSummary: {
    topKpKey: string | null;
    topKpName: string | null;
    sameErrorCount: number;
    relatedSubmissions: number[];
    conclusion: string;
    assignmentId?: string;
  } | null;
  suggestIntervention: boolean;
}

interface EvidenceData {
  seq: number;
  status: string;
  score: number;
  passCount: number;
  totalCount: number;
  code: string;
  message: string | null;
  events: { seq: number; type: string; text: string; at: number }[];
}

/* ---------- 工具（原型 app.js 同款口径）---------- */

function fmtInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}分${s % 60}秒` : `${m}分钟`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

const STATUS_LABEL: Record<string, { label: string; tone: "pass" | "warn" | "fail" }> = {
  pass: { label: "通过", tone: "pass" },
  partial: { label: "部分通过", tone: "warn" },
  run_error: { label: "运行错误", tone: "fail" },
  compile_error: { label: "编译错误", tone: "fail" },
  timeout: { label: "超时", tone: "fail" },
};

/* ---------- 页面 ---------- */

export function AssignmentDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const q = useQuery({
    queryKey: ["assignment", id],
    queryFn: async () => unwrap(await api.assignments({ id }).get()) as AssignmentDetail,
  });

  const [code, setCode] = useState("");
  const [lastLen, setLastLen] = useState(0);
  const [judge, setJudge] = useState<SubmitResult | null>(null);
  const [judgeStep, setJudgeStep] = useState(-1);
  const [liveEvents, setLiveEvents] = useState<AssignmentDetail["events"]>([]);
  const [evidenceSeq, setEvidenceSeq] = useState<number | null>(null);

  const codeRef = useRef(code);
  codeRef.current = code;
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropFired = useRef(false);
  const lastActivity = useRef(Date.now());

  // 初始化编辑器内容（上次提交版本 or 起始代码）
  useEffect(() => {
    if (q.data && code === "") {
      setCode(q.data.starterCodeOrDefault);
      setLastLen(q.data.starterCodeOrDefault.length);
      setLiveEvents(q.data.events);
    }
  }, [q.data, code]);

  const assignment = q.data?.assignment;

  /* ----- 编辑事件：debounce 900ms 上报（I3：异步写入不阻塞）----- */
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onCodeChange(value: string) {
    setCode(value);
    activity();
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      const chars = value.length - lastLen;
      setLastLen(value.length);
      const at = Date.now();
      setLiveEvents((prev) => [
        ...prev,
        {
          seq: (prev.at(-1)?.seq ?? 0) + 1,
          type: "edit",
          text: "编辑代码",
          intervalMs: at - (prev.at(-1)?.at ?? at),
          at,
        },
      ]);
      api.events
        .post({
          assignmentId: id,
          events: [
            {
              type: "edit",
              text: `编辑代码（${chars >= 0 ? "+" : ""}${chars} 字符）`,
              chars: Math.abs(chars),
              at,
            },
          ],
        })
        .catch(() => {});
    }, 900);
  }

  /* ----- 放弃监测：40s 演示阈值（线上 10 分钟），主动干预每日 ≤3 ----- */
  function interventionCount(): number {
    try {
      return Number(localStorage.getItem(`sm-interv-${id}`) ?? "0");
    } catch {
      return 0;
    }
  }
  function startDropWatch() {
    if (dropFired.current || !assignment) return;
    stopDropWatch();
    dropTimer.current = setTimeout(() => {
      dropFired.current = true;
      const at = Date.now();
      setLiveEvents((prev) => [
        ...prev,
        {
          seq: (prev.at(-1)?.seq ?? 0) + 1,
          type: "drop",
          text: "超时无活动 40 秒（演示阈值，线上 10 分钟）",
          intervalMs: at - (prev.at(-1)?.at ?? at),
          at,
        },
      ]);
      api.events
        .post({
          assignmentId: id,
          events: [{ type: "drop", text: "超时无活动 40 秒（演示阈值，线上 10 分钟）", at }],
        })
        .catch(() => {});
      const count = interventionCount();
      if (count < 3) {
        try {
          localStorage.setItem(`sm-interv-${id}`, String(count + 1));
        } catch {}
        toast({
          kicker: "F5 · 诊断驱动的主动干预",
          title: `导师主动出现：你已在「${q.data?.assignment.knowledgePoints[0]?.name ?? "当前题目"}」卡点`,
          body: `连续同型错误触发。今日干预 ${count + 1}/3（同一学生同一题目每日 ≤ 3 次）。`,
          actions: [{ label: "进入对话", href: `/tutor?assignmentId=${id}`, solid: true }],
          duration: 0,
        });
      }
    }, 40_000);
  }
  function stopDropWatch() {
    if (dropTimer.current) clearTimeout(dropTimer.current);
    dropTimer.current = null;
  }
  function activity() {
    lastActivity.current = Date.now();
    stopDropWatch();
    if (!dropFired.current) startDropWatch();
  }
  useEffect(() => {
    startDropWatch();
    return stopDropWatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  /* ----- 提交 ----- */
  const submit = useMutation({
    mutationFn: async () => {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        setJudgeStep(i);
        await new Promise((r) => setTimeout(r, 240));
      }
      return unwrap(
        await api.submissions.post({ assignmentId: id, code: codeRef.current }),
      ) as SubmitResult;
    },
    onSuccess: (result) => {
      setJudgeStep(-1);
      setJudge(result);
      const at = Date.now();
      setLiveEvents((prev) => [
        ...prev,
        {
          seq: (prev.at(-1)?.seq ?? 0) + 1,
          type:
            result.status === "pass"
              ? "pass"
              : result.status === "partial"
                ? "partial"
                : result.status === "compile_error"
                  ? "compile"
                  : "run",
          text: `提交 #${result.submissionSeq} · ${result.passCount}/${result.totalCount} 用例${result.status === "pass" ? "通过" : result.status === "partial" ? "通过" : "未通过"}`,
          intervalMs: at - (prev.at(-1)?.at ?? at),
          at,
        },
      ]);
      void qc.invalidateQueries({ queryKey: ["assignment", id] });
      if (result.status === "pass") {
        stopDropWatch();
        dropFired.current = false;
        toast({
          kicker: "Judge · 沙箱判题",
          title: `通过 ${result.passCount}/${result.totalCount} —— 你自己解出来了`,
          body: "L4 复盘已就绪：总结这次错在哪类问题，结论回流诊断画像。",
          actions: [{ label: "进入复盘", href: `/tutor?assignmentId=${id}`, solid: true }],
          duration: 12000,
        });
      } else {
        dropFired.current = false;
        startDropWatch();
      }
    },
    onError: (err) => {
      setJudgeStep(-1);
      toast({ kicker: "Judge", title: "提交失败", body: err.message, duration: 6000 });
    },
  });

  const evidence = useQuery({
    queryKey: ["evidence", id, evidenceSeq],
    enabled: evidenceSeq !== null,
    queryFn: async () =>
      unwrap(
        await api
          .diagnosis({ assignmentId: id })
          .evidence({ seq: String(evidenceSeq) })
          .get(),
      ) as EvidenceData,
  });

  const gutter = useMemo(() => {
    const lines = code.split("\n").length;
    return Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  }, [code]);

  if (q.isLoading) return <div className="page-body note">加载中…</div>;
  if (q.error || !q.data) return <div className="page-body note">加载失败：{q.error?.message}</div>;
  const d = q.data;
  const latest = d.submissions.at(-1);
  const initialVerdict = judge
    ? null
    : latest && (
        <VerdictBlock
          status={latest.status}
          score={latest.score}
          passCount={latest.passCount}
          totalCount={latest.totalCount}
          message={latest.message}
          rows={null}
          diagSummary={null}
        />
      );

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker={`F1 · 作业提交与沙箱判题 / Submit & Judge · 第 ${assignment!.weekNo} 周`}
        title={`${d.assignment.code} · ${d.assignment.title}`}
        meta={
          <>
            <span>
              函数 <code className="inline">{d.assignment.funcName}</code>
            </span>
            <span>
              已提交 <b>{d.submissions.length}</b> 次
            </span>
            <span>
              状态{" "}
              {latest ? (
                <Badge tone={STATUS_LABEL[latest.status]?.tone ?? "mut"}>
                  {STATUS_LABEL[latest.status]?.label ?? latest.status}
                </Badge>
              ) : (
                <Badge tone="outline">未提交</Badge>
              )}
            </span>
          </>
        }
        actions={
          <>
            <Link to={`/diagnosis?assignmentId=${id}`} className="btn btn-ghost btn-sm">
              诊断画像
            </Link>
            <Link to={`/tutor?assignmentId=${id}`} className="btn btn-ghost btn-sm">
              问导师
            </Link>
          </>
        }
      />
      <div className="page-body">
        <div className="work">
          {/* 左：题面 */}
          <div className="stack col-l">
            <Card title="题面" kicker={d.assignment.code} bodyClassName="pt-0">
              <p className="prob-desc text-fg-muted">{d.assignment.description}</p>
              <div className="mt-3.5" />
              <div className="kicker mb-2 font-[var(--mono)] text-[10.5px] tracking-[0.26em] text-fg-muted uppercase">
                示例 · Samples
              </div>
              <div className="io-blk">
                <span className="io-k">输入</span>
                <span className="io-k">期望输出</span>
                {d.sampleCases.map((c, i) => (
                  <Fragment key={i}>
                    <span>{JSON.stringify(c.input)}</span>
                    <span>{JSON.stringify(c.expected)}</span>
                  </Fragment>
                ))}
              </div>
              <div className="mt-3.5" />
              <div className="kicker mb-2 font-[var(--mono)] text-[10.5px] tracking-[0.26em] text-fg-muted uppercase">
                知识点
              </div>
              <div className="chips">
                {d.assignment.knowledgePoints.map((k, i) => (
                  <span key={k.key} className={`chip ${i === 0 ? "on" : ""}`}>
                    {k.name}
                  </span>
                ))}
              </div>
              <div className="limit">
                LIMIT · {d.assignment.limitMs}ms / 64MB
                <br />
                容器沙箱隔离执行 · 网络禁用（开发版：子进程 + 超时终止）
                <br />
                另有 {d.hiddenInputCount} 组隐藏用例
              </div>
            </Card>
            <Card bodyClassName="text-[12.5px] leading-[1.75] text-fg-muted">
              <b className="text-ink">判题说明</b> ——
              提交后由沙箱逐用例运行你的函数，比对返回值。全过程事件（编辑 / 编译 / 运行 / 通过 /
              放弃）正在写入 <code className="inline">submission_events</code>。
            </Card>
          </div>

          {/* 中：编辑器 + 判题 */}
          <div className="stack col-m">
            <Card
              title={`${d.assignment.funcName}.js`}
              kicker={`${d.assignment.language.toUpperCase()} · 在线编辑`}
              bodyClassName="pt-0"
            >
              <div className="editor">
                <div className="ed-gutter" aria-hidden>
                  {gutter}
                </div>
                <textarea
                  className="ed-area"
                  value={code}
                  spellCheck={false}
                  aria-label="代码编辑区"
                  onChange={(e) => onCodeChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart;
                      const next = `${code.slice(0, start)}    ${code.slice(el.selectionEnd)}`;
                      onCodeChange(next);
                      requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4));
                    }
                  }}
                />
              </div>
              <div className="cta-row">
                <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                  {submit.isPending ? "判题中…" : judge ? "再次提交" : "提交到沙箱"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCode(d.starterCodeOrDefault);
                    setLastLen(d.starterCodeOrDefault.length);
                    activity();
                  }}
                >
                  重置代码
                </Button>
                <span className="cta-note">判题 P95 &lt; 5s · 事件异步写入不阻塞提交</span>
              </div>
            </Card>

            <Card
              title="判题结果"
              kicker={
                judge
                  ? `Submission #${judge.submissionSeq}`
                  : latest
                    ? `Submission #${latest.seq}`
                    : "—"
              }
              bodyClassName="pt-0"
            >
              {submit.isPending && judgeStep >= 0 ? (
                <JudgeProgress step={judgeStep} />
              ) : judge ? (
                <VerdictBlock
                  status={judge.status}
                  score={judge.score}
                  passCount={judge.passCount}
                  totalCount={judge.totalCount}
                  message={judge.detail.message}
                  rows={judge.detail.rows ?? null}
                  diagSummary={
                    judge.diagnosisSummary ? { ...judge.diagnosisSummary, assignmentId: id } : null
                  }
                  elapsedMs={judge.judgeElapsedMs}
                />
              ) : (
                (initialVerdict ?? (
                  <div className="note">提交一次代码，这里会给出逐用例判定与诊断摘要。</div>
                ))
              )}
            </Card>
          </div>

          {/* 右：历史 + 事件流 */}
          <div className="stack col-r">
            <Card
              title="提交历史"
              kicker={String(d.submissions.length)}
              bodyClassName="pt-1.5 pb-2"
            >
              <div className="hist">
                {[...d.submissions].reverse().map((s) => (
                  <button
                    key={s.seq}
                    type="button"
                    className="hist-item"
                    onClick={() => setEvidenceSeq(s.seq)}
                  >
                    <span className="h-no">#{s.seq}</span>
                    <span className="h-t">
                      <b>
                        {s.status === "pass"
                          ? `${s.passCount}/${s.totalCount} · ${s.score} 分`
                          : s.status === "partial"
                            ? `${s.passCount}/${s.totalCount} · ${s.score} 分`
                            : s.status === "compile_error"
                              ? "编译错误"
                              : s.status === "timeout"
                                ? "执行超时"
                                : `${s.passCount}/${s.totalCount} 未通过`}
                      </b>
                      {new Date(s.at).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <EventBadge
                      type={
                        s.status === "pass"
                          ? "pass"
                          : s.status === "partial"
                            ? "partial"
                            : s.status === "compile_error"
                              ? "compile"
                              : "run"
                      }
                    />
                  </button>
                ))}
                {d.submissions.length === 0 && <div className="note">还没有提交。</div>}
              </div>
            </Card>

            <Card title="过程事件" kicker="submission_events" bodyClassName="pt-1 pb-2">
              <div className="note border-b border-dashed border-line px-0 pt-1.5 pb-2.5">
                只追加 · 不可篡改 · 异步写入（不阻塞提交）
              </div>
              <div className="events">
                {[...liveEvents].reverse().map((e, i) => (
                  <div key={`${e.seq}-${e.at}`} className={`evt ${i === 0 ? "new" : ""}`}>
                    <span className="e-seq">{e.seq}</span>
                    <EventBadge type={e.type} />
                    <span className="e-d">{e.text}</span>
                    <span className="e-iv" title="与上一事件间隔">
                      +{fmtInterval(e.intervalMs)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* 证据抽屉 */}
      <Sheet open={evidenceSeq !== null} onOpenChange={(o) => !o && setEvidenceSeq(null)}>
        <SheetContent title={`提交 #${evidenceSeq} · 过程证据`}>
          {evidence.data ? (
            <div>
              <div className="mb-2.5 flex items-center gap-2">
                <Badge tone={STATUS_LABEL[evidence.data.status]?.tone ?? "mut"}>
                  {STATUS_LABEL[evidence.data.status]?.label}
                </Badge>
                <span className="note">
                  {evidence.data.passCount}/{evidence.data.totalCount} 用例 · {evidence.data.score}{" "}
                  分
                </span>
              </div>
              {evidence.data.message && <div className="note mb-2.5">{evidence.data.message}</div>}
              <div className="codebox">{evidence.data.code}</div>
              <div className="kicker mt-4 mb-1.5 font-[var(--mono)] text-[10.5px] tracking-[0.26em] text-fg-muted uppercase">
                该次提交前后事件
              </div>
              {evidence.data.events.map((e) => (
                <div key={e.seq} className="d-evt">
                  <span className="s">{e.seq}</span>
                  <EventBadge type={e.type} />
                  <span className="text-[12px] text-fg-muted">{e.text}</span>
                </div>
              ))}
              <div className="note note-b">
                该次提交已写入 <code className="inline">submission_events</code>
                ；诊断结论可回溯到这条记录（红线 ⑤）。{" "}
                <Link className="link" to={`/diagnosis?assignmentId=${id}`}>
                  在诊断画像中查看证据链 →
                </Link>
              </div>
            </div>
          ) : (
            <div className="note">加载中…</div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

/* ---------- 判题进度动画（编译→沙箱→逐用例）---------- */

const STEPS = [
  "语法检查 …",
  "启动沙箱进程 …",
  "运行用例 1/5 …",
  "运行用例 2/5 …",
  "运行用例 3/5 …",
  "运行用例 4/5 …",
  "运行用例 5/5 …",
  "比对输出 …",
];

function JudgeProgress({ step }: { step: number }) {
  return (
    <div>
      <div className="judge-line">
        <span className="dotp" />
        <span>{STEPS[step] ?? "判题中…"}</span>
      </div>
      <div className="judge-bar">
        <i style={{ width: `${Math.min(100, ((step + 1) / STEPS.length) * 100)}%` }} />
      </div>
    </div>
  );
}

/* ---------- 判题结果块 ---------- */

function VerdictBlock({
  status,
  score,
  passCount,
  totalCount,
  message,
  rows,
  diagSummary,
  elapsedMs,
}: {
  status: string;
  score: number;
  passCount: number;
  totalCount: number;
  message?: string | null;
  rows: { input: unknown; expected: unknown; got: unknown; ok: boolean }[] | null;
  diagSummary: SubmitResult["diagnosisSummary"];
  elapsedMs?: number;
}) {
  const badge = STATUS_LABEL[status] ?? { label: status, tone: "mut" as const };
  return (
    <div>
      <div className="verdict">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <span className="score">
          {score}
          <span className="u">分</span>
        </span>
        <span className="note">
          {passCount} / {totalCount} 用例通过
        </span>
        <span className="spacer" />
        <span className="card-k font-[var(--mono)] text-[10px] tracking-[0.22em] text-fg-faint uppercase">
          {elapsedMs !== undefined ? `延迟 ${(elapsedMs / 1000).toFixed(1)}s` : "历史提交"}
        </span>
      </div>

      {status === "compile_error" && message ? (
        <div className="codebox mt-3">
          <span className="cmt">error:</span> {message.split("\n").slice(0, 4).join("\n")}
        </div>
      ) : rows && rows.length > 0 ? (
        <div className="scroll-x">
          <table className="cases">
            <thead>
              <tr>
                <th>用例</th>
                <th>输入</th>
                <th>期望</th>
                <th>实得</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>#{i + 1}</td>
                  <td className="num">{JSON.stringify(r.input)}</td>
                  <td className="num">{JSON.stringify(r.expected)}</td>
                  <td className="num">{JSON.stringify(r.got)}</td>
                  <td className={r.ok ? "ok" : "bad"}>{r.ok ? "✓ AC" : "✗ WA"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : message ? (
        <div className="note mt-2.5">{message}</div>
      ) : null}

      {status !== "pass" && diagSummary?.topKpName ? (
        <div className="diag-strip">
          <span className="d-k">诊断摘要</span>
          <span className="d-v">
            错误定位：<b className="text-ink">{diagSummary.topKpName}</b> —— 同型错误{" "}
            {diagSummary.sameErrorCount} 次（关联提交{" "}
            {diagSummary.relatedSubmissions.map((s) => `#${s}`).join(" · ")}）。{" "}
            <Link className="link" to={`/diagnosis?assignmentId=${diagSummary.assignmentId ?? ""}`}>
              查看诊断画像 →
            </Link>
          </span>
        </div>
      ) : status === "pass" ? (
        <div className="diag-strip">
          <span className="d-k">下一步</span>
          <span className="d-v">
            L4 复盘已就绪——去导师对话，用自己的话总结这次错在哪类问题上，结论将回流诊断画像。{" "}
            <Link
              className="link"
              to={diagSummary ? `/tutor?assignmentId=${diagSummary.assignmentId ?? ""}` : "/tutor"}
            >
              进入复盘 →
            </Link>
          </span>
        </div>
      ) : null}
    </div>
  );
}
