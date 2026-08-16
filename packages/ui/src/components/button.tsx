/** shadcn Button × Ink Classic token（视觉契约：发丝线边框 / 近直角 3px / ink 主按钮） */
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-medium tracking-[0.03em] whitespace-nowrap transition-[background,color,border-color] duration-150 disabled:cursor-default",
  {
    variants: {
      variant: {
        primary: "border border-ink bg-ink text-paper hover:bg-ink-hover hover:border-ink-hover",
        ghost: "border border-line-mid bg-transparent text-ink hover:bg-ink/6 hover:border-ink",
      },
      size: {
        md: "h-[38px] px-[18px] text-[13.5px]",
        sm: "h-[29px] px-3 text-[12.5px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
