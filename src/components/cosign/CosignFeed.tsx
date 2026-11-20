"use client";

import { russian, type Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, EmptyState, ErrorCard, Skeleton } from "@/components/ui";
import { api, type ApiError } from "@/lib/client/api";
import { signCosign, SignerError, toClientError } from "@/lib/client/signer";
import { useDemoState } from "@/lib/client/useDemoState";
import type { ConnectionStatus } from "@/lib/client/useEventStream";
import { failureMessages, type Mode, type TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { TWEEN_ENTER } from "@/lib/ui/motion";
import { CosignDevicePanel, useCosignDevice } from "./CosignDevicePanel";
import { CosignRequestCard, CosignSignatureChain } from "./CosignRequestCard";
import { selectCosigner, signatureHash } from "./cosignDetails";
import { useCosignFeed } from "./useCosignFeed";

const getConnectionLabels = (t: Translate) => ({
  connecting: ["neutral", t("cosignFeed.connecting")],
  live: ["success", "SSE Live"],
  polling: ["warning", t("cosignFeed.polling")],
  offline: ["danger", t("cosignFeed.offline")],
} as const satisfies Record<ConnectionStatus, readonly [string, string]>);

const decisionTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Almaty", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
};

function formatDecisionTime(value: string, region: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat(region, decisionTimeOptions).format(time) : value;
}

type SuccessfulDecision = {
  transaction: TransactionRecord;
  status: "EXECUTED" | "BLOCKED_BY_COSIGNER";
  savedAmountTenge?: number;
  coolingOffActive?: boolean;
};

function DecisionResult({ decision, coolingOffActive }: { decision: SuccessfulDecision; coolingOffActive: boolean }) {
  const { t, region } = useT();
  const reduce = useReducedMotion();
  const { transaction, status } = decision;
  const blocked = status === "BLOCKED_BY_COSIGNER";
  const corporate = transaction.payload.mode === "B2B";
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : TWEEN_ENTER}
    >
      <Card variant="success" role="status" className="space-y-4">
        <div className="flex items-start gap-3">
          {blocked
            ? <ShieldX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-bcc" strokeWidth={1.75} />
            : <BadgeCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-bcc" strokeWidth={1.75} />}
          <div className="min-w-0">
            <h2 className="type-h2 break-words tabular-nums">
              {blocked ? corporate ? t("cosignFeed.rejected") :
                t("cosignFeed.saved", { value: formatTenge(decision.savedAmountTenge ?? transaction.payload.amountTenge) }) : t("cosignFeed.signed")}
            </h2>
            <p className="mt-1 break-words text-sm tabular-nums text-ink-secondary">
              {transaction.payload.recipientName} · <span className="font-mono">{formatTenge(transaction.payload.amountTenge)}</span>
            </p>
          </div>
        </div>
        {blocked ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {transaction.status === status && <time className="mono-data text-ink-muted" dateTime={transaction.updatedAt}>
              {formatDecisionTime(transaction.updatedAt, region)}
            </time>}
            {coolingOffActive && <Badge tone="warning">{t("cosignFeed.cooling")}</Badge>}
          </div>
        ) : <CosignSignatureChain transaction={transaction} />}
      </Card>
    </motion.div>
  );
}

