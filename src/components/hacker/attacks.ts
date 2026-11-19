import { useSyncExternalStore } from "react";
import { api, type ApiResult, type ExecuteInput, type ExecuteResponse, type PrepareInput } from "@/lib/client/api";
import { signPrimary, SignerError, toClientError } from "@/lib/client/signer";
import type { CanonicalTxPayload } from "@/lib/db/types";

/**
 * Attack simulator for the demo stand. Every scenario sends a real request to
 * POST /api/transactions/execute; the verdict always comes from the server verifier.
 */

export type Interceptor = "MITM_AMOUNT" | "MITM_RECIPIENT";
export type AttackTag = NonNullable<ExecuteInput["attackTag"]>;

export const MITM_AMOUNT_TENGE = 500_000;
export const DROP_ACCOUNT = "KZ99856000000666DROP";
export const DROP_NAME = "Дроппер Х";

/** Replaces signed fields after signing, as a man-in-the-middle would on the wire. */
export function tamperPayload(payload: CanonicalTxPayload, interceptor: Interceptor): CanonicalTxPayload {
  return interceptor === "MITM_AMOUNT"
    ? { ...payload, amountTenge: MITM_AMOUNT_TENGE }
    : { ...payload, recipientAccount: DROP_ACCOUNT, recipientName: DROP_NAME };
}

type State = { armed: Interceptor | null; lastValid: ExecuteInput | null; lastValidTxId: string | null };
let state: State = { armed: null, lastValid: null, lastValidTxId: null };
const listeners = new Set<() => void>();
const emit = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const serverState: State = { armed: null, lastValid: null, lastValidTxId: null };

export function useAttackState() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

export function armInterceptor(interceptor: Interceptor | null) {
  emit({ armed: interceptor });
}

/**
 * Builds the execute request for a freshly signed operation. If an interceptor is armed it
 * fires once: the signatures stay untouched while the submitted payload is replaced.
 */
export function buildExecuteBody(body: ExecuteInput): ExecuteInput {
  const interceptor = state.armed;
  if (!interceptor) return { ...body, attackTag: body.attackTag ?? "NONE" };
  emit({ armed: null });
  return { ...body, submittedPayload: tamperPayload(body.submittedPayload as CanonicalTxPayload, interceptor), attackTag: interceptor };
}

/** Remembers the exact body of the last request the server accepted, as an eavesdropper would. */
export function rememberValidPacket(body: ExecuteInput, status: string) {
  if (body.attackTag && body.attackTag !== "NONE") return;
  if (status === "EXECUTED" || status === "PENDING_COSIGN") emit({ lastValid: structuredClone(body), lastValidTxId: body.txId });
}

export function resetAttackState() {
  emit({ armed: null, lastValid: null, lastValidTxId: null });
}

/** Resends the captured valid packet byte-for-byte. */
export async function replayLastPacket() {
  const captured = state.lastValid;
  if (!captured) return null;
  return { txId: captured.txId, result: await api.execute({ ...structuredClone(captured), attackTag: "REPLAY" }) };
}

/**
 * A cloned site can only produce assertions whose clientDataJSON carries its own origin.
 * Signs a real operation with the software key under the clone's origin and submits it.
 */
export async function submitFromForeignOrigin(input: PrepareInput, deviceId: string, foreignOrigin: string):
  Promise<{ txId: string | null; result: ApiResult<ExecuteResponse> }> {
  const prepared = await api.prepare(input);
  if (!prepared.ok) return { txId: null, result: { ok: false, status: prepared.status, data: null, error: prepared.error } };
  try {
    const signed = await signPrimary(prepared.data, deviceId, { originOverride: foreignOrigin });
    const result = await api.execute({
      txId: prepared.data.txId, deviceId, submittedPayload: prepared.data.payload,
      webAuthnAssertion: signed.webAuthnAssertion, pqSignatureBase64: signed.pqSignatureBase64,
      clientTimings: signed.timings, attackTag: "PHISHING_ORIGIN",
    });
    return { txId: prepared.data.txId, result };
  } catch (error) {
    const details = error instanceof SignerError ? error.details : toClientError(error);
    return { txId: prepared.data.txId, result: { ok: false, status: 0, data: null, error: details } };
  }
}

export function foreignOriginFor(location: Pick<Location, "protocol" | "port">) {
  return `${location.protocol}//127.0.0.1${location.port ? ":" + location.port : ""}`;
}
