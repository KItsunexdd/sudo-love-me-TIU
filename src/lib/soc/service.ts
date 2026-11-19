import { getStorage } from "@/lib/db/store";
import type { SecurityEvent, VerificationStepResult } from "@/lib/db/types";

// Classify the observed rejection. The client-supplied attackTag is audit metadata.
function attackType({ eventType, technicalDetails }: SecurityEvent) {
  switch (eventType) {
    case "ATTACK_MITM_BLOCKED": {
      const fields = technicalDetails.tamperDiff?.map(d => d.field) ?? [];
      if (fields.includes("amountTenge")) return "MITM_AMOUNT";
      if (fields.includes("recipientAccount") || fields.includes("recipientName")) return "MITM_RECIPIENT";
      return "MITM_PAYLOAD";
    }
    case "ATTACK_REPLAY_BLOCKED": return "REPLAY";
    case "ATTACK_PHISHING_BLOCKED": return "PHISHING_ORIGIN";
    case "SOCENG_STOPPED_BY_COSIGNER": return "SOCIAL_ENGINEERING";
    case "PQ_SIGNATURE_REJECTED": return "PQ_SIGNATURE";
    case "WEBAUTHN_REJECTED": return "WEBAUTHN";
  }
}

function timings(steps: VerificationStepResult[], code: string) {
  const ms = steps.filter(s => s.code === code && s.outcome !== "SKIPPED").map(s => s.durationMs).sort((a, b) => a - b);
  return { count: ms.length, averageMs: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
    p95Ms: ms[Math.ceil(ms.length * 0.95) - 1] ?? 0 };
}

export async function socReport() {
  const { transactions, securityEvents } = await getStorage().snapshot();
  const blockedByType: Record<string, number> = {};
  const saved = new Set<string>();
  const attacked = new Set<string>();
  const records = new Map(transactions.map(tx => [tx.id, tx]));
  let savedAmountTenge = 0;
  let attackedAmountTenge = 0;
  let preventedTamperAmountTenge = 0;
  const steps: VerificationStepResult[] = [];
  let attacksBlocked = 0;
  for (const event of securityEvents) {
    const type = attackType(event);
    if (type) {
      attacksBlocked++;
      blockedByType[type] = (blockedByType[type] ?? 0) + 1;
      const tx = event.txId ? records.get(event.txId) : undefined;
      const amount = event.amountTenge ?? 0;
      const diagnostic = amount === 1 && ((type !== "REPLAY" && event.technicalDetails.quantumSimulation === true) ||
        event.technicalDetails.verificationTrace?.some(step => step.outcome === "COMPROMISED") ||
        tx?.verificationTrace.some(step => step.outcome === "COMPROMISED"));
      if (event.txId && !diagnostic) {
        if (!attacked.has(event.txId)) {
          attacked.add(event.txId);
          attackedAmountTenge += amount;
        }
        const duplicateDebit = type === "REPLAY" && (event.technicalDetails.replayOfExecuted === undefined
          ? tx?.status === "EXECUTED" : event.technicalDetails.replayOfExecuted === true);
        if ((type === "SOCIAL_ENGINEERING" || duplicateDebit) && !saved.has(event.txId)) {
          saved.add(event.txId);
          savedAmountTenge += amount;
        }
        if (type === "MITM_AMOUNT") {
          const attempted = Number(event.technicalDetails.tamperDiff?.find(diff => diff.field === "amountTenge")?.tampered);
          if (Number.isSafeInteger(attempted) && attempted > 0) preventedTamperAmountTenge += attempted;
        }
      }
    }
    if (event.technicalDetails.verificationTrace) steps.push(...event.technicalDetails.verificationTrace);
  }
  for (const tx of transactions) {
    if (tx.primaryTrace) steps.push(...tx.primaryTrace);
    if (tx.cosignSignature) steps.push(...tx.verificationTrace);
  }
  return { events: securityEvents.reverse(), aggregates: {
    attacksBlocked, blockedByType, savedAmountTenge, attackedAmountTenge, preventedTamperAmountTenge,
    signedWithoutSms: transactions.filter(t => t.status === "EXECUTED").length,
    verification: { mlDsa: timings(steps, "POST_QUANTUM_ML_DSA"), webAuthn: timings(steps, "WEBAUTHN_SIGNATURE") },
  } };
}
