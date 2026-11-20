"use client";

import { isMessageKey, type Translate } from "@/lib/i18n";
import { diagnosticText } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle, ShieldAlert } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { VerificationStepResult } from "@/lib/db/types";
import { formatMs } from "@/lib/ui/format";
import { reducedMotionVariants, verificationListVariants, verificationStepVariants } from "@/lib/ui/motion";

const stepCodes = [
  "TX_EXISTENCE_AND_TTL",
  "REPLAY_PROTECTION",
  "WYSIWYS_INTEGRITY",
  "ORIGIN_AND_RPID",
  "WEBAUTHN_SIGNATURE",
  "POST_QUANTUM_ML_DSA",
  "RISK_AND_POLICY_GATE",
] as const;

type State = VerificationStepResult["outcome"] | "IDLE" | "RUNNING";
const getAppearance = (t: Translate) => ({
  IDLE: { style: "border-border-default bg-surface/60 text-ink-muted", text: "—", tone: "neutral", Icon: null },
  RUNNING: { style: "border-quantum/45 bg-quantum/[.08] text-quantum", text: t("common.verification"), tone: "info", Icon: LoaderCircle },
  PASS: { style: "border-bcc/35 bg-bcc/[.07] text-bcc", text: t("verificationStepsList.passed"), tone: "success", Icon: CircleCheck },
  FAIL: { style: "border-danger/60 bg-danger/[.16] text-danger-text shadow-[0_0_16px_-6px_rgba(239,68,68,0.55)]", text: t("verificationStepsList.fail"), tone: "danger", Icon: CircleX },
  SKIPPED: { style: "border-border-default bg-surface/50 text-ink-muted", text: t("verificationStepsList.skipped"), tone: "neutral", Icon: CircleMinus },
  COMPROMISED: { style: "border-gold/45 bg-gold/[.14] text-amber-300", text: t("verificationStepsList.simulated"), tone: "warning", Icon: ShieldAlert },
} satisfies Record<State, { style: string; text: string; tone: BadgeTone; Icon: typeof CircleCheck | null }>);

export function VerificationStepsList({ trace = [], runningStep, failureCode, compact = false }: {
  trace?: readonly VerificationStepResult[]; runningStep?: number; failureCode?: string; compact?: boolean;
}) {
  const { t, locale } = useT();
  const appearance = getAppearance(t);

  const reduce = useReducedMotion();
  const rows = new Map(trace.map(row => [row.step, row]));
  const hasTrace = trace.length > 0;
  const traceKey = hasTrace
    ? trace.map(row => `${row.step}:${row.outcome}:${Math.round(row.durationMs * 100)}`).join("|")
    : "idle";
  const hasTamperEvidence = failureCode === "ERR_WYSIWYS_TAMPERED" &&
    [3, 5, 6].every(step => rows.get(step)?.outcome === "FAIL");

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <motion.ol
        key={traceKey}
        initial={hasTrace && !reduce ? "hidden" : false}
        animate="visible"
        aria-label={t("verificationStepsList.steps")}
        variants={reduce || !hasTrace ? reducedMotionVariants : verificationListVariants}
        className={compact ? "space-y-1" : "space-y-1.5"}
      >
        {stepCodes.map((code, index) => {
          const step = index + 1;
          const result = rows.get(step);
          const key = `step.${result?.code ?? code}`;
          const label = isMessageKey(key) ? t(key) : (result?.label ?? code);
          const state = result?.outcome ?? (runningStep === step ? "RUNNING" : "IDLE");
          const { style, text, tone, Icon } = appearance[state];
          return (
            <motion.li
              key={step}
              variants={reduce || !hasTrace ? reducedMotionVariants : verificationStepVariants}
              className={`grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 rounded-xl border transition-colors sm:grid-cols-[auto_1fr_auto]
                ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} ${style}`}
            >
              {Icon ? (
                <Icon aria-hidden="true" className={`size-4 shrink-0 ${state === "RUNNING" ? "motion-safe:animate-spin" : ""}`} />
              ) : (
                <span className="grid size-4 shrink-0 place-items-center rounded-full border border-current font-mono text-xs tabular-nums">
                  {step}
                </span>
              )}
              <div className="min-w-0">
                <div className={`${compact ? "text-[13px]" : "text-sm"} font-medium leading-snug ${state === "IDLE" ? "" : "text-ink-primary"}`}>
                  {label}
                </div>
                {result?.details && state !== "SKIPPED" && (!compact || state === "FAIL" || state === "COMPROMISED") && (
                  <div className="text-xs leading-snug text-ink-secondary">{diagnosticText(locale, result.details)}</div>
                )}
              </div>
              <Badge tone={tone} className="col-start-2 w-fit tabular-nums sm:col-start-auto">
                {text}
                {result && state !== "SKIPPED" && <span className="font-mono tabular-nums">{formatMs(result.durationMs)}</span>}
              </Badge>
            </motion.li>
          );
        })}
      </motion.ol>
      {hasTamperEvidence && (
        <p className="rounded-xl border border-quantum/35 bg-quantum/[.09] px-3 py-2 text-xs leading-relaxed text-sky-200 sm:text-sm">
          {t("verificationStepsList.tamperHint")}
        </p>
      )}
    </div>
  );
}
