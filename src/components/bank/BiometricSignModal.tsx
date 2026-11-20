"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useReducedMotion } from "framer-motion";
import { Check, ChevronRight, Fingerprint, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorCard, HashChip, JsonDiffViewer, Modal } from "@/components/ui";
import { api, type ApiError, type ApiResult, type ExecuteResponse, type PrepareResponse } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { signPrimary, toClientError, type HybridSignature } from "@/lib/client/signer";
import { buildExecuteBody, MITM_AMOUNT_TENGE, rememberValidPacket, useAttackState } from "@/components/hacker/attacks";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";

type SignStage = "review" | "webauthn" | "mldsa" | "sending";

function SignStep({
  index,
  label,
  subtitle,
  state,
  timing,
}: {
  index: number;
  label: string;
  subtitle: string;
  state: "idle" | "signing" | "signed";
  timing?: number;
}) {
  const { t } = useT();
  const statusText =
    state === "signed" && timing !== undefined
      ? t("biometricSignModal.signed", { value: formatMs(timing) })
      : state === "signing"
        ? index === 2
          ? t("biometricSignModal.generating")
          : t("biometricSignModal.confirmDevice")
        : t("biometricSignModal.ready");

  return (
    <li className={`flex items-start gap-3 px-4 py-3 transition-colors ${state === "signing" ? "bg-elevated" : ""}`}>
      <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center">
        {state === "signed" ? <Check className="size-4 text-bcc" strokeWidth={2} />
          : state === "signing" ? <LoaderCircle className="size-4 text-ink-secondary motion-safe:animate-spin" strokeWidth={1.75} />
            : <span className="font-mono text-xs text-ink-muted">{index}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink-primary">{label}</span>
        <span className="block text-xs text-ink-muted">{subtitle}</span>
      </span>
      <span className={`shrink-0 pt-0.5 font-mono text-xs tabular-nums ${state === "signed" ? "text-ink-secondary" : "text-ink-muted"}`}>{statusText}</span>
    </li>
  );
}

export function BiometricSignModal({ prepared, device, onClose, onComplete, onFallback, onRenew }: {
  prepared: PrepareResponse; device: LocalDevice; onClose: () => void;
  onComplete: (result: ApiResult<ExecuteResponse>) => void; onFallback: () => void; onRenew: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<SignStage>("review");
  const [error, setError] = useState<ApiError>();
  const [timings, setTimings] = useState<HybridSignature["timings"]>();
  const [ack, setAck] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [mitmIntercepted, setMitmIntercepted] = useState(false);
  const active = useRef(false);
  const submitting = useRef(false);
  const { payload, txHashHex, risk } = prepared;
  const remaining = Math.max(0, Math.ceil((Date.parse(payload.expiresAt) - now) / 1000));
  const software = device.deviceKind === "SOFTWARE_FALLBACK";
  const reduceMotion = useReducedMotion();
  const { armed } = useAttackState();

  useEffect(() => {
    active.current = true;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(ticker); active.current = false; };
  }, []);

  async function sign() {
    if (submitting.current || !remaining || (risk.requiresAcknowledgement && !ack)) return;
    submitting.current = true;
    setBusy(true);
    setStage("webauthn");
    setError(undefined);
    setMitmIntercepted(false);
    try {
      const signed = await signPrimary(prepared, device.id);
      if (!active.current) return;
      setTimings(signed.timings);

      const wasArmed = Boolean(armed);
      // The client always signs the payload it displayed. An armed MITM interceptor rewrites the
      // submitted copy afterwards, exactly as malware on the wire would; the server must reject it.
      const body = buildExecuteBody({
        txId: prepared.txId,
        deviceId: device.id,
        submittedPayload: payload,
        webAuthnAssertion: signed.webAuthnAssertion,
        pqSignatureBase64: signed.pqSignatureBase64,
        clientTimings: signed.timings,
        acknowledgedWarning: ack,
      });
      const execution = api.execute(body);

      if (!reduceMotion) {
        setStage("mldsa");
        await new Promise(resolve => setTimeout(resolve, 210));
        if (!active.current) return;
        setStage("sending");
        if (wasArmed) setMitmIntercepted(true);
        await new Promise(resolve => setTimeout(resolve, wasArmed ? 280 : 140));
      } else {
        setStage("sending");
      }

      const result = await execution;
      if (result.ok) rememberValidPacket(body, result.data.status);
      if (active.current) onComplete(result);
    } catch (cause) {
      if (active.current) {
        setStage("review");
        setError(toClientError(cause));
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  const fields = [
    { label: t("biometricSignModal.operation"), value: { ONLINE_LOAN: t("common.loan"), DEPOSIT_CLOSE: t("biometricSignModal.closeDeposit"), P2P_TRANSFER: t("common.transfer"), B2B_INVOICE: t("common.invoice") }[payload.operationType], mono: false },
    { label: t("common.recipient"), value: payload.recipientName, mono: false },
    { label: t("biometricSignModal.account"), value: formatIban(payload.recipientAccount), mono: true },
    { label: t("common.purpose"), value: payload.purpose || t("biometricSignModal.noPurpose"), mono: false },
  ];

  const lock1State = stage === "mldsa" || stage === "sending" ? "signed" : stage === "webauthn" ? "signing" : "idle";
  const lock2State = stage === "sending" ? "signed" : stage === "mldsa" ? "signing" : "idle";

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      wide
      title={t("biometricSignModal.confirm")}
      description={t("biometricSignModal.confirmHint")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono-data text-ink-muted">
            {remaining ? t("biometricSignModal.remaining", { value: Math.floor(remaining / 60), value2: String(remaining % 60).padStart(2, "0") }) : t("common.expired")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
            {!remaining ? <Button onClick={onRenew} disabled={busy}>{t("biometricSignModal.renew")}</Button> : <Button
              disabled={risk.requiresAcknowledgement && !ack}
              loading={busy}
              icon={<Fingerprint />}
              onClick={() => void sign()}
            >
              {software ? t("biometricSignModal.confirmSoftware") : t("biometricSignModal.confirmPasskey")}
            </Button>}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-border-default bg-terminal">
          <div className="px-5 pb-5 pt-4">
            <p className="text-[0.8125rem] text-ink-secondary">{t("biometricSignModal.debit")}</p>
            <p className="mt-2 font-mono text-[2.5rem] font-medium leading-none tracking-[-0.02em] tabular-nums text-ink-primary">
              {formatTenge(payload.amountTenge)}
            </p>
          </div>
          <dl className="grid gap-x-4 gap-y-2 border-t border-dashed border-border-strong px-5 py-4 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            {fields.map(({ label, value, mono }) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className={`break-words [overflow-wrap:anywhere] ${mono ? "font-mono tabular-nums" : ""}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-dashed border-border-strong px-5 py-3">
            <HashChip value={txHashHex} label={t("biometricSignModal.checksum")} />
          </div>
        </section>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-[0.8125rem] text-ink-secondary transition-colors hover:text-ink-primary [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" strokeWidth={1.75} />
            {t("biometricSignModal.fields")}
          </summary>
          <JsonDiffViewer json={prepared.canonicalJson} className="mt-3" />
        </details>

        <ol className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default">
          <SignStep
            index={1}
            label={software ? t("biometricSignModal.lockSoftware") : t("biometricSignModal.lockPasskey")}
            subtitle={t("biometricSignModal.bound", { rpId: payload.rpId })}
            state={lock1State}
            timing={timings?.webauthnMs}
          />
          <SignStep
            index={2}
            label={t("biometricSignModal.lockPq")}
            subtitle={t("biometricSignModal.pqSize")}
            state={lock2State}
            timing={timings?.pqSignMs}
          />
        </ol>

        {mitmIntercepted ? (
          <p role="alert" className="rounded-lg border border-danger/45 bg-danger/[.08] px-4 py-3 text-sm text-danger-text">
            {t("biometricSignModal.intercepted")}
          </p>
        ) : stage === "sending" && (
          <p role="status" className="text-sm text-ink-secondary">
            {t("biometricSignModal.submitted")}
          </p>
        )}

        {risk.requiresAcknowledgement && (
          <Card variant="warning">
            <h3 className="mb-3 type-h3">{t("biometricSignModal.warning")}</h3>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                className="mt-1 size-4 shrink-0 accent-gold"
                onChange={event => setAck(event.target.checked)}
              />
              <span>{t("biometricSignModal.ack")}</span>
            </label>
          </Card>
        )}

        {armed && !mitmIntercepted && (
          <Card variant="danger" role="alert">
            <p className="text-sm text-danger-text">
              {t("biometricSignModal.armed")}
              {armed === "MITM_AMOUNT" ? t("biometricSignModal.amount", { value: formatTenge(MITM_AMOUNT_TENGE) }) : t("biometricSignModal.dropper")}).
            </p>
          </Card>
        )}

        {risk.requiresCoSign && (
          <p className="text-sm text-gold-text">
            {t("biometricSignModal.secondSignature")}
          </p>
        )}

        {error && (
          <ErrorCard
            error={error}
            action={!software && <Button size="sm" variant="secondary" onClick={onFallback}>{t("biometricSignModal.useSoftware")}</Button>}
          />
        )}
      </div>
    </Modal>
  );
}
