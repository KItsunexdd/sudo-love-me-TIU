"use client";

import { useEffect } from "react";
import { Atom, Copy, Fingerprint, Link2 } from "lucide-react";
import { Badge, Button, Card, Drawer, ErrorCard, HashChip, JsonDiffViewer, Skeleton, useToast } from "@/components/ui";
import { useDemoState } from "@/lib/client/useDemoState";
import type { SignatureBundle } from "@/lib/db/types";
import { bytesToHex, fromBase64, sha256 } from "@/lib/crypto/canonical";
import { VerificationStepsList } from "./VerificationStepsList";
import { LatencyBadge } from "./LatencyBadge";
import { useTransaction } from "./useTransaction";

function SignatureEvidence({ signature, title }: { signature: SignatureBundle; title: string }) {
  const { toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(signature.pqSignatureBase64);
      toast({ title: "Подпись скопирована", tone: "success" });
    } catch {
      toast({ title: "Браузер ограничил доступ к буферу обмена", tone: "danger" });
    }
  }
  return <Card className="space-y-3">
    <h3 className="type-h2">{title}</h3>
    <h4 className="flex items-center gap-2 text-sm font-semibold"><Fingerprint aria-hidden="true" size={18} className="text-bcc" /> WebAuthn · clientDataJSON</h4>
    <JsonDiffViewer json={signature.webAuthnClientDataJson} />
    <h4 className="flex items-center gap-2 text-sm font-semibold"><Atom aria-hidden="true" size={18} className="text-quantum" /> ML-DSA-65 · FIPS 204</h4>
    <p className="mono-data tabular-nums">{signature.pqSignatureBytesLength.toLocaleString("ru-RU")} байт</p>
    <p className="break-all rounded-lg border border-border-default bg-terminal p-2.5 font-mono text-xs text-ink-secondary">{signature.pqSignatureHexPreview}…</p>
    <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => void copy()}>Скопировать подпись Base64</Button>
    <div className="flex flex-wrap gap-2">{signature.clientTimings ? <>
      <LatencyBadge label="Клиент · WebAuthn" ms={signature.clientTimings.webauthnMs} />
      <LatencyBadge label="Клиент · ML-DSA" ms={signature.clientTimings.pqSignMs} /></> :
      <span className="text-sm text-ink-muted">Клиентские тайминги не записаны.</span>}
      <LatencyBadge label="Сервер" ms={signature.verifyTimeMs} />
    </div>
  </Card>;
}

function DrawerLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка транзакции" className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <Skeleton className="h-5 w-44" />
      <div className="space-y-1.5">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full rounded-xl" />
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

export function CryptoInspectorDrawer({ txId, userId, open = true, onClose, onQuantum }: {
  txId: string | null; userId: string; open?: boolean; onClose: () => void; onQuantum?: () => void;
}) {
  const { record: tx, error, retry } = useTransaction(open ? txId : null, userId);
  const { users } = useDemoState(userId);
  const missing = error?.failureCode === "ERR_TX_NOT_FOUND";
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);
  if (missing) return null;
  const owner = (id: string) => users.find(user => user.id === id)?.fullName ?? id;
  const link = tx?.requiresCoSign && tx.primarySignature ? signatureDigest(tx.primarySignature.pqSignatureBase64) : null;
  return <Drawer open={open && Boolean(txId)} onClose={onClose} title="Crypto Inspector" description={<span className="break-all font-mono">{txId}</span>}
    footer={onQuantum && <Button size="sm" variant="secondary" icon={<Atom size={16} />} onClick={onQuantum}>Симулировать квантовый взлом ECDSA</Button>}>
    {error ? <ErrorCard error={error} action={<Button size="sm" onClick={retry}>Обновить</Button>} /> : !tx ? <DrawerLoadingSkeleton /> :
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Badge status={tx.status} /><Badge status={tx.riskLevel} /></div>
        <h3 className="type-h2">Серверная проверка</h3>
        <VerificationStepsList trace={tx.verificationTrace} failureCode={tx.failureCode} />
        {tx.cosignSignature && tx.primaryTrace && <details className="rounded-xl border border-border-default bg-surface p-3"><summary className="cursor-pointer text-sm font-medium text-ink-secondary">Проверка первой подписи</summary>
          <div className="mt-3"><VerificationStepsList trace={tx.primaryTrace} /></div></details>}
        <h3 className="type-h2">Подписываемые реквизиты</h3>
        <HashChip value={tx.txHashHex} />
        {tx.tamperDiff?.length ? <JsonDiffViewer signedHash={tx.txHashHex} tamperDiff={tx.tamperDiff} /> : null}
        <JsonDiffViewer json={tx.canonicalJson} />
        {tx.primarySignature ? <SignatureEvidence title={owner(tx.primarySignature.signerUserId)} signature={tx.primarySignature} /> :
          !tx.rejectedEvidence && <p className="text-sm text-ink-muted">В записи операции пока нет подтверждённой подписи инициатора.</p>}
        {tx.rejectedEvidence && <Card className="space-y-3"><h3 className="type-h2">Отклонённое подтверждение</h3>
          {tx.rejectedEvidence.clientDataJson && <><h4 className="type-h3">WebAuthn · clientDataJSON</h4><JsonDiffViewer json={tx.rejectedEvidence.clientDataJson} /></>}
          {tx.rejectedEvidence.pqBytes !== undefined && <p className="mono-data text-sm tabular-nums">ML-DSA-65 · {tx.rejectedEvidence.pqBytes.toLocaleString("ru-RU")} байт</p>}
          {tx.rejectedEvidence.pqHexPreview && <p className="mono-data break-all rounded-lg border border-border-default bg-terminal p-2 text-xs text-ink-secondary">{tx.rejectedEvidence.pqHexPreview}…</p>}
          {tx.rejectedEvidence.clientTimings && <div className="flex flex-wrap gap-2"><LatencyBadge label="Клиент · WebAuthn" ms={tx.rejectedEvidence.clientTimings.webauthnMs} />
            <LatencyBadge label="Клиент · ML-DSA" ms={tx.rejectedEvidence.clientTimings.pqSignMs} /></div>}
        </Card>}
        {tx.requiresCoSign && <Card className="space-y-2"><h3 className="flex items-center gap-2 type-h3"><Link2 aria-hidden="true" size={16} className="text-gold" /> Цепочка 2-of-2</h3>
          <p className="text-sm">{owner(tx.payload.senderId)} → {owner(tx.cosignerUserId ?? "Вторая рука")}</p>
          {link && <HashChip value={link} label="SHA-256 первой PQ-подписи" />}
          <p className="text-sm text-ink-secondary">Вторая подпись связывает хэш реквизитов с хэшем первой подписи.</p></Card>}
        {tx.cosignSignature && <SignatureEvidence title={owner(tx.cosignSignature.signerUserId)} signature={tx.cosignSignature} />}
      </div>}
  </Drawer>;
}

export default CryptoInspectorDrawer;
