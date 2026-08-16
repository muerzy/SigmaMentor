/**
 * Toast（原型 .toast · 主动干预等场景）：右下角、ink 底 paper 字、可带动作。
 * 用法：const { toast } = useToast(); toast({ kicker, title, body, actions })
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../lib/cn";

export interface ToastAction {
  label: string;
  href: string;
  solid?: boolean;
}

export interface ToastOptions {
  kicker?: string;
  title: string;
  body?: string;
  actions?: ToastAction[];
  /** 0 = 不自动关闭（需用户操作） */
  duration?: number;
}

interface ToastContextValue {
  toast: (opt: ToastOptions) => void;
  close: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastOptions | null>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setOn(false), []);

  const toast = useCallback((opt: ToastOptions) => {
    setCurrent(opt);
    requestAnimationFrame(() => setOn(true));
    if (timer.current) clearTimeout(timer.current);
    if (opt.duration !== 0) {
      timer.current = setTimeout(() => setOn(false), opt.duration ?? 9000);
    }
  }, []);

  const value = useMemo(() => ({ toast, close }), [toast, close]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed right-[26px] bottom-[26px] z-[70] w-[min(370px,calc(100vw-40px))] gap-3 p-4",
          "border border-[rgba(var(--paper-rgb),.22)] bg-ink text-paper shadow-[0_14px_44px_rgba(10,10,11,.38)]",
          "transition-[transform,opacity] duration-300",
          on ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-3.5 opacity-0",
        )}
      >
        {current && (
          <>
            {current.kicker && (
              <div className="font-[var(--mono)] text-[9.5px] tracking-[0.26em] text-[rgba(var(--paper-rgb),.55)] uppercase">
                {current.kicker}
              </div>
            )}
            <div className="mt-1.5 font-[var(--serif-zh)] text-[14.5px] leading-1.5 font-semibold">
              {current.title}
            </div>
            {current.body && (
              <div className="mt-1.5 text-[12.5px] leading-1.6 text-[rgba(var(--paper-rgb),.75)]">
                {current.body}
              </div>
            )}
            {current.actions && (
              <div className="mt-3 flex gap-2">
                {current.actions.map((a) => (
                  <a
                    key={a.label}
                    href={a.href}
                    className={cn(
                      "inline-flex h-[30px] items-center px-[13px] text-[12px] transition-colors",
                      a.solid
                        ? "bg-paper font-semibold text-ink hover:bg-paper-tint"
                        : "border border-[rgba(var(--paper-rgb),.45)] text-paper hover:border-paper hover:bg-[rgba(var(--paper-rgb),.12)]",
                    )}
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}
