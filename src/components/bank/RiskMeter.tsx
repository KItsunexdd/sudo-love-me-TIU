"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Building2, Check, Moon, PhoneIncoming, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { riskLevel } from "@/lib/risk/engine";
import { SPRING_SMOOTH } from "@/lib/ui/motion";

const tiers = {
  LOW: { bar: "bg-bcc shadow-glow-bcc", text: "Мгновенная 1-of-1 подпись" },
  MEDIUM: { bar: "bg-gold shadow-glow-gold", text: "Нужно подтверждение на Экране отрезвления" },
  HIGH: { bar: "bg-danger shadow-glow-danger", text: "Требуется «Вторая рука» (Co-Sign 2-of-2)" },
};

const rules = {
  NEW_RECIPIENT: [30, TriangleAlert],
  HIGH_AMOUNT_B2C: [35, TriangleAlert],
  VERY_HIGH_AMOUNT_B2C: [25, TriangleAlert],
  CRITICAL_OP_TYPE: [55, TriangleAlert],
  B2B_DUAL_CONTROL: [60, Building2],
  NIGHT_OPERATION: [15, Moon],
  SUSPICIOUS_CALL_FLAG: [40, PhoneIncoming],
  DROP_ACCOUNT_PATTERN: [50, TriangleAlert],
} as const;

export function RiskMeter({ score, reasons = [], codes = [] }: {
  score: number; reasons?: readonly string[]; codes?: readonly string[];
}) {
  const reduce = useReducedMotion();
  const value = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
  const level = riskLevel(value);
  const { bar, text } = tiers[level];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-h3">Оценка риска <span className="text-ink-muted">(Anti-Scam Engine)</span></h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-bold tabular-nums">{value} / 100</span>
          <Badge status={level} />
        </div>
      </div>
      <div role="meter" aria-label="Оценка риска" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={text}
        className="relative h-2.5 overflow-hidden rounded-full bg-terminal ring-1 ring-border-default">
        <motion.div initial={false} animate={{ width: `${value}%` }} transition={reduce ? { duration: 0 } : SPRING_SMOOTH}
          className={`h-full rounded-full transition-colors ${bar}`} />
        <span aria-hidden="true" className="absolute inset-y-0 left-[40%] w-px bg-ink-muted" />
        <span aria-hidden="true" className="absolute inset-y-0 left-[60%] w-px bg-ink-muted" />
      </div>
      <p className="text-sm text-ink-secondary">{text}</p>
      {reasons.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {reasons.map((reason, index) => {
            const code = codes[index];
            const match = code && Object.hasOwn(rules, code) ? rules[code as keyof typeof rules] : undefined;
            const Icon = match?.[1] ?? TriangleAlert;
            return <li key={reason} className="flex items-center gap-2 rounded-lg border border-border-default bg-terminal px-2.5 py-1.5 text-xs text-ink-secondary">
              <Icon aria-hidden="true" className="size-3.5 shrink-0 text-gold" />
              {reason}
              {match && <span className="shrink-0 font-mono tabular-nums text-amber-300">+{match[0]}</span>}
            </li>;
          })}
        </ul>
      ) : value === 0 && <p className="flex items-center gap-2 text-sm text-bcc"><Check aria-hidden="true" className="size-4" /> Доверенный получатель • Аномалий не обнаружено</p>}
    </div>
  );
}
