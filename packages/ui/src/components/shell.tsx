/**
 * 应用壳：顶部导航（学生端墨黑 / 教师端中性灰，全站无侧栏——brand-spec 双端主题）。
 * body 主题类由各应用入口挂载（theme-dark / theme-gray），此处只渲染结构。
 */
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

import { useAuth } from "../auth/auth-context";
import { cn } from "../lib/cn";

export interface NavItem {
  to: string;
  ni: string;
  label: string;
}

export function Shell({
  roleTag,
  items,
  userMeta,
  children,
}: {
  roleTag: string;
  items: NavItem[];
  userMeta?: string;
  children: ReactNode;
}) {
  const { me, logout } = useAuth();
  return (
    <div className="app block min-h-screen">
      <header className="topnav sticky top-0 z-30 flex h-[var(--nav-h)] items-center gap-[18px] px-7">
        <Link to="/" className="brand flex items-baseline gap-[9px] whitespace-nowrap">
          <span className="sig font-[var(--serif-en)] text-[18px] font-extrabold tracking-[-0.02em]">
            SigmaMentor
          </span>
          <span className="sub text-[12px] font-medium tracking-[0.08em]">2σ 导师</span>
        </Link>
        <span className="role-tag font-[var(--mono)] text-[10px] tracking-[0.2em] uppercase">
          {roleTag}
        </span>
        <nav aria-label={`${roleTag}导航`} className="ml-1.5 flex gap-0.5 overflow-x-auto">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) => cn("nav-a", isActive && "active")}
              aria-current="page"
            >
              <span className="ni">{it.ni}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <span className="nav-right ml-auto flex items-center gap-4 whitespace-nowrap">
          <span className="u-meta font-[var(--mono)] text-[10.5px] tracking-[0.08em]">
            {me?.user.displayName}
            {userMeta ? ` · ${userMeta}` : ""}
          </span>
          <button
            type="button"
            className="back font-[var(--mono)] text-[10.5px] tracking-[0.14em] uppercase"
            onClick={() => logout.mutate()}
          >
            退出登录
          </button>
        </span>
      </header>
      {children}
    </div>
  );
}

/** 页眉（原型 .page-head：kicker / 衬线大标题 / mono 元信息 / 右侧动作） */
export function PageHead({
  kicker,
  title,
  meta,
  actions,
}: {
  kicker: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head sticky top-[var(--nav-h)] z-6 flex flex-wrap items-end justify-between gap-[18px] border-b border-line bg-paper px-9 pt-[26px] pb-[18px]">
      <div className="min-w-0">
        <div className="kicker font-[var(--mono)] text-[10.5px] tracking-[0.26em] text-fg-muted uppercase">
          {kicker}
        </div>
        <h1 className="h-page mt-1.5 font-[var(--serif-zh)] text-[27px] leading-1.28 font-bold tracking-[0.005em]">
          {title}
        </h1>
        {meta && (
          <div className="page-meta mt-2 flex flex-wrap gap-[1.2em] font-[var(--mono)] text-[11px] tracking-[0.1em] text-fg-muted">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="head-actions flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** 卡片（原型 .card：surface 面 + 发丝线 + 近直角） */
export function Card({
  title,
  kicker,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  kicker?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("card rounded-[3px] border border-line bg-surface", className)}>
      {(title || kicker) && (
        <div className="card-h flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-[18px] py-[13px]">
          <span className="card-t font-[var(--serif-zh)] text-base font-semibold">{title}</span>
          {kicker && (
            <span className="card-k font-[var(--mono)] text-[10px] tracking-[0.22em] text-fg-faint uppercase">
              {kicker}
            </span>
          )}
        </div>
      )}
      <div className={cn("card-b p-[18px]", bodyClassName)}>{children}</div>
    </section>
  );
}

/** 统计卡（deck .stat 血统：上边强线 + mono 标签 + 衬线大数字） */
export function Stat({
  k,
  n,
  unit,
  desc,
  zh,
}: {
  k: string;
  n: ReactNode;
  unit?: string;
  desc?: ReactNode;
  zh?: boolean;
}) {
  return (
    <div className="stat flex min-w-0 flex-col gap-[5px] border-t border-line-strong pt-3">
      <div className="stat-k font-[var(--mono)] text-[10px] tracking-[0.22em] text-fg-faint uppercase">
        {k}
      </div>
      {zh ? (
        <div className="stat-n zh font-[var(--serif-zh)] text-[23px] leading-1.3 font-bold">
          {n}
        </div>
      ) : (
        <div className="stat-n font-[var(--serif-en)] text-[38px] leading-[0.98] font-extrabold tracking-[-0.02em] [font-feature-settings:'tnum']">
          {n}
          {unit && (
            <span className="u font-[var(--serif-zh)] text-[0.42em] font-medium tracking-0 opacity-72">
              {unit}
            </span>
          )}
        </div>
      )}
      {desc && <div className="stat-d text-[12.5px] leading-1.55 text-fg-muted">{desc}</div>}
    </div>
  );
}
