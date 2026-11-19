import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { POST as options } from "@/app/api/auth/register/options/route";
import { POST as verify } from "@/app/api/auth/register/verify/route";
import { GET as devices, DELETE as revoke } from "@/app/api/devices/route";
import { GET as users } from "@/app/api/users/route";
import { POST as preview } from "@/app/api/risk/preview/route";
import { POST as prepare } from "@/app/api/transactions/prepare/route";
import { POST as execute } from "@/app/api/transactions/execute/route";
import { POST as cosignPrepare } from "@/app/api/transactions/cosign/prepare/route";
import { POST as cosignSubmit } from "@/app/api/transactions/cosign/submit/route";
import { POST as cosignReject } from "@/app/api/transactions/cosign/reject/route";
import { GET as transactions } from "@/app/api/transactions/route";
import { GET as transaction } from "@/app/api/transactions/[id]/route";
import { GET as soc } from "@/app/api/soc/events/route";
import { GET as stream } from "@/app/api/events/stream/route";
import { GET as poll } from "@/app/api/events/poll/route";
import { POST as reset } from "@/app/api/demo/reset/route";
import { assertSoftware, registerSoftware } from "@/lib/crypto/software-authenticator";
import { fromBase64, toBase64 } from "@/lib/crypto/canonical";
import { cosignMessage, keygen, primaryMessage, sign } from "@/lib/crypto/mldsa";
import { recipientPresets } from "@/lib/db/seed";
import type { CanonicalTxPayload, SecurityEvent } from "@/lib/db/types";

const bank = "http://localhost:3000";
const other = "http://127.0.0.1:3000";
const aigul = "usr_aigul", arman = "usr_arman";
const low = { senderId: aigul, mode: "B2C", operationType: "P2P_TRANSFER", purpose: "На продукты", ...recipientPresets.son };
const high = { ...low, ...recipientPresets.unknown, simulatedContext: { activeUnknownCall: true } };

