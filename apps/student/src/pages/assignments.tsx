import { unwrap } from "@sigma/ui";
import { Badge, PageHead } from "@sigma/ui";
/** 作业中心列表（F1 入口）：按教学周分组 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../main";

interface AssignmentRow {
  id: string;
  code: string;
  title: string;
  weekNo: number;
  knowledgePoints: string[];
  language: string;
  submitCount: number;
  latestStatus: string | null;
  latestScore: number | null;
}

const STATUS_BADGE: Record<string, { label: string; tone: "pass" | "warn" | "fail" | "mut" }> = {
  pass: { label: "通过", tone: "pass" },
  partial: { label: "部分通过", tone: "warn" },
  run_error: { label: "运行错误", tone: "fail" },
  compile_error: { label: "编译错误", tone: "fail" },
  timeout: { label: "超时", tone: "fail" },
};

export function AssignmentsPage() {
  const q = useQuery({
    queryKey: ["assignments"],
    queryFn: async () => unwrap(await api.assignments.get()) as AssignmentRow[],
  });

  if (q.isLoading) return <div className="page-body note">加载中…</div>;
  if (q.error) return <div className="page-body note">加载失败：{q.error.message}</div>;
  const rows = (q.data ?? []).toSorted(
    (a, b) => a.weekNo - b.weekNo || a.code.localeCompare(b.code),
  );
  const weeks = [...new Set(rows.map((r) => r.weekNo))];

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker="F1 · 作业提交与沙箱判题 / Submit & Judge"
        title="作业中心"
        meta={
          <>
            <span>提交 → 沙箱判题 → 过程事件入库</span>
            <span>共 {rows.length} 题</span>
          </>
        }
      />
      <div className="page-body flex flex-col gap-6">
        {weeks.map((w) => (
          <section key={w}>
            <div className="kicker mb-3 font-[var(--mono)] text-[10.5px] tracking-[0.26em] text-fg-muted uppercase">
              第 {w} 教学周
            </div>
            <div className="stack">
              {rows
                .filter((r) => r.weekNo === w)
                .map((a) => {
                  const badge = a.latestStatus ? STATUS_BADGE[a.latestStatus] : null;
                  return (
                    <Link
                      key={a.id}
                      to={`/assignment/${a.id}`}
                      className="card card-hover block rounded-[3px] border border-line bg-surface p-[18px] no-underline transition-colors hover:border-line-strong"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="flex items-baseline gap-3">
                          <span className="font-[var(--serif-en)] text-[15px] italic text-fg-faint">
                            {a.code}
                          </span>
                          <span className="card-t font-[var(--serif-zh)] text-base font-semibold text-ink">
                            {a.title}
                          </span>
                        </div>
                        {badge ? (
                          <Badge tone={badge.tone}>
                            {badge.label}
                            {a.latestStatus === "pass" ? ` · ${a.latestScore} 分` : ""}
                          </Badge>
                        ) : (
                          <Badge tone="outline">未提交</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.knowledgePoints.map((k) => (
                          <span key={k} className="chip h-[22px] text-[11.5px]">
                            {k}
                          </span>
                        ))}
                      </div>
                      <div className="note mt-2.5">
                        已提交 {a.submitCount} 次 · {a.language.toUpperCase()} · 点击进入工作台
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        ))}
        {rows.length === 0 && <div className="note">本班暂无作业。</div>}
      </div>
    </main>
  );
}
