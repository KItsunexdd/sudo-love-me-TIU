import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { fromBase64Url, hashPayload, toBase64 } from "../src/lib/crypto/canonical";
import { createPqProofOfPossession, keygen, primaryMessage, sign, verify } from "../src/lib/crypto/mldsa";
import { assertSoftware, registerSoftware } from "../src/lib/crypto/software-authenticator";
import { registrationOptions, verifyRegistration } from "../src/lib/crypto/webauthn";
import { createSeed } from "../src/lib/db/seed";
import { MemoryAdapter } from "../src/lib/db/store";
import { TransactionService } from "../src/lib/tx/service";
import { demoTransfer, signTransfer } from "./demo-transfer";

const iterations = 200;
const warmup = 25;
const origin = "http://localhost:3000";

function statistics(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  return { median, p95: sorted[Math.ceil(0.95 * sorted.length) - 1], max: sorted[sorted.length - 1] };
}

async function main() {
  process.env.SAFESIGN_RP_ID = "localhost";
  process.env.SAFESIGN_ORIGIN = origin;
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(origin) });

  const user = createSeed().users.find(candidate => candidate.id === demoTransfer.senderId);
  assert(user, "Отправитель отсутствует в seed");
  const registration = await registrationOptions(user);
  const { credential, response } = await registerSoftware(registration);
  const pq = keygen();
  const device = await verifyRegistration({
    user, deviceName: "Ключ бенчмарка", deviceKind: "SOFTWARE_FALLBACK", response,
    targetUrl: origin, expectedChallenge: registration.challenge, pqPublicKeyBase64: toBase64(pq.publicKey),
    pqProofOfPossessionBase64: createPqProofOfPossession(user.id, response.id, registration.challenge, pq.secretKey),
  });
  const storage = new MemoryAdapter();
  await storage.transact(({ db }) => { db.devices.push(device); });
  const service = new TransactionService(storage);
  const sample = await service.prepare(demoTransfer);
  assert(sample.ok, !sample.ok ? sample.message : undefined);
  const message = primaryMessage(hashPayload(sample.payload).hashBytes);
  const webAuthnVerifier = {
    expectedChallenge: sample.webAuthnOptions.challenge, expectedOrigin: origin, expectedRPID: device.rpId,
    requireUserVerification: true,
    credential: { id: device.credentialId, publicKey: fromBase64Url(device.webAuthnPublicKey), counter: device.webAuthnCounter },
  };

  const times = {
    keygen: [] as number[], sign: [] as number[], verify: [] as number[], hash: [] as number[],
    assertion: [] as number[], webAuthnVerify: [] as number[], webAuthnRound: [] as number[],
    execute: [] as number[], serverVerify: [] as number[], cycle: [] as number[],
  };
  const signatureSizes: number[] = [];
  const jsonSizes: number[] = [];
  let pqSignatureBytes = 0;

  for (let i = -warmup; i < iterations; i++) {
    let start = performance.now();
    const keys = keygen();
    const keygenMs = performance.now() - start;

    start = performance.now();
    const signature = sign(message, keys.secretKey);
    const signMs = performance.now() - start;

    start = performance.now();
    const valid = verify(signature, message, keys.publicKey);
    const verifyMs = performance.now() - start;
    assert(valid, "Подпись ML-DSA-65 не прошла проверку");

    start = performance.now();
    const digest = hashPayload(sample.payload);
    const hashMs = performance.now() - start;
    assert.equal(digest.txHashHex, sample.txHashHex);

    const assertionStart = performance.now();
    const assertion = await assertSoftware(credential, sample.webAuthnOptions);
    start = performance.now();
    const authentication = await verifyAuthenticationResponse({ ...webAuthnVerifier, response: assertion });
    const verifiedAt = performance.now();
    assert(authentication.verified, "WebAuthn assertion не прошла проверку");
    webAuthnVerifier.credential.counter = authentication.authenticationInfo.newCounter;

    // Keep seed balances and history identical for every timed transaction.
    await storage.resetDemo({ keepDevices: true });
    const cycleStart = performance.now();
    const prepared = await service.prepare(demoTransfer);
    assert(prepared.ok, !prepared.ok ? prepared.message : undefined);
    const packet = await signTransfer(prepared, device.id, credential, pq.secretKey);
    const executeStart = performance.now();
    const executed = await service.execute(packet, origin, origin);
    const cycleEnd = performance.now();
    assert(executed.ok, !executed.ok ? executed.message : undefined);
    assert.equal(executed.status, "EXECUTED");
    assert.equal(executed.verificationTrace.length, 7);
    assert(executed.verificationTrace.every(step => step.passed));
    const primary = executed.transaction.primarySignature;
    assert(primary, "Нет метрик серверной верификации");

    if (i < 0) continue;
    times.keygen.push(keygenMs);
    times.sign.push(signMs);
    times.verify.push(verifyMs);
    times.hash.push(hashMs);
    times.assertion.push(start - assertionStart);
    times.webAuthnVerify.push(verifiedAt - start);
    times.webAuthnRound.push(verifiedAt - assertionStart);
    times.execute.push(cycleEnd - executeStart);
    times.serverVerify.push(primary.verifyTimeMs);
    times.cycle.push(cycleEnd - cycleStart);
    pqSignatureBytes = primary.pqSignatureBytesLength;
    signatureSizes.push(primary.webAuthnSignatureBytesLength);
    jsonSizes.push(Buffer.byteLength(JSON.stringify(packet), "utf8"));
  }

  const formatMs = (value: number) => value.toFixed(3);
  const rows: Array<[string, number[], number?]> = [
    ["ML-DSA-65 keygen", times.keygen],
    ["ML-DSA-65 sign", times.sign, 15],
    ["ML-DSA-65 verify", times.verify],
    ["Canonical JSON + SHA-256", times.hash],
    ["Software ECDSA P-256 assertion", times.assertion],
    ["WebAuthn `verifyAuthenticationResponse`", times.webAuthnVerify],
    ["WebAuthn assertion + verify", times.webAuthnRound],
    ["`TransactionService.execute` (7 шагов и запись)", times.execute],
    ["Серверная гибридная верификация", times.serverVerify, 25],
    ["Полный цикл prepare → подпись → execute", times.cycle, 250],
  ];
  const timeTable = [
    "| Операция | Медиана, мс | p95, мс | Max, мс | Цель §12 по p95 |",
    "|---|---:|---:|---:|---|",
    ...rows.map(([label, samples, target]) => {
      const { median, p95, max } = statistics(samples);
      const verdict = target === undefined ? "—" : `${p95 < target ? "✅" : "❌"} < ${target} мс`;
      return `| ${label} | ${formatMs(median)} | ${formatMs(p95)} | ${formatMs(max)} | ${verdict} |`;
    }),
  ].join("\n");

  function sizeRange(sizes: number[]) {
    const min = Math.min(...sizes), max = Math.max(...sizes);
    return min === max ? String(min) : `${min}–${max}`;
  }
  const sizeTable = [
    "| Объект | Размер, байт |",
    "|---|---:|",
    `| Открытый ключ ML-DSA-65 (PK) | ${pq.publicKey.length} |`,
    `| Закрытый ключ ML-DSA-65 (SK) | ${pq.secretKey.length} |`,
    `| Подпись ML-DSA-65 | ${pqSignatureBytes} |`,
    `| Подпись WebAuthn (DER) | ${sizeRange(signatureSizes)} |`,
    `| JSON-тело execute (UTF-8) | ${sizeRange(jsonSizes)} |`,
  ].join("\n");

  const report = [
    "# Бенчмарки BCC SafeSign", `Дата (UTC) — ${new Date().toISOString()}`,
    `Node.js ${process.version} · CPU ${cpus()[0]?.model ?? "не определён"}`,
    `${iterations} замеров на операцию после ${warmup} прогревочных итераций. p95 — ближайший ранг. Цели [ТЗ §12](../BCC_SafeSign_TZ.md#12-нефункциональные-требования-и-целевые-бенчмарки) оцениваются по p95.`,
    "Сценарий — перевод 15 000 ₸ доверенному получателю. Полный цикл измерен в Node.js с программным ключом и хранением в памяти, без HTTP, браузера и биометрии. Серверная верификация измерена по `primarySignature.verifyTimeMs` внутри гибридного верификатора.",
    timeTable, sizeTable,
  ].join("\n\n");

  await writeFile(new URL("../docs/BENCHMARKS.md", import.meta.url), `${report}\n`);
  console.log(report);
}

main().catch((error: unknown) => {
  console.error("❌ Бенчмарк завершился ошибкой", error);
  process.exitCode = 1;
});
