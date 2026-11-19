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
  const savedByTransaction = new Map<string, number>();
  const steps: VerificationStepResult[] = [];
  let attacksBlocked = 0;
  for (const event of securityEvents) {
    const type = attackType(event);
    if (type) {
      attacksBlocked++;
      blockedByType[type] = (blockedByType[type] ?? 0) + 1;
      if (event.txId) savedByTransaction.set(event.txId, event.amountTenge ?? 0);
    }
    if (event.technicalDetails.verificationTrace) steps.push(...event.technicalDetails.verificationTrace);
  }
  for (const tx of transactions) {
    if (tx.primaryTrace) steps.push(...tx.primaryTrace);
    if (tx.cosignSignature) steps.push(...tx.verificationTrace);
  }
  return { events: securityEvents.reverse(), aggregates: {
    attacksBlocked, blockedByType, savedAmountTenge: [...savedByTransaction.values()].reduce((a, b) => a + b, 0),
    signedWithoutSms: transactions.filter(t => t.status === "EXECUTED").length,
    verification: { mlDsa: timings(steps, "POST_QUANTUM_ML_DSA"), webAuthn: timings(steps, "WEBAUTHN_SIGNATURE") },
  } };
}
