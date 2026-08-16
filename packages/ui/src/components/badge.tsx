/** 徽章（原型 .badge 语义色系：通过/失败/警告/信息/描边） */
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex h-[21px] items-center gap-[5px] rounded-[2px] px-2 text-[11.5px] font-medium leading-none tracking-[0.04em] whitespace-nowrap",
  {
    variants: {
      tone: {
        pass: "bg-pass text-white",
        fail: "bg-fail text-white",
        warn: "bg-warn text-[#231803]",
        mut: "bg-ink/8 text-ink/72",
        info: "bg-accent-tint text-accent",
        outline: "border border-line-mid bg-transparent text-fg-muted",
      },
    },
    defaultVariants: { tone: "mut" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** 事件类型 → 徽章语义（submission_events 颜色口径，与原型 EVT 映射一致） */
export const EVT_BADGE: Record<string, { label: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  edit: { label: "编辑", tone: "mut" },
  compile: { label: "编译错误", tone: "fail" },
  run: { label: "运行错误", tone: "fail" },
  partial: { label: "部分通过", tone: "warn" },
  pass: { label: "通过", tone: "pass" },
  drop: { label: "放弃", tone: "outline" },
};

export function EventBadge({ type }: { type: string }) {
  const e = EVT_BADGE[type] ?? { label: type, tone: "mut" as const };
  return <Badge tone={e.tone}>{e.label}</Badge>;
}
