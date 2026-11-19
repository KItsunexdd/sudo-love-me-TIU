import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { shake256 } from "@noble/hashes/sha3.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  fromBase64, hashPayload, serializeCanonicalJSON, sha256,
  toBase64, toBase64Url, utf8,
} from "@/lib/crypto/canonical";
import { cosignMessage, createPqProofOfPossession, keygen, ML_DSA_BYTES, primaryMessage, sign, verify } from "@/lib/crypto/mldsa";
import { assertSoftware, registerSoftware, type SoftwareCredential } from "@/lib/crypto/software-authenticator";
import { registrationOptions, verifyRegistration } from "@/lib/crypto/webauthn";
import { assessRisk } from "@/lib/risk/engine";
import { recipientPresets } from "@/lib/db/seed";
import { JsonFileAdapter, MemoryAdapter, type StorageAdapter } from "@/lib/db/store";
import type { Failure } from "@/lib/tx/errors";
import { executeSchema } from "@/lib/tx/inputs";
import { COOLING_OFF, COSIGN_TTL, PRIMARY_TTL, TransactionService } from "@/lib/tx/service";

const storage = new MemoryAdapter();
const noon = Date.parse("2026-04-01T07:00:00Z");
let nowMs = noon;
const service = new TransactionService(storage, () => new Date(nowMs));

const lowInput = {
  senderId: "usr_aigul",
  mode: "B2C" as const,
  operationType: "P2P_TRANSFER" as const,
  purpose: "На продукты",
  ...recipientPresets.son,
};

const mediumInput = {
  ...lowInput,
  simulatedContext: { activeUnknownCall: true },
};

const highInput = {
  ...lowInput,
  ...recipientPresets.unknown,
  simulatedContext: { activeUnknownCall: true },
};

function mustOk<T extends { ok: true }>(res: T | Failure): T {
  if (!res.ok) throw new Error(`${res.failureCode}: ${res.message}`);
  return res;
}

async function enroll(userId: string, adapter: StorageAdapter = storage) {
  const db = await adapter.snapshot();
  const user = db.users.find(u => u.id === userId)!;
  const options = await registrationOptions(user, db.devices);
  const { response, credential } = await registerSoftware(options);
  const pq = keygen();
  const device = await verifyRegistration({
    response,
    deviceKind: "SOFTWARE_FALLBACK",
    user,
    expectedChallenge: options.challenge,
    deviceName: "Audit Key",
    pqPublicKeyBase64: toBase64(pq.publicKey),
    pqProofOfPossessionBase64: createPqProofOfPossession(user.id, response.id, options.challenge, pq.secretKey),
  });
  await adapter.transact(unit => { unit.db.devices.push(device); });
  return { device, credential, pq };
}

async function signPrimary(
  input: typeof lowInput & { simulatedContext?: { activeUnknownCall?: boolean; nightTimeOverride?: boolean } } = lowInput,
  adapter: StorageAdapter = storage,
  svc = service,
) {
  const actor = await enroll(input.senderId, adapter);
  const prepared = mustOk(await svc.prepare(input));
  const assertion = await assertSoftware(actor.credential, prepared.webAuthnOptions);
  const pqSig = sign(primaryMessage(hexToBytes(prepared.txHashHex)), actor.pq.secretKey);
  return {
    actor,
    prepared,
    packet: {
      txId: prepared.txId,
      deviceId: actor.device.id,
      submittedPayload: prepared.payload,
      webAuthnAssertion: assertion,
      pqSignatureBase64: toBase64(pqSig),
    },
  };
}

async function createPendingCosign() {
  const { actor, prepared, packet } = await signPrimary(highInput);
  const exec = mustOk(await service.execute(packet));
  expect(exec.status).toBe("PENDING_COSIGN");
  return { actor, prepared, packet, exec };
}

async function signCosign(txId: string, cosignerUserId = "usr_arman") {
  const actor = await enroll(cosignerUserId);
  const prep = mustOk(await service.cosignPrepare({ txId, cosignerUserId }));
  const primarySig = fromBase64(prep.transaction.primarySignature!.pqSignatureBase64);
  const msg = cosignMessage(hexToBytes(prep.txHashHex), primarySig);
  const assertion = await assertSoftware(actor.credential, prep.webAuthnOptions);
  const pqSig = sign(msg, actor.pq.secretKey);
  return {
    actor,
    prep,
    packet: {
      txId,
      deviceId: actor.device.id,
      webAuthnAssertion: assertion,
      pqSignatureBase64: toBase64(pqSig),
    },
  };
}

