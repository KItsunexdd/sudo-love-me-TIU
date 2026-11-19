import { failureMessages, type FailureCode, type TamperDiff, type VerificationStepResult } from "@/lib/db/types";

export class TxError extends Error {
  constructor(readonly code: FailureCode) { super(failureMessages[code]); }
}

export function requireTx(condition: unknown, code: FailureCode): asserts condition {
  if (!condition) throw new TxError(code);
}

export interface Failure {
  ok: false;
  status: "ERROR" | "REJECTED_CRYPTO" | "EXPIRED";
  failureCode: FailureCode;
  message: string;
  verificationTrace: VerificationStepResult[];
  tamperDiff?: TamperDiff;
}
export function failure(code: FailureCode, trace: VerificationStepResult[] = []): Failure {
  return { ok: false, status: code === "ERR_TX_EXPIRED" ? "EXPIRED" : trace.length ? "REJECTED_CRYPTO" : "ERROR",
    failureCode: code, message: failureMessages[code], verificationTrace: trace };
}
