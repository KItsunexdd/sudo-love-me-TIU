"use client";

import type { Translate } from "@/lib/i18n";
import { riskReason } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { Building2, Check, Moon, PhoneIncoming, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { riskLevel } from "@/lib/risk/engine";
import type { RiskLevel } from "@/lib/db/types";
import { TWEEN_ENTER } from "@/lib/ui/motion";

const getTiers = (t: Translate) => ({
  LOW: { bar: "bg-bcc", text: t("riskMeter.instant") },
  MEDIUM: { bar: "bg-gold", text: t("riskMeter.acknowledge") },
  HIGH: { bar: "bg-danger", text: t("riskMeter.cosign") },
});

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

export function RiskMeter({ score, level: assessedLevel, reasons = [], codes = [] }: {
  score: number; level?: RiskLevel; reasons?: readonly string[]; codes?: readonly string[];
}) {
  const { locale, t } = useT();
  const tiers = getTiers(t);
  const reduce = useReducedMotion();
  const value = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
  const level = assessedLevel ?? riskLevel(value);
  const { bar, text } = tiers[level];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[0.8125rem] font-normal text-ink-secondary">
          {t("common.score")} <span className="text-ink-muted">(Anti-Scam)</span>
        </h2>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-[0.9375rem] font-medium tabular-nums">{value}<span className="text-ink-muted"> / 100</span></span>
          <Badge status={level} />
        </div>
      </div>

      <div
        role="meter"
        aria-label={t("common.score")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={text}
        className="relative h-1 overflow-hidden rounded-full bg-elevated"
      >
        <motion.div
          initial={false}
          animate={{ scaleX: value / 100 }}
          transition={reduce ? { duration: 0 } : TWEEN_ENTER}
          style={{ originX: 0 }}
          className={`h-full w-full rounded-full transition-colors ${bar}`}
        />
        <span aria-hidden="true" className="absolute inset-y-0 left-[40%] w-0.5 bg-canvas" />
        <span aria-hidden="true" className="absolute inset-y-0 left-[60%] w-0.5 bg-canvas" />
      </div>

      {reasons.length > 0 ? (
        <>
          <p className="text-[0.8125rem] text-ink-secondary">{text}</p>
          <ul className="flex flex-wrap gap-1.5">
            {reasons.map((reason, index) => {
              const code = codes[index];
              const match = code && Object.hasOwn(rules, code) ? rules[code as keyof typeof rules] : undefined;
              const Icon = match?.[1] ?? TriangleAlert;
              return (
                <li key={reason} className="flex items-center gap-1.5 rounded-md border border-border-default bg-terminal px-2 py-1 text-xs text-ink-secondary">
                  <Icon aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
                  <span>{riskReason(locale, code, reason)}</span>
                  {match && <span className="shrink-0 font-mono tabular-nums text-ink-muted">+{match[0]}</span>}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[0.8125rem]">
          <span className="text-ink-secondary">{text}</span>
          {value === 0 && (
            <span className="inline-flex items-center gap-1.5 text-ink-secondary">
              <Check aria-hidden="true" className="size-3.5 text-bcc" strokeWidth={2} /> {t("riskMeter.trusted")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
