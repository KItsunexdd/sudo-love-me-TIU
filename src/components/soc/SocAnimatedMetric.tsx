"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion, useSpring } from "framer-motion";

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
  const safeValue = Number.isFinite(value) ? value : 0;
  const targetRef = useRef(safeValue);
  targetRef.current = safeValue;

  const spring = useSpring(0, { stiffness: 180, damping: 26, mass: 0.7 });
  const [display, setDisplay] = useState(reduce ? safeValue : 0);

  useEffect(() => {
    if (isEmpty) return;
    if (reduce) {
      spring.jump(safeValue);
      setDisplay(safeValue);
      return;
    }
    spring.set(safeValue);
  }, [isEmpty, reduce, safeValue, spring]);

  useEffect(() => {
    const unsubChange = spring.on("change", latest => {
      const target = targetRef.current;
      const epsilon = Math.max(0.01, Math.abs(target) * 0.002);
      setDisplay(Math.abs(latest - target) <= epsilon ? target : latest);
    });
    const unsubFinish = spring.on("animationComplete", () => {
      setDisplay(targetRef.current);
    });
    return () => {
      unsubChange();
      unsubFinish();
    };
  }, [spring]);

  if (isEmpty) {
    return <span className={`tabular-nums ${className}`}>{emptyText}</span>;
  }

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
