"use client";

import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TWEEN_FAST } from "@/lib/ui/motion";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  badgeCount?: number;
  tone?: "gold";
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, className = "" }: {
  options: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="group" aria-label={label} className={`inline-flex items-center gap-0.5 rounded-[10px] border border-border-default bg-terminal p-0.5 ${className}`}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button key={option.value} type="button" disabled={option.disabled} aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`relative isolate z-0 flex min-h-8 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-1 text-[0.8125rem] font-medium transition-colors disabled:opacity-45 ${selected ? "text-ink-primary" : "text-ink-secondary hover:text-ink-primary"}`}>
            {selected && <motion.span layoutId={reduce ? undefined : id} transition={TWEEN_FAST} aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-lg border border-border-strong bg-elevated shadow-highlight" />}
            {option.tone === "gold" && <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />}
            {option.label}
            {Boolean(option.badgeCount) && <span className="font-mono text-xs tabular-nums text-danger-text">{option.badgeCount}</span>}
          </button>
        );
      })}
    </div>
  );
}