async function resignSoftwareAssertion(
  credential: SoftwareCredential,
  challenge: string,
  opts: { origin?: string; rpId?: string; flags?: number; signCount?: number; crossOrigin?: boolean } = {},
) {
  const origin = opts.origin ?? credential.origin;
  const rpId = opts.rpId ?? credential.rpId;
  const flags = opts.flags ?? 0x05;
  const signCount = opts.signCount ?? ++credential.signCount;
  const clientData = utf8(JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin,
    crossOrigin: opts.crossOrigin ?? false,
  }));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount);
  const authData = concatBytes(sha256(utf8(rpId)), Uint8Array.of(flags), counter);
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    credential.privateKey,
    new Uint8Array(concatBytes(authData, sha256(clientData))),
  ));
  const derInt = (slice: Uint8Array) => {
    let start = 0;
    while (start < slice.length - 1 && slice[start] === 0) start++;
    const mag = slice.subarray(start);
    const pos = mag[0] >= 128 ? concatBytes(Uint8Array.of(0), mag) : mag;
    return concatBytes(Uint8Array.of(2, pos.length), pos);
  };
  const body = concatBytes(derInt(raw.slice(0, 32)), derInt(raw.slice(32)));
  return {
    id: credential.id,
    rawId: credential.id,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: toBase64Url(clientData),
      authenticatorData: toBase64Url(authData),
      signature: toBase64Url(concatBytes(Uint8Array.of(0x30, body.length), body)),
      userHandle: credential.userHandle,
    },
  };
}

function forgeZeroPkSignature(message: Uint8Array, pk: Uint8Array): Uint8Array {
  const tr = shake256(pk, { dkLen: 64 });
  const mPrime = concatBytes(Uint8Array.of(0, 0), message);
  const mu = shake256(concatBytes(tr, mPrime), { dkLen: 64 });
  const w1Zero = new Uint8Array(6 * 128);
  const cTilde = shake256(concatBytes(mu, w1Zero), { dkLen: 48 });
  const sig = new Uint8Array(ML_DSA_BYTES.signature);
  sig.set(cTilde, 0);
  // Encode z_i = 0 => GAMMA1 - 0 = 2^19 (20 bits LE per coefficient)
  const zBytes = new Uint8Array(5 * 640);
  for (let off = 0; off < zBytes.length; off += 5) {
    zBytes[off + 2] = 0x08;
    zBytes[off + 4] = 0x80;
  }
  sig.set(zBytes, 48);
  return sig;
}

beforeEach(async () => {
  nowMs = noon;
  await storage.resetDemo({ keepDevices: false });
});

describe("AUDIT-01: Регистрация ML-DSA-65, PoP и вырожденные ключи t1 = 0", () => {
  it("подписывает согласованный домен и SHA-256 идентификаторов для PoP", () => {
    const pq = keygen();
    const proof = createPqProofOfPossession("usr_aigul", "AQID_-0", "AA_-CQ", pq.secretKey);
    const bindingHash = hexToBytes("0c1970b5477c709b751e03c80e6f0881a0d060d82032140df64d0499f749fa3d");
    const message = concatBytes(utf8("BCC-SAFESIGN-V1:PQ-POP:"), bindingHash);
    expect(ml_dsa65.verify(fromBase64(proof), message, pq.publicKey)).toBe(true);
  });
  it("отклоняет вырожденный ключ даже для подписи, которую принимает примитив ML-DSA-65", () => {
    const zeroPk = new Uint8Array(ML_DSA_BYTES.publicKey);
    const msg = primaryMessage(sha256(utf8("arbitrary-payload")));
    const forged = forgeZeroPkSignature(msg, zeroPk);
    expect(verify(forged, msg, zeroPk)).toBe(false);
    expect(ml_dsa65.verify(forged, msg, zeroPk)).toBe(true);
  });

  it.each([0, 1])("отклоняет вырожденный ключ с t1 = 0 независимо от seed (первый байт %i)", async seedByte => {
    const db = await storage.snapshot();
    const user = db.users[0];
    const options = await registrationOptions(user, db.devices);
    const { response } = await registerSoftware(options);
    const zeroPk = new Uint8Array(ML_DSA_BYTES.publicKey);

    zeroPk[0] = seedByte;
    await expect(verifyRegistration({
      user,
      deviceName: "Zero Key Device",
      deviceKind: "SOFTWARE_FALLBACK",
      expectedChallenge: options.challenge,
      response,
      pqPublicKeyBase64: toBase64(zeroPk),
      pqProofOfPossessionBase64: createPqProofOfPossession(user.id, response.id, options.challenge, keygen().secretKey),
    })).rejects.toMatchObject({ code: "ERR_INVALID_INPUT" });
  });

  it("блокирует исполнение со старой записью устройства с вырожденным ключом", async () => {
    const { actor, packet } = await signPrimary();
    await storage.transact(({ db }) => {
      db.devices.find(device => device.id === actor.device.id)!.pqPublicKey = toBase64(new Uint8Array(ML_DSA_BYTES.publicKey));
    });
    expect(await service.execute(packet)).toMatchObject({ status: "REJECTED_CRYPTO", failureCode: "ERR_PQ_SIGNATURE_INVALID" });
  });
});

