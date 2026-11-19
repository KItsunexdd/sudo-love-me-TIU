import { beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import { MemoryAdapter } from "@/lib/db/store";
import { recipientPresets } from "@/lib/db/seed";
import type { Failure } from "@/lib/tx/errors";
import type { RiskInput } from "@/lib/risk/engine";
import { COOLING_OFF, COSIGN_TTL, PRIMARY_TTL, TransactionService } from "@/lib/tx/service";
import { registrationOptions, verifyRegistration } from "@/lib/crypto/webauthn";
import { registerSoftware, assertSoftware } from "@/lib/crypto/software-authenticator";
import { bytesToHex, fromBase64, fromBase64Url, hashPayload, serializeCanonicalJSON, sha256,
  toBase64, toBase64Url, utf8 } from "@/lib/crypto/canonical";
import { cosignMessage, keygen, primaryMessage, sign, verify } from "@/lib/crypto/mldsa";
import { subscribe, type DemoEvent } from "@/lib/events/bus";

const storage = new MemoryAdapter();
const noon = Date.parse("2026-04-01T07:00:00Z");
let time = noon;
const service = new TransactionService(storage, () => new Date(time));
const low = { senderId: "usr_aigul", mode: "B2C", operationType: "P2P_TRANSFER", purpose: "На продукты", ...recipientPresets.son };
const high = { ...low, ...recipientPresets.unknown, simulatedContext: { activeUnknownCall: true } };
const b2b = { ...low, ...recipientPresets.supplier, senderId: "usr_dinara", mode: "B2B", operationType: "B2B_INVOICE" };

function success<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw new Error(result.failureCode + " " + JSON.stringify(result.verificationTrace));
  return result;
}

async function enroll(userId: string) {
  const db = await storage.snapshot();
  const user = db.users.find(u => u.id === userId)!;
  const options = await registrationOptions(user, db.devices);
  const { response, credential } = await registerSoftware(options);
  const pq = keygen();
  const device = await verifyRegistration({
    response, deviceKind: "SOFTWARE_FALLBACK", user, expectedChallenge: options.challenge,
    deviceName: "Тестовый ключ", pqPublicKeyBase64: toBase64(pq.publicKey),
  });
  await storage.transact(({ db }) => { db.devices.push(device); });
  return { device, credential, pq };
}

async function preparePrimary(input: typeof low & Pick<RiskInput, "simulatedContext"> = low) {
  const actor = await enroll(input.senderId);
  const tx = success(await service.prepare(input));
  const packet = {
    txId: tx.txId, deviceId: actor.device.id, submittedPayload: tx.payload,
    webAuthnAssertion: await assertSoftware(actor.credential, tx.webAuthnOptions),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(tx.txHashHex)), actor.pq.secretKey)),
  };
  return { actor, tx, packet };
}

async function pendingHigh() {
  const primary = await preparePrimary(high);
  const pending = success(await service.execute(primary.packet));
  expect(pending.status).toBe("PENDING_COSIGN");
  expect(pending.transaction.primarySignature?.pqSignatureBytesLength).toBe(3309);
  expect(pending.cosigner?.id).toBe("usr_arman");
  return { ...primary, pending };
}

async function secondSignature(txId: string, cosignerUserId = "usr_arman") {
  const actor = await enroll(cosignerUserId);
  const prepared = success(await service.cosignPrepare({ txId, cosignerUserId }));
  const primary = fromBase64(prepared.transaction.primarySignature!.pqSignatureBase64);
  expect(prepared.primarySignatureHashHex).toBe(bytesToHex(sha256(primary)));
  const hash = hexToBytes(prepared.txHashHex);
  const message = cosignMessage(hash, primary);
  expect(prepared.webAuthnOptions.challenge).toBe(toBase64Url(sha256(message)));
  const packet = { txId, deviceId: actor.device.id,
    webAuthnAssertion: await assertSoftware(actor.credential, prepared.webAuthnOptions),
    pqSignatureBase64: toBase64(sign(message, actor.pq.secretKey)) };
  return { actor, hash, packet };
}

beforeEach(async () => {
  time = noon;
  await storage.resetDemo({ keepDevices: false });
});