function DecisionHistory({ transactions }: { transactions: TransactionRecord[] }) {
  const { t, region } = useT();
  return (
    <section className="space-y-3">
      <h2 className="type-h3 text-ink-secondary">{t("cosignFeed.history")}</h2>
      {transactions.length === 0 ? <p className="text-sm text-ink-muted">{t("cosignFeed.emptyHistory")}</p> : (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface px-4">
          {transactions.map(tx => (
            <li key={tx.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm text-ink-primary">{tx.payload.recipientName}</p>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">{formatTenge(tx.payload.amountTenge)} · <time dateTime={tx.updatedAt}>{formatDecisionTime(tx.updatedAt, region)}</time></p>
              </div>
              {tx.status === "BLOCKED_BY_COSIGNER"
                ? <Badge tone="danger">{tx.payload.mode === "B2B" ? t("cosignFeed.rejected") : t("cosignFeed.stopped")}</Badge>
                : <Badge status={tx.status} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedSkeleton() {
  const { t } = useT();
  return (
    <Card aria-busy="true" aria-label={t("cosignFeed.loading")} className="space-y-3">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </Card>
  );
}

export function CosignFeed({ userId, mode, compact = false, hideConnectionBadge = false, profileSwitch }: {
  userId: string; mode: Mode; compact?: boolean; hideConnectionBadge?: boolean; profileSwitch?: ReactNode;
}) {
  const { locale, t } = useT();
  const connectionLabels = getConnectionLabels(t);
  const feed = useCosignFeed(userId, mode);
  const { users } = useDemoState(userId);
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
            message: russian("cosignFeed.changed"),
          });
        }
        const allowed = deviceState.devices.find(item => prepared.data.webAuthnOptions.allowCredentials?.some(key => key.id === item.credentialId));
        if (!allowed) {
          deviceState.retry();
          throw new SignerError({
            status: "ERROR", failureCode: "ERR_DEVICE_NOT_REGISTERED",
            message: russian("cosignFeed.bind"),
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
  const clock = feed.clock;
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
    ? <ErrorCard error={deviceState.error} action={<Button size="sm" variant="secondary" onClick={deviceState.retry}>{t("cosignFeed.checkDevice")}</Button>} />
    : deviceState.loading
      ? <p role="status" className="flex items-center gap-2 px-1 text-sm text-ink-secondary"><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />{t("cosignFeed.keys")}</p>
      : device ? null : <CosignDevicePanel userId={userId} />;

  function senderName(transaction: TransactionRecord) {
    const { senderId, senderAccount } = transaction.payload;
    return users.find(user => user.id === senderId)?.fullName ?? formatIban(senderAccount);
  }

  return (
    <div className={`min-w-0 ${compact ? "space-y-3 p-3" : "space-y-4"}`}>
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border border-border-default bg-elevated text-[0.8125rem] font-medium text-ink-secondary">
              {initials}
            </span>
            <div className="min-w-0">
              {compact ? (
                <h2 className="truncate text-sm font-medium leading-5">{profileName}</h2>
              ) : (
                <h1 className="truncate text-base font-medium leading-6 sm:text-lg">{profileName}</h1>
              )}
              <p className="truncate text-xs text-ink-muted">
                {t("cosignFeed.role")} {corporate ? t("common.director") : t("common.trusted")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {device && (
              <Badge status={device.deviceKind}>
                {device.deviceKind === "PLATFORM_PASSKEY" ? "Passkey #2" : "Software #2"}
              </Badge>
            )}
            {!hideConnectionBadge && (
              <span role="status">
                <Badge tone={connectionTone} className="font-mono font-normal">{connectionLabel}</Badge>
              </span>
            )}
          </div>
        </div>

        {profileSwitch}
      </header>

      {feed.error && (
        <ErrorCard
          error={feed.error}
          action={<Button variant="secondary" size="sm" onClick={feed.refresh}>{t("cosignFeed.refresh")}</Button>}
        />
      )}
      {recentActionError && <ErrorCard error={recentActionError} />}

      {feed.loading ? (
        <FeedSkeleton />
      ) : (
        <>
          {showOutcome && <DecisionResult key={outcome.transaction.id} decision={outcome} coolingOffActive={coolingOffActive} />}
          {pending.length > 0 && clock ? (
            <section className="space-y-3" aria-label={t("cosignFeed.incoming")}>
              <AnimatePresence initial={false}>
                {pending.map((tx, index) => (
                  <CosignRequestCard
                    key={tx.id}
                    transaction={tx}
                    clock={clock}
                    senderName={senderName(tx)}
                    deviceKind={device?.deviceKind}
                    compact={compact}
                    busy={action?.txId === tx.id ? action.kind : null}
                    disabled={Boolean(action)}
                    onReject={() => void decide(tx, "reject")}
                    onSign={() => void decide(tx, "sign")}
                    onExpire={feed.refresh}
                    devicePrompt={index === 0 ? devicePrompt : undefined}
                  />
                ))}
              </AnimatePresence>
            </section>
          ) : (
            <>
              {!outcome && !recentActionError && latest?.failureCode && latest.failureCode !== "ERR_TX_EXPIRED" && (
                <ErrorCard error={{
                  status: latest.status,
                  failureCode: latest.failureCode,
                  message: failureMessages[latest.failureCode],
                }} />
              )}
              {!feed.error && !outcome && (!latest?.failureCode || latest.failureCode === "ERR_TX_EXPIRED") && (
                <EmptyState
                  icon={ShieldCheck}
                  headingLevel={compact ? 3 : 2}
                  className={compact ? "p-4" : "p-5"}
                  title={corporate ? t("cosignFeed.noPayments") : t("common.allClear")}
                  description={corporate ? t("cosignDetails.corporate") : t("cosignFeed.confirmHint")}
                  action={compact ? undefined : (
                    <Link className="rounded-lg text-sm font-medium text-bcc underline-offset-4 hover:underline" href={`/?mode=${mode}&lang=${locale}`}>
                      {t("cosignFeed.openDemo")}
                    </Link>
                  )}
                />
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
