"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Cpu, Fingerprint, KeyRound, Layers, Microscope, Users } from "lucide-react";
import { LatencyBadge } from "@/components/crypto/LatencyBadge";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { HashChip } from "@/components/ui/HashChip";
import { JsonDiffViewer } from "@/components/ui/JsonDiffViewer";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/client/api";
import type { SecurityEvent, SignatureBundle, TransactionRecord } from "@/lib/db/types";
import { formatIban, formatMs, formatTenge } from "@/lib/ui/format";
import { extractFailureCode, formatEventDateTime, getEventMeta } from "./socHelpers";

interface SocEventDetailDrawerProps {
  event: SecurityEvent | null;
  open: boolean;
  onClose: () => void;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function SignatureLayerBlock({
  title,
  bundle,
  domainLabel,
}: {
  title: string;
  bundle: SignatureBundle;
  domainLabel: string;
}) {
  const [copiedBase64, setCopiedBase64] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function copyPqBase64() {
    try {
      await navigator.clipboard.writeText(bundle.pqSignatureBase64);
      setCopiedBase64(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedBase64(false), 1_500);
    } catch {
      // Clipboard API может быть недоступен в небезопасном контексте
    }
  }

  const decodedClientData = safeParseJson(bundle.webAuthnClientDataJson);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-h3 flex items-center gap-2 text-ink-primary">
          <Fingerprint aria-hidden="true" className="size-4 text-bcc" />
          {title} — Слой 1: WebAuthn (ECDSA P-256)
        </h3>
        <Badge tone="success">
          {bundle.webAuthnSignatureBytesLength} Б
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HashChip value={bundle.webAuthnCredentialId} label="Credential ID" tone="success" visible={6} />
        <LatencyBadge ms={bundle.verifyTimeMs} label="Проверка" tone="info" />
      </div>

      <JsonDiffViewer value={decodedClientData} />

      <div className="rounded-xl border border-quantum/35 bg-quantum/[.07] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="type-h3 flex items-center gap-2 text-sky-200">
            <Cpu aria-hidden="true" className="size-4 text-quantum" />
            Слой 2: Post-Quantum {bundle.pqAlgorithm}
          </h3>
          <Badge tone="info" className="font-mono">
            NIST FIPS 204 · {bundle.pqSignatureBytesLength.toLocaleString("ru-KZ")} Б
          </Badge>
        </div>

        <p className="font-mono text-xs text-ink-secondary">
          Домен подписи: <code className="text-sky-300">{domainLabel}</code>
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <HashChip value={bundle.pqSignatureHexPreview} label="Превью (hex)" tone="info" visible={10} />
          <Button
            size="sm"
            variant="secondary"
            icon={copiedBase64 ? <Check className="size-3.5 text-bcc" /> : <Copy className="size-3.5" />}
            onClick={() => void copyPqBase64()}
          >
            {copiedBase64 ? "Base64 скопирован" : "Копировать Base64"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SocEventDetailDrawer({ event, open, onClose }: SocEventDetailDrawerProps) {
  const [tx, setTx] = useState<TransactionRecord | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txUnavailable, setTxUnavailable] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    if (!open || !event?.txId) {
      setTx(null);
      setTxLoading(false);
      setTxUnavailable(false);
      return;
    }

    const controller = new AbortController();
    setTxLoading(true);
    setTxUnavailable(false);

    void api.getTransaction(event.txId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTx(result.data.transaction);
        setTxUnavailable(false);
      } else {
        setTx(null);
        setTxUnavailable(true);
      }
      setTxLoading(false);
    });

