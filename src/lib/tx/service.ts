import { z } from "zod";
import { hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, fromBase64, hashPayload, sha256 } from "@/lib/crypto/canonical";
import { cosignChallenge } from "@/lib/crypto/mldsa";
import { authenticationOptions, relyingParty } from "@/lib/crypto/webauthn";
import { isExpired, verifyCosign, verifyPrimary, type PrimaryPacket, type SignedPacket } from "@/lib/crypto/hybrid-verifier";
import { getStorage, type StorageAdapter, type UnitOfWork } from "@/lib/db/store";
import { failureMessages, type CanonicalTxPayload, type FailureCode, type SecurityEvent,
  type SignatureBundle, type TransactionRecord, type User } from "@/lib/db/types";
import { assessRisk } from "@/lib/risk/engine";
import { failure, requireTx, TxError, type Failure } from "./errors";
import { prepareSchema, cosignerSchema, cosignSubmitSchema, executeSchema, rejectSchema } from "./inputs";

const MINUTE = 60_000;
export const PRIMARY_TTL = 5 * MINUTE;
export const COSIGN_TTL = 15 * MINUTE;
export const COOLING_OFF = 24 * 60 * MINUTE;

function checkCoolingOff(sender: User, now: Date) {
  requireTx(!sender.coolingOffUntil || Date.parse(sender.coolingOffUntil) <= now.getTime(), "ERR_COOLING_OFF");
}

function updated(unit: UnitOfWork, tx: TransactionRecord, now: Date) {
  tx.updatedAt = now.toISOString();
  unit.emit({ type: "TX_UPDATED", txId: tx.id, status: tx.status });
}

function audit(unit: UnitOfWork, tx: TransactionRecord, now: Date, type: SecurityEvent["eventType"],
  severity: SecurityEvent["severity"], summary: string, details: Record<string, unknown> = {}, actorId = tx.payload.senderId) {
  const event: SecurityEvent = {
    id: "evt_" + crypto.randomUUID(), timestamp: now.toISOString(), severity, eventType: type, txId: tx.id,
    actorName: unit.db.users.find(u => u.id === actorId)?.fullName ?? actorId,
    amountTenge: tx.payload.amountTenge, summary, technicalDetails: details,
  };
  unit.db.securityEvents.push(event);
  if (severity !== "INFO") unit.emit({ type: "SECURITY_ALERT", event });
}

function expire(unit: UnitOfWork, tx: TransactionRecord, now: Date) {
  if (tx.status === "EXPIRED") return;
  tx.status = "EXPIRED";
  tx.failureCode = "ERR_TX_EXPIRED";
  updated(unit, tx, now);
  audit(unit, tx, now, "TX_EXPIRED", "WARNING", failureMessages.ERR_TX_EXPIRED);
}

function pending(unit: UnitOfWork, txId: string, cosignerUserId: string, now: Date) {
  const tx = unit.db.transactions.find(t => t.id === txId);
  requireTx(tx, "ERR_TX_NOT_FOUND");
  requireTx(tx.cosignerUserId === cosignerUserId, "ERR_COSIGNER");
  if (isExpired(tx, now)) {
    expire(unit, tx, now);
    return failure("ERR_TX_EXPIRED");
  }
  requireTx(tx.status === "PENDING_COSIGN" && tx.primarySignature, "ERR_TX_STATE");
  return { ok: true as const, tx, primary: tx.primarySignature };
}

function settle(unit: UnitOfWork, tx: TransactionRecord, sender: User) {
  const { amountTenge, recipientAccount, operationType } = tx.payload;
  const recipient = unit.db.users.find(u => u.accountIban === recipientAccount);
  const source = operationType === "DEPOSIT_CLOSE" ? "depositBalanceTenge" : "balanceTenge";
  const loan = operationType === "ONLINE_LOAN";
  if (!loan) requireTx(sender[source] >= amountTenge, "ERR_INSUFFICIENT_FUNDS");
  const proceeds = recipient === sender && source === "balanceTenge" && !loan ? 0 : amountTenge;
  if (recipient) requireTx(Number.isSafeInteger(recipient.balanceTenge + proceeds), "ERR_INVALID_INPUT");
  if (loan) requireTx(Number.isSafeInteger((sender.loanBalanceTenge ?? 0) + amountTenge), "ERR_INVALID_INPUT");

  if (loan) sender.loanBalanceTenge = (sender.loanBalanceTenge ?? 0) + amountTenge;
  else sender[source] -= amountTenge;
  if (recipient) recipient.balanceTenge += amountTenge;
  tx.status = "EXECUTED";
}

