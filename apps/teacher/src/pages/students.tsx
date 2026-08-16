import { Badge, Checkbox, PageHead, unwrap, useToast } from "@sigma/ui";
/**
 * 高危名单页（F7）：规则过滤 ｜ 展开式证据卡（提交轨迹 + 同型序列 + 干预建议）｜
 * 红线横幅（只呈现不定罪）｜ 跟进状态（本地演示）。
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { api } from "../main";

interface RiskItem {
  studentId: string;
  name: string;
  studentNo: string;
  rules: ("continuous" | "drop" | "anomaly")[];
  summary: string;
  track: { t: string; type: string; label: string }[];
  sameList: string[];
  detail: string;
  advice: string[];
}

interface RiskData {
  classId: string;
  count: number;
  items: RiskItem[];
}

const RULE_BADGE: Record<string, { label: string; tone: "fail" | "warn" | "info" }> = {
  continuous: { label: "连续卡点", tone: "fail" },
  drop: { label: "多次放弃", tone: "warn" },
  anomaly: { label: "轨迹异常", tone: "info" },
};

export function StudentsPage() {
  const { toast } = useToast();
  const classes = useQuery({
    queryKey: ["classes"],
    queryFn: async () => unwrap(await api.classes.get()) as { id: string; studentCount: number }[],
  });
  const classId = classes.data?.[0]?.id;

  const q = useQuery({
    queryKey: ["risk", classId],
    enabled: !!classId,
    queryFn: async () => unwrap(await api.classes({ id: classId! }).risk.get()) as RiskData,
  });

  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const items = (q.data?.items ?? []).filter((r) => filter === "all" || r.rules.includes(filter));
  const counts = {
    all: q.data?.items.length ?? 0,
    continuous: (q.data?.items ?? []).filter((r) => r.rules.includes("continuous")).length,
    drop: (q.data?.items ?? []).filter((r) => r.rules.includes("drop")).length,
    anomaly: (q.data?.items ?? []).filter((r) => r.rules.includes("anomaly")).length,
  };

  const total = classes.data?.[0]?.studentCount ?? "—";

  return (
    <main className="main flex min-w-0 flex-col">
      <PageHead
        kicker="F7 · 高危名单 / At-Risk Students"
        title={
          <>
            高危名单 · <span>{items.length}</span> / {total} 人
          </>
        }
        meta={
          <>
            <span>规则 · 连续同型卡点 ≥ 3</span>
            <span>放弃 ≥ 2</span>
            <span>提交轨迹异常</span>
          </>
        }
        actions={
          <Link to="/dashboard" className="btn btn-ghost btn-sm">
            返回看板
          </Link>
        }
      />
      <div className="page-body">
        <div className="filters">
          {[
            { k: "all", label: `全部 · ${counts.all}` },
            { k: "continuous", label: `连续卡点 · ${counts.continuous}` },
            { k: "drop", label: `多次放弃 · ${counts.drop}` },
            { k: "anomaly", label: `轨迹异常 · ${counts.anomaly}` },
          ].map((f) => (
            <button
              key={f.k}
              type="button"
              className={`chip ${filter === f.k ? "on" : ""}`}
              onClick={() => setFilter(f.k)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {q.isLoading ? (
          <div className="note">加载中…</div>
        ) : q.error ? (
          <div className="note">加载失败：{q.error.message}</div>
        ) : (
          <div className="risk-list">
            {items.map((r, i) => (
              <RiskCard
                key={r.studentId}
                item={r}
                index={i}
                open={openId === null ? i === 0 : openId === r.studentId}
                onToggle={() => setOpenId(openId === r.studentId ? null : r.studentId)}
                onAdvice={(a) =>
                  toast({
                    kicker: "Intervention Queue · 干预待办",
                    title: `已加入待办：${a}`,
                    body: `对象：${r.name}（${r.studentNo}）· 执行前需教师确认（红线 ③）。`,
                    duration: 5000,
                  })
                }
              />
            ))}
            {items.length === 0 && <div className="note">当前过滤条件下没有学生。</div>}
          </div>
        )}

        <div className="banner risk-banner">
          <span className="tag">红线</span>
          <span>
            名单与证据仅教师可见，
            <span style={{ textDecoration: "underline", textUnderlineOffset: "5px" }}>
              不通知学生、不自动定罪
            </span>
            · 学生可申诉 · 教师可随时接管任何对话
          </span>
        </div>
      </div>
    </main>
  );
}

function RiskCard({
  item,
  index,
  open,
  onToggle,
  onAdvice,
}: {
  item: RiskItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  onAdvice: (a: string) => void;
}) {
  const [followed, setFollowed] = useState(() => {
    try {
      return localStorage.getItem(`sm-follow-${item.studentId}`) === "1";
    } catch {
      return false;
    }
  });

  const toggleFollow = (v: boolean) => {
    setFollowed(v);
    try {
      localStorage.setItem(`sm-follow-${item.studentId}`, v ? "1" : "0");
    } catch {}
  };

  return (
    <div className={`risk-item ${open ? "open" : ""} ${followed ? "followed" : ""}`}>
      <button
        type="button"
        className="risk-head"
        aria-expanded={open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".follow-chk")) return;
          onToggle();
        }}
      >
        <span className="r-no">{String(index + 1).padStart(2, "0")}</span>
        <span className="r-who">
          <b>{item.name}</b>
          <span>{item.studentNo}</span>
        </span>
        <span className="r-sum">{item.summary}</span>
        <span className="r-badges">
          {item.rules.map((k) => (
            <Badge key={k} tone={RULE_BADGE[k]?.tone ?? "mut"}>
              {RULE_BADGE[k]?.label ?? k}
            </Badge>
          ))}
          {followed && <Badge tone="outline">✓ 已跟进</Badge>}
          <span className="chev">{open ? "收起 ∧" : "展开 ∨"}</span>
        </span>
      </button>

      <div className="risk-body">
        <div className="ev-grid">
          <div>
            <div className="ev-k">提交轨迹 · submission_events</div>
            <div className="track">
              {item.track.map((t, i) => (
                <span key={i} className={`tnode e-${t.type}`}>
                  <b>{t.label}</b>
                  {t.t}
                </span>
              ))}
            </div>
            <div className="ev-detail">{item.detail}</div>
          </div>
          <div>
            <div className="ev-k">同型 / 异常序列</div>
            <div className="same-chips">
              {item.sameList.map((s, i) => (
                <div key={i} className="sc">
                  {s}
                </div>
              ))}
            </div>
            <div className="ev-k mt-4">建议干预（辅助决策 · 教师确认后执行）</div>
            <div className="advice">
              {item.advice.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onAdvice(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="follow-row">
          <label className="follow-chk" htmlFor={`follow-${item.studentId}`}>
            <Checkbox
              id={`follow-${item.studentId}`}
              checked={followed}
              onCheckedChange={(v) => toggleFollow(v === true)}
            />
            已跟进（本周内联系 / 处理）
          </label>
          <span className="note">勾选状态保存在本地 · 仅为演示</span>
        </div>
      </div>
    </div>
  );
}
