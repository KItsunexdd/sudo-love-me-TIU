import { failureMessages, type FailureCode, type TamperDiff, type VerificationStepResult } from "@/lib/db/types";
import { ZodError } from "zod";

export class TxError extends Error {
  constructor(readonly code: FailureCode, message: string = failureMessages[code]) { super(message); }
}

export function requireTx(condition: unknown, code: FailureCode, message?: string): asserts condition {
  if (!condition) throw new TxError(code, message);
}

export interface Failure {
  ok: false;
  status: "ERROR" | "REJECTED_CRYPTO" | "EXPIRED";
  failureCode: FailureCode;
  message: string;
  verificationTrace: VerificationStepResult[];
  tamperDiff?: TamperDiff;
}
export function isCryptoFailure(code: FailureCode) {
  return code === "ERR_WYSIWYS_TAMPERED" || code === "ERR_ORIGIN_MISMATCH" ||
    code === "ERR_WEBAUTHN_INVALID" || code === "ERR_PQ_SIGNATURE_INVALID";
}
export function failure(code: FailureCode, trace: VerificationStepResult[] = [], message: string = failureMessages[code]): Failure {
  const rejected = isCryptoFailure(code) || code === "ERR_REPLAY_DETECTED";
  return { ok: false, status: code === "ERR_TX_EXPIRED" ? "EXPIRED" : rejected && trace.length ? "REJECTED_CRYPTO" : "ERROR",
    failureCode: code, message, verificationTrace: trace };
}

export function failureFrom(error: unknown): Failure {
  if (error instanceof TxError) return failure(error.code, [], error.message);
  if (error instanceof ZodError) {
    const custom = error.issues.find(issue => issue.code === "custom");
    return failure("ERR_INVALID_INPUT", [], custom?.message);
  }
  return failure("ERR_STORAGE");
}
