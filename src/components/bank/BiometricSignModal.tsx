"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { Atom, CheckCircle2, Fingerprint, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorCard, HashChip, JsonDiffViewer, Modal } from "@/components/ui";
import { api, type ApiError, type ApiResult, type ExecuteResponse, type PrepareResponse } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { signPrimary, toClientError, type HybridSignature } from "@/lib/client/signer";
import { buildExecuteBody, MITM_AMOUNT_TENGE, rememberValidPacket, useAttackState } from "@/components/hacker/attacks";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";
import { lockSnapVariants, reducedMotionVariants } from "@/lib/ui/motion";

type SignStage = "review" | "webauthn" | "mldsa" | "sending";

function LockTile({
  label,
  subtitle,
  state,
  timing,
  quantum = false,
}: {
  label: string;
  subtitle: string;
  state: "idle" | "signing" | "signed";
  timing?: number;
  quantum?: boolean;
}) {
  const { t } = useT();
  const reduce = useReducedMotion();
  const Icon = state === "signed" ? LockKeyhole : quantum ? Atom : LockKeyholeOpen;
  const toneClass = quantum
    ? state === "signed"
      ? "border-quantum/60 bg-quantum/[.12] text-quantum shadow-glow-quantum"
      : state === "signing"
        ? "border-quantum/55 bg-quantum/[.08] text-quantum"
        : "border-border-default bg-terminal text-quantum"
    : state === "signed"
      ? "border-bcc/60 bg-bcc/[.12] text-bcc shadow-glow-bcc"
      : state === "signing"
        ? "border-bcc/55 bg-bcc/[.08] text-bcc shadow-glow-bcc"
        : "border-border-default bg-terminal text-bcc";

  const statusText =
    state === "signed" && timing !== undefined
      ? t("biometricSignModal.signed", { value: formatMs(timing) })
      : state === "signing"
        ? quantum
          ? t("biometricSignModal.generating")
          : t("biometricSignModal.confirmDevice")
        : t("biometricSignModal.ready");

  return (
    <div className={`relative overflow-hidden rounded-xl border p-3.5 transition-colors duration-200 ${toneClass}`}>
      {quantum && state === "signing" && !reduce && (
        <motion.span
          aria-hidden="true"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 0.45, repeat: Infinity, ease: "linear" }}
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgba(56,189,248,0.28),transparent)]"
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <motion.div
          variants={reduce ? reducedMotionVariants : lockSnapVariants}
          animate={state}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-current/30 bg-black/25"
        >
          <Icon aria-hidden="true" size={20} />
        </motion.div>
        {state === "signed" && <CheckCircle2 aria-hidden="true" size={18} className="shrink-0" />}
      </div>
      <h3 className="relative mt-2.5 text-sm font-semibold text-ink-primary">{label}</h3>
      <p className="relative text-xs text-ink-muted">{subtitle}</p>
      <p className="relative mt-1.5 font-mono text-xs font-semibold tabular-nums text-ink-secondary">{statusText}</p>
    </div>
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
          <span className="mono-data text-ink-secondary">
            {remaining ? t("biometricSignModal.remaining", { value: Math.floor(remaining / 60), value2: String(remaining % 60).padStart(2, "0") }) : t("common.expired")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
            {!remaining ? <Button onClick={onRenew} disabled={busy}>{t("biometricSignModal.renew")}</Button> : <Button
              disabled={risk.requiresAcknowledgement && !ack}
              loading={busy}
              icon={<Fingerprint size={18} />}
              onClick={() => void sign()}
            >
              {software ? t("biometricSignModal.confirmSoftware") : t("biometricSignModal.confirmPasskey")}
            </Button>}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Card className="space-y-3">
          <dl className="grid gap-2 text-sm">
            {fields.map(({ label, value, mono }) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[8.5rem_1fr]">
                <dt className="text-ink-muted">{label}</dt>
                <dd className={`break-words font-semibold [overflow-wrap:anywhere] ${mono ? "font-mono tabular-nums text-ink-primary" : ""}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border-default pt-3">
            <p className="type-label text-ink-muted">{t("biometricSignModal.debit")}</p>
            <p className="font-mono text-[2rem] font-extrabold leading-tight tracking-tight tabular-nums text-ink-primary">
              {formatTenge(payload.amountTenge)}
            </p>
          </div>
          <HashChip value={txHashHex} label={t("biometricSignModal.checksum")} />
          <details>
            <summary className="cursor-pointer rounded text-sm font-medium text-ink-secondary hover:text-ink-primary">
              {t("biometricSignModal.fields")}
            </summary>
            <JsonDiffViewer json={prepared.canonicalJson} className="mt-2" />
          </details>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LockTile
            label={software ? t("biometricSignModal.lockSoftware") : t("biometricSignModal.lockPasskey")}
            subtitle={t("biometricSignModal.bound", { rpId: payload.rpId })}
            state={lock1State}
            timing={timings?.webauthnMs}
          />
          <LockTile
            quantum
            label={t("biometricSignModal.lockPq")}
            subtitle={t("biometricSignModal.pqSize")}
            state={lock2State}
            timing={timings?.pqSignMs}
          />
        </div>

        {mitmIntercepted ? (
          <p role="alert" className="rounded-xl border border-danger/55 bg-danger/15 px-3.5 py-2 text-sm font-semibold text-danger-text">
            {t("biometricSignModal.intercepted")}
          </p>
        ) : stage === "sending" && (
          <p role="status" className="text-sm font-medium text-bcc">
            {t("biometricSignModal.submitted")}
          </p>
        )}

        {risk.requiresAcknowledgement && (
          <Card variant="warning">
            <h3 className="mb-2 type-h3">{t("biometricSignModal.warning")}</h3>
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
            <p className="text-sm font-semibold text-danger-text">
              {t("biometricSignModal.armed")}
              {armed === "MITM_AMOUNT" ? t("biometricSignModal.amount", { value: formatTenge(MITM_AMOUNT_TENGE) }) : t("biometricSignModal.dropper")}).
            </p>
          </Card>
        )}

        {risk.requiresCoSign && (
          <p className="text-sm font-medium text-amber-300">
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