function req(path: string, body?: unknown, headers?: Record<string, string>, origin = bank) {
  return new Request(origin + "/api/" + path, body === undefined ? { headers } : {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

async function read(response: Promise<Response>, status = 200) {
  const res = await response;
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function registration(userId: string) {
  const input = { deviceName: "Ключ " + userId, userId };
  const opts: PublicKeyCredentialCreationOptionsJSON & { challengeId: string; rpId: string } =
    await read(options(req("auth/register/options", input)));
  expect(opts.rpId).toBe("localhost");
  const { response, credential } = await registerSoftware(opts);
  const pq = keygen();
  const body = { ...input, deviceKind: "SOFTWARE_FALLBACK", attestationResponse: response, pqPublicKeyBase64: toBase64(pq.publicKey) };
  return { body, credential, pq, challengeId: opts.challengeId };
}

async function enroll(userId: string) {
  const { body, credential, pq } = await registration(userId);
  const { device, verified } = await read(verify(req("auth/register/verify", body)));
  expect(verified).toBe(true);
  expect(device).toMatchObject({ deviceKind: "SOFTWARE_FALLBACK", userId });
  return { deviceId: String(device.id), credential, pq };
}

async function primary(signer: Awaited<ReturnType<typeof enroll>>, input = low, host = bank) {
  const tx: { txId: string; payload: CanonicalTxPayload; txHashHex: string; webAuthnOptions: PublicKeyCredentialRequestOptionsJSON } =
    await read(prepare(req("transactions/prepare", input, undefined, host)));
  return {
    txId: tx.txId, submittedPayload: tx.payload, deviceId: signer.deviceId,
    webAuthnAssertion: await assertSoftware(signer.credential, tx.webAuthnOptions),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(tx.txHashHex)), signer.pq.secretKey)),
  };
}

beforeEach(async () => {
  vi.stubEnv("SAFESIGN_STORAGE", "memory");
  await read(reset(req("demo/reset", { keepDevices: false })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("REST §7", () => {
  it("обрабатывает перевод, повторное подтверждение, изменение суммы и чужой Origin через execute", async () => {
    const actor = await enroll(aigul);
    const packet = await primary(actor);
    const receipt = await read(execute(req("transactions/execute", { ...packet, attackTag: "NONE" }, { Host: "localhost:3000" })));
    expect(receipt.status).toBe("EXECUTED");
    expect(receipt.verificationTrace).toHaveLength(7);
    expect(await read(execute(req("transactions/execute", { ...packet, attackTag: "REPLAY" })), 403))
      .toMatchObject({ status: "REJECTED_CRYPTO", failureCode: "ERR_REPLAY_DETECTED" });

    const next = await primary(actor);
    const mismatch = { ...next, submittedPayload: { ...next.submittedPayload, amountTenge: 16_000 }, attackTag: "MITM_AMOUNT" };
    expect(await read(execute(req("transactions/execute", mismatch)), 403)).toMatchObject({
      failureCode: "ERR_WYSIWYS_TAMPERED", tamperDiff: [{ field: "amountTenge", original: "15000", tampered: "16000" }],
    });
    const foreignHeaders: Record<string, string>[] = [{ Origin: other, Host: "localhost:3000" }, { Host: "127.0.0.1:3000" }];
    for (const headers of foreignHeaders) {
      const packet = await primary(actor, low, other);
      const result = await read(execute(req("transactions/execute", { ...packet, attackTag: "PHISHING_ORIGIN" }, headers)), 403);
      expect(result.failureCode).toBe("ERR_ORIGIN_MISMATCH");
      expect(result.verificationTrace[3].outcome).toBe("FAIL");
    }

    const report = await read(soc(req("soc/events", undefined, undefined, other)));
    expect(report.aggregates).toMatchObject({
      signedWithoutSms: 1, attacksBlocked: 4, savedAmountTenge: 60_000,
      blockedByType: { MITM_AMOUNT: 1, REPLAY: 1, PHISHING_ORIGIN: 2 },
    });
    for (const metric of [report.aggregates.verification.mlDsa, report.aggregates.verification.webAuthn]) {
      expect(metric.count).toBe(2);
      expect(metric.averageMs).toBeGreaterThan(0);
      expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.averageMs);
    }
    expect(report.events.find((e: SecurityEvent) => e.eventType === "ATTACK_MITM_BLOCKED").technicalDetails.attackTag).toBe("MITM_AMOUNT");
    expect((await read(users(req("users")))).users[0].balanceTenge).toBe(1_185_000);
  });

  it.each(["submit", "reject"])("проводит перевод на 850 000 ₸ через решение сына (%s), затем сбрасывает стенд", async decision => {
    const sender = await enroll(aigul), son = await enroll(arman);
    const risk = await read(preview(req("risk/preview", { ...high, recipientName: undefined, purpose: undefined })));
    expect(risk.risk).toMatchObject({ score: 100, requiresCoSign: true });
    expect((await read(transactions(req("transactions")))).transactions).toEqual([]);
    const packet = await primary(sender, high);
    const { txId } = packet;
    const context = { txId, cosignerUserId: arman };
    const pending = await read(execute(req("transactions/execute", packet)), 202);
    expect(pending).toMatchObject({ status: "PENDING_COSIGN", cosigner: { id: arman }, transaction: { id: txId } });
    expect((await read(transactions(req("transactions?status=PENDING_COSIGN&userId=usr_arman")))).transactions).toHaveLength(1);
    expect((await read(transactions(req("transactions?status=PENDING_COSIGN&userId=usr_timur")))).transactions).toHaveLength(0);
    const prepared = await read(cosignPrepare(req("transactions/cosign/prepare", context)));
    let expectedStatus: string;
    if (decision === "submit") {
      const message = cosignMessage(hexToBytes(prepared.txHashHex), fromBase64(packet.pqSignatureBase64));
      const second = { txId, deviceId: son.deviceId, webAuthnAssertion: await assertSoftware(son.credential, prepared.webAuthnOptions),
        pqSignatureBase64: toBase64(sign(message, son.pq.secretKey)) };
      expect(await read(cosignSubmit(req("transactions/cosign/submit", second)))).toMatchObject({
        status: "EXECUTED", transaction: { primarySignature: { deviceId: sender.deviceId }, cosignSignature: { deviceId: son.deviceId } },
      });
      expectedStatus = "EXECUTED";
    } else {
      expect(await read(cosignReject(req("transactions/cosign/reject", { ...context, reason: "SUSPECTED_SCAM", activateCoolingOff: true }))))
        .toEqual({ status: "BLOCKED_BY_COSIGNER", savedAmountTenge: 850_000, coolingOffActive: true });
      expectedStatus = "BLOCKED_BY_COSIGNER";
      expect((await read(prepare(req("transactions/prepare", low)), 409)).failureCode).toBe("ERR_COOLING_OFF");
    }
    const record = await read(transaction(req("transactions/" + txId), { params: Promise.resolve({ id: txId }) }));
    expect(record.transaction.status).toBe(expectedStatus);
    const { aggregates } = await read(soc(req("soc/events")));
    expect(aggregates.savedAmountTenge).toBe(decision === "reject" ? 850_000 : 0);
    expect(aggregates.verification.mlDsa.count).toBe(decision === "reject" ? 1 : 2);
    const state = await read(users(req("users")));
    expect(state.users[0]).toMatchObject({ balanceTenge: decision === "reject" ? 1_200_000 : 350_000, depositBalanceTenge: 2_500_000 });
    expect(state.users[0].coolingOffActive).toBe(decision === "reject");
    expect(state.recipientPresets).toEqual(recipientPresets);
    await read(reset(req("demo/reset", { keepDevices: true })));
    expect((await read(devices(req("devices?userId=usr_aigul")))).devices).toHaveLength(1);
    expect((await read(soc(req("soc/events")))).events).toEqual([]);
    expect((await read(users(req("users")))).users[0].balanceTenge).toBe(1_200_000);
    await read(reset(req("demo/reset", { keepDevices: false })));
    expect((await read(devices(req("devices?userId=usr_aigul")))).devices).toEqual([]);
  });

  it("проверяет одноразовую регистрацию, длину ключа, origin, привязку challenge и отзыв", async () => {
    const { body, challengeId } = await registration(aigul);
    expect((await read(verify(req("auth/register/verify", { ...body, pqPublicKeyBase64: toBase64(new Uint8Array(1953)) })), 400))
      .failureCode).toBe("ERR_INVALID_INPUT");
    expect((await read(verify(req("auth/register/verify", body, { Origin: other })), 403)).failureCode).toBe("ERR_ORIGIN_MISMATCH");
    expect((await read(verify(req("auth/register/verify", { ...body, userId: arman })), 403)).failureCode).toBe("ERR_WEBAUTHN_INVALID");
    const response = await read(verify(req("auth/register/verify", { ...body, deviceKind: undefined, challengeId })));
    expect(response.device.deviceKind).toBe("PLATFORM_PASSKEY");
    await read(verify(req("auth/register/verify", body)), 403);
    const { devices: list } = await read(devices(req("devices?userId=" + aigul)));
    expect(list).toHaveLength(1);
    const url = bank + "/api/devices?id=" + list[0].id;
    await read(revoke(new Request(url, { method: "DELETE" })));
    await read(revoke(new Request(url, { method: "DELETE" })), 404);
    expect((await read(prepare(req("transactions/prepare", low)), 404)).failureCode).toBe("ERR_DEVICE_NOT_FOUND");
  });

  it("после перевыпуска принимает подпись нового устройства и отклоняет ранее подготовленную со старого", async () => {
    const old = await enroll(aigul);
    const outstanding = await primary(old);
    await read(revoke(new Request(bank + "/api/devices?id=" + old.deviceId, { method: "DELETE" })));
    const replacement = await enroll(aigul);
    expect(replacement.deviceId).not.toBe(old.deviceId);
    expect((await read(execute(req("transactions/execute", outstanding)), 403)).failureCode).toBe("ERR_WEBAUTHN_INVALID");
    expect((await read(execute(req("transactions/execute", await primary(replacement))))).status).toBe("EXECUTED");
  });

  it("ограничивает срок регистрации и аннулирует незавершённую привязку при сбросе", async () => {
    const first = await registration(aigul);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    await read(verify(req("auth/register/verify", first.body)), 403);
    const second = await registration(aigul);
    await read(reset(req("demo/reset", { keepDevices: true })));
    await read(verify(req("auth/register/verify", second.body)), 403);
  });

  it("отказывает до выдачи challenge при нехватке средств на выбранном счёте", async () => {
    for (const input of [{ ...low, amountTenge: 1_200_001 }, { ...low, operationType: "DEPOSIT_CLOSE", amountTenge: 2_500_001 }]) {
      expect((await read(prepare(req("transactions/prepare", input)), 409)).failureCode).toBe("ERR_INSUFFICIENT_FUNDS");
    }
    expect((await read(transactions(req("transactions")))).transactions).toEqual([]);
    expect((await read(poll(req("events/poll?since=0")))).events).toHaveLength(1); // reset only
  });

  it("возвращает JSON для ошибок запроса, отсутствующих записей и отказа хранилища", async () => {
    const missing = { id: "absent" };
    await read(transaction(req("transactions/absent"), { params: Promise.resolve(missing) }), 404);
    const malformed = new Request(bank + "/api/demo/reset", { method: "POST", body: "{" });
    for (const response of [reset(malformed), reset(req("demo/reset", {})), devices(req("devices")),
      transactions(req("transactions?status=bad")), stream(req("events/stream?channel=bad")), poll(req("events/poll?since=bad"))]) {
      expect(await read(response, 400)).toEqual({ status: "ERROR", failureCode: "ERR_INVALID_INPUT", message: expect.any(String) });
    }
    vi.stubEnv("SAFESIGN_STORAGE", "unavailable");
    expect(await read(users(req("users")), 500)).toEqual({ status: "ERROR", failureCode: "ERR_STORAGE", message: expect.any(String) });
  });
});

async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  const chunk = new TextDecoder().decode(value);
  const id = Number(/^id: (\d+)$/m.exec(chunk)?.[1]);
  const type = /^event: (\w+)$/m.exec(chunk)?.[1];
  const data = JSON.parse(/^data: (.+)$/m.exec(chunk)![1]);
  return { id, type, data };
}

it("доставляет prepare и execute по SSE, продолжает polling с того же курсора и закрывается по abort", async () => {
  const actor = await enroll(aigul);
  const controller = new AbortController();
  const response = await stream(new Request(bank + "/api/events/stream?userId=" + aigul, { signal: controller.signal }));
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  try {
    const hello = await nextEvent(reader);
    expect(hello.type).toBe("hello");
    const packet = await primary(actor);
    const issued = await nextEvent(reader);
    expect(issued).toMatchObject({ type: "TX_UPDATED", data: { txId: packet.txId, status: "CHALLENGE_ISSUED" } });
    await read(execute(req("transactions/execute", packet)));
    const executed = await nextEvent(reader);
    expect(executed).toMatchObject({ type: "TX_UPDATED", data: { txId: packet.txId, status: "EXECUTED" } });
    expect(executed.id).toBeGreaterThan(issued.id);
    const polled = await read(poll(req("events/poll?userId=" + aigul + "&since=" + issued.id)));
    expect(polled.events).toEqual([{ id: executed.id, ...executed.data }]);
    expect(polled.cursor).toBe(executed.id);
    expect((await read(poll(req("events/poll?userId=usr_timur&since=" + hello.id)))).events).toEqual([]);
    controller.abort();
    expect((await reader.read()).done).toBe(true);
  } finally { controller.abort(); await reader.cancel(); }
});

it("фильтрует запросы второй руки и оповещения SOC", async () => {
  const actor = await enroll(aigul);
  const reader = (await stream(req("events/stream?userId=usr_arman&channel=cosign"))).body!.getReader();
  try {
    const hello = await nextEvent(reader);
    const small = await primary(actor);
    await read(execute(req("transactions/execute", small)));
    const packet = await primary(actor, high);
    await read(execute(req("transactions/execute", packet)), 202);
    expect(await nextEvent(reader)).toMatchObject({ type: "TX_UPDATED", data: { txId: packet.txId, status: "PENDING_COSIGN" } });
    expect(await nextEvent(reader)).toMatchObject({ type: "COSIGN_REQUESTED", data: { txId: packet.txId, cosignerUserId: arman } });
    await read(cosignReject(req("transactions/cosign/reject", { txId: packet.txId, cosignerUserId: arman })));
    const feed = await read(poll(req("events/poll?channel=soc&since=" + hello.id)));
    expect(feed.events).toContainEqual(expect.objectContaining({ type: "SECURITY_ALERT", event: expect.objectContaining({ txId: packet.txId }) }));
    expect(feed.events).not.toContainEqual(expect.objectContaining({ type: "COSIGN_REQUESTED" }));
  } finally { await reader.cancel(); }
});

it("отправляет heartbeat каждые 15 с и освобождает таймер и подписку при закрытии", async () => {
  vi.useFakeTimers();
  for (const close of ["abort", "cancel"]) {
    const controller = new AbortController();
    const reader = (await stream(new Request(bank + "/api/events/stream", { signal: controller.signal }))).body!.getReader();
    await nextEvent(reader);
    expect(vi.getTimerCount()).toBe(1);
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(15_000);
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");
    }
    if (close === "abort") controller.abort();
    else await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
    expect((await reader.read()).done).toBe(true);
    controller.abort();
  }
});
