"use client";

import { motion } from "framer-motion";
import { Clock3, Fingerprint, LockKeyhole, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, HashChip } from "@/components/ui";
import type { DeviceKind, TransactionRecord } from "@/lib/db/types";
import { formatTenge } from "@/lib/ui/format";
import { cosignAlertVariants } from "@/lib/ui/motion";
import { corporateRule, formatCosignTimer, remainingSeconds, signatureHash } from "./cosignDetails";

export function CosignSignatureChain({ transaction }: { transaction: TransactionRecord }) {
  const first = signatureHash(transaction.primarySignature);
  const second = signatureHash(transaction.cosignSignature);
  return (
    <ol aria-label="Цепочка подписей 2-of-2" className="space-y-2 rounded-xl border border-border-default bg-terminal p-3 text-sm">
      <li className="flex flex-wrap items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" />
        <span>Первая подпись проверена</span>
        {first && <HashChip value={first} label="SHA-256 подписи № 1" visible={6} />}
      </li>
      <li className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
        {second
          ? <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-bcc" />
          : <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-gold" />}
        <span>{second ? "Вторая подпись проверена" : "Ожидает вторую подпись"}</span>
        {second && <HashChip value={second} label="SHA-256 подписи № 2" tone="info" visible={6} />}
      </li>
    </ol>
  );
}

interface RequestProps {
  transaction: TransactionRecord;
  senderName: string;
  deviceKind?: DeviceKind;
  busy: "reject" | "sign" | null;
  disabled: boolean;
  onReject: () => void;
  onSign: () => void;
  onExpire: () => void;
  devicePrompt?: ReactNode;
}

export function CosignRequestCard({ transaction, senderName, deviceKind, busy, disabled, onReject, onSign, onExpire, devicePrompt }: RequestProps) {
  const [now, setNow] = useState<number>();
  const expiry = transaction.cosignExpiresAt;
  const seconds = now === undefined ? undefined : remainingSeconds(expiry, now);
  const expired = seconds === 0;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (expired) onExpire(); }, [expired, onExpire]);

  const { amountTenge, mode, purpose, recipientAccount, recipientName } = transaction.payload;
  const corporate = mode === "B2B";
  const unavailable = disabled || seconds === undefined || expired;

  return (
    <motion.article variants={cosignAlertVariants} initial="hidden" animate="visible">
      <Card className="space-y-4">
        <div className={`flex items-start gap-2.5 rounded-xl px-3 py-3 ${corporate ? "bg-gold/15 text-amber-200" : "bg-danger-solid text-white"}`}>
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="type-h3">{corporate ? "Требуется подпись директора" : "Подозрение на мошенничество"}</h3>
            <p className="mt-1 text-xs">{corporate ? corporateRule : `Риск ${transaction.riskScore}/100`}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-ink-secondary">От кого</dt>
          <dd className="break-words font-semibold">{senderName}</dd>
          <dt className="text-ink-secondary">Сумма</dt>
          <dd className="break-words font-mono text-[clamp(1.25rem,6vw,2rem)] font-extrabold leading-tight tracking-tight tabular-nums">{formatTenge(amountTenge)}</dd>
          <dt className="text-ink-secondary">Кому</dt>
          <dd className="break-words font-semibold">
            {recipientName}
            <span className="mono-data mt-0.5 block break-all text-ink-secondary">{recipientAccount}</span>
          </dd>
          {purpose && <><dt className="text-ink-secondary">Назначение</dt><dd className="break-words">{purpose}</dd></>}
        </dl>
        {transaction.riskReasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="type-label text-ink-secondary">Причины дополнительной проверки</p>
            <ul className={`list-disc space-y-1 pl-5 text-sm ${corporate ? "marker:text-gold" : "marker:text-danger-text"}`}>
              {transaction.riskReasons.map((reason, index) => (
                <li key={index}>{corporate ? reason.replace(" — частый признак мошенников", "") : reason}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-sm ${expired ? "text-danger-text" : "text-gold"}`}>
            <Clock3 className="size-4" aria-hidden="true" />
            {expired ? "Время истекло" : "Осталось"}
            <span role="timer" className="mono-data">{seconds === undefined ? "—" : formatCosignTimer(seconds)}</span>
          </span>
          <HashChip value={transaction.txHashHex} label="txHash" visible={6} />
        </div>
        <CosignSignatureChain transaction={transaction} />
        <div className="space-y-2">
          <Button variant="danger" size="xl" className="w-full px-3" icon={<ShieldX className="size-5" />}
            loading={busy === "reject"} disabled={unavailable} onClick={onReject}>
            {corporate ? "Отклонить платёж" : "Отклонить — это мошенники!"}
          </Button>
          <p className="px-1 text-xs text-ink-secondary">После отклонения включится режим охлаждения счёта.</p>
          <Button size="xl" className="w-full px-3" icon={<Fingerprint className="size-5" />}
            loading={busy === "sign"} disabled={unavailable || !deviceKind} onClick={onSign}>
            {deviceKind === "SOFTWARE_FALLBACK" ? "Подписать (Software Key #2 + ML-DSA #2)" : "Подписать (Passkey #2 + ML-DSA #2)"}
          </Button>
          {devicePrompt}
        </div>
      </Card>
    </motion.article>
  );
}
