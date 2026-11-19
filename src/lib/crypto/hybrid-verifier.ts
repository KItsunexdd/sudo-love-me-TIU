import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { SigningRole, UnitOfWork } from "@/lib/db/store";
import type {
  FailureCode, RegisteredDevice, SignatureBundle,
  TransactionRecord, VerificationStepResult,
} from "@/lib/db/types";
import { failureMessages } from "@/lib/db/types";
import { failure, requireTx, TxError } from "@/lib/tx/errors";
import { bytesToHex, computeTamperDiff, fromBase64, fromBase64Url, hashPayload, sha256, toBase64Url, utf8 } from "./canonical";
import { cosignMessage, primaryMessage, verify } from "./mldsa";
import { relyingParty, verifyAuthentication } from "./webauthn";

export interface SignedPacket {
  txId: string;
  deviceId: string;
  webAuthnAssertion: AuthenticationResponseJSON;
  pqSignatureBase64: string;
  submittedPayload?: object;
}
export interface PrimaryPacket extends SignedPacket {
  submittedPayload: object;
  acknowledgedWarning?: boolean;
  quantumSimulation?: boolean;
}
export interface VerificationContext {
  unit: UnitOfWork;
  clock(): Date;
  applyPolicy(tx: TransactionRecord, signature: SignatureBundle): void;
}

const steps = [
  ["TX_EXISTENCE_AND_TTL", "Состояние и срок действия"],
  ["REPLAY_PROTECTION", "Одноразовое подтверждение"],
  ["WYSIWYS_INTEGRITY", "Целостность реквизитов"],
  ["ORIGIN_AND_RPID", "Источник запроса и домен банка"],
  ["WEBAUTHN_SIGNATURE", "Подпись устройства"],
  ["POST_QUANTUM_ML_DSA", "Постквантовая подпись"],
  ["RISK_AND_POLICY_GATE", "Риск и исполнение операции"],
];

type Check<T> = { ok: true; value: T } | { ok: false; code: FailureCode };

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
      Object.assign(row, { outcome: "FAIL", details: failureMessages[code] });
      return { ok: false, code };
    } finally {
      row.durationMs = performance.now() - start;
    }
  }
}

export function isExpired(tx: TransactionRecord, now: Date) {
  const deadline = tx.status === "PENDING_COSIGN" ? tx.cosignExpiresAt :
    tx.status === "CHALLENGE_ISSUED" ? tx.payload.expiresAt : undefined;
  return tx.status === "EXPIRED" || (deadline !== undefined && now.getTime() >= Date.parse(deadline));
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
    requireTx(!isExpired(tx, clock()), "ERR_TX_EXPIRED");
    // A completed attempt reaches the nonce CAS to report replay without reopening its state.
    const alreadyUsed = primary ? tx.nonceUsed : tx.cosignNonceUsed;
    requireTx(alreadyUsed || tx.status === (primary ? "CHALLENGE_ISSUED" : "PENDING_COSIGN"), "ERR_TX_STATE");
    return tx;
  });
  if (!state.ok) return failure(state.code, trace.rows);
  const record = state.value;
  const nonce = await trace.check(2, "ERR_REPLAY_DETECTED", () =>
    requireTx(unit.consumeNonce(record.id, role), "ERR_REPLAY_DETECTED"));
  if (!nonce.ok) return failure(nonce.code, trace.rows);

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
    requireTx(data.origin === expectedOrigin && record.payload.rpId === rpId, "ERR_ORIGIN_MISMATCH");
    const authData = fromBase64Url(assertion.response.authenticatorData);
    requireTx(authData.length >= 37 && bytesToHex(authData.subarray(0, 32)) === bytesToHex(sha256(utf8(rpId))), "ERR_ORIGIN_MISMATCH");
    return json;
  });
  if (!origin.ok && !diff) return failure(origin.code, trace.rows);

  const signer = primary ? record.payload.senderId : record.cosignerUserId;
  const device = db.devices.find(d => d.id === packet.deviceId && d.userId === signer);
  const classic = await trace.check(5, "ERR_WEBAUTHN_INVALID", async () => {
    requireTx(device, "ERR_WEBAUTHN_INVALID");
    if (!primary) enforceIndependentDevice(device, db.devices.find(d => d.id === record.primarySignature?.deviceId));
    return verifyAuthentication(device, assertion, challenge);
  });
  if (!classic.ok && !diff && !simulation) return failure(classic.code, trace.rows);
  if (simulation && !diff) {
    Object.assign(trace.rows[4], { passed: false, outcome: "COMPROMISED",
      details: "Симуляция компрометации ECDSA. Фактическая проверка: " + (classic.ok ? "пройдена" : "отклонена") });
  }
  const postQuantum = await trace.check(6, "ERR_PQ_SIGNATURE_INVALID", () => {
    requireTx(device, "ERR_PQ_SIGNATURE_INVALID");
    const signature = fromBase64(packet.pqSignatureBase64);
    requireTx(verify(signature, message, fromBase64(device.pqPublicKey)), "ERR_PQ_SIGNATURE_INVALID");
    return signature;
  });
  if (diff) return { ...failure("ERR_WYSIWYS_TAMPERED", trace.rows), tamperDiff: diff };
  if (!postQuantum.ok) return failure(postQuantum.code, trace.rows);
  if (!classic.ok || !origin.ok || !device) return failure("ERR_WEBAUTHN_INVALID", trace.rows);

  const gate = await trace.check(7, "ERR_TX_STATE", () => {
    requireTx(!simulation, "ERR_SIMULATION_ONLY");
    requireTx(!isExpired(record, clock()), "ERR_TX_EXPIRED");
    const signature: SignatureBundle = {
      signerUserId: device.userId, deviceId: device.id, signedAt: clock().toISOString(),
      webAuthnCredentialId: device.credentialId, webAuthnClientDataJson: origin.value,
      webAuthnSignatureBytesLength: fromBase64Url(assertion.response.signature).length,
      pqAlgorithm: "ML-DSA-65", pqSignatureHexPreview: bytesToHex(postQuantum.value.subarray(0, 32)),
      pqSignatureBytesLength: postQuantum.value.length, pqSignatureBase64: packet.pqSignatureBase64,
      verifyTimeMs: performance.now() - started,
    };
    context.applyPolicy(record, signature);
    device.webAuthnCounter = classic.value.newCounter;
  });
  if (!gate.ok) return failure(gate.code, trace.rows);
  trace.rows[6].details = record.status === "PENDING_COSIGN" ? "Запрошена вторая подпись" : "Операция исполнена";
  return { ok: true as const, transaction: record, verificationTrace: trace.rows };
}

function enforceIndependentDevice(device: RegisteredDevice, first?: RegisteredDevice) {
  requireTx(first && device.userId !== first.userId && device.credentialId !== first.credentialId &&
    device.webAuthnPublicKey !== first.webAuthnPublicKey && device.pqPublicKey !== first.pqPublicKey, "ERR_COSIGNER");
}

export const verifyPrimary = (context: VerificationContext, packet: PrimaryPacket) =>
  verifyHybrid(context, packet, "primary", packet.quantumSimulation === true);

export const verifyCosign = (context: VerificationContext, packet: SignedPacket) =>
  verifyHybrid(context, packet, "cosign", false);
