"use client";

import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  variant?: "default" | "attack";
  disabled?: boolean;
  description?: string;
}

export function Toggle({ checked, onChange, label, variant = "default", disabled, description }: ToggleProps) {
  const id = useId();
  const reduce = useReducedMotion();
  const armed = variant === "attack" && checked;
  const track = armed ? "justify-end border-danger bg-danger-solid shadow-glow-danger" :
    checked ? "justify-end border-bcc bg-bcc" : "justify-start border-border-strong bg-terminal";
  return (
    <div className="flex items-center gap-3">
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:opacity-45 ${track}`}>
        <motion.span layout={!reduce} transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="size-[18px] rounded-full bg-ink-primary shadow" />
      </button>
      <span className="min-w-0 text-sm text-ink-secondary">
        <span id={`${id}-label`} className="font-semibold text-ink-primary">{label}</span>
        {description && <span id={`${id}-description`} className="mt-0.5 block text-xs">{description}</span>}
      </span>
      {armed && <span className="rounded bg-danger/20 px-2 py-0.5 font-mono text-xs text-danger-text">ВКЛ</span>}
    </div>
  );
}
