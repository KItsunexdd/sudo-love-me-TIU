"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle, ShieldAlert } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { VerificationStepResult } from "@/lib/db/types";
import { formatMs } from "@/lib/ui/format";
import { reducedMotionVariants, verificationListVariants, verificationStepVariants } from "@/lib/ui/motion";

const steps = [
  "Наличие транзакции и срок действия (TTL)",
  "Защита от повтора (одноразовый Nonce)",
  "Целостность WYSIWYS (сверка SHA-256)",
  "Привязка домена (Origin и RP ID Hash)",
  "Подпись WebAuthn (ECDSA P-256)",
  "Постквантовая подпись ML-DSA-65 (FIPS 204)",
  "Антифрод-политика и правило Co-Sign 2-of-2",
];

type State = VerificationStepResult["outcome"] | "IDLE" | "RUNNING";
const appearance = {
  IDLE: { style: "border-border-subtle text-ink-muted", text: "—", tone: "neutral", Icon: null },
  RUNNING: { style: "border-quantum/40 bg-quantum/[.08] text-quantum", text: "Проверка", tone: "info", Icon: LoaderCircle },
  PASS: { style: "border-bcc/30 bg-bcc/[.06] text-bcc", text: "Пройдено", tone: "success", Icon: CircleCheck },
  FAIL: { style: "border-danger/[.55] bg-danger/[.14] text-danger-text", text: "Отказ", tone: "danger", Icon: CircleX },
  SKIPPED: { style: "border-border-subtle bg-surface text-ink-muted", text: "Пропущено", tone: "neutral", Icon: CircleMinus },
  COMPROMISED: { style: "border-gold/40 bg-gold/[.13] text-amber-300", text: "Симуляция", tone: "warning", Icon: ShieldAlert },
} satisfies Record<State, { style: string; text: string; tone: BadgeTone; Icon: typeof CircleCheck | null }>;

export function VerificationStepsList({ trace = [], runningStep, failureCode }: {
  trace?: readonly VerificationStepResult[]; runningStep?: number; failureCode?: string;
}) {
  const reduce = useReducedMotion();
  const rows = new Map(trace.map(row => [row.step, row]));
  const hasTamperEvidence = failureCode === "ERR_WYSIWYS_TAMPERED" &&
    [3, 5, 6].every(step => rows.get(step)?.outcome === "FAIL");
  return (
    <div className="space-y-3">
      <motion.ol key={trace.length ? "trace" : "progress"} initial="hidden" animate="visible"
        aria-label="Шаги серверной проверки"
        variants={reduce ? reducedMotionVariants : verificationListVariants} className="space-y-1.5">
        {steps.map((label, index) => {
          const step = index + 1;
          const result = rows.get(step);
          const state = result?.outcome ?? (runningStep === step ? "RUNNING" : "IDLE");
          const { style, text, tone, Icon } = appearance[state];
          return (
            <motion.li key={step} variants={reduce ? reducedMotionVariants : verificationStepVariants}
              className={`grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 rounded-lg border px-3 py-2 sm:grid-cols-[auto_1fr_auto] ${style}`}>
              {Icon ? <Icon aria-hidden="true" className={`mt-0.5 size-4 ${state === "RUNNING" ? "motion-safe:animate-spin" : ""}`} /> :
                <span className="grid size-4 place-items-center rounded-full border border-current font-mono text-xs">{step}</span>}
              <div className="min-w-0">
                <div className={`text-sm font-medium ${state === "IDLE" ? "" : "text-ink-primary"}`}>{label}</div>
                {result?.details && state !== "SKIPPED" && <div className="text-xs text-ink-secondary">{result.details}</div>}
              </div>
              <Badge tone={tone} className="col-start-2 w-fit sm:col-start-auto">
                {text}
                {result && state !== "SKIPPED" && <span className="font-mono tabular-nums">{formatMs(result.durationMs)}</span>}
              </Badge>
            </motion.li>
          );
        })}
      </motion.ol>
      {hasTamperEvidence && <p className="rounded-lg border border-quantum/30 bg-quantum/[.08] p-3 text-sm text-sky-200">
        Диагностика показала, что WebAuthn и ML-DSA-65 отклоняют подписи для изменённого хэша даже без сверки с исходными реквизитами.
      </p>}
    </div>
  );
}
