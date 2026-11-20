"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useEffect, useMemo, useState } from "react";
import { Badge, ErrorCard, JsonDiffViewer, Spinner } from "@/components/ui";
import { computeTamperDiff, fromBase64, hashPayload } from "@/lib/crypto/canonical";
import type { TransactionRecord } from "@/lib/db/types";
import { formatMs } from "@/lib/ui/format";

function CompareSignedCopy({ tx, field }: { tx: TransactionRecord; field: "amount" | "iban" }) {
  const { t } = useT();
  const comparison = useMemo(() => {
    const copy = field === "amount" ? { ...tx.payload, amountTenge: 500000 } :
      { ...tx.payload, recipientAccount: "KZ99856000000666DROP", recipientName: "Дроппер Х" };
    return { copy, diff: computeTamperDiff(tx.payload, copy), digest: hashPayload(copy), original: hashPayload(tx.payload) };
  }, [tx.payload, field]);
  const [proof, setProof] = useState<{ original: boolean; copy: boolean; ms: number }>();
  const [error, setError] = useState(false);
  const signature = tx.primarySignature;
  useEffect(() => {
    const publicKey = signature?.pqPublicKey;
    if (!signature || !publicKey) return;
    let active = true;
    void import("@/lib/crypto/mldsa").then(({ primaryMessage, verify }) => {
      if (!active) return;
      const key = fromBase64(publicKey);
      const bytes = fromBase64(signature.pqSignatureBase64);
      const start = performance.now();
      setProof({ original: verify(bytes, primaryMessage(comparison.original.hashBytes), key),
        copy: verify(bytes, primaryMessage(comparison.digest.hashBytes), key), ms: performance.now() - start });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [signature, comparison]);
  return <div className="space-y-2">
    <p className="text-sm text-ink-secondary">{t("tamperDiffViewer.compare")} {comparison.diff.length ? t("tamperDiffViewer.changed") : t("tamperDiffViewer.same")}</p>
    <JsonDiffViewer value={comparison.copy} signedHash={tx.txHashHex} receivedHash={comparison.digest.txHashHex} tamperDiff={comparison.diff} />
    {error ? <ErrorCard error={{ failureCode: "ERR_LOCAL_VERIFY", message: t("tamperDiffViewer.readError") }} /> :
      !signature?.pqPublicKey ? <p className="text-sm text-ink-muted">{t("tamperDiffViewer.noKey")}</p> :
        proof ? <div className="flex flex-wrap items-center gap-2" role="status">
          <Badge tone={proof.original ? "success" : "danger"}>{t("tamperDiffViewer.original")} {proof.original ? t("tamperDiffViewer.verified") : t("tamperDiffViewer.rejected")}</Badge>
          <Badge tone={proof.copy ? "success" : "danger"}>{t("tamperDiffViewer.copy")} {proof.copy ? t("tamperDiffViewer.verifiedCopy") : t("tamperDiffViewer.rejectedCopy")}</Badge>
          <span className="mono-data text-ink-secondary">{formatMs(proof.ms)}</span>
        </div> : <Spinner label={t("tamperDiffViewer.checking")} />}
  </div>;
}

export function TamperDiffViewer({ tx, field }: { tx: TransactionRecord; field: "amount" | "iban" | null }) {
  return field ? <CompareSignedCopy key={tx.id + field} tx={tx} field={field} /> :
    <JsonDiffViewer json={tx.canonicalJson} signedHash={tx.txHashHex} tamperDiff={tx.tamperDiff} />;
}
