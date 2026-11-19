"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Microscope, RotateCcw, ShieldAlert } from "lucide-react";
import type { ApiError } from "@/lib/client/api";
import { formatMs } from "@/lib/ui/format";
import { attackShieldVariants, reducedMotionVariants } from "@/lib/ui/motion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { JsonDiffViewer } from "@/components/ui/JsonDiffViewer";

export function AttackBlockedShield({ error, httpStatus, durationMs, onInspect, onReset }: {
  error: ApiError; httpStatus: number; durationMs?: number; onInspect?: () => void; onReset?: () => void;
}) {
  const reduce = useReducedMotion();
  const failed = error.verificationTrace?.filter(row => row.outcome === "FAIL") ?? [];
  return (
    <motion.section role="alert" initial="hidden" animate="visible"
      variants={reduce ? reducedMotionVariants : attackShieldVariants}
      className="space-y-4 rounded-[20px] border-2 border-danger/75 bg-surface bg-shield-danger p-5 shadow-glow-danger">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldAlert aria-hidden="true" className="size-9 text-danger-text" />
        <div className="min-w-0 space-y-1">
          <h2 className="type-h1">Атака отражена</h2>
          <Badge tone="danger" className="max-w-full !whitespace-normal break-all font-mono">HTTP {httpStatus} • {error.failureCode}</Badge>
        </div>
      </div>
      <p className="text-sm text-ink-secondary">{error.message}</p>
      {error.tamperDiff?.length ? <JsonDiffViewer tamperDiff={error.tamperDiff} /> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">
        {durationMs !== undefined && <span>Время проверки <span className="mono-data">{formatMs(durationMs)}</span></span>}
        {failed.length > 0 && <span>Отклонены шаги {failed.map(row => `№${row.step}`).join(", ")}</span>}
      </div>
      {(onInspect || onReset) && <div className="flex flex-wrap gap-2">
        {onInspect && <Button variant="secondary" icon={<Microscope className="size-4" />} onClick={onInspect}>Открыть Crypto Inspector</Button>}
        {onReset && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={onReset}>Сбросить</Button>}
      </div>}
    </motion.section>
  );
}
