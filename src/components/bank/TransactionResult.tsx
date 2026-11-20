"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { CircleCheck, Clock, Hand, Microscope, Plus } from "lucide-react";
import type { ApiError } from "@/lib/client/api";
import type { TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { Badge, Button, Card, ErrorCard, HashChip, Skeleton } from "@/components/ui";
import { LatencyBadge } from "@/components/crypto/LatencyBadge";
import { AttackBlockedShield } from "@/components/hacker/AttackBlockedShield";

export function TransactionResult({ attemptId, record, error, http, cosigner, onInspect, onNew, onCosign }: {
  attemptId?: string; record?: TransactionRecord; error?: ApiError; http?: number; cosigner?: string;
  onInspect: (attemptError?: ApiError) => void; onNew: () => void; onCosign: () => void;
}) {
  const { t } = useT();
  const reduce = useReducedMotion();
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" icon={<Microscope size={15} />} onClick={() => onInspect()}>{t("common.inspect")}</Button>
      <Button variant="ghost" size="sm" icon={<Plus size={15} />} onClick={onNew}>{t("transactionResult.new")}</Button>
    </div>
  );

  if (error?.status === "REJECTED_CRYPTO" && http === 403) {
    return (
      <AttackBlockedShield
        key={attemptId ?? error.failureCode}
        error={error}
        httpStatus={http}
        onInspect={() => onInspect(error)}
        onReset={onNew}
      />
    );
  }
  if (error && (!record || record.status === "CHALLENGE_ISSUED")) return <ErrorCard error={error} action={actions} />;
  if (!record) {
    return (
      <Card aria-busy="true" aria-label={t("transactionResult.checking")} className="space-y-3">
        <Skeleton className="h-6 w-36 rounded-full" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-9 w-52 rounded-lg" />
      </Card>
    );
  }

  const waiting = record.status === "PENDING_COSIGN";
  const stopped = record.status === "BLOCKED_BY_COSIGNER";
  const executed = record.status === "EXECUTED";
  const Icon = waiting ? Clock : executed ? CircleCheck : Hand;
  const titles = {
    EXECUTED: t("transactionResult.success"),
    PENDING_COSIGN: t("transactionResult.pending"),
    BLOCKED_BY_COSIGNER: t("transactionResult.blocked"),
    EXPIRED: t("transactionResult.expired"),
    CHALLENGE_ISSUED: t("common.unsigned"),
    REJECTED_CRYPTO: t("common.repelled"),
  };
  const verifyMs = record.primarySignature?.verifyTimeMs;

  return (
    <motion.div
      key={record.id + record.status}
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card variant={waiting ? "warning" : executed || stopped ? "success" : "default"} className="space-y-3.5" aria-live="polite">
        <div className="flex items-start justify-between gap-2">
          <Icon aria-hidden="true" className={waiting ? "text-gold" : "text-bcc"} size={30} />
          <Badge status={record.status} />
        </div>
        <h2 className="type-h1">{titles[record.status]}</h2>
        <div>
          <p className="display-kpi">{formatTenge(record.payload.amountTenge)}</p>
          <p className="mt-1 text-sm font-medium text-ink-primary">{record.payload.recipientName}</p>
          <p className="mono-data text-xs text-ink-secondary">{formatIban(record.payload.recipientAccount)}</p>
        </div>
        {(waiting || stopped) && (
          <div className="space-y-1 text-sm">
            <p>{waiting ? t("transactionResult.request") : t("transactionResult.decided")} · <span className="font-semibold">{cosigner}</span></p>
            <p className="text-ink-secondary">
              {waiting ? (
                <>{t("common.risk")} <span className="font-mono font-semibold tabular-nums text-amber-300">{record.riskScore}/100</span>{t("transactionResult.paused")}</>
              ) : (
                t("transactionResult.safe")
              )}
            </p>
          </div>
        )}
        {executed && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-bcc">
              {record.cosignSignature ? t("transactionResult.both") : t("transactionResult.verified")}
            </p>
            {verifyMs !== undefined && <LatencyBadge ms={verifyMs} label={t("common.verification")} tone="success" />}
          </div>
        )}
        {record.failureCode && <p className="mono-data font-bold text-danger-text">{record.failureCode}</p>}
        <HashChip value={record.txHashHex} />
        {waiting && <Button variant="warning" size="sm" onClick={onCosign}>{t("transactionResult.openCosign")}</Button>}
        {actions}
      </Card>
    </motion.div>
  );
}
