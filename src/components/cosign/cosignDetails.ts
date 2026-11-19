import { demoParticipants } from "@/lib/demo/participants";
import { bytesToHex, fromBase64, sha256 } from "@/lib/crypto/canonical";
import type { Mode, SignatureBundle } from "@/lib/db/types";

export const corporateRule = "Корпоративное правило: платежи от 500 000 ₸ подписывает директор";

export function selectCosigner(mode: Mode, userId?: string | null) {
  return userId?.trim() || demoParticipants[mode].cosignerId;
}

export function cosignMode(mode: Mode, userId: string | null) {
  if (userId === demoParticipants.B2B.cosignerId) return "B2B";
  if (userId === demoParticipants.B2C.cosignerId) return "B2C";
  return mode;
}

export function cosignHref(mode: Mode, userId?: string | null) {
  const query = new URLSearchParams({ userId: selectCosigner(mode, userId) });
  if (mode === "B2B") query.set("mode", mode);
  return `/cosign?${query}`;
}

export function remainingSeconds(expiresAt: string | undefined, now: number) {
  const expiry = Date.parse(expiresAt ?? "");
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 1_000)) : 0;
}

export function formatCosignTimer(seconds: number) {
  const remaining = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  return `${minutes}:${String(remaining % 60).padStart(2, "0")}`;
}

export function signatureHash(signature: SignatureBundle | undefined) {
  if (!signature) return;
  try {
    return bytesToHex(sha256(fromBase64(signature.pqSignatureBase64)));
  } catch {
    return;
  }
}