describe("Канонический пакет и ML-DSA-65", () => {
  it("сортирует все ключи лексикографически, включая числовые, и сохраняет UTF-8", () => {
    const a = { z: [{ 2: "б", 10: "я" }], a: "₸" };
    const b = { a: "₸", z: [{ 10: "я", 2: "б" }] };
    expect(serializeCanonicalJSON(a)).toBe('{"a":"₸","z":[{"10":"я","2":"б"}]}');
    expect(hashPayload(a)).toEqual(hashPayload(b));
    expect(hashPayload(a).webAuthnChallenge).toHaveLength(43);
  });
  it.each([undefined, NaN, Infinity, { a: [undefined] }, { amountTenge: 1.5 }, { amountTenge: "1" },
    { amountTenge: Number.MAX_SAFE_INTEGER + 1 }])("отклоняет недопустимое значение %#", value => {
    expect(() => serializeCanonicalJSON(value)).toThrow();
  });
  it("проверяет длины ключей и подписи и привязку COSIGN к точной первой подписи", () => {
    const { publicKey, secretKey } = keygen();
    const hash = sha256(utf8("операция"));
    const first = sign(primaryMessage(hash), secretKey);
    expect([publicKey.length, secretKey.length, first.length]).toEqual([1952, 4032, 3309]);
    const second = sign(cosignMessage(hash, first), secretKey);
    expect(verify(second, cosignMessage(hash, first), publicKey)).toBe(true);
    first[10] ^= 1;
    expect(verify(second, cosignMessage(hash, first), publicKey)).toBe(false);
  });
});

