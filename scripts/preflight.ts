import assert from "node:assert/strict";
import { styleText } from "node:util";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { toBase64 } from "../src/lib/crypto/canonical";
import { createPqProofOfPossession, keygen } from "../src/lib/crypto/mldsa";
import { registerSoftware } from "../src/lib/crypto/software-authenticator";
import { createSeed } from "../src/lib/db/seed";
import type { RegisteredDevice, User, VerificationStepResult } from "../src/lib/db/types";
import { demoTransfer, signTransfer, type PreparedTransfer } from "./demo-transfer";

const timeoutMs = 20_000;
const helloDeadlineMs = 2_000;
const pagePaths = ["/", "/cosign", "/soc", "/roi", "/phishing-clone"];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function finish(ready: boolean) {
  console.log(`\n${styleText(ready ? "green" : "red", ready ? "READY" : "NOT READY")}`);
  process.exitCode = ready ? 0 : 1;
}

function fetchFrom(url: URL, init?: RequestInit) {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...init }).catch((error: unknown) => {
    throw new Error(`${url} — ${errorMessage(error)}`, { cause: error });
  });
}

async function requestJson<T>(base: URL, path: string, options: {
  method?: "POST" | "DELETE"; body?: unknown; origin?: string; status?: number;
} = {}) {
  const { method, body, origin = base.origin, status = 200 } = options;
  const response = await fetchFrom(new URL(path, base), {
    method,
    headers: method ? { Origin: origin, "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => undefined);
  const operation = `${method ?? "GET"} ${path}`;
  if (response.status !== status) {
    const details = [json?.failureCode, json?.message].filter(Boolean).join(" — ");
    throw new Error(`${operation} — HTTP ${response.status}, ожидался ${status}${details ? ` (${details})` : ""}`);
  }
  assert(json && typeof json === "object" && !Array.isArray(json), `${operation} — ожидался объект JSON`);
  return json as T;
}

async function checkPage(url: URL) {
  const response = await fetchFrom(url);
  await response.body?.cancel();
  assert.equal(response.status, 200, `HTTP ${response.status}, ожидался 200`);
  const csp = response.headers.get("content-security-policy");
  const frame = response.headers.get("x-frame-options");
  const missing = [!csp && "CSP", !frame && "X-Frame-Options"].filter(Boolean);
  assert(csp && frame, `HTTP 200, отсутствуют заголовки ${missing.join(", ")}`);
  return csp;
}

async function checkBalances(base: URL) {
  const { users } = await requestJson<{ users: User[] }>(base, "/api/users");
  const seed = createSeed().users;
  assert(Array.isArray(users), "/api/users — отсутствует список пользователей");
  const differences = seed.filter(expected => {
    const actual = users.find(user => user.id === expected.id);
    return !actual || actual.balanceTenge !== expected.balanceTenge ||
      actual.depositBalanceTenge !== expected.depositBalanceTenge ||
      (actual.loanBalanceTenge ?? 0) !== (expected.loanBalanceTenge ?? 0);
  });
  assert(differences.length === 0 && users.length === seed.length,
    `Балансы отличаются от seed (${differences.map(user => user.id).join(", ") || "состав пользователей"}). ` +
    "Нажмите «Сбросить демо» с галочкой «Сохранить мои Passkeys».");
}

async function checkHello(base: URL) {
  const signal = AbortSignal.timeout(helloDeadlineMs);
  const start = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchFrom(new URL("/api/events/stream?channel=soc", base), { signal });
    reader = response.body?.getReader();
    assert(response.status === 200 && reader && response.headers.get("content-type")?.startsWith("text/event-stream"),
      `HTTP ${response.status}, ожидался поток text/event-stream`);
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      assert(!chunk.done, "Поток закрылся до события hello");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      if (frames.some(frame => /^event: ?hello\r?$/m.test(frame))) {
        const elapsed = performance.now() - start;
        assert(elapsed < helloDeadlineMs, "Событие hello не получено за 2 с");
        return `hello за ${elapsed.toFixed(1)} мс`;
      }
    }
  } catch (error) {
    if (signal.aborted) throw new Error("Событие hello не получено за 2 с", { cause: error });
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

async function main() {
  const base = new URL(process.env.BASE_URL ?? "http://localhost:3000");
  assert(base.protocol === "http:" || base.protocol === "https:", "BASE_URL должен использовать HTTP или HTTPS");
  const loopback = new URL("http://127.0.0.1");
  loopback.port = base.port || (base.protocol === "https:" ? "443" : "80");
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());

  let ready = true;
  function log(color: "green" | "red" | "yellow", label: string) {
    const marker = { green: "✓", red: "✗", yellow: "⚠" }[color];
    console.log(styleText(color, `${marker} ${label}`));
  }

  async function check(label: string, action: () => Promise<string | void>) {
    try {
      const detail = await action();
      log("green", detail ? `${label} — ${detail}` : label);
    } catch (error) {
      ready = false;
      log("red", `${label} — ${errorMessage(error)}`);
    }
  }

  console.log(`BCC SafeSign · ${base.origin}`);
  const night = Number(localTime.slice(0, 2)) < 6;
  log(night ? "yellow" : "green", `Алматы ${localTime}${night ? " — ночное правило +15" : ""}`);

  for (const path of pagePaths) {
    let csp: string | undefined;
    await check(`GET ${path}`, async () => {
      csp = await checkPage(new URL(path, base));
      return "HTTP 200, CSP и X-Frame-Options";
    });
    if (path === "/" && csp) {
      // SafeSign adds unsafe-eval to script-src only in Next.js development mode.
      const dev = /\bscript-src\s+[^;,]*'unsafe-eval'/.test(csp);
      log(dev ? "yellow" : "green", dev ? "Режим dev. Для сцены запустите npm run build и npm start." : "Режим production");
    }
  }
  const clone = new URL("/phishing-clone", loopback);
  await check(`GET ${clone.href}`, async () => {
    await checkPage(clone);
    return "HTTP 200, CSP и X-Frame-Options";
  });
  await check("GET /api/users", async () => {
    await checkBalances(base);
    return "балансы совпадают с seed";
  });
  await check("SSE channel=soc", () => checkHello(base));

  const executePath = "/api/transactions/execute";
  type ExecuteResponse = { status: string; failureCode?: string; verificationTrace: VerificationStepResult[] };
  let deviceId: string | undefined;
  let registrationAttempted = false;
  try {
    await check("Сквозной прогон software-ключом", async () => {
      assert.notEqual(base.origin, loopback.origin, "Для BASE_URL укажите origin банка, например http://localhost:<port>");
      Object.defineProperty(globalThis, "location", { configurable: true, value: base });
      const input = { userId: demoTransfer.senderId, deviceName: "Временный ключ preflight", deviceKind: "SOFTWARE_FALLBACK" };
      registrationAttempted = true;
      const options = await requestJson<PublicKeyCredentialCreationOptionsJSON & { challengeId: string }>(base,
        "/api/auth/register/options", { method: "POST", body: input });
      const { credential, response } = await registerSoftware(options);
      const pq = keygen();
      const registration = await requestJson<{ verified: boolean; device: RegisteredDevice }>(base,
        "/api/auth/register/verify", { method: "POST", body: {
          ...input, challengeId: options.challengeId, attestationResponse: response, pqPublicKeyBase64: toBase64(pq.publicKey),
          pqProofOfPossessionBase64: createPqProofOfPossession(input.userId, response.id, options.challenge, pq.secretKey),
        } });
      assert(registration.verified === true && registration.device?.deviceKind === input.deviceKind &&
        registration.device.userId === input.userId && registration.device.credentialId === credential.id &&
        registration.device.id, "Регистрация временного ключа не подтверждена");
      deviceId = registration.device.id;

      async function signedTransfer(id: string, originOverride?: string) {
        const prepared = await requestJson<PreparedTransfer>(base, "/api/transactions/prepare", {
          method: "POST", body: demoTransfer,
        });
        return signTransfer(prepared, id, credential, pq.secretKey, originOverride);
      }

      const packet = await signedTransfer(deviceId);
      const body = { method: "POST", body: packet } as const;
      const executed = await requestJson<ExecuteResponse>(base, executePath, body);
      assert.equal(executed.status, "EXECUTED", "Execute (200) должен вернуть EXECUTED");
      assert(executed.verificationTrace?.length === 7 && executed.verificationTrace.every(step => step.passed),
        "Execute — ожидались 7 пройденных шагов");
      const replay = await requestJson<ExecuteResponse>(base, executePath, { ...body, status: 403 });
      assert.equal(replay.failureCode, "ERR_REPLAY_DETECTED", "Replay (403) — неожиданный код ошибки");

      const foreign = await requestJson<ExecuteResponse>(base, executePath, {
        method: "POST", body: await signedTransfer(deviceId, loopback.origin), origin: loopback.origin, status: 403,
      });
      assert.equal(foreign.failureCode, "ERR_ORIGIN_MISMATCH", "Origin 127.0.0.1 (403) — неожиданный код ошибки");
      assert.equal(foreign.verificationTrace?.[3]?.outcome, "FAIL", "Origin 127.0.0.1 — ожидался отказ на шаге 4");
      return "register → prepare → 200 EXECUTED → 403 ERR_REPLAY_DETECTED → 403 ERR_ORIGIN_MISMATCH";
    });
  } finally {
    if (deviceId) {
      const id = deviceId;
      await check("Временный software-ключ отозван", async () => {
        const revoked = await requestJson<{ status: string; deviceId: string }>(base,
          `/api/devices?${new URLSearchParams({ id })}`, { method: "DELETE" });
        assert(revoked.status === "REVOKED" && revoked.deviceId === id, "Отзыв временного ключа не подтверждён");
      });
    }
    if (registrationAttempted) {
      await check("POST /api/demo/reset", async () => {
        const reset = await requestJson<{ status: string; keepDevices: boolean }>(base, "/api/demo/reset", {
          method: "POST", body: { keepDevices: true },
        });
        assert(reset.status === "RESET" && reset.keepDevices === true, "Сервер не подтвердил сброс с сохранением Passkeys");
        await checkBalances(base);
        return "балансы восстановлены, Passkeys сохранены";
      });
    }
  }

  finish(ready);
}

main().catch((error: unknown) => {
  console.error(styleText("red", `✗ ${errorMessage(error)}`));
  finish(false);
});
