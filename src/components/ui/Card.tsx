import type { HTMLAttributes, ReactNode } from "react";

// Depth comes from surface steps and hairlines. A coloured border marks the one card that carries a verdict.
const variants = {
  default: "border-border-default bg-surface",
  elevated: "border-border-strong bg-elevated",
  terminal: "border-border-default bg-terminal font-mono",
  success: "border-bcc/35 bg-surface",
  warning: "border-gold/40 bg-surface",
  danger: "border-danger/45 bg-danger/[.05]",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
  heading?: ReactNode;
  divided?: boolean;
}

export function Card({ variant = "default", heading, divided = false, className = "", children, ...props }: CardProps) {
  return (
    <div {...props} className={`min-w-0 rounded-xl border p-4 2xl:p-5 ${variants[variant]} ${className}`}>
      {heading && <div className={divided ? "mb-4 border-b border-border-subtle pb-4" : "mb-4"}>{heading}</div>}
      {children}
    </div>
  );
}
