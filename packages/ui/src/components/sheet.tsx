/**
 * 证据抽屉（shadcn Sheet × 原型 .drawer 视觉契约）：
 * 右侧滑出 min(600px,94vw)、遮罩、ESC 关闭、焦点管理——Radix Dialog 驱动。
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  title,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgba(10,10,11,.42)] data-[state=open]:animate-[fadeIn_.25s_ease]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-[61] flex w-[min(600px,94vw)] flex-col border-l border-line-strong bg-paper shadow-[-18px_0_60px_rgba(10,10,11,.18)]",
          "data-[state=open]:animate-[sheetIn_.32s_cubic-bezier(.77,0,.175,1)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-[22px] py-[18px]">
          <DialogPrimitive.Title className="font-[var(--serif-zh)] text-[18px] font-bold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded-[2px] border border-line-mid px-3 py-1.5 font-[var(--mono)] text-[11px] tracking-[0.18em] text-fg-muted uppercase transition-[border-color,color] hover:border-ink hover:text-ink">
            ESC 关闭
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-auto px-[22px] pb-10 pt-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