describe("AUDIT-02: Pre-Auth сжигание nonce и состояние транзакции", () => {
  it("попытка cosignSubmit с чужим deviceId не должна блокировать доверенному лицу cosignReject и cooling-off", async () => {
    const { actor: initiator, prepared } = await createPendingCosign();
    const intruder = await enroll("usr_timur");

    // Инициатор или посторонний шлёт cosignSubmit со своим deviceId и мусорными подписями
    const badCosign = await service.cosignSubmit({
      txId: prepared.txId,
      deviceId: intruder.device.id,
      webAuthnAssertion: await assertSoftware(initiator.credential, prepared.webAuthnOptions),
      pqSignatureBase64: toBase64(new Uint8Array(ML_DSA_BYTES.signature)),
    });
    expect(badCosign).toMatchObject({ status: "ERROR", failureCode: "ERR_COSIGNER" });
    expect((await storage.snapshot()).transactions[0]).toMatchObject({ status: "PENDING_COSIGN", cosignNonceUsed: false });

    // Реальный cosigner (Арман) должен всё ещё иметь возможность заблокировать скам и включить cooling-off
    const rejected = await service.cosignReject({
      txId: prepared.txId,
      cosignerUserId: "usr_arman",
    });
    expect(rejected).toMatchObject({ status: "BLOCKED_BY_COSIGNER", coolingOffActive: true });
  });

  // AUDIT-02: отказ по ERR_ACK_REQUIRED не должен навсегда помечать валидную подпись как REJECTED_CRYPTO
  it("отказ по чекбоксу MEDIUM (ERR_ACK_REQUIRED) не должен сжигать nonce и закрывать TX в REJECTED_CRYPTO", async () => {
    const { packet } = await signPrimary(mediumInput);
    const first = await service.execute({ ...packet, acknowledgedWarning: false });
    expect(first).toMatchObject({ ok: false, failureCode: "ERR_ACK_REQUIRED" });

    const snap = await storage.snapshot();
    expect(snap.transactions[0]).toMatchObject({ status: "CHALLENGE_ISSUED", nonceUsed: false });

    const retry = await service.execute({ ...packet, acknowledgedWarning: true });
    expect(retry.status).toBe("EXECUTED");
    const replay = await service.execute(packet);
    expect(replay).toMatchObject({ failureCode: "ERR_REPLAY_DETECTED" });
    expect(replay.verificationTrace[1]).toMatchObject({ code: "REPLAY_PROTECTION", outcome: "FAIL" });
  });

  it("не позволяет инициатору сделать cosign самому себе или подписать за другого пользователя", async () => {
    const { actor: initiator, prepared } = await createPendingCosign();
    await enroll("usr_arman");
    const prep = mustOk(await service.cosignPrepare({ txId: prepared.txId, cosignerUserId: "usr_arman" }));
    const primarySig = fromBase64(prep.transaction.primarySignature!.pqSignatureBase64);
    const msg = cosignMessage(hexToBytes(prep.txHashHex), primarySig);

    const selfRes = await service.cosignSubmit({
      txId: prepared.txId,
      deviceId: initiator.device.id,
      webAuthnAssertion: await resignSoftwareAssertion(initiator.credential, prep.webAuthnOptions.challenge),
      pqSignatureBase64: toBase64(sign(msg, initiator.pq.secretKey)),
    });
    expect(selfRes.ok).toBe(false);
    expect(selfRes.status).not.toBe("EXECUTED");
    const db = await storage.snapshot();
    expect(db.users[0].balanceTenge).toBe(1_200_000);
  });

  it("не позволяет переиспользовать подпись инициатора как cosign-подпись и проверяет порядок аргументов ml_dsa65", async () => {
    const { actor, prepared, packet } = await createPendingCosign();
    const cosigner = await enroll("usr_arman");
    const prep = mustOk(await service.cosignPrepare({ txId: prepared.txId, cosignerUserId: "usr_arman" }));

    // Подсовываем первичную подпись инициатора в cosignSubmit
    const res = await service.cosignSubmit({
      txId: prepared.txId,
      deviceId: cosigner.device.id,
      webAuthnAssertion: packet.webAuthnAssertion,
      pqSignatureBase64: packet.pqSignatureBase64,
    });
    expect(res).toMatchObject({ ok: false, failureCode: "ERR_WEBAUTHN_INVALID" });

    // И проверяем прямое разделение доменов ml_dsa65
    const h = hexToBytes(prep.txHashHex);
    const pMsg = primaryMessage(h);
    const cMsg = cosignMessage(h, fromBase64(packet.pqSignatureBase64));
    const pSig = sign(pMsg, actor.pq.secretKey);
    expect(verify(pSig, pMsg, actor.pq.publicKey)).toBe(true);
    expect(verify(pSig, cMsg, actor.pq.publicKey)).toBe(false);
  });
});

