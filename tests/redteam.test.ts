import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
        headers: { "Content-Type": "application/json", ...headers },
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
): Promise<ExecuteInput> {
  const prepRes = await readJson(prepare(apiReq("transactions/prepare", input, { Origin: bank })));
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
    expect(resEvilOrigin.body.failureCode).toBe("ERR_ORIGIN_MISMATCH");
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
    const revokeRes = await readJson(revoke(new Request(`${bank}/api/devices?id=${deviceId}`, { method: "DELETE" })));

    expect(listTx.status).toBe(401);
    expect(listDev.status).toBe(401);
    expect(revokeRes.status).toBe(401);
  });

  it.fails("[RT-02] простой CORS-запрос text/plain с чужого Origin на /api/demo/reset и /api/transactions/cosign/reject должен блокироваться", async () => {
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
  });

  it.fails("[RT-03] поток событий без фильтра или авторизации не должен отдавать транзакции и txId других пользователей", async () => {
    const aigulDev = await enrollSoftware(aigul);
    const dinaraDev = await enrollSoftware(dinara);
    const startCursor = (await readJson(poll(apiReq("events/poll?since=0")))).body.cursor as number;

    const pB2C = await prepareAndSign({ deviceId: aigulDev.verifyRes.body.device.id, credential: aigulDev.credential, pq: aigulDev.pq }, highB2C);
    await readJson(execute(apiReq("transactions/execute", pB2C, { Origin: bank })));

    const pB2B = await prepareAndSign({ deviceId: dinaraDev.verifyRes.body.device.id, credential: dinaraDev.credential, pq: dinaraDev.pq }, highB2B);
    await readJson(execute(apiReq("transactions/execute", pB2B, { Origin: bank })));

    // Как в DemoStand / Topbar / useDemoState: клиент подписывается без userId и без авторизации
    const unfiltered = await readJson(poll(apiReq(`events/poll?since=${startCursor}`)));
    const leakedIds = (unfiltered.body.events as Array<{ txId?: string }>).map(e => e.txId).filter(Boolean);
    expect(leakedIds).not.toContain(pB2B.txId);
  });

  it.fails("[RT-03b] сторонний наблюдатель, получивший txId из SSE, не должен иметь возможности заморозить счёт через cosign/reject", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const startCursor = (await readJson(poll(apiReq("events/poll?since=0")))).body.cursor as number;

    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, highB2C);
    await readJson(execute(apiReq("transactions/execute", packet, { Origin: bank })));

    const feed = await readJson(poll(apiReq(`events/poll?since=${startCursor}`)));
    const cosignEvent = (feed.body.events as Array<{ type: string; txId?: string; cosignerUserId?: string }>)
      .find(e => e.type === "COSIGN_REQUESTED");
    expect(cosignEvent?.txId).toBe(packet.txId);

    const hijackReject = await readJson(cosignReject(apiReq("transactions/cosign/reject", {
      txId: cosignEvent!.txId,
      cosignerUserId: cosignEvent!.cosignerUserId,
      activateCoolingOff: true,
    })));
    expect([401, 403]).toContain(hijackReject.status);
  });

  it.fails("[RT-05] в проекте должны быть настроены заголовки безопасности (CSP / X-Frame-Options) против XSS и Clickjacking", () => {
    const root = resolve(process.cwd());
    const hasSecurityLayer = ["next.config.ts", "next.config.mjs", "next.config.js", "src/middleware.ts", "middleware.ts"]
      .some(file => existsSync(resolve(root, file)));
    expect(hasSecurityLayer).toBe(true);
  });

  it.fails("[RT-06] Bidi (U+202E) и управляющие символы должны отклоняться в recipientAccount, deviceName и очищаться в tamperDiff", async () => {
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
    expect(JSON.stringify(tamperBidi.body.tamperDiff)).not.toContain("\u202E");
  });

  it.fails("[RT-07] SOC 'Спасено средств' не должен складывать по 15 000 ₸ с каждой отдельной атаки и +1 ₸ с диагностической квантовой пробы", async () => {
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
    // Сейчас агрегатор возвращает 60_001 ₸ (15k * 4 + 1 ₸ диагностический)
    expect(report.body.aggregates.savedAmountTenge).toBe(60_001);
    expect(report.body.aggregates.savedAmountTenge).toBe(15_000);
  });

  it.fails("[RT-08] при MEDIUM-риске без чекбокса и одновременной MITM-подмене не должна маскироваться проверка WYSIWYS шагом 1", async () => {
    const { verifyRes, credential, pq } = await enrollSoftware(aigul);
    const packet = await prepareAndSign({ deviceId: verifyRes.body.device.id, credential, pq }, mediumB2C);
    const tamperedNoAck = {
      ...packet,
      acknowledgedWarning: false,
      submittedPayload: { ...packet.submittedPayload, amountTenge: 500_000 },
    };
    const res = await readJson(execute(apiReq("transactions/execute", tamperedNoAck, { Origin: bank })));
    expect(res.status).toBe(409);
    expect(res.body.failureCode).toBe("ERR_WYSIWYS_TAMPERED");
  });

  it.fails("[RT-10] POST /api/transactions/prepare должен отклонять запросы с чужого Origin", async () => {
    await enrollSoftware(aigul);
    const res = await readJson(prepare(apiReq("transactions/prepare", lowB2C, { Origin: evilOrigin })));
    expect(res.status).toBe(403);
  });

  it.fails("[DEMO-04] работа на порту 3001 (http://localhost:3001) без ручного SAFESIGN_ORIGIN не должна падать на регистрации", async () => {
    const { verifyRes } = await enrollSoftware(aigul, "http://localhost:3001");
    expect(verifyRes.status).toBe(200);
  });
});
