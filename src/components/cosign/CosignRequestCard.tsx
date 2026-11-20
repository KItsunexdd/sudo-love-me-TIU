"use client";

import { riskReason } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { Clock3, Fingerprint, LockKeyhole, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, HashChip } from "@/components/ui";
import type { DeviceKind, TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { cosignAlertVariants, reducedMotionVariants } from "@/lib/ui/motion";
import { formatCosignTimer, signatureHash, watchCosignDeadline, type ServerClockSample } from "./cosignDetails";

export function CosignSignatureChain({ transaction }: { transaction: TransactionRecord }) {
  const { t } = useT();
  const first = signatureHash(transaction.primarySignature);
  const second = signatureHash(transaction.cosignSignature);
  return (
    <ol aria-label={t("cosignRequestCard.chain")} className="divide-y divide-border-subtle rounded-lg border border-border-default bg-terminal text-[0.8125rem]">
      <li className="flex flex-wrap items-center gap-2 px-3 py-2">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" strokeWidth={1.75} />
        <span className="text-ink-primary">{t("cosignRequestCard.first")}</span>
        {first && <HashChip value={first} label="Sig1" visible={5} />}
      </li>
      <li className="flex flex-wrap items-center gap-2 px-3 py-2">
        {second
          ? <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" strokeWidth={1.75} />
          : <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />}
        <span className={second ? "text-ink-primary" : "text-ink-secondary"}>{second ? t("cosignRequestCard.second") : t("cosignRequestCard.pending")}</span>
        {second && <HashChip value={second} label="Sig2" tone="info" visible={5} />}
      </li>
    </ol>
  );
}

interface RequestProps {
  transaction: TransactionRecord;
  clock: ServerClockSample;
  senderName: string;
  deviceKind?: DeviceKind;
  compact?: boolean;
  busy: "reject" | "sign" | null;
  disabled: boolean;
  onReject: () => void;
  onSign: () => void;
  onExpire: () => void;
  devicePrompt?: ReactNode;
}

export function CosignRequestCard({
  transaction,
  clock,
  senderName,
  deviceKind,
  compact = false,
  busy,
  disabled,
  onReject,
  onSign,
  onExpire,
  devicePrompt,
}: RequestProps) {
  const { locale, t } = useT();
  const reduce = useReducedMotion();
  const [seconds, setSeconds] = useState<number>();
  const expiry = transaction.cosignExpiresAt;
  const expired = seconds === 0;

  useEffect(() => watchCosignDeadline(expiry, clock, setSeconds, onExpire), [expiry, clock, onExpire]);

  const { amountTenge, mode, purpose, recipientAccount, recipientName } = transaction.payload;
  const corporate = mode === "B2B";
  const unavailable = disabled || seconds === undefined || expired;
  // The full /cosign page has no section heading above the card; the embedded tab does.
  const Heading = compact ? "h3" : "h2";

  return (
    <motion.article
      variants={reduce ? reducedMotionVariants : cosignAlertVariants}
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
    >
      <Card className={`space-y-4 ${corporate ? "border-gold/40" : "border-danger/45"}`}>
        <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${corporate ? "bg-gold/[.10]" : "bg-danger/[.10]"}`}>
          <ShieldAlert className={`mt-0.5 size-[18px] shrink-0 ${corporate ? "text-gold-text" : "text-danger-text"}`} strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <Heading className={`text-sm font-medium leading-5 ${corporate ? "text-gold-text" : "text-danger-text"}`}>
              {corporate ? t("cosignRequestCard.directorRequired") : t("cosignRequestCard.suspected")}
            </Heading>
            <p className="mt-0.5 text-xs text-ink-secondary">
              {corporate ? t("cosignDetails.corporate") : <>{t("common.risk")} <span className="font-mono tabular-nums text-ink-primary">{transaction.riskScore}/100</span></>}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-[0.8125rem] text-ink-muted">{t("cosignRequestCard.sender")}</dt>
          <dd className="break-words">{senderName}</dd>
          <dt className="text-[0.8125rem] text-ink-muted">{t("common.amount")}</dt>
          <dd className="break-words font-mono text-[1.75rem] font-medium leading-tight tracking-[-0.01em] tabular-nums text-ink-primary sm:text-[2rem]">
            {formatTenge(amountTenge)}
          </dd>
          <dt className="text-[0.8125rem] text-ink-muted">{t("cosignRequestCard.to")}</dt>
          <dd className="break-words">
            {recipientName}
            <span className="mt-0.5 block break-all font-mono text-xs tabular-nums text-ink-muted">{formatIban(recipientAccount)}</span>
          </dd>
          {purpose && (
            <>
              <dt className="text-[0.8125rem] text-ink-muted">{t("common.purpose")}</dt>
              <dd className="break-words text-[0.8125rem] text-ink-secondary">{purpose}</dd>
            </>
          )}
        </dl>

        {transaction.riskReasons.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border-default bg-terminal px-3 py-2.5">
            <p className="text-xs text-ink-muted">{t("cosignRequestCard.reasons")}</p>
            <ul className="list-disc space-y-1 pl-4 text-[0.8125rem] leading-5 text-ink-secondary marker:text-ink-muted">
              {transaction.riskReasons.map((reason, index) => (
                <li key={index}>{riskReason(locale, transaction.riskCodes?.[index], reason, corporate)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[0.8125rem] ${expired ? "text-danger-text" : "text-ink-secondary"}`}>
            <Clock3 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {expired ? t("common.expired") : t("cosignRequestCard.remaining")}
            <span role="timer" className={`mono-data ${expired ? "" : "text-gold-text"}`}>{seconds === undefined ? "—" : formatCosignTimer(seconds)}</span>
          </span>
          <HashChip value={transaction.txHashHex} />
        </div>

        <CosignSignatureChain transaction={transaction} />

        <div className="space-y-2">
          <Button
            variant="danger"
            size={compact ? "md" : "lg"}
            className="w-full px-3"
            icon={<ShieldX />}
            loading={busy === "reject"}
            disabled={unavailable}
            onClick={onReject}
          >
            {corporate ? t("cosignRequestCard.reject") : t("cosignRequestCard.scam")}
          </Button>
          <Button
            size={compact ? "md" : "lg"}
            className="w-full px-3"
            icon={<Fingerprint />}
            loading={busy === "sign"}
            disabled={unavailable || !deviceKind}
            onClick={onSign}
          >
            {deviceKind === "SOFTWARE_FALLBACK" ? t("cosignRequestCard.software") : t("cosignRequestCard.passkey")}
          </Button>
          <p className="px-1 pt-1 text-center text-xs text-ink-muted">
            {t("cosignRequestCard.coolingHint")}
          </p>
          {devicePrompt}
        </div>
      </Card>
    </motion.article>
  );
}
