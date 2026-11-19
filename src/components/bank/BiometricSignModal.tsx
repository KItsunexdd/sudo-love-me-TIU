"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Fingerprint, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorCard, HashChip, JsonDiffViewer, Modal } from "@/components/ui";
import { api, type ApiError, type ApiResult, type ExecuteResponse, type PrepareResponse } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { signPrimary, toClientError, type HybridSignature } from "@/lib/client/signer";
import { buildExecuteBody, rememberValidPacket, useAttackState } from "@/components/hacker/attacks";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";
import { lockSnapVariants, reducedMotionVariants } from "@/lib/ui/motion";

function Lock({ label, timing, busy, quantum }: { label: string; timing?: number; busy: boolean; quantum?: boolean }) {
  const reduce = useReducedMotion();
  const Icon = timing === undefined ? LockKeyholeOpen : LockKeyhole;
  return <motion.div initial={false} animate={timing !== undefined && !reduce ? { opacity: [0.55, 1] } : { opacity: 1 }}
    transition={{ duration: 0.18, delay: quantum ? 0.12 : 0 }}
    className={`rounded-xl border border-border-default bg-terminal p-3 ${quantum ? "text-quantum" : "text-bcc"}`}>
    <motion.div variants={reduce ? reducedMotionVariants : lockSnapVariants}
      animate={timing !== undefined ? "signed" : busy && !quantum ? "signing" : "idle"}><Icon size={22} /></motion.div>
    <h3 className="mt-2 font-semibold">{label}</h3><p className="text-xs text-ink-secondary">
      {timing !== undefined ? `Подписано · ${formatMs(timing)}` : busy ? quantum ? "После WebAuthn" : "Подтверждение устройством…" : "Готов к подписи"}
    </p>
  </motion.div>;
}

export function BiometricSignModal({ prepared, device, onClose, onComplete, onFallback }: {
  prepared: PrepareResponse; device: LocalDevice; onClose: () => void;
  onComplete: (result: ApiResult<ExecuteResponse>) => void; onFallback: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [timings, setTimings] = useState<HybridSignature["timings"]>();
  const [ack, setAck] = useState(false);
  const [now, setNow] = useState(Date.now);
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
    setError(undefined);
    try {
      const signed = await signPrimary(prepared, device.id);
      if (!active.current) return;
      setTimings(signed.timings);
      // The client always signs the payload it displayed. An armed MITM interceptor rewrites the
      // submitted copy afterwards, exactly as malware on the wire would; the server must reject it.
      const body = buildExecuteBody({ txId: prepared.txId, deviceId: device.id, submittedPayload: payload,
        webAuthnAssertion: signed.webAuthnAssertion, pqSignatureBase64: signed.pqSignatureBase64,
        clientTimings: signed.timings, acknowledgedWarning: ack });
      const execution = api.execute(body);
      // Let both lock confirmations finish while the server verifies the signatures.
      const [result] = await Promise.all([execution, reduceMotion ? undefined : new Promise(resolve => setTimeout(resolve, 320))]);
      if (result.ok) rememberValidPacket(body, result.data.status);
      if (active.current) onComplete(result);
    } catch (cause) {
      if (active.current) setError(toClientError(cause));
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }
  const fields = [
    ["Операция", { ONLINE_LOAN: "Онлайн-кредит", DEPOSIT_CLOSE: "Закрытие депозита", P2P_TRANSFER: "Перевод", B2B_INVOICE: "Оплата счёта" }[payload.operationType]],
    ["Получатель", payload.recipientName], ["Счёт (IBAN)", formatIban(payload.recipientAccount)],
    ["Назначение", payload.purpose || "Без назначения"],
  ];
  return <Modal open onClose={onClose} dismissible={!busy} wide title="Подтверждение операции"
    description="Сверьте реквизиты. Они входят в обе подписи (WYSIWYS)."
    footer={<div className="flex flex-wrap items-center justify-between gap-3">
      <span className="mono-data text-ink-secondary">{remaining ? `Осталось ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Время истекло"}</span>
      <Button disabled={!remaining || (risk.requiresAcknowledgement && !ack)} loading={busy} icon={<Fingerprint size={18} />} onClick={() => void sign()}>
        {software ? "Подтвердить Software Key + ML-DSA" : "Подтвердить Passkey + ML-DSA"}</Button>
    </div>}>
    <div className="space-y-4">
      <Card className="space-y-3"><dl className="grid gap-2 text-sm">
        {fields.map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[8rem_1fr]"><dt className="text-ink-muted">{label}</dt>
          <dd className="break-words font-semibold [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
        <div className="border-t border-border-default pt-3"><p className="type-label text-ink-muted">Сумма операции</p>
          <p className="display-kpi">{formatTenge(payload.amountTenge)}</p></div><HashChip value={txHashHex} />
        <details><summary className="cursor-pointer text-sm text-ink-secondary">Все подписываемые поля</summary>
          <JsonDiffViewer json={prepared.canonicalJson} className="mt-2" /></details></Card>
      <div className="grid grid-cols-2 gap-3"><Lock label={software ? "WebCrypto ECDSA" : "Passkey"} timing={timings?.webauthnMs} busy={busy} />
        <Lock quantum label="ML-DSA-65" timing={timings?.pqSignMs} busy={busy} /></div>
      {timings && <p role="status" className="text-sm text-ink-secondary">Обе подписи готовы и отправлены на проверку.</p>}
      {risk.requiresAcknowledgement && <Card variant="warning"><h3 className="mb-2 type-h3">Экран отрезвления</h3>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={ack} disabled={busy} className="mt-1 size-4 shrink-0 accent-gold"
          onChange={event => setAck(event.target.checked)} />Я подтверждаю, что совершаю операцию добровольно и мне сейчас не звонят из полиции, Нацбанка, КНБ или службы безопасности.</label></Card>}
      {armed && <Card variant="danger" role="alert"><p className="text-sm font-semibold text-danger-text">⚡ Перехватчик взведён: после вашей подписи пакет будет изменён в пути ({armed === "MITM_AMOUNT" ? "сумма → 500 000 ₸" : "получатель → дроппер"}).</p></Card>}
      {risk.requiresCoSign && <p className="text-sm text-amber-300">После вашей подписи запрос получит Вторая рука.</p>}
      {error && <ErrorCard error={error} action={!software && <Button variant="secondary" onClick={onFallback}>Использовать Software Key</Button>} />}
    </div>
  </Modal>;
}