describe("Гибридная проверка и атомарное исполнение", () => {
  it("исполняет LOW со всеми семью PASS, обновляет оба остатка и счётчик", async () => {
    const { actor, tx, packet } = await preparePrimary();
    expect(tx.risk.level).toBe("LOW");
    expect(tx.webAuthnOptions.challenge).toBe(toBase64Url(hexToBytes(tx.txHashHex)));
    expect(tx.webAuthnOptions.allowCredentials?.map(c => c.id)).toEqual([actor.device.credentialId]);
    expect(tx.payload.nonce).toMatch(/^[a-f0-9]{64}$/);
    const result = success(await service.execute(packet));
    expect(result.status).toBe("EXECUTED");
    expect(result.verificationTrace.map(step => step.outcome)).toEqual(Array(7).fill("PASS"));
    expect(result.verificationTrace.every(step => step.durationMs >= 0)).toBe(true);
    const db = await storage.snapshot();
    expect(db.devices[0].webAuthnCounter).toBe(1);
    expect(db.users.slice(0, 2).map(u => u.balanceTenge)).toEqual([435_000, 15_000]);
  });
  it.each([
    ["amountTenge", 500_000, "15000"], ["recipientAccount", recipientPresets.unknown.recipientAccount, low.recipientAccount],
    ["unexpected", "лишнее поле", "(отсутствует)"],
  ])("показывает diff и реальные отказы обеих подписей при изменении %s", async (field, changed, original) => {
    const { packet } = await preparePrimary();
    const result = await service.execute({ ...packet, submittedPayload: { ...packet.submittedPayload, [field]: changed } });
    expect(result).toMatchObject({ ok: false, failureCode: "ERR_WYSIWYS_TAMPERED",
      tamperDiff: [{ field, original, tampered: String(changed) }] });
    expect(result.verificationTrace.map(s => s.outcome)).toEqual(["PASS", "PASS", "FAIL", "PASS", "FAIL", "FAIL", "SKIPPED"]);
    const db = await storage.snapshot();
    expect(db.users[0].balanceTenge).toBe(450_000);
    expect(db.securityEvents.at(-1)?.eventType).toBe("ATTACK_MITM_BLOCKED");
  });
  it("повторные и одновременные пакеты дают одно списание и сохраняют квитанцию", async () => {
    const { packet } = await preparePrimary();
    const results = await Promise.all([service.execute(packet), service.execute(packet), service.execute(packet)]);
    expect(results.filter(r => r.status === "EXECUTED")).toHaveLength(1);
    expect(results.filter(r => !r.ok && r.failureCode === "ERR_REPLAY_DETECTED")).toHaveLength(2);
    expect(await service.execute(packet)).toMatchObject({ failureCode: "ERR_REPLAY_DETECTED" });
    const db = await storage.snapshot();
    expect(db.transactions[0].status).toBe("EXECUTED");
    expect(db.users[0].balanceTenge).toBe(435_000);
    expect(db.securityEvents.filter(e => e.eventType === "ATTACK_REPLAY_BLOCKED")).toHaveLength(3);
  });
  it.each(["origin", "rpIdHash"])("отклоняет чужой %s на четвёртом шаге", async field => {
    const { packet } = await preparePrimary();
    const response = packet.webAuthnAssertion.response;
    if (field === "origin") {
      const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(response.clientDataJSON)));
      response.clientDataJSON = toBase64Url(utf8(JSON.stringify({ ...clientData, origin: "http://127.0.0.1:3000" })));
    } else {
      const authData = fromBase64Url(response.authenticatorData);
      authData.set(sha256(utf8("127.0.0.1")));
      response.authenticatorData = toBase64Url(authData);
    }
    const result = await service.execute(packet);
    expect(result).toMatchObject({ failureCode: "ERR_ORIGIN_MISMATCH" });
    expect(result.verificationTrace[3].outcome).toBe("FAIL");
  });
  it.each(["подпись", "счётчик", "пользователь"])("отклоняет недействительный WebAuthn (%s)", async which => {
    const { packet } = await preparePrimary();
    if (which === "подпись") {
      const signature = fromBase64Url(packet.webAuthnAssertion.response.signature);
      signature[signature.length - 1] ^= 1;
      packet.webAuthnAssertion.response.signature = toBase64Url(signature);
    } else if (which === "счётчик") {
      await storage.transact(({ db }) => { db.devices[0].webAuthnCounter = 1; });
    } else {
      packet.deviceId = (await enroll("usr_arman")).device.id;
    }
    expect(await service.execute(packet)).toMatchObject({ failureCode: "ERR_WEBAUTHN_INVALID" });
  });
  it.each(["бит", "чужой ключ", "квантовая симуляция"])("обнаруживает недействительную ML-DSA (%s)", async which => {
    const { packet, tx } = await preparePrimary();
    const foreign = keygen();
    const sig = which === "бит" ? fromBase64(packet.pqSignatureBase64) : sign(primaryMessage(hexToBytes(tx.txHashHex)), foreign.secretKey);
    if (which === "бит") sig[42] ^= 1;
    else expect(verify(sig, primaryMessage(hexToBytes(tx.txHashHex)), foreign.publicKey)).toBe(true);
    const quantumSimulation = which === "квантовая симуляция";
    const result = await service.execute({ ...packet, pqSignatureBase64: toBase64(sig), quantumSimulation });
    expect(result).toMatchObject({ failureCode: "ERR_PQ_SIGNATURE_INVALID" });
    expect(result.verificationTrace.slice(4).map(s => s.outcome)).toEqual([quantumSimulation ? "COMPROMISED" : "PASS", "FAIL", "SKIPPED"]);
  });
  it("диагностический режим с подлинными ключами исключает списание", async () => {
    const { packet } = await preparePrimary();
    expect(await service.execute({ ...packet, quantumSimulation: true })).toMatchObject({ failureCode: "ERR_SIMULATION_ONLY" });
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(450_000);
  });
  it("проверяет точную границу TTL и отсутствующий txId", async () => {
    const { packet } = await preparePrimary();
    expect(await service.execute({ ...packet, txId: "tx_unknown" })).toMatchObject({ failureCode: "ERR_TX_NOT_FOUND" });
    time += PRIMARY_TTL;
    expect(await service.execute(packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
    expect((await storage.snapshot()).transactions[0]).toMatchObject({ status: "EXPIRED", nonceUsed: false });
  });
  it.each([true, false])("требует чекбокс для MEDIUM, подтверждение %s", async acknowledgedWarning => {
    const { packet, tx } = await preparePrimary({ ...low, simulatedContext: { activeUnknownCall: true } });
    expect(tx.risk.level).toBe("MEDIUM");
    expect(await service.execute({ ...packet, acknowledgedWarning })).toMatchObject(
      acknowledgedWarning ? { status: "EXECUTED" } : { failureCode: "ERR_ACK_REQUIRED" });
  });
});

