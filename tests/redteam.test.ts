import nextConfig from "../next.config";
import { GET as stream } from "@/app/api/events/stream/route";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { POST as options } from "@/app/api/auth/register/options/route";
import { POST as verify } from "@/app/api/auth/register/verify/route";
import { POST as reset } from "@/app/api/demo/reset/route";
import { DELETE as revoke, GET as devices } from "@/app/api/devices/route";
import { GET as poll } from "@/app/api/events/poll/route";
import { GET as soc } from "@/app/api/soc/events/route";
import { GET as transactions } from "@/app/api/transactions/route";
import { POST as cosignReject } from "@/app/api/transactions/cosign/reject/route";
import { POST as execute } from "@/app/api/transactions/execute/route";
import { POST as prepare } from "@/app/api/transactions/prepare/route";
import { armInterceptor, buildExecuteBody, rememberValidPacket, replayLastPacket, resetAttackState } from "@/components/hacker/attacks";
import type { ExecuteInput } from "@/lib/client/api";
import { registerDevice } from "@/lib/client/signer";
import * as keystore from "@/lib/crypto/client-keystore";
import { hashPayload, toBase64 } from "@/lib/crypto/canonical";
import { createPqProofOfPossession, keygen, primaryMessage, sign } from "@/lib/crypto/mldsa";
import { assertSoftware, registerSoftware } from "@/lib/crypto/software-authenticator";
import { recipientPresets } from "@/lib/db/seed";
import type { CanonicalTxPayload } from "@/lib/db/types";

const bank = "http://localhost:3000";
const evilOrigin = "https://evil.example";
const foreignOrigin = "http://127.0.0.1:3000";
const aigul = "usr_aigul";
const arman = "usr_arman";
const dinara = "usr_dinara";

const lowB2C = {
  senderId: aigul,
  mode: "B2C",
  operationType: "P2P_TRANSFER",
  purpose: "На продукты",
  ...recipientPresets.son,
};

const highB2C = {
  ...lowB2C,
  ...recipientPresets.unknown,
  simulatedContext: { activeUnknownCall: true },
};

const mediumB2C = {
  ...lowB2C,
  simulatedContext: { activeUnknownCall: true },
};

const highB2B = {
  senderId: dinara,
  mode: "B2B",
  operationType: "B2B_INVOICE",
  purpose: "Оплата по счёту",
  ...recipientPresets.supplier,
};

function apiReq(path: string, body?: unknown, headers?: Record<string, string>, origin = bank) {
  return new Request(`${origin}/api/${path}`, body === undefined
    ? { headers }
    : {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
}

async function readJson(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, headers: res.headers, body: await res.json() };
}

async function enrollSoftware(userId: string, origin = bank) {
  const input = { deviceName: `Key-${userId}`, userId };
  const optsRes = await readJson(options(apiReq("auth/register/options", input, { Origin: origin }, origin)));
  expect(optsRes.status).toBe(200);
  const opts = optsRes.body as PublicKeyCredentialCreationOptionsJSON & { challengeId: string };

  const savedLocation = globalThis.location;
  vi.stubGlobal("location", new URL(origin));
  let reg: Awaited<ReturnType<typeof registerSoftware>>;
  try {
    reg = await registerSoftware(opts);
  } finally {
    vi.stubGlobal("location", savedLocation);
  }

  const pq = keygen();
  const verifyRes = await readJson(verify(apiReq("auth/register/verify", {
    ...input,
    deviceKind: "SOFTWARE_FALLBACK",
    challengeId: opts.challengeId,
    attestationResponse: reg.response,
    pqPublicKeyBase64: toBase64(pq.publicKey),
    pqProofOfPossessionBase64: createPqProofOfPossession(userId, reg.response.id, opts.challenge, pq.secretKey),
  }, { Origin: origin }, origin)));
  return { verifyRes, credential: reg.credential, pq };
}

async function prepareAndSign(
  signer: { deviceId: string; credential: Awaited<ReturnType<typeof registerSoftware>>["credential"]; pq: ReturnType<typeof keygen> },
  input: Record<string, unknown> = lowB2C,
  originOverride?: string,
  target = bank,
): Promise<ExecuteInput> {
  const prepRes = await readJson(prepare(apiReq("transactions/prepare", input, { Origin: target }, target)));
  expect(prepRes.status).toBe(200);
  const tx = prepRes.body as {
    txId: string;
    payload: CanonicalTxPayload;
    txHashHex: string;
    webAuthnOptions: PublicKeyCredentialRequestOptionsJSON;
  };
  return {
    txId: tx.txId,
    deviceId: signer.deviceId,
    submittedPayload: tx.payload,
    webAuthnAssertion: await assertSoftware(signer.credential, tx.webAuthnOptions, { originOverride }),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(tx.txHashHex)), signer.pq.secretKey)),
  };
}

