import type { HTMLAttributes, ReactNode } from "react";

const variants = {
  default: "border-border-default bg-surface",
  elevated: "border-border-strong bg-elevated",
  terminal: "border-border-default bg-terminal font-mono",
  success: "border-bcc/[.45] bg-surface bg-shield-success",
  warning: "border-gold/[.45] bg-surface bg-shield-cosign",
  danger: "border-danger/[.55] bg-surface bg-shield-danger shadow-glow-danger",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
  heading?: ReactNode;
  divided?: boolean;
}

export function Card({ variant = "default", heading, divided = false, className = "", children, ...props }: CardProps) {
  const shadow = variant === "danger" ? "" : "shadow-card";
  return (
    <div {...props} className={`min-w-0 rounded-2xl border p-4 2xl:p-5 ${shadow} ${variants[variant]} ${className}`}>
      {heading && <div className={divided ? "mb-3 border-b border-border-subtle pb-3" : "mb-3"}>{heading}</div>}
      {children}
    </div>
  );
}
