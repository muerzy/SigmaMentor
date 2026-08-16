import {
  Badge,
  Button,
  Card,
  EventBadge,
  PageHead,
  Sheet,
  SheetContent,
  Stat,
  unwrap,
  useAuth,
} from "@sigma/ui";
/**
 * 诊断画像页（F2 · A1 规则版+LLM 增强）：
 * 4 统计卡 ｜ 错误演化时间线 ｜ 知识点缺陷条 ｜ 诊断结论 + 证据链抽屉。
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { api } from "../main";

interface DiagnosisData {
  assignment: { id: string; code: string; title: string };
  diagnosis: {
    stuckPoints: { kpKey: string; kpName: string; confidence: number }[];
    conclusion: string;
    evolution: {
      time: number;
      type: string;
      title: string;
      detail: string;
      submissionSeq?: number;
    }[];
    evidence: { submissionSeq: number; submissionId: string; eventType: string; note: string }[];
    stuckMinutes: number;
    sameErrorCount: number;
    engine: string;
    createdAt: number;
  } | null;
  message?: string;
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

const EVO_TYPE_CLASS: Record<string, string> = {
  compile: "e-compile",
  run: "e-run",
  partial: "e-partial",
  pass: "e-pass",
  drop: "e-drop",
  edit: "e-edit",
  stuck: "e-stuck",
};

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DiagnosisPage() {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const list = useQuery({
    queryKey: ["assignments"],
    queryFn: async () => unwrap(await api.assignments.get()),
  });
  // 无参数时取最新（提交过的）作业
  const assignmentId =
    params.get("assignmentId") ?? (list.data as { id: string }[] | undefined)?.at(-1)?.id;

  const q = useQuery({
    queryKey: ["diagnosis", assignmentId],
    enabled: !!assignmentId,
    queryFn: async () =>
      unwrap(await api.diagnosis({ assignmentId: assignmentId! }).get()) as DiagnosisData,
  });

  const [evidenceSeq, setEvidenceSeq] = useState<number | null>(null);
  const evidence = useQuery({
    queryKey: ["evidence", assignmentId, evidenceSeq],
    enabled: evidenceSeq !== null && !!assignmentId,
    queryFn: async () =>
      unwrap(
        await api
          .diagnosis({ assignmentId: assignmentId! })
          .evidence({ seq: String(evidenceSeq) })
          .get(),
      ) as EvidenceData,
  });

  // 缺陷条入场动画（宽度 0 → 目标值）
  const [meterOn, setMeterOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMeterOn(true), 120);
    return () => clearTimeout(t);
  }, [q.data]);

  const d = q.data?.diagnosis;
  const top = d?.stuckPoints[0];

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker="F2 · 卡点诊断反馈 / Diagnosis"
        title="我的诊断画像"
        meta={
          <>
            <span>
              {me?.user.displayName} · {me?.student?.studentNo}
            </span>
            <span>规则引擎{d?.engine === "llm" ? " + LLM 增强" : ""}</span>
            {d && <span>更新于 {fmtTime(d.createdAt)}</span>}
          </>
        }
        actions={
          assignmentId ? (
            <>
              <Link to={`/assignment/${assignmentId}`} className="btn btn-ghost btn-sm">
                返回作业
              </Link>
              <Link to={`/tutor?assignmentId=${assignmentId}`} className="btn btn-ghost btn-sm">
                进入导师对话
              </Link>
            </>
          ) : undefined
        }
      />
      <div className="page-body">
        {!assignmentId || !d ? (
          <div className="note">
            {q.isLoading ? "加载中…" : (q.data?.message ?? "暂无诊断——提交一次代码后生成")}
          </div>
        ) : (
          <>
            <div className="stats-row-4">
              <Stat
                k="当前卡点知识点"
                zh
                n={top?.kpName ?? "无未解卡点"}
                desc={`同型错误 ${d.sameErrorCount} 次`}
              />
              <Stat k="本会话卡点时长" n={d.stuckMinutes} unit="分钟" desc="从首次失败到最近活动" />
              <Stat
                k="知识缺陷项"
                n={d.stuckPoints.length}
                unit="项"
                desc="置信度 ≥0.60 标红并触发干预"
              />
              <Stat
                k="关联提交证据"
                n={d.evidence.length}
                unit="条"
                desc="全部可点击回溯（红线 ⑤）"
              />
            </div>

            <div className="diag-grid">
              <div className="stack">
                <Card title="错误演化路径" kicker="Error Evolution">
                  <div className="tl">
                    {d.evolution.map((e, i) => (
                      <div key={i} className={`tl-item ${EVO_TYPE_CLASS[e.type] ?? "e-edit"}`}>
                        <span className="tl-time">
                          {e.type === "stuck" ? "当前" : fmtTime(e.time)}
                        </span>
                        <div className="tl-body">
                          <div className="tl-t">
                            {e.title}
                            {e.submissionSeq ? (
                              <span className="ev-l">
                                [
                                <a
                                  href="javascript:void 0"
                                  onClick={() => setEvidenceSeq(e.submissionSeq!)}
                                >
                                  查看证据 #{e.submissionSeq}
                                </a>
                                ]
                              </span>
                            ) : null}
                            {e.type === "stuck" && (
                              <Link
                                className="link ml-1.5"
                                to={`/tutor?assignmentId=${assignmentId}`}
                              >
                                去对话 →
                              </Link>
                            )}
                          </div>
                          <div className="tl-d">{e.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="知识点缺陷" kicker="置信度 · 规则引擎" bodyClassName="pt-2.5">
                  {d.stuckPoints.map((p, i) => (
                    <div
                      key={p.kpKey}
                      className={`meter ${i === 0 && p.confidence >= 0.6 ? "hot" : ""}`}
                    >
                      <span className="m-k">{p.kpName}</span>
                      <span className="m-bar">
                        <i
                          style={{
                            width: meterOn ? `${Math.round(p.confidence * 100)}%` : "0%",
                            transition: "width .8s cubic-bezier(.77,0,.175,1)",
                          }}
                        />
                      </span>
                      <span className="m-v">{p.confidence.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="note note-b">
                    数值由轨迹统计 + 错误聚类得出（规则版）；≥ 0.60 标红并触发导师干预。
                  </div>
                </Card>
              </div>

              <div className="stack">
                <Card
                  title="诊断结论"
                  kicker={`D-${new Date(d.createdAt).toISOString().slice(5, 10).replace("-", "")}`}
                >
                  <div className="concl">
                    {d.conclusion}
                    <span className="cite">
                      证据 {d.evidence.map((e) => `#${e.submissionSeq}`).join(" · ") || "—"} ｜
                      维果茨基 ZPD：反馈发生在卡住的那一刻
                    </span>
                  </div>
                  <div className="mt-3.5">
                    <Link
                      to={`/tutor?assignmentId=${assignmentId}`}
                      className="btn btn-ghost btn-sm"
                    >
                      接受 L1 提示 · 进对话
                    </Link>
                  </div>
                </Card>

                <Card title="关联提交证据" kicker="Evidence Chain" bodyClassName="pt-1.5">
                  {d.evidence.map((e) => (
                    <div key={e.submissionId} className="rel-item">
                      <span className="r-no">#{e.submissionSeq}</span>
                      <span className="r-t">
                        <b className="text-ink">
                          {e.eventType === "compile"
                            ? "编译错误"
                            : e.eventType === "partial"
                              ? "部分通过"
                              : "运行错误"}
                        </b>
                        {" · "}
                        {top?.kpName ?? ""}
                        <span className="r-d">{e.note}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEvidenceSeq(e.submissionSeq)}
                      >
                        证据
                      </Button>
                    </div>
                  ))}
                  {d.evidence.length === 0 && <div className="note">暂无失败提交。</div>}
                  <div className="note note-b">
                    每条诊断结论均引用具体提交记录与轨迹证据，非黑箱打分（产品红线 ⑤）。
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet open={evidenceSeq !== null} onOpenChange={(o) => !o && setEvidenceSeq(null)}>
        <SheetContent title={`提交 #${evidenceSeq} · 过程证据`}>
          {evidence.data ? (
            <div>
              <div className="mb-2.5 flex items-center gap-2">
                <Badge
                  tone={
                    evidence.data.status === "pass"
                      ? "pass"
                      : evidence.data.status === "partial"
                        ? "warn"
                        : "fail"
                  }
                >
                  {evidence.data.status === "pass"
                    ? "通过"
                    : evidence.data.status === "partial"
                      ? "部分通过"
                      : "失败"}
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
            </div>
          ) : (
            <div className="note">加载中…</div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
