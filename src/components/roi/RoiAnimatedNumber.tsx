"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion, useSpring } from "framer-motion";

interface RoiAnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

export function RoiAnimatedNumber({ value, format, className = "" }: RoiAnimatedNumberProps) {
  const reduce = useReducedMotion();
  const safeValue = Number.isFinite(value) ? value : 0;
  const targetRef = useRef(safeValue);
  targetRef.current = safeValue;

  const spring = useSpring(safeValue, { stiffness: 260, damping: 30, mass: 0.6 });
  const [display, setDisplay] = useState(safeValue);

  useEffect(() => {
    if (reduce) {
      spring.jump(safeValue);
      setDisplay(safeValue);
      return;
    }
    spring.set(safeValue);
  }, [reduce, safeValue, spring]);

  useEffect(() => {
    const unsubscribeChange = spring.on("change", latest => {
      const target = targetRef.current;
      const epsilon = Math.max(0.5, Math.abs(target) * 0.00025);
      setDisplay(Math.abs(latest - target) <= epsilon ? target : latest);
    });
    const unsubscribeFinish = spring.on("animationComplete", () => {
      setDisplay(targetRef.current);
    });
    return () => {
      unsubscribeChange();
      unsubscribeFinish();
    };
  }, [spring]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