describe("Вторая рука", () => {
  it("связывает две гибридные подписи для 850 000 ₸ и допускает только одно исполнение", async () => {
    // Fund the current account from the seeded deposit through the same two-signature service.
    const withdrawal = await preparePrimary({ ...low, operationType: "DEPOSIT_CLOSE", amountTenge: 450_000,
      recipientAccount: "KZ868560000004512890", recipientName: "Айгуль Сатыбалдиева" });
    expect(await service.execute(withdrawal.packet)).toMatchObject({ status: "PENDING_COSIGN" });
    const release = await secondSignature(withdrawal.tx.txId);
    expect(await service.cosignSubmit(release.packet)).toMatchObject({ status: "EXECUTED" });
    expect((await storage.snapshot()).users[0]).toMatchObject({ balanceTenge: 900_000, depositBalanceTenge: 2_050_000 });
    const { tx, packet: primary, pending } = await pendingHigh();
    expect(pending.transaction.riskScore).toBe(100);
    time += PRIMARY_TTL + 1;
    const { packet } = await secondSignature(tx.txId);
    const result = success(await service.cosignSubmit(packet));
    expect(result.transaction.primarySignature?.pqSignatureBase64).toBe(primary.pqSignatureBase64);
    expect(result.transaction.cosignSignature?.pqSignatureBase64).toBe(packet.pqSignatureBase64);
    expect(result.transaction.cosignSignature?.signerUserId).toBe("usr_arman");
    expect(await service.cosignSubmit(packet)).toMatchObject({ failureCode: "ERR_REPLAY_DETECTED" });
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(50_000);
  });
  it("при исходных 450 000 ₸ вторая подпись не создаёт овердрафт", async () => {
    const { tx } = await pendingHigh();
    const { packet } = await secondSignature(tx.txId);
    expect(await service.cosignSubmit(packet)).toMatchObject({ failureCode: "ERR_INSUFFICIENT_FUNDS" });
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(450_000);
  });
  it("отклоняет ML-DSA второй подписи с доменом PRIMARY", async () => {
    const { tx } = await pendingHigh();
    const { packet, hash, actor } = await secondSignature(tx.txId);
    packet.pqSignatureBase64 = toBase64(sign(primaryMessage(hash), actor.pq.secretKey));
    const result = await service.cosignSubmit(packet);
    expect(result).toMatchObject({ failureCode: "ERR_PQ_SIGNATURE_INVALID" });
    expect(result.verificationTrace[4].outcome).toBe("PASS");
  });
  it("отказ сына замораживает операции, публикует событие SOC и сохраняет депозит", async () => {
    const events: DemoEvent[] = [];
    const unsub = subscribe(e => events.push(e));
    try {
      const { tx } = await pendingHigh();
      expect(await service.cosignReject({ txId: tx.txId, cosignerUserId: "usr_timur" })).toMatchObject({ failureCode: "ERR_COSIGNER" });
      expect(await service.cosignReject({ txId: tx.txId, cosignerUserId: "usr_arman" })).toMatchObject({
        status: "BLOCKED_BY_COSIGNER", savedAmountTenge: 850_000, coolingOffActive: true,
      });
      expect(await service.prepare(low)).toMatchObject({ failureCode: "ERR_COOLING_OFF" });
      expect((await storage.snapshot()).users[0]).toMatchObject({ balanceTenge: 450_000, depositBalanceTenge: 2_500_000 });
      expect(events).toContainEqual({ type: "COSIGN_REQUESTED", txId: tx.txId, cosignerUserId: "usr_arman" });
      expect(events).toContainEqual(expect.objectContaining({ type: "SECURITY_ALERT",
        event: expect.objectContaining({ eventType: "SOCENG_STOPPED_BY_COSIGNER" }) }));
      time += COOLING_OFF;
      expect((await service.prepare(low)).ok).toBe(true);
    } finally { unsub(); }
  });
  it("срок второй подписи истекает через 15 минут после первой", async () => {
    const { tx } = await pendingHigh();
    const { packet } = await secondSignature(tx.txId);
    time += COSIGN_TTL;
    expect(await service.cosignSubmit(packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
    expect(await service.cosignReject({ txId: tx.txId, cosignerUserId: "usr_arman" })).toMatchObject({ status: "EXPIRED" });
  });
  it("направляет счёт на 1 250 000 ₸ директору и списывает с корпоративного счёта", async () => {
    const { tx, packet } = await preparePrimary(b2b);
    expect(tx.risk.score).toBe(60);
    expect(success(await service.execute(packet)).cosigner?.id).toBe("usr_timur");
    const second = await secondSignature(tx.txId, "usr_timur");
    expect(await service.cosignSubmit(second.packet)).toMatchObject({ status: "EXECUTED" });
    expect((await storage.snapshot()).users[2].balanceTenge).toBe(17_150_000);
  });
});

it("резервный ключ привязан к origin, закрытый ECDSA-ключ не экспортируется", async () => {
  const { actor, tx } = await preparePrimary();
  expect(actor.credential.privateKey.extractable).toBe(false);
  vi.stubGlobal("location", new URL("http://127.0.0.1:3000"));
  try {
    await expect(assertSoftware(actor.credential, tx.webAuthnOptions)).rejects.toThrow();
  } finally { vi.unstubAllGlobals(); }
});

it("сброс с сохранением устройств восстанавливает seed и счётчик зарегистрированного ключа", async () => {
  const { actor, packet } = await preparePrimary();
  success(await service.execute(packet));
  await storage.resetDemo({ keepDevices: true });
  const db = await storage.snapshot();
  expect(db.devices[0]).toMatchObject({ id: actor.device.id, webAuthnCounter: 1 });
  expect(db.users[0].balanceTenge).toBe(450_000);
  expect([db.transactions.length, db.securityEvents.length]).toEqual([0, 0]);
  const next = success(await service.prepare(low));
  expect(success(await service.execute({ txId: next.txId, deviceId: actor.device.id,
    submittedPayload: next.payload, webAuthnAssertion: await assertSoftware(actor.credential, next.webAuthnOptions),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(next.txHashHex)), actor.pq.secretKey)),
  })).status).toBe("EXECUTED");
  await storage.resetDemo({ keepDevices: false });
  expect(await service.prepare(low)).toMatchObject({ failureCode: "ERR_DEVICE_NOT_FOUND" });
});

