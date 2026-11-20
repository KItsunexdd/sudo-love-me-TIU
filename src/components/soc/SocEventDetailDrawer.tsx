"use client";

import { riskReason } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { LatencyBadge } from "@/components/crypto/LatencyBadge";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { HashChip } from "@/components/ui/HashChip";
import { JsonDiffViewer } from "@/components/ui/JsonDiffViewer";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/client/api";
import type { SecurityEvent, SignatureBundle, TransactionRecord } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { eventSummary, extractFailureCode, formatEventDateTime, getEventMeta } from "./socHelpers";

interface SocEventDetailDrawerProps {
  event: SecurityEvent | null;
  open: boolean;
  onClose: () => void;
  projectorMode?: boolean;
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
  const { locale, t } = useT();
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
      // Clipboard access can be unavailable in insecure contexts.
    }
  }

  const decodedClientData = safeParseJson(bundle.webAuthnClientDataJson);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-h3">{title} {t("socEventDetailDrawer.layer")}</h3>
        <span className="mono-data text-ink-muted">{bundle.webAuthnSignatureBytesLength.toLocaleString(locale)} Б</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HashChip value={bundle.webAuthnCredentialId} label="Credential ID" />
        <LatencyBadge label={t("common.verification")} ms={bundle.verifyTimeMs} />
      </div>
      <JsonDiffViewer value={decodedClientData} />
      <div className="space-y-3 border-t border-border-subtle pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="type-h3">{t("socEventDetailDrawer.pqLayer")} {bundle.pqAlgorithm}</h3>
          <span className="mono-data text-ink-muted">NIST FIPS 204 · {bundle.pqSignatureBytesLength.toLocaleString(locale)} Б</span>
        </div>
        <p className="type-label">{t("socEventDetailDrawer.domain")} <code className="mono-data break-words">{domainLabel}</code></p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <HashChip value={bundle.pqSignatureHexPreview} label={t("socEventDetailDrawer.hex")} visible={10} />
          <Button size="sm" variant="ghost" icon={copiedBase64 ? <Check /> : <Copy />} onClick={() => void copyPqBase64()}>
            {copiedBase64 ? t("socEventDetailDrawer.copied") : t("socEventDetailDrawer.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SocEventDetailDrawer({ event, open, onClose, projectorMode = false }: SocEventDetailDrawerProps) {
  const { locale, t } = useT();
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
      <Drawer open={false} onClose={onClose} title={t("socEventDetailDrawer.incident")}>
        <div />
      </Drawer>
    );
  }

  const meta = getEventMeta(event, t);
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
      // Leave the copy action available if clipboard access is denied.
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={t("socEventDetailDrawer.heading")}
      className={projectorMode ? "[&_h2]:text-xl [&_h3]:text-xl [&_dd]:text-base [&_dt]:text-base [&_p]:text-base [&_code]:text-base" : undefined}
      description={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge status={event.severity} />
          <span className="text-xs text-ink-secondary">{meta.label}</span>
          {tx && <Badge status={tx.status} />}
          <span className="mono-data text-ink-muted">{formatEventDateTime(event.timestamp, locale)}</span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="secondary" icon={copiedReport ? <Check /> : <Copy />} onClick={() => void copyFullReport()}>
            {copiedReport ? t("socEventDetailDrawer.reportCopied") : t("socEventDetailDrawer.copyReport")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </div>
      }
    >
      <div className="space-y-5 divide-y divide-border-default">
        <div className="space-y-3">
          <p className="type-h3">{eventSummary(event, locale)}</p>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <p className="type-label">{t("socEventDetailDrawer.participant")} <span className="text-ink-primary">{event.actorName}</span></p>
            {event.amountTenge !== undefined && (
              <div className="text-right">
                <div className="type-label">{t("common.operationAmount")}</div>
                <div className="display-kpi mt-1">{formatTenge(event.amountTenge)}</div>
              </div>
            )}
          </div>
          {failureCode && <code className="fingerprint block break-all text-danger-text">{failureCode}</code>}
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            {event.txId && <HashChip value={event.txId} label="TX ID" />}
            {tx?.txHashHex && <HashChip value={tx.txHashHex} label="SHA-256" />}
          </div>
        </div>

        {trace.length > 0 && (
          <section aria-labelledby="soc-drawer-trace" className="space-y-3 pt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="soc-drawer-trace" className="type-h3">{t("socEventDetailDrawer.verification")}</h3>
              <LatencyBadge label={t("socEventDetailDrawer.stepCount")} ms={totalTraceMs} />
            </div>
            <VerificationStepsList trace={trace} failureCode={failureCode} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-ink-muted">
              {webAuthnStep && <LatencyBadge label="WebAuthn" ms={webAuthnStep.durationMs} />}
              {mlDsaStep && <LatencyBadge label="ML-DSA-65" ms={mlDsaStep.durationMs} />}
            </div>
          </section>
        )}

        {(tamperDiff.length > 0 || tx) && (
          <section aria-labelledby="soc-drawer-wysiwys" className="space-y-3 pt-5">
            <h3 id="soc-drawer-wysiwys" className="type-h3">
              {tamperDiff.length > 0 ? t("socEventDetailDrawer.diff") : t("socEventDetailDrawer.payload")}
            </h3>
            {tamperDiff.length > 0 && <JsonDiffViewer signedHash={tx?.txHashHex} tamperDiff={tamperDiff} />}
            {tx && (
              <>
                <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 [&_dd]:mt-1 [&_dt]:type-label">
                  <div>
                    <dt>{t("common.recipient")}</dt>
                    <dd className="type-body">{tx.payload.recipientName}</dd>
                  </div>
                  <div>
                    <dt>{t("common.iban")}</dt>
                    <dd className="fingerprint">{formatIban(tx.payload.recipientAccount)}</dd>
                  </div>
                  <div>
                    <dt>{t("common.score")}</dt>
                    <dd className="flex items-center gap-2"><span className="mono-data">{tx.riskScore} / 100</span><Badge status={tx.riskLevel} /></dd>
                  </div>
                  <div>
                    <dt>{t("socEventDetailDrawer.type")}</dt>
                    <dd className="mono-data">{tx.payload.mode} · {tx.payload.operationType}</dd>
                  </div>
                </dl>
                <JsonDiffViewer signedHash={tamperDiff.length === 0 ? tx.txHashHex : undefined} json={tx.canonicalJson} />
              </>
            )}
          </section>
        )}

        {txLoading && <div className="space-y-2 pt-5"><Skeleton className="w-48" /><Skeleton className="h-16 w-full" /></div>}
        {txUnavailable && event.txId && (
          <p className="type-label pt-5">
            {t("socEventDetailDrawer.record")} <code className="fingerprint break-all">{event.txId}</code> {t("socEventDetailDrawer.missing")}
          </p>
        )}

        {tx?.primarySignature && (
          <section aria-label={t("socEventDetailDrawer.primary")} className="pt-5">
            <SignatureLayerBlock title={t("socEventDetailDrawer.initiator")} bundle={tx.primarySignature}
              domainLabel="BCC-SAFESIGN-V1:PRIMARY: || SHA-256(canonical)" />
          </section>
        )}

        {tx && (tx.requiresCoSign || tx.cosignSignature) && (
          <section aria-labelledby="soc-drawer-cosign" className="space-y-4 pt-5">
            <h3 id="soc-drawer-cosign" className="type-h3">{t("socEventDetailDrawer.chain")}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={tx.primarySignature ? "success" : "neutral"}>
                {t("socEventDetailDrawer.first")} {tx.primarySignature ? t("socEventDetailDrawer.signed") : t("socEventDetailDrawer.none")}
              </Badge>
              <span aria-hidden="true" className="mono-data text-ink-muted">SHA-256(Sig1) →</span>
              <Badge tone={tx.status === "BLOCKED_BY_COSIGNER" ? "danger" : tx.cosignSignature ? "success" : "warning"}>
                {t("socEventDetailDrawer.second")}{" "}
                {tx.status === "BLOCKED_BY_COSIGNER" ? t("socEventDetailDrawer.blocked") : tx.cosignSignature ? t("socEventDetailDrawer.signed") : t("socEventDetailDrawer.pending")}
              </Badge>
            </div>
            {tx.riskReasons.length > 0 && (
              <ul className="type-label list-disc space-y-1 pl-4 marker:text-ink-muted">
                {tx.riskReasons.map((reason, index) => <li key={reason}>{riskReason(locale, tx.riskCodes?.[index], reason)}</li>)}
              </ul>
            )}
            {tx.cosignSignature && (
              <SignatureLayerBlock title={t("cosign.heading")} bundle={tx.cosignSignature}
                domainLabel="BCC-SAFESIGN-V1:COSIGN: || txHash || SHA-256(Sig1)" />
            )}
          </section>
        )}

        <section aria-labelledby="soc-drawer-tech" className="space-y-3 pt-5">
          <h3 id="soc-drawer-tech" className="type-h3">{t("socEventDetailDrawer.technical")}</h3>
          <JsonDiffViewer value={event.technicalDetails} />
        </section>
      </div>
    </Drawer>
  );
}
