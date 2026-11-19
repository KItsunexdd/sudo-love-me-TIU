"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Microscope, RotateCcw, ShieldAlert } from "lucide-react";
import type { ApiError } from "@/lib/client/api";
import { escapeDisplayControls } from "@/lib/crypto/canonical";
import type { TamperDiff } from "@/lib/db/types";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";
import { attackShieldVariants, reducedMotionVariants } from "@/lib/ui/motion";
import { Badge } from "@/components/ui/Badge";
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
      className="space-y-3.5 rounded-[20px] border-2 border-danger/75 bg-surface bg-shield-danger p-4 shadow-glow-danger sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl border border-danger/60 bg-danger/20 text-danger-text">
          <span aria-hidden="true" className="absolute inset-0 rounded-2xl border border-danger/55 motion-safe:animate-ping opacity-35" />
          <ShieldAlert aria-hidden="true" className="relative size-7" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-xl font-extrabold tracking-tight text-ink-primary sm:text-[22px]">АТАКА ОТРАЖЕНА</h2>
          <Badge tone="danger" className="max-w-full !whitespace-normal break-all font-mono text-[13px] font-bold tabular-nums">
            HTTP {httpStatus} • {error.failureCode}
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-ink-secondary">{error.message}</p>

      {headline && (
        <div className="rounded-xl border border-danger/45 bg-terminal/90 px-3.5 py-2.5 text-sm leading-snug">
          <span className="text-ink-secondary">Клиент подписал: </span>
          <strong className={`${headline.mono ? "font-mono" : ""} font-bold tabular-nums text-bcc`}>
            {escapeDisplayControls(headline.original)}
          </strong>
          <span className="mx-1.5 text-ink-muted">·</span>
          <span className="text-ink-secondary">Сервер получил: </span>
          <strong className={`${headline.mono ? "font-mono" : ""} font-bold tabular-nums text-danger-text`}>
            {escapeDisplayControls(headline.tampered)}
          </strong>
        </div>
      )}

      {error.tamperDiff?.length ? <JsonDiffViewer tamperDiff={error.tamperDiff} /> : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-secondary sm:text-sm">
        {computedMs !== undefined && (
          <span>Остановлено за <span className="mono-data font-bold text-ink-primary">{formatMs(computedMs)}</span></span>
        )}
        {failed.length > 0 && (
          <span>· Отклонены шаги <span className="font-mono font-semibold tabular-nums text-danger-text">{failed.map(row => `№${row.step}`).join(", ")}</span></span>
        )}
        <span>· Событие записано в SOC</span>
      </div>

      {(onInspect || onReset) && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {onInspect && <Button size="sm" variant="secondary" icon={<Microscope className="size-4" />} onClick={onInspect}>Открыть Crypto Inspector</Button>}
          {onReset && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onReset}>Сбросить</Button>}
        </div>
      )}
    </motion.section>
  );
}
