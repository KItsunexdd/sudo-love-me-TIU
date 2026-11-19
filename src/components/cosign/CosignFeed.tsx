"use client";

import { motion } from "framer-motion";
import { BadgeCheck, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, EmptyState, ErrorCard, Spinner } from "@/components/ui";
import { api, type ApiError } from "@/lib/client/api";
import { signCosign, SignerError, toClientError } from "@/lib/client/signer";
import { useDemoState } from "@/lib/client/useDemoState";
import type { ConnectionStatus } from "@/lib/client/useEventStream";
import { failureMessages, type Mode, type TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { CosignDevicePanel, useCosignDevice } from "./CosignDevicePanel";
import { CosignRequestCard, CosignSignatureChain } from "./CosignRequestCard";
import { corporateRule, selectCosigner, signatureHash } from "./cosignDetails";
import { useCosignFeed } from "./useCosignFeed";

const connectionLabels = {
  connecting: ["neutral", "Подключение SSE"],
  live: ["success", "SSE Live"],
  polling: ["warning", "Резервный опрос"],
  offline: ["danger", "Связь потеряна"],
} as const satisfies Record<ConnectionStatus, readonly [string, string]>;

const almatyTime = new Intl.DateTimeFormat("ru-KZ", {
  timeZone: "Asia/Almaty", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

function formatDecisionTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? almatyTime.format(time) : value;
}

type SuccessfulDecision = {
  transaction: TransactionRecord;
  status: "EXECUTED" | "BLOCKED_BY_COSIGNER";
  savedAmountTenge?: number;
  coolingOffActive?: boolean;
};

function DecisionResult({ decision, coolingOffActive }: { decision: SuccessfulDecision; coolingOffActive: boolean }) {
  const { transaction, status } = decision;
  const blocked = status === "BLOCKED_BY_COSIGNER";
  const corporate = transaction.payload.mode === "B2B";
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
      <Card variant="success" role="status" className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-bcc/10 text-bcc">
            {blocked ? <ShieldX aria-hidden="true" className="size-6" /> : <BadgeCheck aria-hidden="true" className="size-6" />}
          </span>
          <div className="min-w-0">
            <h2 className="type-h2 break-words">
              {blocked ? corporate ? "Платёж отклонён" :
                `Спасено ${formatTenge(decision.savedAmountTenge ?? transaction.payload.amountTenge)}` : "Операция подписана 2-of-2"}
            </h2>
            <p className="mt-1 break-words text-sm text-ink-secondary">
              {transaction.payload.recipientName} · {formatTenge(transaction.payload.amountTenge)}
            </p>
          </div>
        </div>
        {blocked ? (
          <div className="flex flex-wrap items-center gap-2">
            {transaction.status === status && <time className="mono-data text-ink-secondary" dateTime={transaction.updatedAt}>
              {formatDecisionTime(transaction.updatedAt)}
            </time>}
            {coolingOffActive && <Badge tone="warning">Режим охлаждения активен</Badge>}
          </div>
        ) : <CosignSignatureChain transaction={transaction} />}
      </Card>
    </motion.div>
  );
}

function DecisionHistory({ transactions }: { transactions: TransactionRecord[] }) {
  return (
    <section className="space-y-2">
      <h2 className="type-h2">История решений</h2>
      {transactions.length === 0 ? <p className="text-sm text-ink-secondary">Решений пока нет.</p> : (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface px-3">
          {transactions.map(tx => (
            <li key={tx.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{tx.payload.recipientName}</p>
                <p className="mono-data text-ink-secondary">{formatTenge(tx.payload.amountTenge)} · <time dateTime={tx.updatedAt}>{formatDecisionTime(tx.updatedAt)}</time></p>
              </div>
              {tx.status === "BLOCKED_BY_COSIGNER"
                ? <Badge tone="danger">{tx.payload.mode === "B2B" ? "Платёж отклонён" : "Перевод остановлен"}</Badge>
                : <Badge status={tx.status} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CosignFeed({ userId, mode, compact = false, profileSwitch }: {
  userId: string; mode: Mode; compact?: boolean; profileSwitch?: ReactNode;
}) {
  const feed = useCosignFeed(userId, mode);
  const { users } = useDemoState();
  const deviceState = useCosignDevice(userId, feed.syncVersion, feed.resyncVersion, feed.resetId);
  const device = deviceState.devices[0];
  const [action, setAction] = useState<{ txId: string; kind: "sign" | "reject" }>();
  const actionGuard = useRef(false);
  const [actionError, setActionError] = useState<{ error: ApiError; resetId?: number }>();
  const [localDecision, setLocalDecision] = useState<(SuccessfulDecision & { resetId?: number })>();
  const recentActionError = actionError?.resetId === feed.resetId ? actionError?.error : undefined;
  const decision = localDecision?.resetId === feed.resetId ? localDecision : undefined;

  async function decide(transaction: TransactionRecord, kind: "sign" | "reject") {
    if (actionGuard.current) return;
    actionGuard.current = true;
    setAction({ txId: transaction.id, kind });
    setActionError(undefined);
    const resetId = feed.resetId;

    try {
      const identity = { txId: transaction.id, cosignerUserId: userId };
      if (kind === "reject") {
        const result = await api.cosignReject({ ...identity, activateCoolingOff: true });
        if (!result.ok) throw new SignerError(result.error);
        setLocalDecision({
          transaction, status: "BLOCKED_BY_COSIGNER", resetId,
          savedAmountTenge: result.data.savedAmountTenge, coolingOffActive: result.data.coolingOffActive,
        });
      } else {
        const prepared = await api.cosignPrepare(identity);
        if (!prepared.ok) throw new SignerError(prepared.error);
        if (prepared.data.transaction.id !== transaction.id || prepared.data.transaction.cosignerUserId !== userId ||
            prepared.data.txHashHex !== transaction.txHashHex ||
            prepared.data.primarySignatureHashHex !== signatureHash(transaction.primarySignature)) {
          throw new SignerError({
            status: "ERROR", failureCode: "ERR_WYSIWYS_TAMPERED",
            message: "Реквизиты или первая подпись изменились после открытия запроса.",
          });
        }
        const allowed = deviceState.devices.find(item => prepared.data.webAuthnOptions.allowCredentials?.some(key => key.id === item.credentialId));
        if (!allowed) {
          deviceState.retry();
          throw new SignerError({
            status: "ERROR", failureCode: "ERR_DEVICE_NOT_REGISTERED",
            message: "Привяжите ключ доверенного лица на этом устройстве.",
          });
        }
        const signature = await signCosign(prepared.data, allowed.id);
        const submitted = await api.cosignSubmit({
          txId: transaction.id, deviceId: allowed.id, submittedPayload: transaction.payload,
          webAuthnAssertion: signature.webAuthnAssertion, pqSignatureBase64: signature.pqSignatureBase64,
        });
        if (!submitted.ok) throw new SignerError(submitted.error);
        setLocalDecision({ transaction: submitted.data.transaction, status: "EXECUTED", resetId });
      }
    } catch (cause) {
      const error = toClientError(cause);
      if (error.failureCode === "ERR_DEVICE_NOT_FOUND") deviceState.retry();
      setActionError({ error, resetId });
    } finally {
      actionGuard.current = false;
      setAction(undefined);
      feed.refresh();
    }
  }

  const pending = feed.pending.filter(tx => tx.id !== decision?.transaction.id);
  const localRecord = feed.history.find(tx => tx.id === decision?.transaction.id);
  const latest = feed.history[0];
  const outcome = decision && !localRecord
    ? decision
    : latest?.status === "EXECUTED" || latest?.status === "BLOCKED_BY_COSIGNER"
      ? { transaction: latest, status: latest.status, ...(latest.id === decision?.transaction.id && {
        savedAmountTenge: decision.savedAmountTenge, coolingOffActive: decision.coolingOffActive,
      }) } satisfies SuccessfulDecision
      : undefined;
  const currentCoolingOff = users.find(user => user.id === outcome?.transaction.payload.senderId)?.coolingOffUntil;
  const coolingOffActive = currentCoolingOff ? Date.parse(currentCoolingOff) > Date.now() : Boolean(outcome?.coolingOffActive);
  const showOutcome = outcome && (pending.length === 0 || outcome.transaction.id === decision?.transaction.id);
  const [connectionTone, connectionLabel] = connectionLabels[feed.status];
  const corporate = mode === "B2B";
  const profile = users.find(user => user.id === userId);
  const profileName = profile?.fullName ?? (userId === selectCosigner(mode)
    ? corporate ? "Тимур Бекмуратов" : "Арман Сатыбалдиев"
    : userId);
  const initials = profileName.split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  const devicePrompt = deviceState.error
    ? <ErrorCard error={deviceState.error} action={<Button size="sm" variant="secondary" onClick={deviceState.retry}>Проверить устройство</Button>} />
    : deviceState.loading
      ? <p role="status" className="flex items-center gap-2 px-1 text-sm text-ink-secondary"><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />Проверяем ключи</p>
      : device ? null : <CosignDevicePanel userId={userId} />;

  function senderName(transaction: TransactionRecord) {
    const { senderId, senderAccount } = transaction.payload;
    return users.find(user => user.id === senderId)?.fullName ?? formatIban(senderAccount);
  }

  return (
    <div className={`min-w-0 space-y-4 ${compact ? "p-3" : ""}`}>
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-xl border font-semibold ${corporate ? "border-gold/40 bg-gold/10 text-gold" : "border-bcc/40 bg-bcc/10 text-bcc"}`}>
            {initials}
          </span>
          <div className="min-w-0">
            {compact ? <h2 className="type-h3">Вторая рука</h2> : <h1 className="type-h1">Вторая рука</h1>}
            <p className="mt-0.5 break-words text-sm text-ink-secondary">{profileName} · {corporate ? "Директор" : "Доверенное лицо"}</p>
          </div>
        </div>
        {profileSwitch}
        <div className="flex flex-wrap items-center gap-2">
          <span role="status">
            <Badge tone={connectionTone}>
              <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${feed.status === "live" ? "motion-safe:animate-pulse" : ""}`} />
              {connectionLabel}
            </Badge>
          </span>
          {device && <Badge status={device.deviceKind}>{device.deviceKind === "PLATFORM_PASSKEY" ? "Passkey #2" : "Software Key #2"}</Badge>}
        </div>
      </header>

      {feed.error && <ErrorCard error={feed.error}
        action={<Button variant="secondary" size="sm" onClick={feed.refresh}>Обновить запросы</Button>} />}
      {recentActionError && <ErrorCard error={recentActionError} />}

      {feed.loading ? <div className="flex justify-center py-8"><Spinner label="Загрузка запросов" /></div> : (
        <>
          {showOutcome && <DecisionResult key={outcome.transaction.id} decision={outcome} coolingOffActive={coolingOffActive} />}
          {pending.length > 0 ? (
            <section className="space-y-3" aria-label="Входящие запросы">
              {pending.map((tx, index) => (
                <CosignRequestCard key={tx.id} transaction={tx} senderName={senderName(tx)} deviceKind={device?.deviceKind}
                  busy={action?.txId === tx.id ? action.kind : null} disabled={Boolean(action)}
                  onReject={() => void decide(tx, "reject")} onSign={() => void decide(tx, "sign")}
                  onExpire={feed.refresh} devicePrompt={index === 0 ? devicePrompt : undefined} />
              ))}
            </section>
          ) : (
            <>
              {!outcome && !recentActionError && latest?.failureCode && <ErrorCard error={{
                status: latest.status, failureCode: latest.failureCode, message: failureMessages[latest.failureCode],
              }} />}
              {!feed.error && !outcome && !latest?.failureCode && (
                <EmptyState icon={ShieldCheck} title={corporate ? "Нет платежей на подпись" : "Всё спокойно"}
                  description={corporate ? corporateRule : "Здесь появятся операции, которым нужна ваша подпись."}
                  action={compact ? undefined : <Link className="rounded text-sm font-semibold text-bcc hover:underline" href={`/?mode=${mode}`}>Открыть демо-стенд</Link>} />
              )}
              {devicePrompt}
            </>
          )}
          {!compact && <DecisionHistory transactions={feed.history} />}
        </>
      )}
    </div>
  );
}
