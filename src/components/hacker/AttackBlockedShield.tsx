"use client";

import { failureText } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { Microscope, RotateCcw, ShieldAlert } from "lucide-react";
import type { ApiError } from "@/lib/client/api";
import { escapeDisplayControls } from "@/lib/crypto/canonical";
import type { TamperDiff } from "@/lib/db/types";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";
import { attackShieldVariants, reducedMotionVariants } from "@/lib/ui/motion";
import { Button } from "@/components/ui/Button";
import { JsonDiffViewer } from "@/components/ui/JsonDiffViewer";

function pickTamperHeadline(diff?: TamperDiff): { original: string; tampered: string; mono: boolean } | null {
  if (!diff?.length) return null;
  const amount = diff.find(item => item.field === "amountTenge");
  if (amount) {
    const origNum = Number(amount.original);
    const tampNum = Number(amount.tampered);
    if (Number.isFinite(origNum) && Number.isFinite(tampNum)) {
      return { original: formatTenge(origNum), tampered: formatTenge(tampNum), mono: true };
    }
  }
  const account = diff.find(item => item.field === "recipientAccount");
  if (account) {
    return { original: formatIban(account.original), tampered: formatIban(account.tampered), mono: true };
  }
  const first = diff[0];
  return first ? { original: first.original, tampered: first.tampered, mono: false } : null;
}

export function AttackBlockedShield({ error, httpStatus, durationMs, onInspect, onReset }: {
  error: ApiError; httpStatus: number; durationMs?: number; onInspect?: () => void; onReset?: () => void;
}) {
  const { locale, t } = useT();
  const reduce = useReducedMotion();
  const trace = error.verificationTrace ?? [];
  const failed = trace.filter(row => row.outcome === "FAIL");
  const computedMs = durationMs ?? (trace.length > 0
    ? trace.filter(row => row.outcome !== "SKIPPED").reduce((sum, row) => sum + row.durationMs, 0)
    : undefined);
  const headline = pickTamperHeadline(error.tamperDiff);

  return (
    <motion.section
      role="alert"
      initial={reduce ? false : "hidden"}
      animate="visible"
      variants={reduce ? reducedMotionVariants : attackShieldVariants}
      className="space-y-4 rounded-xl border border-danger/50 bg-[#1C1718] p-4 2xl:p-5"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-danger-text" strokeWidth={1.75} />
        <div className="min-w-0 space-y-1">
          <h2 className="type-h1">{t("attackBlockedShield.repelled")}</h2>
          <p className="break-all font-mono text-[0.8125rem] tabular-nums text-danger-text">
            HTTP {httpStatus} · {error.failureCode}
          </p>
        </div>
      </div>

      <p className="text-sm text-ink-secondary">{failureText(locale, error.failureCode, error.message)}</p>

      {headline && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 rounded-lg border border-border-default bg-terminal px-4 py-3 text-sm">
          <div className="contents">
            <dt className="text-ink-secondary">{t("attackBlockedShield.signed")}</dt>
            <dd className={`${headline.mono ? "font-mono" : ""} break-all text-[0.9375rem] tabular-nums text-ink-primary`}>
              {escapeDisplayControls(headline.original)}
            </dd>
          </div>
          <div className="contents">
            <dt className="text-ink-secondary">{t("attackBlockedShield.received")}</dt>
            <dd className={`${headline.mono ? "font-mono" : ""} break-all text-[0.9375rem] tabular-nums text-danger-text`}>
              {escapeDisplayControls(headline.tampered)}
            </dd>
          </div>
        </dl>
      )}

      {error.tamperDiff?.length ? <JsonDiffViewer tamperDiff={error.tamperDiff} /> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-ink-muted">
        {computedMs !== undefined && (
          <span>{t("attackBlockedShield.elapsed")} <span className="text-ink-primary">{formatMs(computedMs)}</span></span>
        )}
        {failed.length > 0 && (
          <span>{t("attackBlockedShield.failedSteps")} <span className="text-danger-text">{failed.map(row => `№${row.step}`).join(", ")}</span></span>
        )}
        <span className="font-sans">{t("attackBlockedShield.logged")}</span>
      </div>

      {(onInspect || onReset) && (
        <div className="flex flex-wrap gap-2">
          {onInspect && <Button size="sm" variant="secondary" icon={<Microscope className="size-4" />} onClick={onInspect}>{t("common.inspect")}</Button>}
          {onReset && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onReset}>{t("common.reset")}</Button>}
        </div>
      )}
    </motion.section>
  );
}
