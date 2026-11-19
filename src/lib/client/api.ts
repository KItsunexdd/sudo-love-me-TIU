import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { z } from "zod";
import type { RegisteredDevice, DeviceKind, TxStatus } from "@/lib/db/types";
import type { demoUsers, resetDemo } from "@/lib/db/demo";
import type { pollEvents, EventFilter } from "@/lib/events/bus";
import type { socReport } from "@/lib/soc/service";
import type { Failure } from "@/lib/tx/errors";
import type { prepareSchema, riskPreviewSchema, executeSchema, cosignerSchema, cosignSubmitSchema, rejectSchema } from "@/lib/tx/inputs";
import type { TransactionService } from "@/lib/tx/service";

type ServiceSuccess<K extends keyof TransactionService> =
  Omit<Extract<Awaited<ReturnType<TransactionService[K]>>, { ok: true }>, "ok">;

export type PrepareInput = z.input<typeof prepareSchema>;
export type PrepareResponse = Omit<ServiceSuccess<"prepare">, "status">;
export type ExecuteInput = Omit<z.input<typeof executeSchema>, "webAuthnAssertion"> & {
  webAuthnAssertion: AuthenticationResponseJSON;
};
export type ExecuteResponse = Pick<ServiceSuccess<"execute">, "transaction"> & (
  | { status: "PENDING_COSIGN"; cosigner: NonNullable<ServiceSuccess<"execute">["cosigner"]> }
  | { status: "EXECUTED"; verificationTrace: ServiceSuccess<"execute">["verificationTrace"] }
);
export type CosignPrepareResponse = ServiceSuccess<"cosignPrepare">;
export type CosignSubmitInput = Omit<z.input<typeof cosignSubmitSchema>, "webAuthnAssertion"> & {
  webAuthnAssertion: AuthenticationResponseJSON;
};
export type RegistrationInput = { userId: string; deviceName: string; deviceKind?: DeviceKind };
export type RegistrationOptions = PublicKeyCredentialCreationOptionsJSON & { rpId: string; challengeId: string };
export type RegistrationVerificationInput = RegistrationInput & {
  challengeId: string;
  attestationResponse: RegistrationResponseJSON;
  pqPublicKeyBase64: string;
  pqProofOfPossessionBase64: string;
};
export type DemoUsersResponse = Awaited<ReturnType<typeof demoUsers>>;
export type PollResponse = ReturnType<typeof pollEvents>;
export type { EventFilter, DemoEvent } from "@/lib/events/bus";

export type ApiError = Omit<Failure, "ok" | "status" | "failureCode" | "verificationTrace"> & {
  status: string;
  failureCode: string;
  verificationTrace?: Failure["verificationTrace"];
};
export type ApiResult<T> =
  | { ok: true; status: number; data: T; error: null }
  | { ok: false; status: number; data: null; error: ApiError };

function fail(status: number, failureCode: string, message: string): ApiResult<never> {
  return { ok: false, status, data: null, error: { status: "ERROR", failureCode, message } };
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "status" in value && typeof value.status === "string" &&
    "failureCode" in value && typeof value.failureCode === "string" && "message" in value && typeof value.message === "string";
}

type RequestSpec = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

function withQuery(path: string, query: RequestSpec["query"]) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size ? `${path}?${params}` : path;
}