beforeEach(async () => {
  vi.stubEnv("SAFESIGN_STORAGE", "memory");
  resetAttackState();
  const resetRes = await readJson(reset(apiReq("demo/reset", { keepDevices: false }, { Origin: bank })));
  expect(resetRes.status).toBe(200);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Честность демо и оценка src/components/hacker/attacks.ts", () => {
  it("[HONEST-01] attackTag является только метаданными аудита и не вызывает фейковую блокировку валидной подписи", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    expect(verifyRes.status).toBe(200);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq });

    const res = await readJson(execute(apiReq("transactions/execute", { ...packet, attackTag: "MITM_AMOUNT" }, { Origin: bank })));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("EXECUTED");
  });

  it("[HONEST-02] originOverride в software-authenticator не позволяет обойти серверную проверку домена", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const signer = { deviceId: verifyRes.body.device.id, credential, pq };

    const foreignClientData = await prepareAndSign(signer, lowB2C, foreignOrigin);
    const resForeign = await readJson(execute(apiReq("transactions/execute", foreignClientData, { Origin: bank })));
    expect(resForeign.status).toBe(403);
    expect(resForeign.body.failureCode).toBe("ERR_ORIGIN_MISMATCH");

    const spoofedWithEvilHeader = await prepareAndSign(signer, lowB2C, bank);
    const resEvilOrigin = await readJson(execute(apiReq("transactions/execute", spoofedWithEvilHeader, { Origin: evilOrigin })));
    expect(resEvilOrigin.status).toBe(403);
    expect(resEvilOrigin.body.failureCode).toBe("ERR_CSRF");
  });

  it("[HONEST-03] квантовая симуляция (Атака №6) реально проверяет ML-DSA-65 и никогда не списывает средства", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const signer = { deviceId: verifyRes.body.device.id, credential, pq };
    const before = (await readJson(transactions(apiReq("transactions")))).body.transactions.length;

    const packet = await prepareAndSign(signer, { ...lowB2C, amountTenge: 1 });
    const disposable = keygen();
    const forgedPqSig = toBase64(sign(
      primaryMessage(hexToBytes((await readJson(prepare(apiReq("transactions/prepare", { ...lowB2C, amountTenge: 1 })))).body.txHashHex)),
      disposable.secretKey,
    ));

    const resForged = await readJson(execute(apiReq("transactions/execute", {
      ...packet,
      pqSignatureBase64: forgedPqSig,
      quantumSimulation: true,
    }, { Origin: bank })));
    expect(resForged.status).toBe(403);
    expect(resForged.body.failureCode).toBe("ERR_PQ_SIGNATURE_INVALID");
    expect(resForged.body.verificationTrace[4].outcome).toBe("COMPROMISED");
    expect(resForged.body.verificationTrace[5].outcome).toBe("FAIL");

    const packetRealPq = await prepareAndSign(signer, { ...lowB2C, amountTenge: 1 });
    const resSimOnly = await readJson(execute(apiReq("transactions/execute", {
      ...packetRealPq,
      quantumSimulation: true,
    }, { Origin: bank })));
    expect(resSimOnly.status).toBe(403);
    expect(resSimOnly.body.failureCode).toBe("ERR_SIMULATION_ONLY");
    expect(resSimOnly.body.verificationTrace[5].outcome).toBe("PASS");
    expect((await readJson(transactions(apiReq("transactions")))).body.transactions.length).toBeGreaterThan(before);
  });
});

