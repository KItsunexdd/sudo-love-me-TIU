"use client";

import { Atom, LockKeyholeOpen } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, ErrorCard, Modal } from "@/components/ui";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { api, type ApiError, type ApiResult, type ExecuteResponse, type PrepareInput } from "@/lib/client/api";
import { signPrimary, toClientError } from "@/lib/client/signer";
import { hashPayload, toBase64 } from "@/lib/crypto/canonical";
import { formatTenge } from "@/lib/ui/format";

export function QuantumCompareModal({ sample, deviceId, onClose, onInspect, onResult }: {
  sample: PrepareInput; deviceId?: string; onClose: () => void; onInspect: (id: string) => void;
  onResult: (id: string, result: ApiResult<ExecuteResponse>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [http, setHttp] = useState<number>();
  const [id, setId] = useState<string>();

  async function check() {
    if (!deviceId || busy) return;
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
        setError(result.ok ? { status: result.data.status, failureCode: "ERR_UNEXPECTED_RESULT", message: "Сервер принял диагностический запрос. Проверьте транзакцию." } : result.error);
      } finally {
        disposable.secretKey.fill(0);
      }
    } catch (cause) {
      setError(toClientError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <Modal open onClose={onClose} dismissible={!busy} title="Квантовая атака" wide
    description="Что произойдёт при компрометации классического ключа?"
    footer={<div className="flex flex-wrap justify-end gap-2">
      {id && <Button variant="secondary" onClick={() => onInspect(id)} disabled={busy}>Открыть Crypto Inspector</Button>}
      <Button loading={busy} disabled={!deviceId} onClick={() => void check()}>Проверить защиту ML-DSA-65</Button>
    </div>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Card><LockKeyholeOpen className="mb-2 text-gold" /><h3 className="type-h3">Классический слой</h3>
        <p className="mt-2 text-sm text-ink-secondary">В сценарии Шора считаем ECDSA скомпрометированной. Вы подтверждаете тест своим устройством.</p></Card>
      <Card><Atom className="mb-2 text-quantum" /><h3 className="type-h3">Постквантовый слой</h3>
        <p className="mt-2 text-sm text-ink-secondary">Сервер проверяет подпись временного ML-DSA-65 ключа по открытому ключу вашего устройства.</p></Card>
    </div>
    <p className="my-4 text-sm">Диагностическая операция без списания · {formatTenge(sample.amountTenge)} · {sample.recipientName} · <span className="mono-data">{sample.recipientAccount}</span></p>
    {!deviceId && <p className="text-sm text-amber-300">Сначала привяжите устройство на демо-стенде.</p>}
    {error && <div className="space-y-3">{http && <Badge tone="info">HTTP {http}</Badge>}<ErrorCard error={error} />
      {error.verificationTrace?.length ? <VerificationStepsList trace={error.verificationTrace} failureCode={error.failureCode} /> : null}</div>}
  </Modal>;
}