it("учитывает период охлаждения для ранее подготовленной операции", async () => {
  const prepared = await preparePrimary();
  const { tx } = await pendingHigh();
  success(await service.cosignReject({ txId: tx.txId, cosignerUserId: "usr_arman" }));
  expect(await service.execute(prepared.packet)).toMatchObject({ failureCode: "ERR_COOLING_OFF" });
  expect((await storage.snapshot()).users[0].balanceTenge).toBe(450_000);
});

it("ограничивает регистрацию выданным challenge и ключом ML-DSA-65", async () => {
  const [user] = (await storage.snapshot()).users;
  const options = await registrationOptions(user);
  const { response } = await registerSoftware(options);
  const input = { user, response, expectedChallenge: options.challenge, deviceName: "Тест",
    deviceKind: "SOFTWARE_FALLBACK" as const, pqPublicKeyBase64: toBase64(keygen().publicKey) };
  await expect(verifyRegistration({ ...input, expectedChallenge: toBase64Url(sha256(utf8("другой"))) })).rejects.toThrow();
  await expect(verifyRegistration({ ...input, pqPublicKeyBase64: "AA==" })).rejects.toThrow();
});

it("заём зачисляется подписанному получателю и учитывается как долг инициатора", async () => {
  const { packet } = await preparePrimary({ ...low, operationType: "ONLINE_LOAN" });
  expect(await service.execute({ ...packet, acknowledgedWarning: true })).toMatchObject({ status: "EXECUTED" });
  const [borrower, recipient] = (await storage.snapshot()).users;
  expect(borrower).toMatchObject({ balanceTenge: 450_000, loanBalanceTenge: 15_000 });
  expect(recipient.balanceTenge).toBe(15_000);
});

it("применяет настроенные RP ID и origin при регистрации и исполнении", async () => {
  vi.stubEnv("SAFESIGN_RP_ID", "bank.example");
  vi.stubEnv("SAFESIGN_ORIGIN", "https://bank.example");
  vi.stubGlobal("location", new URL("https://bank.example"));
  try {
    const { packet, tx } = await preparePrimary();
    expect(tx.webAuthnOptions.rpId).toBe("bank.example");
    expect(await service.execute(packet)).toMatchObject({ status: "EXECUTED" });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
