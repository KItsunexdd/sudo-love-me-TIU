"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Clock3, Fingerprint, LockKeyhole, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, HashChip } from "@/components/ui";
import type { DeviceKind, TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { cosignAlertVariants, reducedMotionVariants } from "@/lib/ui/motion";
import { corporateRule, formatCosignTimer, signatureHash, watchCosignDeadline, type ServerClockSample } from "./cosignDetails";

export function CosignSignatureChain({ transaction }: { transaction: TransactionRecord }) {
  const first = signatureHash(transaction.primarySignature);
  const second = signatureHash(transaction.cosignSignature);
  return (
    <ol aria-label="Цепочка подписей 2-of-2" className="space-y-1.5 rounded-xl border border-border-default bg-terminal p-2.5 text-xs sm:text-[13px]">
      <li className="flex flex-wrap items-center gap-1.5">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" />
        <span className="font-medium">Подпись № 1 проверена</span>
        {first && <HashChip value={first} label="Sig1" visible={5} />}
      </li>
      <li className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-1.5">
        {second
          ? <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" />
          : <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-gold" />}
        <span className="font-medium">{second ? "Подпись № 2 проверена" : "Ожидает вторую подпись"}</span>
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
  const reduce = useReducedMotion();
  const [seconds, setSeconds] = useState<number>();
  const expiry = transaction.cosignExpiresAt;
  const expired = seconds === 0;

  useEffect(() => watchCosignDeadline(expiry, clock, setSeconds, onExpire), [expiry, clock, onExpire]);

  const { amountTenge, mode, purpose, recipientAccount, recipientName } = transaction.payload;
  const corporate = mode === "B2B";
  const unavailable = disabled || seconds === undefined || expired;

  return (
    <motion.article
      variants={reduce ? reducedMotionVariants : cosignAlertVariants}
      initial={reduce ? false : "hidden"}
      animate="visible"
      exit="exit"
    >
      <Card
        className={`space-y-2.5 p-3.5 sm:space-y-3 sm:p-4 ${
          corporate
            ? "border-gold/55 shadow-glow-gold"
            : "border-danger/60 shadow-glow-danger"
        }`}
      >
        <div
          className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
            corporate ? "border border-gold/40 bg-gold/15 text-amber-200" : "bg-danger-solid text-white"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex size-full rounded-full bg-current opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2.5 rounded-full bg-current" />
            </span>
            <ShieldAlert className="size-[18px] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold leading-tight">
                {corporate ? "Требуется подпись директора" : "Подозрение на мошенничество"}
              </h3>
              <p className="mt-0.5 text-xs opacity-90">
                {corporate ? corporateRule : <>Риск <span className="font-mono font-bold tabular-nums">{transaction.riskScore}/100</span></>}
              </p>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm">
          <dt className="text-xs text-ink-secondary sm:text-sm">От кого</dt>
          <dd className="break-words font-semibold">{senderName}</dd>
          <dt className="text-xs text-ink-secondary sm:text-sm">Сумма</dt>
          <dd className="break-words font-mono text-2xl font-extrabold leading-tight tracking-tight tabular-nums text-ink-primary sm:text-[1.75rem]">
            {formatTenge(amountTenge)}
          </dd>
          <dt className="text-xs text-ink-secondary sm:text-sm">Кому</dt>
          <dd className="break-words font-semibold">
            {recipientName}
            <span className="mono-data mt-0.5 block break-all text-xs text-ink-secondary">{formatIban(recipientAccount)}</span>
          </dd>
          {purpose && (
            <>
              <dt className="text-xs text-ink-secondary sm:text-sm">Назначение</dt>
              <dd className="break-words text-xs text-ink-secondary sm:text-sm">{purpose}</dd>
            </>
          )}
        </dl>

        {transaction.riskReasons.length > 0 && (
          <div className="space-y-1 rounded-xl border border-border-default bg-terminal/70 px-3 py-2">
            <p className="text-xs font-semibold text-ink-secondary">Причины проверки</p>
            <ul className={`list-disc space-y-0.5 pl-4 text-xs leading-snug sm:text-[13px] ${corporate ? "marker:text-gold" : "marker:text-danger-text"}`}>
              {transaction.riskReasons.map((reason, index) => (
                <li key={index}>{corporate ? reason.replace(" — частый признак мошенников", "") : reason}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium sm:text-sm ${expired ? "text-danger-text" : "text-gold"}`}>
            <Clock3 className="size-4 shrink-0" aria-hidden="true" />
            {expired ? "Время истекло" : "Осталось"}
            <span role="timer" className="mono-data font-bold">{seconds === undefined ? "—" : formatCosignTimer(seconds)}</span>
          </span>
          <HashChip value={transaction.txHashHex} label="txHash" visible={5} />
        </div>

        <CosignSignatureChain transaction={transaction} />

        <div className="space-y-2 pt-0.5">
          <Button
            variant="danger"
            size={compact ? "md" : "lg"}
            className="w-full px-3"
            icon={<ShieldX className="size-5" />}
            loading={busy === "reject"}
            disabled={unavailable}
            onClick={onReject}
          >
            {corporate ? "Отклонить платёж" : "Отклонить — это мошенники!"}
          </Button>
          <Button
            size={compact ? "md" : "lg"}
            className="w-full px-3"
            icon={<Fingerprint className="size-5" />}
            loading={busy === "sign"}
            disabled={unavailable || !deviceKind}
            onClick={onSign}
          >
            {deviceKind === "SOFTWARE_FALLBACK" ? "Подписать (Software Key #2 + ML-DSA)" : "Подписать (Passkey #2 + ML-DSA)"}
          </Button>
          <p className="px-1 text-center text-xs text-ink-muted">
            После отклонения автоматически включится режим охлаждения счёта.
          </p>
          {devicePrompt}
        </div>
      </Card>
    </motion.article>
  );
}
