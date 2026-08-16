import { Card, PageHead, Stat, unwrap } from "@sigma/ui";
/**
 * 班级学情看板（F6 · A4）：周页签 ｜ 5 统计卡 ｜ 热力图（人数/时长双维度 + 悬停提示 +
 * 点格学生明细）｜ TOP 卡点 ｜ 对账说明。数据源 analytics_snapshots（对账测试覆盖）。
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { api } from "../main";

interface WeekCell {
  n: number;
  m: number;
}
interface AnalyticsData {
  classId: string;
  weeks: {
    weekNo: number;
    stats: {
      submits: number;
      stuckCount: number;
      stuckMedianMin: number;
      riskCount: number;
      passRate: number;
    };
    kps: { key: string; name: string; weeks: (WeekCell | null)[] }[];
    topKps: { key: string; name: string; n: number; m: number; delta: number | null }[];
  }[];
  kpStudents: Record<
    string,
    { name: string; studentNo: string; minutes: number; sameErrorCount: number }[]
  >;
}
interface ClassInfo {
  id: string;
  name: string;
  semester: string;
  studentCount: number;
}

type Dim = "n" | "m";

function bucket(v: WeekCell, max: number, dim: Dim): string {
  if (!v) return "empty";
  const t = v[dim] / max;
  if (t <= 0.15) return "h0";
  if (t <= 0.35) return "h1";
  if (t <= 0.6) return "h2";
  if (t <= 0.85) return "h3";
  return "h4";
}

export function DashboardPage() {
  const classes = useQuery({
    queryKey: ["classes"],
    queryFn: async () => unwrap(await api.classes.get()) as ClassInfo[],
  });
  const classId = classes.data?.[0]?.id;

  const q = useQuery({
    queryKey: ["analytics", classId],
    enabled: !!classId,
    queryFn: async () =>
      unwrap(await api.classes({ id: classId! }).analytics.get()) as AnalyticsData,
  });

  const [week, setWeek] = useState<number | null>(null);
  const [dim, setDim] = useState<Dim>("n");
  const [detailKp, setDetailKp] = useState<{ key: string; weekNo: number } | null>(null);
  const [tip, setTip] = useState<{
    name: string;
    week: number;
    cell: WeekCell;
    left: string;
    top: string;
  } | null>(null);

  useEffect(() => {
    if (week === null && q.data) {
      const saved = Number(localStorage.getItem("sm-dash-week") ?? "0");
      const weeks = q.data.weeks;
      setWeek(saved >= 1 && saved <= weeks.length ? saved : weeks.length);
    }
  }, [q.data, week]);

  const weeks = q.data?.weeks ?? [];
  const current = weeks.find((w) => w.weekNo === week) ?? weeks.at(-1);

  // 着色基准 = 全矩阵在当前维度下的最大值（原型口径）；依赖 q.data 而非每渲染新建的 weeks 数组
  const max = useMemo(() => {
    let m = 0;
    for (const w of q.data?.weeks ?? [])
      for (const kp of w.kps)
        for (const c of kp.weeks) if (c) m = Math.max(m, dim === "n" ? c.n : c.m);
    return m || 1;
  }, [q.data, dim]);

  const cls = classes.data?.[0];

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker="F6 · 班级学情看板 / Class Analytics"
        title={cls ? `${cls.name} · ${cls.semester}` : "班级学情看板"}
        meta={
          <>
            <span>{cls ? `${cls.studentCount} 名学生` : "—"}</span>
            <span>数据源 analytics_snapshots</span>
          </>
        }
        actions={
          <Link to="/students" className="btn btn-ghost btn-sm">
            高危名单 →
          </Link>
        }
      />
      <div className="page-body">
        {q.isLoading || !q.data || !current ? (
          <div className="note">{q.error ? `加载失败：${q.error.message}` : "加载中…"}</div>
        ) : (
          <>
            {/* 周页签 */}
            <div className="tabs mb-[18px] flex gap-0.5 border-b border-line">
              {weeks.map((w) => (
                <button
                  key={w.weekNo}
                  type="button"
                  className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] transition-colors ${
                    w.weekNo === week
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-fg-muted hover:text-ink"
                  }`}
                  onClick={() => {
                    setWeek(w.weekNo);
                    setDetailKp(null);
                    localStorage.setItem("sm-dash-week", String(w.weekNo));
                  }}
                >
                  第 {w.weekNo} 周{w.weekNo === weeks.length ? " · 本周" : ""}
                </button>
              ))}
            </div>

            {/* 统计 */}
            <div className="stats-row-5">
              <Stat k="本周提交" n={current.stats.submits} desc="submission_events 聚合" />
              <Stat
                k="卡点人次"
                n={current.stats.stuckCount}
                unit="人次"
                desc="一人可命中多个知识点"
              />
              <Stat
                k="卡点中位时长"
                n={current.stats.stuckMedianMin}
                unit="分钟"
                desc="从首次失败到通过/放弃"
              />
              <Stat
                k="高危学生"
                n={current.stats.riskCount}
                unit="人"
                desc={
                  <Link to="/students" className="link">
                    查看名单与证据链 →
                  </Link>
                }
              />
              <Stat
                k="提交通过率"
                n={`${current.stats.passRate}`}
                unit="%"
                desc="通过提交 / 全部提交"
              />
            </div>

            <div className="dash-grid">
              <div className="flex flex-col gap-4">
                {/* 热力图 */}
                <Card bodyClassName="p-0">
                  <div className="card-h flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-[18px] py-[13px]">
                    <span className="card-t font-[var(--serif-zh)] text-base font-semibold">
                      班级卡点热力图
                    </span>
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        className={`chip ${dim === "n" ? "on" : ""}`}
                        onClick={() => setDim("n")}
                      >
                        卡点人数
                      </button>
                      <button
                        type="button"
                        className={`chip ${dim === "m" ? "on" : ""}`}
                        onClick={() => setDim("m")}
                      >
                        中位卡点时长
                      </button>
                    </span>
                  </div>
                  <div className="p-[18px]">
                    <div className="heat-wrap">
                      <div
                        className="heat-tbl"
                        style={{
                          gridTemplateColumns: `132px repeat(${weeks.length}, minmax(0,1fr))`,
                        }}
                      >
                        <div className="heat-head" />
                        {weeks.map((w) => (
                          <div key={w.weekNo} className="heat-head">
                            第 {w.weekNo} 周
                          </div>
                        ))}
                        {current.kps.map((kp) => (
                          <HeatRow
                            key={kp.key}
                            name={kp.name}
                            cells={kp.weeks}
                            weeks={weeks.length}
                            max={max}
                            dim={dim}
                            onHover={setTip}
                            onSelect={(w) =>
                              setDetailKp(
                                kp.key === detailKp?.key && w === detailKp?.weekNo
                                  ? null
                                  : { key: kp.key, weekNo: w },
                              )
                            }
                          />
                        ))}
                      </div>
                      <div
                        className="heat-tip"
                        style={{ opacity: tip ? 1 : 0, left: tip?.left, top: tip?.top }}
                      >
                        {tip && (
                          <>
                            <b>{tip.name}</b> · 第{tip.week}周
                            <br />
                            <span className="mono">
                              卡点 {tip.cell.n} 人 · 中位 {tip.cell.m} 分钟
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="heat-foot">
                      <div className="heat-legend">
                        <span>卡点强度</span>
                        <i style={{ background: "rgba(10,10,11,.05)" }} />
                        <i style={{ background: "rgba(10,10,11,.16)" }} />
                        <i style={{ background: "rgba(10,10,11,.34)" }} />
                        <i style={{ background: "rgba(10,10,11,.6)" }} />
                        <i style={{ background: "rgba(10,10,11,.88)" }} />
                        <span>少 → 多</span>
                      </div>
                      <span className="note">悬停查看数值 · 点击单元格展开该知识点学生明细</span>
                    </div>
                  </div>
                </Card>

                {/* 单元格明细 */}
                {detailKp && (
                  <KpDetail
                    kpKey={detailKp.key}
                    weekNo={detailKp.weekNo}
                    isCurrent={detailKp.weekNo === weeks.length}
                    data={q.data}
                  />
                )}
              </div>

              <div className="flex flex-col gap-4">
                {/* TOP 卡点 */}
                <Card
                  title="TOP 卡点知识点"
                  kicker={`第 ${current.weekNo} 周`}
                  bodyClassName="pt-1.5"
                >
                  {current.topKps.map((t, i) => (
                    <div key={t.key} className="rank">
                      <span className="r-no">0{i + 1}</span>
                      <span>
                        <span className="r-t">{t.name}</span>
                        <div className="r-d">
                          {t.n} 人卡点 · 中位 {t.m} 分钟
                        </div>
                      </span>
                      {t.delta === null ? (
                        <span className="delta flat">— 首周无对比</span>
                      ) : t.delta > 0 ? (
                        <span className="delta up">▲ +{t.delta} 人</span>
                      ) : t.delta < 0 ? (
                        <span className="delta down">▼ {t.delta} 人</span>
                      ) : (
                        <span className="delta flat">= 持平</span>
                      )}
                    </div>
                  ))}
                </Card>

                <Card title="下一步" kicker="Action">
                  <div className="note text-[13px]">
                    本周卡点前三已同步至针对性练习生成队列（F9 · P1 路线，教师确认后发布）。
                    {current.topKps[0] && (
                      <>
                        「{current.topKps[0].name}」
                        {current.topKps[0].delta !== null && current.topKps[0].delta >= 0
                          ? "较上周仍在上升，"
                          : ""}
                        建议下次实验课头 10 分钟集中讲评。
                      </>
                    )}
                  </div>
                  <div className="recon">
                    看板数据与底表 SQL 直查一致（对账测试通过）· 快照物化于 analytics_snapshots · 50
                    人班级一学周数据加载 &lt; 2s（验收线）。
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function HeatRow({
  name,
  cells,
  weeks,
  max,
  dim,
  onHover,
  onSelect,
}: {
  name: string;
  cells: (WeekCell | null)[];
  weeks: number;
  max: number;
  dim: Dim;
  onHover: (
    t: { name: string; week: number; cell: WeekCell; left: string; top: string } | null,
  ) => void;
  onSelect: (weekNo: number) => void;
}) {
  return (
    <>
      <div className="heat-rowlab">{name}</div>
      {Array.from({ length: weeks }, (_, w) => {
        const cell = cells[w] ?? null;
        if (!cell)
          return (
            <div key={w} className="heat-cell empty">
              —
            </div>
          );
        const val = dim === "n" ? cell.n : cell.m;
        return (
          <button
            key={w}
            type="button"
            className={`heat-cell ${bucket(cell, max, dim)}`}
            aria-label={`${name} 第${w + 1}周 · 卡点 ${cell.n} 人 · 中位 ${cell.m} 分钟`}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const wrap = e.currentTarget.closest(".heat-wrap")!.getBoundingClientRect();
              onHover({
                name,
                week: w + 1,
                cell,
                left: `${r.left - wrap.left + r.width / 2}px`,
                top: `${r.top - wrap.top - 6}px`,
              });
            }}
            onMouseLeave={() => onHover(null)}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const wrap = e.currentTarget.closest(".heat-wrap")!.getBoundingClientRect();
              onHover({
                name,
                week: w + 1,
                cell,
                left: `${r.left - wrap.left + r.width / 2}px`,
                top: `${r.top - wrap.top - 6}px`,
              });
            }}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(w + 1)}
          >
            {val}
          </button>
        );
      })}
    </>
  );
}

function KpDetail({
  kpKey,
  data,
  weekNo,
  isCurrent,
}: {
  kpKey: string;
  data: AnalyticsData;
  weekNo: number;
  isCurrent: boolean;
}) {
  const kp = data.weeks.find((w) => w.weekNo === weekNo)?.kps.find((k) => k.key === kpKey);
  const cell = kp?.weeks[weekNo - 1] ?? null;
  const students = data.kpStudents[kpKey] ?? [];
  const maxM = Math.max(1, ...students.map((s) => s.minutes));

  return (
    <Card
      title={`${kp?.name ?? kpKey} · 第 ${weekNo} 周`}
      kicker={cell ? `卡点 ${cell.n} 人 · 中位 ${cell.m} 分钟` : "—"}
      bodyClassName="pt-2"
    >
      {isCurrent ? (
        <>
          <div className="note mb-2">按卡点时长降序 · 来自该知识点最新诊断</div>
          {students.map((s) => (
            <div key={s.studentNo} className="stu-row">
              <span className="n">{s.name}</span>
              <span className="bar">
                <i style={{ width: `${Math.round((s.minutes / maxM) * 100)}%` }} />
              </span>
              <span className="m">
                {s.minutes} 分 · 同型 {s.sameErrorCount} 次
              </span>
            </div>
          ))}
          {students.length === 0 && <div className="note">该知识点暂无卡点学生。</div>}
        </>
      ) : (
        <div className="note">
          本演示仅本周提供学生级明细；第 1 / 2 周为聚合格（知识点 × 人数 × 时长）。当前格：
          {cell?.n ?? 0} 人卡点 · 中位 {cell?.m ?? 0} 分钟。
        </div>
      )}
    </Card>
  );
}
