import type { SigningRole, UnitOfWork } from "@/lib/db/store";
import type {
  FailureCode, RegisteredDevice, SignatureBundle,
  TransactionRecord, VerificationStepResult,
} from "@/lib/db/types";
import { failureMessages } from "@/lib/db/types";
import { failure, requireTx, TxError } from "@/lib/tx/errors";
import type { z } from "zod";
import type { cosignSubmitSchema, executeSchema } from "@/lib/tx/inputs";
import { bytesToHex, computeTamperDiff, fromBase64, fromBase64Url, hashPayload, sha256, toBase64Url, utf8 } from "./canonical";
import { cosignMessage, primaryMessage, verify } from "./mldsa";
import { relyingParty, verifyAuthentication } from "./webauthn";

export type SignedPacket = z.infer<typeof cosignSubmitSchema>;
export type PrimaryPacket = z.infer<typeof executeSchema>;
export interface VerificationContext {
  unit: UnitOfWork;
  requestOrigin?: string;
  clock(): Date;
  preparePolicy(tx: TransactionRecord): (signature: SignatureBundle) => void;
}

const steps = [
  ["TX_EXISTENCE_AND_TTL", "Состояние, срок действия и допуск к операции"],
  ["REPLAY_PROTECTION", "Одноразовое подтверждение"],
  ["WYSIWYS_INTEGRITY", "Целостность реквизитов"],
  ["ORIGIN_AND_RPID", "Источник запроса и домен банка"],
  ["WEBAUTHN_SIGNATURE", "Подпись устройства"],
  ["POST_QUANTUM_ML_DSA", "Постквантовая подпись"],
  ["RISK_AND_POLICY_GATE", "Риск и исполнение операции"],
];

type Check<T> = { ok: true; value: T } | { ok: false; code: FailureCode; message: string };

class Trace {
  readonly rows: VerificationStepResult[] = steps.map(([code, label], i) => ({
    step: i + 1, code, label, passed: false, outcome: "SKIPPED", durationMs: 0, details: "Проверка пропущена",
  }));

  async check<T>(step: number, fallback: FailureCode, evaluate: () => T | Promise<T>): Promise<Check<T>> {
    const row = this.rows[step - 1];
    const start = performance.now();
    try {
      const value = await evaluate();
      Object.assign(row, { passed: true, outcome: "PASS", details: "Проверка пройдена" });
      return { ok: true, value };
    } catch (error) {
      const code = error instanceof TxError ? error.code : fallback;
      const message = error instanceof TxError ? error.message : failureMessages[code];
      Object.assign(row, { outcome: "FAIL", details: message });
      return { ok: false, code, message };
    } finally {
      row.durationMs = performance.now() - start;
    }
  }
}

export function isExpired(tx: TransactionRecord, now: Date) {
  if (tx.status !== "PENDING_COSIGN" && tx.status !== "CHALLENGE_ISSUED") return tx.status === "EXPIRED";
  const deadline = Date.parse((tx.status === "PENDING_COSIGN" ? tx.cosignExpiresAt : tx.payload.expiresAt) ?? "");
  return !(now.getTime() < deadline);
}

