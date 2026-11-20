"use client";

import { useEffect, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "@/lib/ui/motion";

interface RoiAnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

export function RoiAnimatedNumber({ value, format, className = "" }: RoiAnimatedNumberProps) {
  const reduce = useReducedMotion();
  const target = Number.isFinite(value) ? value : 0;
  const current = useMotionValue(target);
  const [display, setDisplay] = useState(target);

  useMotionValueEvent(current, "change", setDisplay);

  useEffect(() => {
    if (reduce) {
      current.jump(target);
      return;
    }
    if (current.get() === target) return;

    const tween = animate(current, target, { type: "tween", duration: 0.5, ease: EASE_OUT });
    return () => tween.stop();
  }, [current, reduce, target]);

  return <span className={`tabular-nums ${className}`}>{format(reduce ? target : display)}</span>;
}
