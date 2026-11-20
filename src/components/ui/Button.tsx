"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

const variants = {
  primary: "bg-bcc text-ink-inverse hover:bg-bcc-hover active:bg-bcc-active shadow-glow-bcc",
  danger: "bg-danger-solid text-white hover:bg-danger active:bg-red-700 shadow-glow-danger",
  "danger-outline": "bg-danger/[.12] text-danger-text border border-danger/50 hover:bg-danger/[.22]",
  warning: "bg-gold text-ink-inverse hover:bg-gold-hover active:bg-gold-active shadow-glow-gold",
  secondary: "bg-elevated text-ink-primary border border-border-strong hover:bg-surface-hover hover:border-bcc/50",
  ghost: "bg-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
};

const sizes = {
  sm: "min-h-9 px-3 py-1.5 text-[13px] rounded-[10px] gap-1.5",
  md: "min-h-11 px-4 py-2 text-sm rounded-xl gap-2",
  lg: "min-h-12 px-5 py-2 text-[15px] rounded-xl gap-2.5",
  xl: "min-h-14 px-6 py-2 text-base rounded-[14px] gap-3",
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
      className={`relative inline-flex items-center justify-center text-center font-semibold transition duration-150 motion-safe:active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none ${variants[variant]} ${sizes[size]} ${className}`}>
      {icon && <span aria-hidden="true" className={`inline-flex shrink-0 ${loading ? "invisible" : ""}`}>{icon}</span>}
      {loading && <LoaderCircle aria-hidden="true" className={`absolute size-4 motion-safe:animate-spin ${icon ? "left-3" : "left-1/2 -translate-x-1/2"}`} />}
      <span className={loading && !icon ? "invisible" : undefined}>{children}</span>
      {loading && <span className="sr-only">{t("common.busy")}</span>}
    </button>
  );
});
