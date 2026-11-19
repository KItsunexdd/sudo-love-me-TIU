import { z } from "zod";
import type { FailureCode } from "@/lib/db/types";
import { failureFrom, TxError, type Failure } from "@/lib/tx/errors";

const httpStatus = {
  ERR_INVALID_INPUT: 400, ERR_TX_NOT_FOUND: 404, ERR_USER_NOT_FOUND: 404, ERR_DEVICE_NOT_FOUND: 404,
  ERR_TX_STATE: 409, ERR_TX_EXPIRED: 409, ERR_INSUFFICIENT_FUNDS: 409, ERR_ACK_REQUIRED: 409,
  ERR_COOLING_OFF: 409, ERR_COSIGNER: 403, ERR_REPLAY_DETECTED: 403, ERR_WYSIWYS_TAMPERED: 403,
  ERR_ORIGIN_MISMATCH: 403, ERR_WEBAUTHN_INVALID: 403, ERR_PQ_SIGNATURE_INVALID: 403,
  ERR_SIMULATION_ONLY: 403, ERR_STORAGE: 500,
} satisfies Record<FailureCode, number>;

function errorResponse({ status, failureCode, message, verificationTrace, tamperDiff }: Failure) {
  return Response.json({ status, failureCode, message,
    verificationTrace: verificationTrace.length ? verificationTrace : undefined, tamperDiff },
  { status: httpStatus[failureCode] });
}

export async function handle(action: () => Promise<Response> | Response) {
  try {
    return await action();
  } catch (error) {
    return errorResponse(failureFrom(error));
  }
}

export function json<T extends object>(result: Failure | (T & { ok?: true }), status = 200) {
  if (result.ok === false) return errorResponse(result);
  // ok is the internal service discriminant. Only expose the public contract over HTTP.
  const body = { ...result };
  if ("ok" in body) delete body.ok;
  return Response.json(body, { status });
}

export function post(action: (body: unknown, request: Request) => Promise<Response>) {
  return (request: Request) => handle(async () => {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new TxError("ERR_INVALID_INPUT"); }
    return action(body, request);
  });
}

export function query<S extends z.ZodType>(schema: S, action: (params: z.output<S>, request: Request) => Response | Promise<Response>) {
  return (request: Request) => handle(() => action(schema.parse(Object.fromEntries(new URL(request.url).searchParams)), request));
}

export const emptyQuery = z.object({}).strict();

export function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin;
  const url = new URL(request.url);
  return url.protocol + "//" + (request.headers.get("host") ?? url.host);
}
