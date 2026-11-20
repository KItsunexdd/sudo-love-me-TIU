"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useEffect } from "react";
import { Atom, Copy, Fingerprint, Link2 } from "lucide-react";
import { Badge, Button, Card, Drawer, ErrorCard, HashChip, JsonDiffViewer, Skeleton, useToast } from "@/components/ui";
import { useDemoState } from "@/lib/client/useDemoState";
import type { ApiError } from "@/lib/client/api";
import type { SignatureBundle } from "@/lib/db/types";
import { bytesToHex, fromBase64, fromBase64Url, sha256 } from "@/lib/crypto/canonical";
import { VerificationStepsList } from "./VerificationStepsList";
import { LatencyBadge } from "./LatencyBadge";
import { useTransaction } from "./useTransaction";

function WebAuthnBytes({ signature }: { signature: SignatureBundle }) {
  const { t } = useT();
  const encoded = signature.webAuthnSignatureBase64Url;
  if (!encoded) return <p className="text-sm text-ink-muted">{t("cryptoInspectorDrawer.noBytes")}</p>;
  try {
    const bytes = fromBase64Url(encoded);
    return <div className="mono-data space-y-1 break-all text-xs text-ink-secondary">
      <p>Hex · {bytesToHex(bytes.subarray(0, 32))}{bytes.length > 32 && "…"}</p>
      <p>Base64URL · {encoded}</p>
    </div>;
  } catch {
    return <p className="text-sm text-danger-text">{t("cryptoInspectorDrawer.unreadable")}</p>;
  }
}

function SignatureEvidence({ signature, title }: { signature: SignatureBundle; title: string }) {
  const { t } = useT();
  const { toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(signature.pqSignatureBase64);
      toast({ titleKey: "cryptoInspectorDrawer.copied", tone: "success" });
    } catch {
      toast({ titleKey: "cryptoInspectorDrawer.clipboard", tone: "danger" });
    }
  }
  return <Card className="space-y-3">
    <h3 className="type-h2 pb-1">{title}</h3>
    <h4 className="flex items-center gap-2 type-h3"><Fingerprint aria-hidden="true" size={16} strokeWidth={1.75} className="text-ink-muted" /> WebAuthn · clientDataJSON</h4>
    <JsonDiffViewer json={signature.webAuthnClientDataJson} />
    <h4 className="type-h3">{t("cryptoInspectorDrawer.signature")}</h4>
    <p className="mono-data tabular-nums">{signature.webAuthnSignatureBytesLength} {t("cryptoInspectorDrawer.bytes")}</p>
    <WebAuthnBytes signature={signature} />
    <h4 className="flex items-center gap-2 type-h3"><Atom aria-hidden="true" size={16} strokeWidth={1.75} className="text-ink-muted" /> ML-DSA-65 · FIPS 204</h4>
    <p className="mono-data tabular-nums">{signature.pqSignatureBytesLength.toLocaleString("ru-RU")} {t("cryptoInspectorDrawer.bytes")}</p>
    <p className="break-all rounded-lg border border-border-default bg-terminal p-3 font-mono text-xs text-ink-secondary">{signature.pqSignatureHexPreview}…</p>
    <Button size="sm" variant="secondary" icon={<Copy />} onClick={() => void copy()}>{t("cryptoInspectorDrawer.copy")}</Button>
    <div className="flex flex-wrap gap-x-4 gap-y-1">{signature.clientTimings ? <>
      <LatencyBadge label={t("cryptoInspectorDrawer.clientWebAuthn")} ms={signature.clientTimings.webauthnMs} />
      <LatencyBadge label={t("cryptoInspectorDrawer.clientPq")} ms={signature.clientTimings.pqSignMs} /></> :
      <span className="text-sm text-ink-muted">{t("cryptoInspectorDrawer.noTimings")}</span>}
      <LatencyBadge label={t("cryptoInspectorDrawer.server")} ms={signature.verifyTimeMs} />
    </div>
  </Card>;
}