describe("AUDIT-03: Атомарность nonce и параллельный replay через Promise.all", () => {
  it("внутри одного процесса параллельный Promise.all на execute и cosignSubmit допускает ровно 1 исполнение", async () => {
    const { packet } = await signPrimary(lowInput);
    const before = (await storage.snapshot()).users[0].balanceTenge;
    const primaryResults = await Promise.all(Array.from({ length: 5 }, () => service.execute(packet)));
    expect(primaryResults.filter(r => r.status === "EXECUTED")).toHaveLength(1);
    expect(primaryResults.filter(r => !r.ok && r.failureCode === "ERR_REPLAY_DETECTED")).toHaveLength(4);
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(before - lowInput.amountTenge);

    const { prepared } = await createPendingCosign();
    const second = await signCosign(prepared.txId);
    const beforeCosign = (await storage.snapshot()).users[0].balanceTenge;
    const cosignResults = await Promise.all(Array.from({ length: 5 }, () => service.cosignSubmit(second.packet)));
    expect(cosignResults.filter(r => r.status === "EXECUTED")).toHaveLength(1);
    expect(cosignResults.filter(r => !r.ok && r.failureCode === "ERR_REPLAY_DETECTED")).toHaveLength(4);
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(beforeCosign - highInput.amountTenge);
  });

  it("в одном процессе JsonFileAdapter сериализует параллельный replay через Promise.all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "safesign-audit-"));
    try {
      const file = join(dir, "store.json");
      const adapterA = new JsonFileAdapter(file);
      const adapterB = new JsonFileAdapter(file);
      await adapterA.resetDemo({ keepDevices: false });
      const svcA = new TransactionService(adapterA, () => new Date(nowMs));
      const svcB = new TransactionService(adapterB, () => new Date(nowMs));
      const { packet } = await signPrimary(lowInput, adapterA, svcA);
      const before = (await adapterA.snapshot()).users[0].balanceTenge;

      const results = await Promise.all([
        svcA.execute(packet),
        svcB.execute(packet),
        svcA.execute(packet),
        svcB.execute(packet),
      ]);
      expect(results.filter(r => r.status === "EXECUTED")).toHaveLength(1);
      expect((await adapterA.snapshot()).users[0].balanceTenge).toBe(before - lowInput.amountTenge);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // AUDIT-03: два независимых воркера/процесса (без общего globalThis.safeSignLocks) на JsonFileAdapter
  // могут одновременно прочитать store.json и оба списать деньги / пройти consumeNonce
  it.fails("JsonFileAdapter должен гарантировать атомарность между независимыми процессами (блокировка файла / CAS)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "safesign-audit-mp-"));
    const runtime = globalThis as typeof globalThis & { safeSignLocks?: unknown };
    const savedLocks = runtime.safeSignLocks;
    try {
      const file = join(dir, "store.json");
      const { JsonFileAdapter: Adapter1 } = await import("@/lib/db/store");
      const a1 = new Adapter1(file);
      await a1.resetDemo({ keepDevices: false });
      const svc1 = new TransactionService(a1, () => new Date(nowMs));
      const { packet } = await signPrimary(lowInput, a1, svc1);
      const before = (await a1.snapshot()).users[0].balanceTenge;

      // Имитируем второй независимый процесс Node.js (отдельный модуль и отдельный safeSignLocks)
      vi.resetModules();
      delete runtime.safeSignLocks;
      const { JsonFileAdapter: Adapter2 } = await import("@/lib/db/store");
      const { TransactionService: TxSvc2 } = await import("@/lib/tx/service");
      const a2 = new Adapter2(file);
      const svc2 = new TxSvc2(a2, () => new Date(nowMs));

      const [r1, r2] = await Promise.all([svc1.execute(packet), svc2.execute(packet)]);
      expect([r1, r2].filter(r => r.status === "EXECUTED")).toHaveLength(1);
      expect((await a1.snapshot()).users[0].balanceTenge).toBe(before - lowInput.amountTenge);
    } finally {
      runtime.safeSignLocks = savedLocks;
      vi.resetModules();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("AUDIT-04 / AUDIT-05 / AUDIT-06: Каноническая сериализация и валидация ввода", () => {
  it("отклоняет в prepare отрицательную, нулевую, -0, нецелую сумму, MAX_SAFE_INTEGER+1 и огромный purpose", async () => {
    for (const amountTenge of [-15_000, -1, 0, -0, 15_000.5, "15000", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const res = await service.prepare({ ...lowInput, amountTenge });
      expect(res).toMatchObject({ ok: false, failureCode: "ERR_INVALID_INPUT" });
    }
    const hugePurpose = await service.prepare({ ...lowInput, purpose: "A".repeat(10_000) });
    expect(hugePurpose).toMatchObject({ ok: false, failureCode: "ERR_INVALID_INPUT" });
  });

  it("нормализует -0 к 0, сортирует вложенные и числовые ключи и безопасно обрабатывает ключ __proto__", () => {
    expect(serializeCanonicalJSON({ a: -0 })).toBe(serializeCanonicalJSON({ a: 0 }));
    expect(serializeCanonicalJSON({ b: { "10": 1, "2": 2 }, a: 1 })).toBe('{"a":1,"b":{"10":1,"2":2}}');
    const protoObj = JSON.parse('{"__proto__":{"admin":true},"a":1}');
    expect(serializeCanonicalJSON(protoObj)).toBe('{"__proto__":{"admin":true},"a":1}');
  });

  it("executeSchema должен ограничивать размер строк и глубину вложенности в submittedPayload", async () => {
    const { packet } = await signPrimary();
    const huge = executeSchema.safeParse({
      ...packet,
      submittedPayload: { ...packet.submittedPayload, purpose: "X".repeat(100_000) },
    });
    expect(huge.success).toBe(false);

    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 15_000; i++) deep = { n: deep };
    const nested = executeSchema.safeParse({
      ...packet,
      submittedPayload: { ...packet.submittedPayload, extra: deep },
    });
    expect(nested.success).toBe(false);
    expect(executeSchema.safeParse({ ...packet, pqSignatureBase64: "A".repeat(6001) }).success).toBe(false);
    for (const field of ["clientDataJSON", "authenticatorData"]) {
      const assertion = packet.webAuthnAssertion;
      expect(executeSchema.safeParse({ ...packet, webAuthnAssertion: {
        ...assertion, response: { ...assertion.response, [field]: "A".repeat(8193) },
      } }).success).toBe(false);
    }
    expect(await service.execute({ ...packet, submittedPayload: { ...packet.submittedPayload, recipientName: "я".repeat(121) } }))
      .toMatchObject({ status: "ERROR", failureCode: "ERR_INVALID_INPUT" });
    expect((await service.execute(packet)).status).toBe("EXECUTED");
  });

  it.each([[15_000.5, "15000.5"], ["18000", "18000"], ["15000", '"15000"']])("показывает изменение суммы на %j в tamperDiff", async (amountTenge, displayed) => {
    const { packet } = await signPrimary();
    const res = await service.execute({
      ...packet,
      submittedPayload: { ...packet.submittedPayload, amountTenge },
    });
    expect(res).toMatchObject({
      ok: false,
      failureCode: "ERR_WYSIWYS_TAMPERED",
      tamperDiff: [{ field: "amountTenge", original: "15000", tampered: displayed }],
    });
    expect(res.verificationTrace[2]).toMatchObject({ code: "WYSIWYS_INTEGRITY", outcome: "FAIL" });
    expect((await storage.snapshot()).transactions[0]).toMatchObject({ status: "REJECTED_CRYPTO", nonceUsed: true });
  });

  // AUDIT-06: Bidi-управление (RLO) и zero-width символы в WYSIWYS-полях
  it("prepare должен отклонять Bidi-переопределение (U+202E) и невидимые символы в recipientName/purpose", async () => {
    const res = await service.prepare({
      ...lowInput,
      recipientName: "Арман \u202E000051",
      purpose: "Перевод\u200B",
    });
    expect(res).toMatchObject({ ok: false, failureCode: "ERR_INVALID_INPUT" });
  });

  it("нормализует реквизиты в NFC до хеширования и сохраняет подписанное написание при проверке", async () => {
    const { packet, prepared } = await signPrimary({ ...lowInput, recipientName: "И\u0306", purpose: "Пае\u0308к" });
    expect(prepared.payload).toMatchObject({ recipientName: "Й", purpose: "Паёк" });
    expect(hashPayload(prepared.payload).txHashHex).toBe(prepared.txHashHex);
    expect(await service.execute({ ...packet, submittedPayload: { ...packet.submittedPayload, recipientName: "И\u0306" } }))
      .toMatchObject({ failureCode: "ERR_WYSIWYS_TAMPERED" });
  });
});

describe("WebAuthn Origin, UV, SignCount, challenge из присланного payload и Атака №6", () => {
  it("подтверждает, что сервер считает challenge и сообщение ML-DSA из ПРИСЛАННОГО submittedPayload", async () => {
    // Злоумышленник/перехватчик подменяет сумму и даже переподписывает ИЗМЕНЁННЫЙ payload валидными ключами:
    // шаги 5 и 6 обязаны пройти против присланного payload, но шаг 3 обязан остановить как ERR_WYSIWYS_TAMPERED.
    const { actor, prepared } = await signPrimary();
    const tampered = { ...prepared.payload, amountTenge: 500_000 };
    const { hashBytes, webAuthnChallenge } = hashPayload(tampered);

    const res = await service.execute({
      txId: prepared.txId,
      deviceId: actor.device.id,
      submittedPayload: tampered,
      webAuthnAssertion: await resignSoftwareAssertion(actor.credential, webAuthnChallenge),
      pqSignatureBase64: toBase64(sign(primaryMessage(hashBytes), actor.pq.secretKey)),
    });
    expect(res).toMatchObject({ ok: false, failureCode: "ERR_WYSIWYS_TAMPERED" });
    expect(res.verificationTrace.map(s => s.outcome)).toEqual([
      "PASS", "PASS", "FAIL", "PASS", "PASS", "PASS", "SKIPPED",
    ]);
  });

  it("подмена HTTP-заголовка Origin на легитимный не обходит фишинг-защиту для assertion с чужого origin", async () => {
    const { actor, prepared } = await signPrimary();
    const phishingAssertion = await resignSoftwareAssertion(
      actor.credential,
      prepared.webAuthnOptions.challenge,
      { origin: "http://127.0.0.1:3000", rpId: "127.0.0.1" },
    );

    // Заголовок Origin подделан на http://localhost:3000 (и даже если undefined)
    const res1 = await service.execute(
      { txId: prepared.txId, deviceId: actor.device.id, submittedPayload: prepared.payload, webAuthnAssertion: phishingAssertion, pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(prepared.txHashHex)), actor.pq.secretKey)) },
      "http://localhost:3000",
    );
    expect(res1).toMatchObject({ ok: false, failureCode: "ERR_ORIGIN_MISMATCH" });

    // Даже при подмене origin в clientDataJSON фишингового assertion без переподписи валится на rpIdHash / ECDSA
    const second = await signPrimary();
    const phishSigned = await resignSoftwareAssertion(
      second.actor.credential,
      second.prepared.webAuthnOptions.challenge,
      { origin: "http://127.0.0.1:3000", rpId: "localhost" },
    );
    phishSigned.response.clientDataJSON = toBase64Url(utf8(JSON.stringify({
      type: "webauthn.get",
      challenge: second.prepared.webAuthnOptions.challenge,
      origin: "http://localhost:3000",
      crossOrigin: false,
    })));
    const res2 = await service.execute(
      { ...second.packet, webAuthnAssertion: phishSigned },
      "http://localhost:3000",
    );
    expect(res2).toMatchObject({ ok: false, failureCode: "ERR_WEBAUTHN_INVALID" });
  });

  it("отклоняет assertion без userVerified (UV = 0) и откат signCount", async () => {
    const { actor, prepared, packet } = await signPrimary();
    packet.webAuthnAssertion = await resignSoftwareAssertion(
      actor.credential,
      prepared.webAuthnOptions.challenge,
      { flags: 0x01 }, // UP = 1, UV = 0
    );
    expect(await service.execute(packet)).toMatchObject({ ok: false, failureCode: "ERR_WEBAUTHN_INVALID" });

    const second = await signPrimary();
    await storage.transact(unit => {
      const dev = unit.db.devices.find(d => d.id === second.actor.device.id)!;
      dev.webAuthnCounter = 10;
    });
    expect(await service.execute(second.packet)).toMatchObject({ ok: false, failureCode: "ERR_WEBAUTHN_INVALID" });
  });

  // AUDIT-09: crossOrigin: true при отсутствии topOrigin принимается библиотекой
  it("должен отклонять WebAuthn assertion с crossOrigin: true", async () => {
    const { actor, prepared, packet } = await signPrimary();
    packet.webAuthnAssertion = await resignSoftwareAssertion(
      actor.credential,
      prepared.webAuthnOptions.challenge,
      { crossOrigin: true },
    );
    const res = await service.execute(packet);
    expect(res).toMatchObject({ ok: false, failureCode: "ERR_ORIGIN_MISMATCH" });
  });

  it("сверяет непустой userHandle с идентификатором зарегистрированного пользователя", async () => {
    const { packet } = await signPrimary();
    packet.webAuthnAssertion.response.userHandle = toBase64Url(utf8("usr_arman"));
    expect(await service.execute(packet)).toMatchObject({ failureCode: "ERR_WEBAUTHN_INVALID" });
  });

  it("квантовая атака №6 честно проверяет ML-DSA-65 даже при quantumSimulation: true", async () => {
    const { actor, prepared, packet } = await signPrimary();
    const fakeKey = keygen();
    const forgedSig = sign(primaryMessage(hexToBytes(prepared.txHashHex)), fakeKey.secretKey);
    const bogusAssertion = await resignSoftwareAssertion(
      actor.credential,
      prepared.webAuthnOptions.challenge,
      { flags: 0x01 },
    );

    const failPq = await service.execute({
      ...packet,
      webAuthnAssertion: bogusAssertion,
      pqSignatureBase64: toBase64(forgedSig),
      quantumSimulation: true,
    });
    expect(failPq).toMatchObject({ ok: false, failureCode: "ERR_PQ_SIGNATURE_INVALID" });
    expect(failPq.verificationTrace[4].outcome).toBe("COMPROMISED");
    expect(failPq.verificationTrace[5].outcome).toBe("FAIL");
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(1_200_000);
  });
});

describe("TTL, машина состояний §5.3, Risk Engine §5.1–5.2 и деньги", () => {
  it("считает повреждённый и отсутствующий срок истёкшим", async () => {
    const first = await signPrimary();
    const pending = await createPendingCosign();
    await storage.transact(({ db }) => {
      db.transactions.find(t => t.id === first.packet.txId)!.payload.expiresAt = "повреждённая дата";
      delete db.transactions.find(t => t.id === pending.packet.txId)!.cosignExpiresAt;
    });
    expect(await service.execute(first.packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
    expect(await service.cosignPrepare({ txId: pending.packet.txId, cosignerUserId: "usr_arman" }))
      .toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
  });
  it("блокирует подпись ровно в expiresAt и после expiresAt, а также после cosignExpiresAt", async () => {
    const p1 = await signPrimary();
    nowMs += PRIMARY_TTL; // точная граница expiresAt
    expect(await service.execute(p1.packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });

    const p2 = await signPrimary();
    nowMs += PRIMARY_TTL + 10_000;
    expect(await service.execute(p2.packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });

    const pending = await createPendingCosign();
    const c2 = await signCosign(pending.prepared.txId);
    nowMs += COSIGN_TTL;
    expect(await service.cosignSubmit(c2.packet)).toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
    expect(await service.cosignReject({ txId: pending.prepared.txId, cosignerUserId: "usr_arman" }))
      .toMatchObject({ status: "EXPIRED", failureCode: "ERR_TX_EXPIRED" });
  });

  it("блокирует исполнение BLOCKED_BY_COSIGNER, преждевременный cosign на CHALLENGE_ISSUED и двойной cosign", async () => {
    const p = await signPrimary(highInput);
    const cosigner = await enroll("usr_arman");
    // Преждевременный cosignSubmit до первичной подписи
    expect(await service.cosignSubmit({
      txId: p.prepared.txId,
      deviceId: cosigner.device.id,
      webAuthnAssertion: p.packet.webAuthnAssertion,
      pqSignatureBase64: p.packet.pqSignatureBase64,
    })).toMatchObject({ ok: false, failureCode: "ERR_TX_STATE" });

    // Блокировка доверенным лицом
    mustOk(await service.execute(p.packet));
    mustOk(await service.cosignReject({ txId: p.prepared.txId, cosignerUserId: "usr_arman" }));
    const blockedPrep = await service.cosignPrepare({ txId: p.prepared.txId, cosignerUserId: "usr_arman" });
    expect(blockedPrep).toMatchObject({ ok: false, failureCode: "ERR_TX_STATE" });
    expect(await service.cosignSubmit({
      txId: p.prepared.txId,
      deviceId: cosigner.device.id,
      webAuthnAssertion: p.packet.webAuthnAssertion,
      pqSignatureBase64: p.packet.pqSignatureBase64,
    })).toMatchObject({ ok: false, failureCode: "ERR_TX_STATE" });
    expect(await service.execute(p.packet)).toMatchObject({ ok: false, failureCode: "ERR_REPLAY_DETECTED" });
  });

  it("исключает отрицательный баланс при двух одновременно подготовленных списаниях на полный баланс", async () => {
    const actor = await enroll("usr_aigul");
    const bal = (await storage.snapshot()).users[0].balanceTenge;
    const t1 = mustOk(await service.prepare({ ...lowInput, amountTenge: bal }));
    const t2 = mustOk(await service.prepare({ ...lowInput, amountTenge: bal }));

    const exec1 = mustOk(await service.execute({
      txId: t1.txId,
      deviceId: actor.device.id,
      submittedPayload: t1.payload,
      webAuthnAssertion: await assertSoftware(actor.credential, t1.webAuthnOptions),
      pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(t1.txHashHex)), actor.pq.secretKey)),
    }));
    const exec2 = mustOk(await service.execute({
      txId: t2.txId,
      deviceId: actor.device.id,
      submittedPayload: t2.payload,
      webAuthnAssertion: await assertSoftware(actor.credential, t2.webAuthnOptions),
      pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(t2.txHashHex)), actor.pq.secretKey)),
    }));
    expect(exec1.status).toBe("PENDING_COSIGN");
    expect(exec2.status).toBe("PENDING_COSIGN");

    const c1 = await signCosign(t1.txId);
    const c2 = await signCosign(t2.txId);
    expect(mustOk(await service.cosignSubmit(c1.packet)).status).toBe("EXECUTED");
    expect(await service.cosignSubmit(c2.packet)).toMatchObject({ ok: false, failureCode: "ERR_INSUFFICIENT_FUNDS" });
    expect((await storage.snapshot()).users[0].balanceTenge).toBe(0);
  });

  it("применяет cooling-off ко всем операциям (prepare, execute, cosignSubmit) до окончания 24 часов", async () => {
    const preparedBeforeBlock = await signPrimary();
    const { prepared: highTx } = await createPendingCosign();
    const highSecond = await signCosign(highTx.txId);

    const { prepared: scamTx } = await createPendingCosign();
    mustOk(await service.cosignReject({ txId: scamTx.txId, cosignerUserId: "usr_arman", activateCoolingOff: true }));

    expect(await service.prepare(lowInput)).toMatchObject({ ok: false, failureCode: "ERR_COOLING_OFF" });
    expect(await service.execute(preparedBeforeBlock.packet)).toMatchObject({ ok: false, failureCode: "ERR_COOLING_OFF" });
    expect(await service.cosignSubmit(highSecond.packet)).toMatchObject({ ok: false, failureCode: "ERR_COOLING_OFF" });

    nowMs += COOLING_OFF - 1;
    expect(await service.prepare(lowInput)).toMatchObject({ ok: false, failureCode: "ERR_COOLING_OFF" });
    nowMs += 1;
    expect((await service.prepare(lowInput)).ok).toBe(true);
  });

  it("сохраняет вес 55 и требует Co-Sign для ONLINE_LOAN < 200 000 ₸ доверенному получателю", () => {
    const db = storage.snapshot();
    return db.then(snap => {
      const aigul = snap.users[0];
      const r = assessRisk(
        { mode: "B2C", operationType: "ONLINE_LOAN", amountTenge: 199_999, recipientAccount: recipientPresets.son.recipientAccount },
        aigul,
        snap.blacklist,
        new Date("2026-04-01T07:00:00Z"),
      );
      expect(r.score).toBe(55);
      expect(r.level).toBe("HIGH");
      expect(r.requiresCoSign).toBe(true);
      expect(r.reasons).toContain("Политика банка: закрытие депозита / кредит подтверждает доверенное лицо");
    });
  });

  it("service.preview при невалидном вводе должен возвращать структурированный Failure без исключения", async () => {
    const res = await service.preview({ bad: true });
    expect(res).toMatchObject({ ok: false, failureCode: "ERR_INVALID_INPUT" });
  });
});