const alertType: Partial<Record<FailureCode, SecurityEvent["eventType"]>> = {
  ERR_WYSIWYS_TAMPERED: "ATTACK_MITM_BLOCKED", ERR_ORIGIN_MISMATCH: "ATTACK_PHISHING_BLOCKED",
  ERR_REPLAY_DETECTED: "ATTACK_REPLAY_BLOCKED", ERR_PQ_SIGNATURE_INVALID: "PQ_SIGNATURE_REJECTED",
  ERR_WEBAUTHN_INVALID: "WEBAUTHN_REJECTED",
};

function recordFailure(unit: UnitOfWork, tx: TransactionRecord, result: Failure, now: Date) {
  if (result.failureCode === "ERR_TX_EXPIRED") {
    if (tx.status !== "EXPIRED") tx.verificationTrace = result.verificationTrace;
    expire(unit, tx, now);
    return;
  }
  // Only the attempt which actually claimed this role's nonce may close its transaction.
  if (result.verificationTrace[1]?.passed) {
    tx.verificationTrace = result.verificationTrace;
    tx.tamperDiff = result.tamperDiff;
    tx.failureCode = result.failureCode;
    tx.status = "REJECTED_CRYPTO";
    updated(unit, tx, now);
  }
  audit(unit, tx, now, alertType[result.failureCode] ?? "TX_POLICY_REJECTED", "WARNING", result.message,
    { failureCode: result.failureCode, verificationTrace: result.verificationTrace, tamperDiff: result.tamperDiff });
}

export class TransactionService {
  constructor(private readonly storage: StorageAdapter = getStorage(), private readonly clock = () => new Date()) {}

  private async run<T>(action: (unit: UnitOfWork) => T | Promise<T>) {
    try {
      return await this.storage.transact(action);
    } catch (error) {
      if (error instanceof TxError) return failure(error.code);
      if (error instanceof z.ZodError) return failure("ERR_INVALID_INPUT");
      return failure("ERR_STORAGE");
    }
  }

