"use client";

import { useEffect, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "@/lib/ui/motion";

interface SocAnimatedMetricProps {
  value: number;
  format: (value: number) => string;
  emptyText?: string;
  isEmpty?: boolean;
  className?: string;
}

export function SocAnimatedMetric({
  value,
  format,
  emptyText = "—",
  isEmpty = false,
  className = "",
}: SocAnimatedMetricProps) {
  const reduce = useReducedMotion();
  const target = Number.isFinite(value) ? value : 0;
  const current = useMotionValue(target);
  const [display, setDisplay] = useState(target);
  useMotionValueEvent(current, "change", setDisplay);

  useEffect(() => {
    if (reduce || isEmpty) {
      current.jump(target);
      return;
    }
    if (current.get() === target) return;
    const tween = animate(current, target, { type: "tween", duration: 0.5, ease: EASE_OUT });
    return () => tween.stop();
  }, [current, isEmpty, reduce, target]);

  return <span className={`tabular-nums ${className}`}>{isEmpty ? emptyText : format(reduce ? target : display)}</span>;
}