    return () => controller.abort();
  }, [event?.txId, open]);

  if (!event) {
    return (
      <Drawer open={false} onClose={onClose} title="Детали инцидента">
        <div />
      </Drawer>
    );
  }

  const meta = getEventMeta(event);
  const eventTrace = event.technicalDetails.verificationTrace;
  const trace = eventTrace && eventTrace.length > 0 ? eventTrace : (tx?.verificationTrace ?? tx?.primaryTrace ?? []);
  const tamperDiff =
    event.technicalDetails.tamperDiff && event.technicalDetails.tamperDiff.length > 0
      ? event.technicalDetails.tamperDiff
      : (tx?.tamperDiff ?? []);
  const failureCode = extractFailureCode(event) ?? tx?.failureCode;

  const totalTraceMs = trace
    .filter(step => step.outcome !== "SKIPPED")
    .reduce((sum, step) => sum + step.durationMs, 0);
  const mlDsaStep = trace.find(step => step.code === "POST_QUANTUM_ML_DSA" && step.outcome !== "SKIPPED");
  const webAuthnStep = trace.find(step => step.code === "WEBAUTHN_SIGNATURE" && step.outcome !== "SKIPPED");

  async function copyFullReport() {
    try {
      const payload = JSON.stringify({ event, transaction: tx }, null, 2);
      await navigator.clipboard.writeText(payload);
      setCopiedReport(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedReport(false), 1_500);
    } catch {
      // Игнорируем отказ буфера обмена
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Microscope aria-hidden="true" className="size-5 text-bcc" />
          <span>Разбор инцидента SOC</span>
        </span>
      }
      description={
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge status={event.severity} />
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {tx && <Badge status={tx.status} />}
          <span className="font-mono text-xs text-ink-muted">{formatEventDateTime(event.timestamp)}</span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={copiedReport ? <Check className="size-4 text-bcc" /> : <Copy className="size-4" />}
            onClick={() => void copyFullReport()}
          >
            {copiedReport ? "JSON-отчёт скопирован" : "Копировать JSON-отчёт"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Сводка события */}
        <Card variant={meta.isAttack ? "danger" : "elevated"}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-ink-primary">{event.summary}</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  Участник: <span className="font-semibold text-ink-primary">{event.actorName}</span>
                </p>
              </div>
              {event.amountTenge !== undefined && (
                <div className="text-right">
                  <div className="text-xs text-ink-muted">Сумма операции</div>
                  <div className="font-mono text-xl font-bold tabular-nums text-ink-primary">
                    {formatTenge(event.amountTenge)}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {failureCode && (
                <Badge tone="danger" className="font-mono">
                  {failureCode}
                </Badge>
              )}
              {event.txId && <HashChip value={event.txId} label="TX ID" tone="info" visible={8} />}
              {tx?.txHashHex && <HashChip value={tx.txHashHex} label="SHA-256" tone="success" visible={8} />}
            </div>

            {trace.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                <LatencyBadge ms={totalTraceMs} label="Всего 7 шагов" tone="success" />
                {webAuthnStep && <LatencyBadge ms={webAuthnStep.durationMs} label="WebAuthn" tone="info" />}
                {mlDsaStep && <LatencyBadge ms={mlDsaStep.durationMs} label="ML-DSA-65" tone="info" />}
              </div>
            )}
          </div>
        </Card>

        {/* 1. 7-шаговая серверная верификация */}
        {trace.length > 0 && (
          <section aria-labelledby="soc-drawer-trace" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="soc-drawer-trace" className="type-h3 flex items-center gap-2">
                <Layers aria-hidden="true" className="size-4 text-bcc" />
                1. 7-шаговая криптоверификация сервера
              </h3>
              <span className="font-mono text-xs text-ink-muted">Итого: {formatMs(totalTraceMs)}</span>
            </div>
            <VerificationStepsList trace={trace} failureCode={failureCode} />
          </section>
        )}

        {/* 2. Tamper Diff / WYSIWYS Payload */}
        {(tamperDiff.length > 0 || tx) && (
          <section aria-labelledby="soc-drawer-wysiwys" className="space-y-2.5">
            <h3 id="soc-drawer-wysiwys" className="type-h3 flex items-center gap-2">
              <KeyRound aria-hidden="true" className="size-4 text-quantum" />
              {tamperDiff.length > 0 ? "2. Обнаруженная подмена (Tamper Diff)" : "2. Канонический WYSIWYS Payload"}
            </h3>

            {tamperDiff.length > 0 && (
              <JsonDiffViewer
                signedHash={tx?.txHashHex}
                tamperDiff={tamperDiff}
              />
            )}

            {tx && (
              <div className="space-y-2">
                <dl className="grid grid-cols-1 gap-2 rounded-xl border border-border-subtle bg-terminal px-3.5 py-2.5 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-muted">Получатель</dt>
                    <dd className="mt-0.5 font-semibold text-ink-primary">{tx.payload.recipientName}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Счёт получателя (IBAN)</dt>
                    <dd className="mt-0.5 font-mono text-ink-primary">{formatIban(tx.payload.recipientAccount)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Оценка риска</dt>
                    <dd className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono font-bold text-ink-primary">{tx.riskScore} / 100</span>
                      <Badge status={tx.riskLevel} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Режим / Тип</dt>
                    <dd className="mt-0.5 font-mono text-ink-primary">
                      {tx.payload.mode} · {tx.payload.operationType}
                    </dd>
                  </div>
                </dl>

                <JsonDiffViewer
                  signedHash={tamperDiff.length === 0 ? tx.txHashHex : undefined}
                  json={tx.canonicalJson}
                />
              </div>
            )}
          </section>
        )}

        {/* Загрузка транзакции */}
        {txLoading && (
          <div className="space-y-2 rounded-xl border border-border-default bg-surface p-4">
            <Skeleton className="w-48" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {txUnavailable && event.txId && (
          <p className="rounded-xl border border-border-default bg-terminal px-3.5 py-2.5 text-xs text-ink-muted">
            Полная запись транзакции <code className="font-mono text-ink-secondary">{event.txId}</code> отсутствует в хранилище (возможен сброс демо или отклонение до создания записи). Ниже показана сохранённая телеметрия события SOC.
          </p>
        )}

        {/* 3. Криптослои первичной подписи */}
        {tx?.primarySignature && (
          <section aria-label="Первичная гибридная подпись" className="space-y-3 border-t border-border-subtle pt-4">
            <SignatureLayerBlock
              title="Инициатор"
              bundle={tx.primarySignature}
              domainLabel="BCC-SAFESIGN-V1:PRIMARY: || SHA-256(canonical)"
            />
          </section>
        )}

        {/* 4. Цепочка 2-of-2 Co-Sign */}
        {tx && (tx.requiresCoSign || tx.cosignSignature) && (
          <section aria-labelledby="soc-drawer-cosign" className="space-y-3 border-t border-border-subtle pt-4">
            <h3 id="soc-drawer-cosign" className="type-h3 flex items-center gap-2 text-amber-300">
              <Users aria-hidden="true" className="size-4" />
              Цепочка Smart Co-Sign 2-of-2 («Вторая рука»)
            </h3>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/35 bg-gold/[.08] px-3.5 py-2.5 text-xs">
              <Badge tone="success">1. Инициатор: {tx.primarySignature ? "подписано" : "нет"}</Badge>
              <span aria-hidden="true" className="font-mono text-ink-muted">──SHA-256(Sig1)──▶</span>
              <Badge
                tone={
                  tx.status === "BLOCKED_BY_COSIGNER"
                    ? "danger"
                    : tx.cosignSignature
                      ? "success"
                      : "warning"
                }
              >
                2. Вторая рука:{" "}
                {tx.status === "BLOCKED_BY_COSIGNER"
                  ? "заблокировано (фрод)"
                  : tx.cosignSignature
                    ? "подписано"
                    : "ожидает"}
              </Badge>
            </div>

            {tx.riskReasons.length > 0 && (
              <ul className="space-y-1 text-xs text-ink-secondary">
                {tx.riskReasons.map(reason => (
                  <li key={reason} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-gold" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            )}

            {tx.cosignSignature && (
              <SignatureLayerBlock
                title="Вторая рука (Co-Sign)"
                bundle={tx.cosignSignature}
                domainLabel="BCC-SAFESIGN-V1:COSIGN: || txHash || SHA-256(Sig1)"
              />
            )}
          </section>
        )}

        {/* 5. Полные технические детали события SOC */}
        <section aria-labelledby="soc-drawer-tech" className="space-y-2 border-t border-border-subtle pt-4">
          <h3 id="soc-drawer-tech" className="type-h3 text-ink-secondary">
            Технические детали события (technicalDetails)
          </h3>
          <JsonDiffViewer value={event.technicalDetails} />
        </section>
      </div>
    </Drawer>
  );
}