describe("Red Team: уязвимости периметра, SSE, ввода, SOC и хрупкости демо", () => {
  it.fails("[RT-01] API не должен позволять неаутентифицированный просмотр транзакций/SOC и отзыв чужого устройства", async () => {
    const { verifyRes } = await enrollSoftware(aigul);
    const deviceId = String(verifyRes.body.device.id);

    const listTx = await readJson(transactions(apiReq("transactions")));
    const listDev = await readJson(devices(apiReq(`devices?userId=${aigul}`)));
    const revokeRes = await readJson(revoke(new Request(`${bank}/api/devices?id=${deviceId}`, { method: "DELETE", headers: { Origin: bank, "Content-Type": "application/json" } })));

    expect(listTx.status).toBe(401);
    expect(listDev.status).toBe(401);
    expect(revokeRes.status).toBe(401);
  });

  it("[RT-02] простой CORS-запрос text/plain с чужого Origin на /api/demo/reset и /api/transactions/cosign/reject должен блокироваться", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, highB2C);
    const execRes = await readJson(execute(apiReq("transactions/execute", packet, { Origin: bank })));
    expect(execRes.status).toBe(202);

    const csrfReject = await readJson(cosignReject(new Request(`${bank}/api/transactions/cosign/reject`, {
      method: "POST",
      headers: { Origin: evilOrigin, "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ txId: packet.txId, cosignerUserId: arman, activateCoolingOff: true }),
    })));
    expect(csrfReject.status).toBe(403);

    const csrfReset = await readJson(reset(new Request(`${bank}/api/demo/reset`, {
      method: "POST",
      headers: { Origin: evilOrigin, "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ keepDevices: false }),
    })));
    expect(csrfReset.status).toBe(403);
    expect(csrfReset.body.failureCode).toBe("ERR_CSRF");
    expect(csrfReject.body.failureCode).toBe("ERR_CSRF");
    const wrongType = await readJson(reset(apiReq("demo/reset", { keepDevices: true }, { "Content-Type": "text/plain" })));
    expect(wrongType.status).toBe(415);
    const deviceUrl = bank + "/api/devices?id=" + verifyRes.body.device.id;
    for (const [headers, status] of [
      [{ Origin: bank }, 415],
      [{ Origin: evilOrigin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, 403],
      [{ "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, 403],
    ] as const) {
      const result = await revoke(new Request(deviceUrl, { method: "DELETE", headers }));
      expect(result.status).toBe(status);
    }
    const allowedClone = await readJson(prepare(apiReq("transactions/prepare", lowB2C,
      { Origin: foreignOrigin, "Sec-Fetch-Site": "cross-site" })));
    expect(allowedClone.status).toBe(200);
    const sameHost = await prepare(apiReq("transactions/prepare", lowB2C,
      { Host: "stand.lan:3105", Origin: "http://stand.lan:3105", "Sec-Fetch-Site": "same-origin" }));
    expect(sameHost.status).toBe(200);
    vi.stubEnv("SAFESIGN_ORIGIN", "https://stand.example");
    const configured = await prepare(apiReq("transactions/prepare", lowB2C, { Origin: "https://stand.example" }));
    expect(configured.status).toBe(200);
    const wrongPort = await prepare(apiReq("transactions/prepare", lowB2C, { Origin: "http://localhost:3101" }));
    expect(wrongPort.status).toBe(403);
  });

  it("[RT-03] поток событий без фильтра или авторизации не должен отдавать транзакции и txId других пользователей", async () => {
    const aigulDev = await enrollSoftware(aigul);
    const dinaraDev = await enrollSoftware(dinara);
    const startCursor = (await readJson(poll(apiReq("events/poll?since=0")))).body.cursor as number;

    const pB2C = await prepareAndSign({ deviceId: aigulDev.verifyRes.body.device.id, credential: aigulDev.credential, pq: aigulDev.pq }, highB2C);
    await readJson(execute(apiReq("transactions/execute", pB2C, { Origin: bank })));

    const pB2B = await prepareAndSign({ deviceId: dinaraDev.verifyRes.body.device.id, credential: dinaraDev.credential, pq: dinaraDev.pq }, highB2B);
    await readJson(execute(apiReq("transactions/execute", pB2B, { Origin: bank })));

    const unfiltered = await readJson(poll(apiReq(`events/poll?since=${startCursor}`)));
    expect(unfiltered.body.events).toEqual([]);
    const personal = await readJson(poll(apiReq(`events/poll?since=${startCursor}&userId=${aigul}`)));
    expect(personal.body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(personal.body.events)).toContain(pB2C.txId);
    expect(JSON.stringify(personal.body.events)).not.toContain(pB2B.txId);
    for (const handler of [stream, poll]) {
      expect((await handler(apiReq("events?channel=cosign"))).status).toBe(400);
    }
  });

  it("[RT-03b] постороннему участнику недоступны запрос второй подписи и отказ от своего имени", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, highB2C);
    await readJson(execute(apiReq("transactions/execute", packet, { Origin: bank })));
    const feed = await readJson(poll(apiReq(`events/poll?channel=cosign&userId=${dinara}`)));
    expect(JSON.stringify(feed.body.events)).not.toContain(packet.txId);
    const rejection = await readJson(cosignReject(apiReq("transactions/cosign/reject", {
      txId: packet.txId, cosignerUserId: dinara,
    })));
    expect(rejection.status).toBe(403);
    expect(rejection.body.failureCode).toBe("ERR_COSIGNER");
  });

  it("[RT-04/05] заголовки защищают страницы и разрешают WebAuthn на своём origin", async () => {
    const [rule] = await nextConfig.headers!();
    const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
    expect(rule.source).toBe("/:path*");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("publickey-credentials-create=(self)");
  });

  it("[RT-06] Bidi (U+202E) и управляющие символы должны отклоняться в recipientAccount, deviceName и очищаться в tamperDiff", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const badAccount = await readJson(prepare(apiReq("transactions/prepare", {
      ...lowB2C,
      recipientAccount: "KZ148560000007721304\u202E9999",
    })));
    const badDevice = await readJson(options(apiReq("auth/register/options", {
      userId: aigul,
      deviceName: "MacBook\u202Eevil",
    })));

    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq });
    const tamperBidi = await readJson(execute(apiReq("transactions/execute", {
      ...packet,
      submittedPayload: { ...packet.submittedPayload, recipientName: "Дроп\u202E0001" },
    }, { Origin: bank })));

    expect(badAccount.status).toBe(400);
    expect(badDevice.status).toBe(400);
    expect(tamperBidi.body.failureCode).toBe("ERR_WYSIWYS_TAMPERED");
    expect(tamperBidi.body.tamperDiff).toContainEqual({ field: "recipientName",
      original: packet.submittedPayload.recipientName, tampered: "Дроп\\u202E0001" });
    for (const account of ["KZ1", "A".repeat(20), "+7701\u200B0000000", "1".repeat(17)]) {
      expect((await prepare(apiReq("transactions/prepare", { ...lowB2C, recipientAccount: account }))).status).toBe(400);
    }
    for (const account of ["1234567890123456", "+77011234567"]) {
      expect((await prepare(apiReq("transactions/prepare", { ...lowB2C, recipientAccount: account }))).status).toBe(200);
    }
  });

  it("[RT-07] SOC 'Спасено средств' не должен складывать по 15 000 ₸ с каждой отдельной атаки и +1 ₸ с диагностической квантовой пробы", async () => {
    vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
      execute(new Request(bank + url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: bank } })));

    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const signer = { deviceId: verifyRes.body.device.id, credential, pq };

    const valid = buildExecuteBody(await prepareAndSign(signer, lowB2C));
    const validRes = await readJson(execute(apiReq("transactions/execute", valid, { Origin: bank })));
    expect(validRes.status).toBe(200);
    rememberValidPacket(valid, validRes.body.status);

    await replayLastPacket();

    armInterceptor("MITM_AMOUNT");
    const mitmAmount = buildExecuteBody(await prepareAndSign(signer, lowB2C));
    await readJson(execute(apiReq("transactions/execute", { ...mitmAmount, attackTag: "MITM_AMOUNT" }, { Origin: bank })));

    armInterceptor("MITM_RECIPIENT");
    const mitmIban = buildExecuteBody(await prepareAndSign(signer, lowB2C));
    await readJson(execute(apiReq("transactions/execute", { ...mitmIban, attackTag: "MITM_RECIPIENT" }, { Origin: bank })));

    const originPacket = await prepareAndSign(signer, lowB2C, foreignOrigin);
    await readJson(execute(apiReq("transactions/execute", { ...originPacket, attackTag: "PHISHING_ORIGIN" }, { Origin: bank })));

    const qPacket = await prepareAndSign(signer, { ...lowB2C, amountTenge: 1 });
    const qRes = await readJson(execute(apiReq("transactions/execute", {
      ...qPacket,
      pqSignatureBase64: toBase64(sign(primaryMessage(hashPayload(qPacket.submittedPayload).hashBytes), keygen().secretKey)),
      quantumSimulation: true,
    }, { Origin: bank })));
    expect(qRes.status).toBe(403);
    expect(qRes.body.failureCode).toBe("ERR_PQ_SIGNATURE_INVALID");

    const report = await readJson(soc(apiReq("soc/events")));
    expect(report.body.aggregates).toMatchObject({
      attacksBlocked: 5, savedAmountTenge: 15_000, attackedAmountTenge: 60_000, preventedTamperAmountTenge: 500_000,
    });
  });

  it("[RT-08] при MEDIUM-риске без чекбокса и одновременной MITM-подмене не должна маскироваться проверка WYSIWYS шагом 1", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, mediumB2C);
    const tamperedNoAck = {
      ...packet,
      acknowledgedWarning: false,
      submittedPayload: { ...packet.submittedPayload, amountTenge: 500_000 },
    };
    const res = await readJson(execute(apiReq("transactions/execute", tamperedNoAck, { Origin: bank })));
    expect(res.status).toBe(403);
    expect(res.body.failureCode).toBe("ERR_WYSIWYS_TAMPERED");
    expect(res.body.verificationTrace[2].outcome).toBe("FAIL");
    expect(res.body.verificationTrace[6].outcome).toBe("SKIPPED");
  });

  it("[RT-10] POST /api/transactions/prepare должен отклонять запросы с чужого Origin", async () => {
    await enrollSoftware(aigul);
    const res = await readJson(prepare(apiReq("transactions/prepare", lowB2C, { Origin: evilOrigin })));
    expect(res.status).toBe(403);
  });

  it("[RT-10] ограничивает активные вызовы пользователя и освобождает квоту после TTL", async () => {
    await enrollSoftware(aigul);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 32; i++) {
        expect((await prepare(apiReq("transactions/prepare", lowB2C))).status).toBe(200);
      }
      const full = await readJson(prepare(apiReq("transactions/prepare", lowB2C)));
      expect([full.status, full.body.failureCode]).toEqual([429, "ERR_PREPARE_LIMIT"]);
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await prepare(apiReq("transactions/prepare", lowB2C))).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });

  it("отмена регистрации Passkey возвращает пользователю выбор и не создаёт Software Key", async () => {
    vi.spyOn(keystore, "prepareKeystore").mockResolvedValue(undefined as unknown as CryptoKey);
    const create = vi.fn().mockRejectedValue(new DOMException("Отмена", "NotAllowedError"));
    vi.stubGlobal("PublicKeyCredential", class {});
    vi.stubGlobal("navigator", { credentials: { create, get: vi.fn() } });
    const send = vi.fn((path: string, init: RequestInit) => options(new Request(bank + path, {
      ...init, headers: { "Content-Type": "application/json", Origin: bank },
    })));
    vi.stubGlobal("fetch", send);
    await expect(registerDevice(aigul)).rejects.toMatchObject({ details: {
      failureCode: "ERR_WEBAUTHN_CANCELLED", message: expect.stringContaining("Software Key"),
    } });
    expect(create).toHaveBeenCalledOnce();
    expect(send.mock.calls.map(([path]) => path)).toEqual(["/api/auth/register/options"]);
    expect((await readJson(devices(apiReq("devices?userId=" + aigul)))).body.devices).toEqual([]);
  });

  it("[DEMO-04] работа на порту 3001 (http://localhost:3001) без ручного SAFESIGN_ORIGIN не должна падать на регистрации", async () => {
    const origin = "http://localhost:3001";
    const { verifyRes, credential, pq } = await enrollSoftware(aigul, origin);
    expect(verifyRes.status).toBe(200);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, lowB2C, origin, origin);
    const result = await readJson(execute(apiReq("transactions/execute", packet, { Origin: origin }, origin)));
    expect([result.status, result.body.status]).toEqual([200, "EXECUTED"]);
  });
});
