"use client";

import { isMessageKey, type Translate } from "@/lib/i18n";
import { diagnosticText } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle, ShieldAlert } from "lucide-react";
import type { BadgeTone } from "@/components/ui/Badge";
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
// Seven checks in one column. Passing rows stay quiet; a failed check is the only red row.
const getAppearance = (t: Translate) => ({
  IDLE: { style: "", icon: "text-ink-muted", status: "text-ink-muted", text: "—", tone: "neutral", Icon: null },
  RUNNING: { style: "bg-elevated", icon: "text-ink-secondary", status: "text-ink-secondary", text: t("common.verification"), tone: "info", Icon: LoaderCircle },
  PASS: { style: "", icon: "text-bcc", status: "text-ink-muted", text: t("verificationStepsList.passed"), tone: "success", Icon: CircleCheck },
  FAIL: { style: "bg-danger/[.08]", icon: "text-danger-text", status: "text-danger-text", text: t("verificationStepsList.fail"), tone: "danger", Icon: CircleX },
  SKIPPED: { style: "", icon: "text-ink-disabled", status: "text-ink-muted", text: t("verificationStepsList.skipped"), tone: "neutral", Icon: CircleMinus },
  COMPROMISED: { style: "bg-gold/[.08]", icon: "text-gold-text", status: "text-gold-text", text: t("verificationStepsList.simulated"), tone: "warning", Icon: ShieldAlert },
} satisfies Record<State, { style: string; icon: string; status: string; text: string; tone: BadgeTone; Icon: typeof CircleCheck | null }>);

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
        className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default"
      >
        {stepCodes.map((code, index) => {
          const step = index + 1;
          const result = rows.get(step);
          const key = `step.${result?.code ?? code}`;
          const label = isMessageKey(key) ? t(key) : (result?.label ?? code);
          const state = result?.outcome ?? (runningStep === step ? "RUNNING" : "IDLE");
          const { style, icon, status, text, Icon } = appearance[state];
          return (
            <motion.li
              key={step}
              variants={reduce || !hasTrace ? reducedMotionVariants : verificationStepVariants}
              className={`grid grid-cols-[1rem_1fr] items-start gap-x-3 gap-y-1 transition-colors sm:grid-cols-[1rem_1fr_auto]
                ${compact ? "min-h-9 px-3 py-2" : "min-h-10 px-4 py-2.5"} ${style}`}
            >
              {Icon ? (
                <Icon aria-hidden="true" strokeWidth={1.75} className={`mt-0.5 size-4 shrink-0 ${icon} ${state === "RUNNING" ? "motion-safe:animate-spin" : ""}`} />
              ) : (
                <span className={`mt-px text-center font-mono text-xs tabular-nums ${icon}`}>{step}</span>
              )}
              <div className="min-w-0">
                <div className={`${compact ? "text-[0.8125rem]" : "text-sm"} leading-5 ${state === "IDLE" || state === "SKIPPED" ? "text-ink-secondary" : "text-ink-primary"}`}>
                  {label}
                </div>
                {result?.details && state !== "SKIPPED" && (!compact || state === "FAIL" || state === "COMPROMISED") && (
                  <div className="mt-0.5 text-xs leading-4 text-ink-secondary">{diagnosticText(locale, result.details)}</div>
                )}
              </div>
              <span className={`col-start-2 whitespace-nowrap font-mono text-xs leading-5 tabular-nums sm:col-start-auto ${status}`}>
                {text}
                {result && state !== "SKIPPED" && <span className="ml-2">{formatMs(result.durationMs)}</span>}
              </span>
            </motion.li>
          );
        })}
      </motion.ol>
      {hasTamperEvidence && (
        <p className="rounded-lg border border-border-default bg-terminal px-4 py-2.5 text-[0.8125rem] leading-5 text-ink-secondary">
          {t("verificationStepsList.tamperHint")}
        </p>
      )}
    </div>
  );
}
