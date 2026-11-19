import { z } from "zod";
import type { FailureCode } from "@/lib/db/types";
import { failureFrom, TxError, type Failure } from "@/lib/tx/errors";

const httpStatus = {
  ERR_CSRF: 403, ERR_UNSUPPORTED_MEDIA_TYPE: 415, ERR_PREPARE_LIMIT: 429,
  ERR_INVALID_INPUT: 400, ERR_TX_NOT_FOUND: 404, ERR_USER_NOT_FOUND: 404, ERR_DEVICE_NOT_FOUND: 404,
  ERR_TX_STATE: 409, ERR_TX_EXPIRED: 409, ERR_INSUFFICIENT_FUNDS: 409, ERR_ACK_REQUIRED: 409,
  ERR_COOLING_OFF: 409, ERR_COSIGNER: 403, ERR_REPLAY_DETECTED: 403, ERR_WYSIWYS_TAMPERED: 403,
  ERR_ORIGIN_MISMATCH: 403, ERR_WEBAUTHN_INVALID: 403, ERR_PQ_SIGNATURE_INVALID: 403,
  ERR_DEVICE_NOT_ALLOWED: 403, ERR_SIMULATION_ONLY: 403, ERR_STORAGE: 500,
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

// Next can construct request.url with its internal hostname. Host identifies the browser-facing authority.
export function targetOrigin(request: Request) {
  const url = new URL(request.url);
  return url.protocol + "//" + (request.headers.get("host") ?? url.host);
}

function checkMutation(request: Request) {
  const target = targetOrigin(request);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const loopback = new URL(target);
  const allowed = new Set([loopback.origin, process.env.SAFESIGN_ORIGIN]);
  for (const hostname of ["localhost", "127.0.0.1"]) {
    loopback.hostname = hostname;
    allowed.add(loopback.origin);
  }
  if ((origin !== null && !allowed.has(origin)) || (origin === null && site && site !== "same-origin")) {
    throw new TxError("ERR_CSRF");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new TxError("ERR_UNSUPPORTED_MEDIA_TYPE");
  if (origin === null && site !== "same-origin") throw new TxError("ERR_CSRF");
}

export function post(action: (body: unknown, request: Request) => Promise<Response>) {
  return (request: Request) => handle(async () => {
    checkMutation(request);
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new TxError("ERR_INVALID_INPUT"); }
    return action(body, request);
  });
}

export function query<S extends z.ZodType>(schema: S, action: (params: z.output<S>, request: Request) => Response | Promise<Response>) {
  return (request: Request) => handle(() => {
    if (request.method === "DELETE") checkMutation(request);
    return action(schema.parse(Object.fromEntries(new URL(request.url).searchParams)), request);
  });
}

export const emptyQuery = z.object({}).strict();

export function requestOrigin(request: Request) {
  return request.headers.get("origin") ?? targetOrigin(request);
}
