"use client";

import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

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
    <div role="group" aria-label={label} className={`inline-flex items-center rounded-xl border border-border-default bg-terminal p-1 ${className}`}>
      {options.map(option => {
        const selected = option.value === value;
        const gold = option.tone === "gold";
        return (
          <button key={option.value} type="button" disabled={option.disabled} aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`relative isolate z-0 flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-45 ${selected ? gold ? "text-amber-300" : "text-ink-primary" : "text-ink-secondary hover:text-ink-primary"}`}>
            {selected && <motion.span layoutId={reduce ? undefined : id} aria-hidden="true"
              className={`absolute inset-0 -z-10 rounded-[9px] border ${gold ? "border-gold/40 bg-gold/15" : "border-border-strong bg-elevated"}`} />}
            {option.label}
            {Boolean(option.badgeCount) && <span className="rounded-full bg-danger-solid px-1.5 font-mono text-xs tabular-nums text-white motion-safe:animate-pulse">{option.badgeCount}</span>}
          </button>
        );
      })}
    </div>
  );
}
