"use client";

import { russian } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import { Atom, LockKeyholeOpen, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Card, ErrorCard, Modal } from "@/components/ui";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { api, type ApiError, type ApiResult, type ExecuteResponse, type PrepareInput } from "@/lib/client/api";
import { signPrimary, toClientError } from "@/lib/client/signer";
import { hashPayload, toBase64 } from "@/lib/crypto/canonical";
import { formatIban, formatTenge } from "@/lib/ui/format";

export function QuantumCompareModal({ sample, deviceId, onClose, onInspect, onResult }: {
  sample: PrepareInput; deviceId?: string; onClose: () => void; onInspect: (id: string) => void;
  onResult: (id: string, result: ApiResult<ExecuteResponse>) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ApiError>();
  const [http, setHttp] = useState<number>();
  const [id, setId] = useState<string>();

  async function check() {
    if (!deviceId || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    setHttp(undefined);
    setId(undefined);
    try {
      const prepared = await api.prepare(sample);
      if (!prepared.ok) return setError(prepared.error);
      const { txId, payload } = prepared.data;
      setId(txId);
      const { webAuthnAssertion, timings } = await signPrimary(prepared.data, deviceId);
      const { keygen, primaryMessage, sign } = await import("@/lib/crypto/mldsa");
      const disposable = keygen();
      try {
        const message = primaryMessage(hashPayload(payload).hashBytes);
        const start = performance.now();
        const signature = sign(message, disposable.secretKey);
        const clientTimings = { webauthnMs: timings.webauthnMs, pqSignMs: performance.now() - start };
        const result = await api.execute({ quantumSimulation: true, deviceId, txId, submittedPayload: payload, webAuthnAssertion,
          pqSignatureBase64: toBase64(signature), clientTimings });
        onResult(txId, result);
        setHttp(result.status);
        setError(result.ok ? { status: result.data.status, failureCode: "ERR_UNEXPECTED_RESULT", message: russian("quantumCompareModal.unexpected") } : result.error);
      } finally {
        disposable.secretKey.fill(0);
      }
    } catch (cause) {
      setError(toClientError(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const verifiedBlocked = error?.failureCode === "ERR_PQ_SIGNATURE_INVALID";

  return (
    <Modal open onClose={onClose} dismissible={!busy} title={t("quantumCompareModal.quantum")} wide
      description={t("quantumCompareModal.compromisedHint")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {id && <Button variant="secondary" onClick={() => onInspect(id)} disabled={busy}>{t("common.inspect")}</Button>}
          <Button loading={busy} disabled={!deviceId} onClick={() => void check()}>{t("quantumCompareModal.verify")}</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Card variant={verifiedBlocked ? "danger" : "default"} className="h-full space-y-2">
          <div className="flex items-center justify-between gap-2">
            <LockKeyholeOpen aria-hidden="true" size={18} strokeWidth={1.75} className={verifiedBlocked ? "text-danger-text" : "text-ink-muted"} />
            <Badge tone={verifiedBlocked ? "danger" : "neutral"} className="font-mono">
              {verifiedBlocked ? t("quantumCompareModal.compromised") : "ECDSA P-256"}
            </Badge>
          </div>
          <h3 className="type-h3">{t("quantumCompareModal.classic")}</h3>
          <p className="text-sm text-ink-secondary">
            {t("quantumCompareModal.scenario")}
          </p>
        </Card>

        <Card className="h-full space-y-2 border-quantum/40">
          <div className="flex items-center justify-between gap-2">
            {verifiedBlocked
              ? <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.75} className="text-quantum" />
              : <Atom aria-hidden="true" size={18} strokeWidth={1.75} className="text-quantum" />}
            <Badge tone={verifiedBlocked ? "success" : "neutral"} className="font-mono tabular-nums">
              {verifiedBlocked ? t("quantumCompareModal.repelled") : t("quantumCompareModal.size")}
            </Badge>
          </div>
          <h3 className="type-h3">{t("quantumCompareModal.pq")}</h3>
          <p className="text-sm text-ink-secondary">
            {t("quantumCompareModal.serverCheck")}
          </p>
        </Card>
      </div>

      <p className="my-5 rounded-lg border border-border-default bg-terminal px-4 py-3 text-sm text-ink-secondary">
        {t("quantumCompareModal.diagnostic")} <span className="font-mono tabular-nums text-ink-primary">{formatTenge(sample.amountTenge)}</span> · {sample.recipientName} · <span className="mono-data text-ink-primary">{formatIban(sample.recipientAccount)}</span>
      </p>

      {!deviceId && <p className="text-sm text-gold-text">{t("quantumCompareModal.enroll")}</p>}

      {error && (
        <div className="space-y-3">
          {http && <p className="font-mono text-xs tabular-nums text-ink-muted">HTTP {http}</p>}
          <ErrorCard error={error} />
          {error.verificationTrace?.length ? <VerificationStepsList trace={error.verificationTrace} failureCode={error.failureCode} /> : null}
        </div>
      )}
    </Modal>
  );
}