  prepare(request: unknown) {
    return this.run(async ({ db, emit }) => {
      const input = prepareSchema.parse(request);
      const sender = db.users.find(u => u.id === input.senderId);
      requireTx(sender, "ERR_USER_NOT_FOUND");
      const b2b = input.mode === "B2B";
      requireTx(sender.role === (b2b ? "ACCOUNTANT_B2B" : "CLIENT_B2C") &&
        b2b === (input.operationType === "B2B_INVOICE"), "ERR_INVALID_INPUT");
      const now = this.clock();
      checkCoolingOff(sender, now);
      const risk = assessRisk(input, sender, db.blacklist, now);
      const cosignerUserId = risk.requiresCoSign ? sender.linkedCosignerId : undefined;
      requireTx(!risk.requiresCoSign || db.users.some(u => u.id === cosignerUserId &&
        u.role === (b2b ? "DIRECTOR_B2B" : "COSIGNER_FAMILY")), "ERR_COSIGNER");
      const txId = "tx_" + crypto.randomUUID();
      const payload: CanonicalTxPayload = {
        amountTenge: input.amountTenge, currency: "KZT", createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PRIMARY_TTL).toISOString(), mode: input.mode,
        nonce: bytesToHex(randomBytes(32)), operationType: input.operationType, purpose: input.purpose,
        recipientAccount: input.recipientAccount, recipientName: input.recipientName, rpId: relyingParty().rpId,
        senderAccount: sender.accountIban, senderId: sender.id, txId, version: "1.0",
      };
      const { canonicalJson, txHashHex, hashBytes } = hashPayload(payload);
      const webAuthnOptions = await authenticationOptions(sender.id, db.devices, hashBytes);
      requireTx(webAuthnOptions.allowCredentials?.length, "ERR_DEVICE_NOT_FOUND");
      const status = "CHALLENGE_ISSUED" as const;
      db.transactions.push({
        id: txId, status, payload, canonicalJson, txHashHex, nonceUsed: false, cosignNonceUsed: false,
        riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons, requiresCoSign: risk.requiresCoSign,
        cosignerUserId, verificationTrace: [], createdAt: payload.createdAt, updatedAt: payload.createdAt,
      });
      emit({ type: "TX_UPDATED", txId, status });
      return { ok: true as const, status, txId, payload, canonicalJson, txHashHex, risk, webAuthnOptions };
    });
  }

  execute(request: unknown) {
    return this.run(unit => this.submit(unit, { primary: true, packet: executeSchema.parse(request) }));
  }

  cosignSubmit(request: unknown) {
    return this.run(unit => this.submit(unit, { primary: false, packet: cosignSubmitSchema.parse(request) }));
  }

  private async submit(unit: UnitOfWork, attempt: { primary: true; packet: PrimaryPacket } | { primary: false; packet: SignedPacket }) {
    const now = this.clock;
    const applyPolicy = (tx: TransactionRecord, signature: SignatureBundle) => {
      const sender = unit.db.users.find(u => u.id === tx.payload.senderId);
      requireTx(sender, "ERR_USER_NOT_FOUND");
      checkCoolingOff(sender, now());
      if (attempt.primary && tx.riskLevel === "MEDIUM") requireTx(attempt.packet.acknowledgedWarning, "ERR_ACK_REQUIRED");
      if (attempt.primary && tx.requiresCoSign) {
        tx.status = "PENDING_COSIGN";
        tx.cosignExpiresAt = new Date(now().getTime() + COSIGN_TTL).toISOString();
      } else {
        settle(unit, tx, sender);
      }
      if (attempt.primary) tx.primarySignature = signature;
      else tx.cosignSignature = signature;
    };
    const context = { unit, clock: now, applyPolicy };
    const result = attempt.primary ? await verifyPrimary(context, attempt.packet) : await verifyCosign(context, attempt.packet);
    const timestamp = now();
    if (!result.ok) {
      const tx = unit.db.transactions.find(t => t.id === attempt.packet.txId);
      if (tx) recordFailure(unit, tx, result, timestamp);
      return result;
    }

    const tx = result.transaction;
    tx.verificationTrace = result.verificationTrace;
    if (attempt.primary) tx.primaryTrace = result.verificationTrace;
    updated(unit, tx, timestamp);
    const cosigner = unit.db.users.find(u => u.id === tx.cosignerUserId);
    if (tx.status === "PENDING_COSIGN" && cosigner) {
      audit(unit, tx, timestamp, "COSIGN_TRIGGERED", "INFO", "Запрошена вторая подпись");
      unit.emit({ type: "COSIGN_REQUESTED", txId: tx.id, cosignerUserId: cosigner.id });
    } else {
      if (!attempt.primary) audit(unit, tx, timestamp, "COSIGN_APPROVED", "INFO", "Получена вторая подпись", {}, tx.cosignerUserId);
      audit(unit, tx, timestamp, "TX_EXECUTED", "INFO", "Операция исполнена");
    }
    return { ...result, status: tx.status, cosigner: cosigner && { id: cosigner.id, fullName: cosigner.fullName } };
  }

  cosignPrepare(request: unknown) {
    return this.run(async unit => {
      const { txId, cosignerUserId } = cosignerSchema.parse(request);
      const state = pending(unit, txId, cosignerUserId, this.clock());
      if (!state.ok) return state;
      const first = fromBase64(state.primary.pqSignatureBase64);
      const tx = state.tx;
      const challenge = cosignChallenge(hexToBytes(tx.txHashHex), first);
      const webAuthnOptions = await authenticationOptions(cosignerUserId, unit.db.devices, challenge);
      requireTx(webAuthnOptions.allowCredentials?.length, "ERR_DEVICE_NOT_FOUND");
      return { ok: true as const, status: tx.status, transaction: tx, riskReasons: tx.riskReasons,
        txHashHex: tx.txHashHex, primarySignatureHashHex: bytesToHex(sha256(first)), webAuthnOptions };
    });
  }

  cosignReject(request: unknown) {
    return this.run(unit => {
      const { txId, cosignerUserId, reason, activateCoolingOff } = rejectSchema.parse(request);
      const now = this.clock();
      const state = pending(unit, txId, cosignerUserId, now);
      if (!state.ok) return state;
      const tx = state.tx;
      const sender = unit.db.users.find(u => u.id === tx.payload.senderId);
      requireTx(sender, "ERR_USER_NOT_FOUND");
      if (activateCoolingOff) sender.coolingOffUntil = new Date(now.getTime() + COOLING_OFF).toISOString();
      tx.status = "BLOCKED_BY_COSIGNER";
      updated(unit, tx, now);
      audit(unit, tx, now, "SOCENG_STOPPED_BY_COSIGNER", "CRITICAL", "Доверенное лицо заблокировало операцию",
        { reason, coolingOffUntil: sender.coolingOffUntil }, cosignerUserId);
      return { ok: true as const, status: tx.status, transaction: tx, savedAmountTenge: tx.payload.amountTenge,
        coolingOffActive: Date.parse(sender.coolingOffUntil ?? "") > now.getTime() };
    });
  }

  listTransactions() {
    return this.run(unit => {
      const now = this.clock();
      for (const tx of unit.db.transactions) {
        if (isExpired(tx, now)) expire(unit, tx, now);
      }
      return { ok: true as const, transactions: unit.db.transactions };
    });
  }
}
