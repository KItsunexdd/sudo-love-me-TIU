"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

const variants = {
  primary: "bg-bcc text-ink-inverse shadow-highlight hover:bg-bcc-hover active:bg-bcc-active",
  danger: "bg-danger-solid text-white shadow-highlight hover:bg-danger-hover",
  "danger-outline": "border border-danger/40 text-danger-text hover:bg-danger/10",
  warning: "bg-gold text-ink-inverse shadow-highlight hover:bg-gold-hover active:bg-gold-active",
  secondary: "border border-border-strong bg-elevated text-ink-primary shadow-highlight hover:bg-surface-hover",
  ghost: "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
};

const sizes = {
  sm: "min-h-8 px-3 py-1 text-[0.8125rem] rounded-lg gap-1.5",
  md: "min-h-10 px-4 py-2 text-sm rounded-lg gap-2",
  lg: "min-h-11 px-5 py-2 text-[0.9375rem] rounded-[10px] gap-2",
  xl: "min-h-12 px-6 py-2 text-[0.9375rem] rounded-[10px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, type = "button", disabled, className = "", children, ...props },
  ref,
) {
  const { t } = useT();
  return (
    <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={`relative inline-flex items-center justify-center text-center font-medium transition-[background-color,border-color,color,opacity,transform] motion-safe:active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}>
      {icon && <span aria-hidden="true" className={`inline-flex shrink-0 [&_svg]:size-4 [&_svg]:stroke-[1.75] ${loading ? "invisible" : ""}`}>{icon}</span>}
      {loading && <LoaderCircle aria-hidden="true" className={`absolute size-4 motion-safe:animate-spin ${icon ? "left-3" : "left-1/2 -translate-x-1/2"}`} />}
      <span className={loading && !icon ? "invisible" : undefined}>{children}</span>
      {loading && <span className="sr-only">{t("common.busy")}</span>}
    </button>
  );
});