function DrawerLoadingSkeleton() {
  const { t } = useT();
  return (
    <div aria-busy="true" aria-label={t("cryptoInspectorDrawer.loading")} className="space-y-4">
      <div className="flex gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-5 w-44" />
      <div className="space-y-1.5">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-9 w-64 rounded-lg" />
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}

function signatureDigest(value: string) {
  try { return bytesToHex(sha256(fromBase64(value))); } catch { return null; }
}

export function CryptoInspectorDrawer({ txId, userId, open = true, onClose, onQuantum, attemptError }: {
  txId: string | null; userId: string; open?: boolean; onClose: () => void; onQuantum?: () => void;
  attemptError?: ApiError;
}) {
  const { t } = useT();
  const { record: tx, error, retry } = useTransaction(open ? txId : null, userId);
  const { users } = useDemoState(userId);
  const missing = !attemptError && error?.failureCode === "ERR_TX_NOT_FOUND";
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);
  if (missing) return null;
  const owner = (id: string) => users.find(user => user.id === id)?.fullName ?? id;
  const link = tx?.requiresCoSign && tx.primarySignature ? signatureDigest(tx.primarySignature.pqSignatureBase64) : null;
  return <Drawer open={open && Boolean(txId)} onClose={onClose} title="Crypto Inspector" description={<span className="break-all font-mono">{txId}</span>}
    footer={onQuantum && <Button size="sm" variant="secondary" icon={<Atom />} onClick={onQuantum}>{t("cryptoInspectorDrawer.simulate")}</Button>}>
    {attemptError && <section className="mb-5 space-y-3">
      <h3 className="type-h2">{t("cryptoInspectorDrawer.rejected")}</h3>
      <ErrorCard error={attemptError} />
      <VerificationStepsList trace={attemptError.verificationTrace} failureCode={attemptError.failureCode} />
    </section>}
    {error ? <ErrorCard error={error} action={<Button size="sm" onClick={retry}>{t("common.refresh")}</Button>} /> : !tx ? <DrawerLoadingSkeleton /> :
      <section className="space-y-5">
        {attemptError && <h3 className="type-h2">{tx.status === "EXECUTED" ? t("cryptoInspectorDrawer.executed") : t("cryptoInspectorDrawer.original")}</h3>}
        <div className="flex flex-wrap gap-4"><Badge status={tx.status} /><Badge status={tx.riskLevel} /></div>
        <h3 className="type-h2">{t("cryptoInspectorDrawer.verify")}</h3>
        <VerificationStepsList trace={tx.verificationTrace} failureCode={tx.failureCode} />
        {tx.cosignSignature && tx.primaryTrace && <details className="rounded-lg border border-border-default bg-surface p-4"><summary className="cursor-pointer text-sm text-ink-secondary">{t("cryptoInspectorDrawer.first")}</summary>
          <div className="mt-3"><VerificationStepsList trace={tx.primaryTrace} /></div></details>}
        <h3 className="type-h2">{t("cryptoInspectorDrawer.fields")}</h3>
        <HashChip value={tx.txHashHex} />
        {tx.tamperDiff?.length ? <JsonDiffViewer signedHash={tx.txHashHex} tamperDiff={tx.tamperDiff} /> : null}
        <JsonDiffViewer json={tx.canonicalJson} />
        {tx.primarySignature ? <SignatureEvidence title={owner(tx.primarySignature.signerUserId)} signature={tx.primarySignature} /> :
          !tx.rejectedEvidence && <p className="text-sm text-ink-muted">{t("cryptoInspectorDrawer.unsigned")}</p>}
        {tx.rejectedEvidence && <Card className="space-y-3"><h3 className="type-h2">{t("cryptoInspectorDrawer.rejectedAssertion")}</h3>
          {tx.rejectedEvidence.clientDataJson && <><h4 className="type-h3">WebAuthn · clientDataJSON</h4><JsonDiffViewer json={tx.rejectedEvidence.clientDataJson} /></>}
          {tx.rejectedEvidence.pqBytes !== undefined && <p className="mono-data text-sm tabular-nums">ML-DSA-65 · {tx.rejectedEvidence.pqBytes.toLocaleString("ru-RU")} {t("cryptoInspectorDrawer.bytes")}</p>}
          {tx.rejectedEvidence.pqHexPreview && <p className="mono-data break-all rounded-lg border border-border-default bg-terminal p-3 text-xs text-ink-secondary">{tx.rejectedEvidence.pqHexPreview}…</p>}
          {tx.rejectedEvidence.clientTimings && <div className="flex flex-wrap gap-x-4 gap-y-1"><LatencyBadge label={t("cryptoInspectorDrawer.clientWebAuthn")} ms={tx.rejectedEvidence.clientTimings.webauthnMs} />
            <LatencyBadge label={t("cryptoInspectorDrawer.clientPq")} ms={tx.rejectedEvidence.clientTimings.pqSignMs} /></div>}
        </Card>}
        {tx.requiresCoSign && <Card className="space-y-2"><h3 className="flex items-center gap-2 type-h3"><Link2 aria-hidden="true" size={16} strokeWidth={1.75} className="text-ink-muted" /> {t("cryptoInspectorDrawer.chain")}</h3>
          <p className="text-sm">{owner(tx.payload.senderId)} → {owner(tx.cosignerUserId ?? t("common.secondHand"))}</p>
          {link && <HashChip value={link} label={t("cryptoInspectorDrawer.firstHash")} />}
          <p className="text-sm text-ink-secondary">{t("cryptoInspectorDrawer.binding")}</p></Card>}
        {tx.cosignSignature && <SignatureEvidence title={owner(tx.cosignSignature.signerUserId)} signature={tx.cosignSignature} />}
      </section>}
  </Drawer>;
}

export default CryptoInspectorDrawer;