async function verifyHybrid(context: VerificationContext, packet: SignedPacket, role: SigningRole, simulation: boolean) {
  const { unit, clock } = context;
  const { db } = unit;
  const trace = new Trace();
  const started = performance.now();
  const primary = role === "primary";
  const tx = db.transactions.find(item => item.id === packet.txId);
  const state = await trace.check(1, "ERR_TX_STATE", () => {
    requireTx(tx, "ERR_TX_NOT_FOUND");
    if (primary ? tx.nonceUsed : tx.cosignNonceUsed) return null;
    requireTx(!isExpired(tx, clock()), "ERR_TX_EXPIRED");
    requireTx(tx.status === (primary ? "CHALLENGE_ISSUED" : "PENDING_COSIGN"), "ERR_TX_STATE");
    const signer = primary ? tx.payload.senderId : tx.cosignerUserId;
    const device = db.devices.find(d => d.id === packet.deviceId && d.userId === signer);
    requireTx(device, primary ? "ERR_DEVICE_NOT_ALLOWED" : "ERR_COSIGNER");
    if (!primary) enforceIndependentDevice(device, tx.primarySignature, db.devices);
    return { record: tx, device, applyPolicy: context.preparePolicy(tx) };
  });
  if (!state.ok) return failure(state.code, trace.rows, state.message);
  // The storage transaction holds the lock through verification and final nonce consumption.
  const nonce = await trace.check(2, "ERR_REPLAY_DETECTED", () => {
    requireTx(state.value, "ERR_REPLAY_DETECTED");
    return state.value;
  });
  if (!nonce.ok) return failure(nonce.code, trace.rows);
  const { record, device, applyPolicy } = nonce.value;

  const submitted = packet.submittedPayload ?? record.payload;
  const integrity = await trace.check(3, "ERR_INVALID_INPUT", () => {
    requireTx(!primary || packet.submittedPayload, "ERR_INVALID_INPUT");
    const { hashBytes, txHashHex } = hashPayload(submitted);
    const diff = txHashHex === record.txHashHex ? undefined : computeTamperDiff(record.payload, submitted);
    if (primary) return { message: primaryMessage(hashBytes), challenge: toBase64Url(hashBytes), diff };
    requireTx(record.primarySignature, "ERR_TX_STATE");
    const message = cosignMessage(hashBytes, fromBase64(record.primarySignature.pqSignatureBase64));
    return { message, challenge: toBase64Url(sha256(message)), diff };
  });
  if (!integrity.ok) return failure(integrity.code, trace.rows);
  const { message, challenge, diff } = integrity.value;
  if (diff) {
    Object.assign(trace.rows[2], { passed: false, outcome: "FAIL", details: failureMessages.ERR_WYSIWYS_TAMPERED });
  }
  const assertion = packet.webAuthnAssertion;
  const { rpId, expectedOrigin } = relyingParty();
  const origin = await trace.check(4, "ERR_ORIGIN_MISMATCH", () => {
    const json = new TextDecoder().decode(fromBase64Url(assertion.response.clientDataJSON));
    const data = JSON.parse(json);
    const requestOrigin = context.requestOrigin ?? expectedOrigin;
    requireTx(requestOrigin === expectedOrigin && data.origin === requestOrigin && data.crossOrigin !== true &&
      record.payload.rpId === rpId, "ERR_ORIGIN_MISMATCH");
    const authData = fromBase64Url(assertion.response.authenticatorData);
    requireTx(authData.length >= 37 && bytesToHex(authData.subarray(0, 32)) === bytesToHex(sha256(utf8(rpId))), "ERR_ORIGIN_MISMATCH");
    const { userHandle } = assertion.response;
    requireTx(!userHandle || userHandle === toBase64Url(utf8(device.userId)), "ERR_WEBAUTHN_INVALID");
    return json;
  });
  if (!origin.ok && !diff) return failure(origin.code, trace.rows);

  const classic = await trace.check(5, "ERR_WEBAUTHN_INVALID", () => verifyAuthentication(device, assertion, challenge));
  if (!classic.ok && !diff && !simulation) return failure(classic.code, trace.rows);
  if (simulation && !diff) {
    Object.assign(trace.rows[4], { passed: false, outcome: "COMPROMISED",
      details: "Симуляция компрометации ECDSA. Фактическая проверка: " + (classic.ok ? "пройдена" : "отклонена") });
  }
  const postQuantum = await trace.check(6, "ERR_PQ_SIGNATURE_INVALID", () => {
    const signature = fromBase64(packet.pqSignatureBase64);
    requireTx(verify(signature, message, fromBase64(device.pqPublicKey)), "ERR_PQ_SIGNATURE_INVALID");
    return signature;
  });
  if (diff) return { ...failure("ERR_WYSIWYS_TAMPERED", trace.rows), tamperDiff: diff };
  if (!postQuantum.ok) return failure(postQuantum.code, trace.rows);
  if (!classic.ok || !origin.ok) return failure("ERR_WEBAUTHN_INVALID", trace.rows);

  const gate = await trace.check(7, "ERR_TX_STATE", () => {
    requireTx(!simulation, "ERR_SIMULATION_ONLY");
    const signedAt = clock();
    requireTx(!isExpired(record, signedAt), "ERR_TX_EXPIRED");
    const signature: SignatureBundle = {
      signerUserId: device.userId, deviceId: device.id, signedAt: signedAt.toISOString(),
      webAuthnCredentialId: device.credentialId, webAuthnClientDataJson: origin.value,
      webAuthnPublicKey: device.webAuthnPublicKey, pqPublicKey: device.pqPublicKey,
      webAuthnSignatureBytesLength: fromBase64Url(assertion.response.signature).length,
      pqAlgorithm: "ML-DSA-65", pqSignatureHexPreview: bytesToHex(postQuantum.value.subarray(0, 32)),
      pqSignatureBytesLength: postQuantum.value.length, pqSignatureBase64: packet.pqSignatureBase64,
      verifyTimeMs: performance.now() - started,
    };
    requireTx(unit.consumeNonce(record.id, role), "ERR_REPLAY_DETECTED");
    applyPolicy(signature);
    device.webAuthnCounter = classic.value.newCounter;
  });
  if (!gate.ok) return failure(gate.code, trace.rows);
  trace.rows[6].details = record.status === "PENDING_COSIGN" ? "Запрошена вторая подпись" : "Операция исполнена";
  return { ok: true as const, transaction: record, verificationTrace: trace.rows };
}

function enforceIndependentDevice(device: RegisteredDevice, first: SignatureBundle | undefined, devices: RegisteredDevice[]) {
  requireTx(first, "ERR_TX_STATE");
  // Older signature bundles may still need the original registration to identify both keys.
  const original = devices.find(d => d.id === first.deviceId);
  const webKey = first.webAuthnPublicKey ?? original?.webAuthnPublicKey;
  const pqKey = first.pqPublicKey ?? original?.pqPublicKey;
  requireTx(webKey && pqKey && device.userId !== first.signerUserId && device.credentialId !== first.webAuthnCredentialId &&
    device.webAuthnPublicKey !== webKey && device.pqPublicKey !== pqKey, "ERR_COSIGNER");
}

export const verifyPrimary = (context: VerificationContext, packet: PrimaryPacket) =>
  verifyHybrid(context, packet, "primary", packet.quantumSimulation === true);

export const verifyCosign = (context: VerificationContext, packet: SignedPacket) =>
  verifyHybrid(context, packet, "cosign", false);