async function request<T>(path: string | (() => string), spec: RequestSpec = {}, stream = false): Promise<ApiResult<T>> {
  let status = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  try {
    if (!stream) {
      spec.signal?.addEventListener("abort", cancel, { once: true });
      if (spec.signal?.aborted) cancel();
      timer = setTimeout(() => { timedOut = true; cancel(); }, 15_000);
    }
    const response = await fetch(withQuery(typeof path === "string" ? path : path(), spec.query), {
      method: spec.method ?? "GET", cache: "no-store", signal: stream ? spec.signal : controller.signal,
      headers: {
        Accept: stream ? "text/event-stream" : "application/json",
        ...((spec.method === "POST" || spec.method === "DELETE") && { "Content-Type": "application/json" }),
      },
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    });
    status = response.status;
    if (stream && response.ok) {
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
        await response.body?.cancel();
        return fail(status, "ERR_INVALID_RESPONSE", "Сервер не открыл поток событий.");
      }
      return { ok: true, status, data: response.body as T, error: null };
    }
    const data: unknown = await response.json().catch(() => null);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (isApiError(data)) return { ok: false, status, data: null, error: data };
    if (!response.ok) return fail(status, "ERR_HTTP", `Сервер вернул HTTP ${status}.`);
    if (typeof data !== "object" || data === null) {
      return fail(status, "ERR_INVALID_RESPONSE", "Сервер вернул ответ в неожиданном формате.");
    }
    return { ok: true, status, data: data as T, error: null };
  } catch {
    if (spec.signal?.aborted) return fail(status, "ERR_REQUEST_CANCELLED", "Запрос отменён.");
    if (timedOut) return fail(status, "ERR_NETWORK_TIMEOUT", "Сервер не ответил вовремя.");
    return fail(status, "ERR_NETWORK", "Не удалось связаться с сервером.");
  } finally {
    clearTimeout(timer);
    spec.signal?.removeEventListener("abort", cancel);
  }
}

export const eventStreamUrl = (filter: EventFilter = {}) => withQuery("/api/events/stream", { ...filter });

export const api = {
  registerOptions: (body: RegistrationInput) =>
    request<RegistrationOptions>("/api/auth/register/options", { method: "POST", body }),
  registerVerify: (body: RegistrationVerificationInput) =>
    request<{ verified: true; device: RegisteredDevice }>("/api/auth/register/verify", { method: "POST", body }),
  listDevices: (userId: string, signal?: AbortSignal) => request<{ devices: RegisteredDevice[] }>("/api/devices", { query: { userId }, signal }),
  revokeDevice: (id: string) => request<{ status: "REVOKED"; deviceId: string }>("/api/devices", { method: "DELETE", query: { id } }),
  users: (signal?: AbortSignal) => request<DemoUsersResponse>("/api/users", { signal }),
  riskPreview: (body: z.input<typeof riskPreviewSchema>, signal?: AbortSignal) =>
    request<Awaited<ReturnType<TransactionService["preview"]>>>("/api/risk/preview", { method: "POST", body, signal }),
  prepare: (body: PrepareInput) => request<PrepareResponse>("/api/transactions/prepare", { method: "POST", body }),
  execute: (body: ExecuteInput) => request<ExecuteResponse>("/api/transactions/execute", { method: "POST", body }),
  getTransaction: (id: string, signal?: AbortSignal) =>
    request<ServiceSuccess<"getTransaction">>(() => `/api/transactions/${encodeURIComponent(id)}`, { signal }),
  listTransactions: (query: { status?: TxStatus; userId?: string } = {}, signal?: AbortSignal) =>
    request<ServiceSuccess<"listTransactions">>("/api/transactions", { query, signal }),
  cosignPrepare: (body: z.input<typeof cosignerSchema>) =>
    request<CosignPrepareResponse>("/api/transactions/cosign/prepare", { method: "POST", body }),
  cosignSubmit: (body: CosignSubmitInput) => request<Pick<ServiceSuccess<"cosignSubmit">, "status" | "transaction">>(
    "/api/transactions/cosign/submit", { method: "POST", body }),
  cosignReject: (body: z.input<typeof rejectSchema>) => request<Omit<ServiceSuccess<"cosignReject">, "transaction">>(
    "/api/transactions/cosign/reject", { method: "POST", body }),
  streamEvents: (filter: EventFilter = {}, signal?: AbortSignal) =>
    request<ReadableStream<Uint8Array>>("/api/events/stream", { query: { ...filter }, signal }, true),
  pollEvents: (filter: EventFilter & { since?: number | string } = {}, signal?: AbortSignal) =>
    request<PollResponse>("/api/events/poll", { query: { ...filter }, signal }),
  socEvents: (signal?: AbortSignal) => request<Awaited<ReturnType<typeof socReport>>>("/api/soc/events", { signal }),
  resetDemo: (keepDevices: boolean) =>
    request<Awaited<ReturnType<typeof resetDemo>> & { status: "RESET" }>("/api/demo/reset", { method: "POST", body: { keepDevices } }),
};
