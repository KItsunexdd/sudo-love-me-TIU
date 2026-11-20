import type { z } from "zod";
import { hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, fromBase64, fromBase64Url, hashPayload, sha256 } from "@/lib/crypto/canonical";
import { cosignChallenge } from "@/lib/crypto/mldsa";
import { authenticationOptions, relyingParty } from "@/lib/crypto/webauthn";
import { isExpired, verifyCosign, verifyPrimary, type PrimaryPacket, type SignedPacket } from "@/lib/crypto/hybrid-verifier";
import { getStorage, type SigningRole, type StorageAdapter, type UnitOfWork } from "@/lib/db/store";
import { failureMessages, type CanonicalTxPayload, type Database, type FailureCode, type SecurityEvent,
  type SignatureBundle, type TransactionRecord, type TxStatus, type User } from "@/lib/db/types";
import { assessRisk, bankCoSignReason, requiresBankCoSign } from "@/lib/risk/engine";
import { failure, failureFrom, isCryptoFailure, requireTx, type Failure } from "./errors";
import { prepareSchema, riskPreviewSchema, cosignerSchema, cosignSubmitSchema, executeSchema, rejectSchema } from "./inputs";

const MINUTE = 60_000;
const MAX_ACTIVE_CHALLENGES = 32;
export const PRIMARY_TTL = 5 * MINUTE;
export const COSIGN_TTL = 15 * MINUTE;
export const COOLING_OFF = 24 * 60 * MINUTE;

function checkCoolingOff(sender: User, now: Date) {
  requireTx(!sender.coolingOffUntil || Date.parse(sender.coolingOffUntil) <= now.getTime(), "ERR_COOLING_OFF");
}

function assignedCosigner(db: Database, mode: CanonicalTxPayload["mode"], id?: string) {
  const role = mode === "B2B" ? "DIRECTOR_B2B" : "COSIGNER_FAMILY";
  const cosigner = db.users.find(user => user.id === id && user.role === role);
  requireTx(cosigner, "ERR_COSIGNER");
  return cosigner.id;
}

function updated(unit: UnitOfWork, tx: TransactionRecord, now: Date) {
  tx.updatedAt = now.toISOString();
  unit.emit({ type: "TX_UPDATED", txId: tx.id, status: tx.status, senderId: tx.payload.senderId, cosignerUserId: tx.cosignerUserId });
}

interface AuditTransaction { id: string; payload?: CanonicalTxPayload; cosignerUserId?: string }
function audit(unit: UnitOfWork, tx: AuditTransaction,
  now: Date, type: SecurityEvent["eventType"], severity: SecurityEvent["severity"], summary: string,
  details: SecurityEvent["technicalDetails"] = {}, actorId = tx.payload?.senderId) {
  const event: SecurityEvent = {
    id: "evt_" + crypto.randomUUID(), timestamp: now.toISOString(), severity, eventType: type, txId: tx.id,
    actorName: unit.db.users.find(u => u.id === actorId)?.fullName ?? actorId ?? "Неизвестный пользователь",
    amountTenge: tx.payload?.amountTenge, summary, technicalDetails: details,
  };
  unit.db.securityEvents.push(event);
  if (severity !== "INFO") unit.emit({ type: "SECURITY_ALERT", event, senderId: tx.payload?.senderId, cosignerUserId: tx.cosignerUserId });
}

function expire(unit: UnitOfWork, tx: TransactionRecord, now: Date, details: SecurityEvent["technicalDetails"] = {}) {
  if (tx.status === "EXPIRED") return;
  tx.status = "EXPIRED";
  tx.failureCode = "ERR_TX_EXPIRED";
  updated(unit, tx, now);
  audit(unit, tx, now, "TX_EXPIRED", "WARNING", failureMessages.ERR_TX_EXPIRED, details);
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

function checkProductLimits(sender: User, { operationType, amountTenge, recipientAccount }:
  Pick<CanonicalTxPayload, "operationType" | "amountTenge" | "recipientAccount">) {
  if (operationType === "DEPOSIT_CLOSE") {
    requireTx(recipientAccount === sender.accountIban, "ERR_INVALID_INPUT", "Депозит можно зачислить только на собственный счёт");
  }
  if (operationType === "ONLINE_LOAN") {
    requireTx(amountTenge <= 3_000_000 - (sender.loanBalanceTenge ?? 0), "ERR_INVALID_INPUT",
      "Общая сумма задолженности по демо-кредитам ограничена 3 000 000 ₸");
  }
}

function fundingSource(sender: User, { operationType, amountTenge }: Pick<CanonicalTxPayload, "operationType" | "amountTenge">) {
  const source = operationType === "DEPOSIT_CLOSE" ? "depositBalanceTenge" : "balanceTenge";
  if (operationType !== "ONLINE_LOAN") requireTx(sender[source] >= amountTenge, "ERR_INSUFFICIENT_FUNDS");
  return source;
}

function prepareSettlement(unit: UnitOfWork, tx: TransactionRecord, sender: User) {
  const { amountTenge, recipientAccount, operationType } = tx.payload;
  const phone = /^[78]\d{10}$/.test(recipientAccount) ? "+7" + recipientAccount.slice(1) : recipientAccount;
  const recipient = unit.db.users.find(u => u.accountIban === recipientAccount || u.phone === phone);
  const source = fundingSource(sender, tx.payload);
  const loan = operationType === "ONLINE_LOAN";
  const proceeds = recipient === sender && source === "balanceTenge" && !loan ? 0 : amountTenge;
  if (recipient) requireTx(Number.isSafeInteger(recipient.balanceTenge + proceeds), "ERR_INVALID_INPUT");
  if (loan) requireTx(Number.isSafeInteger((sender.loanBalanceTenge ?? 0) + amountTenge), "ERR_INVALID_INPUT");

  return () => {
    if (loan) sender.loanBalanceTenge = (sender.loanBalanceTenge ?? 0) + amountTenge;
    else sender[source] -= amountTenge;
    if (recipient) recipient.balanceTenge += amountTenge;
    tx.status = "EXECUTED";
  };
}

const alertType: Partial<Record<FailureCode, SecurityEvent["eventType"]>> = {
  ERR_WYSIWYS_TAMPERED: "ATTACK_MITM_BLOCKED", ERR_ORIGIN_MISMATCH: "ATTACK_PHISHING_BLOCKED",
  ERR_REPLAY_DETECTED: "ATTACK_REPLAY_BLOCKED", ERR_PQ_SIGNATURE_INVALID: "PQ_SIGNATURE_REJECTED",
  ERR_WEBAUTHN_INVALID: "WEBAUTHN_REJECTED",
};

function rejectedEvidence(packet: SignedPacket): NonNullable<TransactionRecord["rejectedEvidence"]> {
  const evidence: NonNullable<TransactionRecord["rejectedEvidence"]> = { clientTimings: packet.clientTimings };
  // Malformed encodings are valid rejection cases. Preserve the verifier's original verdict.
  try {
    evidence.clientDataJson = new TextDecoder().decode(fromBase64Url(packet.webAuthnAssertion.response.clientDataJSON));
  } catch { /* No decodable clientDataJSON. */ }
  try {
    const bytes = fromBase64(packet.pqSignatureBase64);
    evidence.pqBytes = bytes.length;
    evidence.pqHexPreview = bytesToHex(bytes.subarray(0, 32));
  } catch { /* No decodable signature bytes. */ }
  return evidence;
}

function recordFailure(unit: UnitOfWork, tx: TransactionRecord, role: SigningRole, result: Failure, now: Date, details: Record<string, unknown>, packet: SignedPacket) {
  const rejection = { ...details,
    ...(result.failureCode === "ERR_REPLAY_DETECTED" && { replayOfExecuted: tx.status === "EXECUTED" }),
    failureCode: result.failureCode, verificationTrace: result.verificationTrace, tamperDiff: result.tamperDiff };
  if (result.failureCode === "ERR_TX_EXPIRED" && tx.status !== "EXPIRED") {
    tx.verificationTrace = result.verificationTrace;
    expire(unit, tx, now, rejection);
    return;
  }
  // Only the attempt which actually claimed this role's nonce may close its transaction.
  if (isCryptoFailure(result.failureCode) && unit.consumeNonce(tx.id, role)) {
    tx.rejectedEvidence = rejectedEvidence(packet);
    tx.verificationTrace = result.verificationTrace;
    tx.tamperDiff = result.tamperDiff;
    tx.failureCode = result.failureCode;
    tx.status = "REJECTED_CRYPTO";
    updated(unit, tx, now);
  }
  audit(unit, tx, now, alertType[result.failureCode] ?? "TX_POLICY_REJECTED", "WARNING", result.message, rejection);
}

function assessRequest(input: z.infer<typeof riskPreviewSchema>, db: Database, now: Date) {
  const sender = db.users.find(u => u.id === input.senderId);
  requireTx(sender, "ERR_USER_NOT_FOUND");
  const b2b = input.mode === "B2B";
  requireTx(sender.role === (b2b ? "ACCOUNTANT_B2B" : "CLIENT_B2C") &&
    b2b === (input.operationType === "B2B_INVOICE"), "ERR_INVALID_INPUT");
  checkProductLimits(sender, input);
  const risk = assessRisk(input, sender, db.blacklist, now);
  if (requiresBankCoSign(input)) risk.codes.push("BANK_COSIGN");
  return { sender, risk };
}

export class TransactionService {
  constructor(private readonly storage: StorageAdapter = getStorage(), private readonly clock = () => new Date()) {}

  private async run<T>(action: (unit: UnitOfWork) => T | Promise<T>) {
    try {
      return await this.storage.transact(action);
    } catch (error) {
      return failureFrom(error);
    }
  }

  async preview(request: unknown) {
    try {
      const input = riskPreviewSchema.parse(request);
      const { risk } = assessRequest(input, await this.storage.snapshot(), this.clock());
      return { risk };
    } catch (error) {
      return failureFrom(error);
    }
  }

  prepare(request: unknown) {
    return this.run(async unit => {
      const { db } = unit;
      const input = prepareSchema.parse(request);
      const now = this.clock();
      const { sender, risk } = assessRequest(input, db, now);
      checkCoolingOff(sender, now);
      fundingSource(sender, input);
      const cosignerUserId = risk.requiresCoSign ? assignedCosigner(db, input.mode, sender.linkedCosignerId) : undefined;
      const active = db.transactions.filter(tx => tx.payload.senderId === sender.id &&
        tx.status === "CHALLENGE_ISSUED" && !isExpired(tx, now));
      requireTx(active.length < MAX_ACTIVE_CHALLENGES, "ERR_PREPARE_LIMIT");
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
      const tx: TransactionRecord = {
        id: txId, status, payload, canonicalJson, txHashHex, nonceUsed: false, cosignNonceUsed: false,
        riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons, riskCodes: risk.codes,
        requiresCoSign: risk.requiresCoSign,
        cosignerUserId, verificationTrace: [], createdAt: payload.createdAt, updatedAt: payload.createdAt,
      };
      db.transactions.push(tx);
      updated(unit, tx, now);
      return { ok: true as const, status, txId, payload, canonicalJson, txHashHex, risk, webAuthnOptions };
    });
  }

  execute(request: unknown, requestOrigin?: string, targetUrl?: string) {
    return this.run(unit => this.submit(unit, { primary: true, packet: executeSchema.parse(request) }, requestOrigin, targetUrl));
  }

  cosignSubmit(request: unknown, requestOrigin?: string, targetUrl?: string) {
    return this.run(unit => this.submit(unit, { primary: false, packet: cosignSubmitSchema.parse(request) }, requestOrigin, targetUrl));
  }

  private async submit(unit: UnitOfWork, attempt: { primary: true; packet: PrimaryPacket } | { primary: false; packet: SignedPacket }, requestOrigin?: string, targetUrl?: string) {
    const now = this.clock;
    const preparePolicy = (tx: TransactionRecord) => {
      const sender = unit.db.users.find(u => u.id === tx.payload.senderId);
      requireTx(sender, "ERR_USER_NOT_FOUND");
      checkCoolingOff(sender, now());
      checkProductLimits(sender, tx.payload);
      const bankCoSign = requiresBankCoSign(tx.payload);
      if (attempt.primary && (tx.requiresCoSign || bankCoSign)) {
        const cosignerId = assignedCosigner(unit.db, tx.payload.mode, tx.cosignerUserId ?? sender.linkedCosignerId);
        fundingSource(sender, tx.payload);
        return (signature: SignatureBundle) => {
          tx.primarySignature = signature;
          tx.cosignerUserId = cosignerId;
          tx.requiresCoSign = true;
          if (bankCoSign) {
            tx.riskLevel = "HIGH";
            if (!tx.riskReasons.includes(bankCoSignReason)) {
              tx.riskReasons.push(bankCoSignReason);
              tx.riskCodes?.push("BANK_COSIGN");
            }
          }
          tx.status = "PENDING_COSIGN";
          tx.cosignExpiresAt = new Date(Date.parse(signature.signedAt) + COSIGN_TTL).toISOString();
        };
      }
      if (!attempt.primary) assignedCosigner(unit.db, tx.payload.mode, tx.cosignerUserId);
      if (attempt.primary && tx.riskLevel === "MEDIUM") requireTx(attempt.packet.acknowledgedWarning, "ERR_ACK_REQUIRED");
      const settle = prepareSettlement(unit, tx, sender);
      return (signature: SignatureBundle) => {
        settle();
        if (attempt.primary) tx.primarySignature = signature;
        else tx.cosignSignature = signature;
      };
    };
    const context = { unit, clock: now, preparePolicy, requestOrigin, targetUrl };
    const result = attempt.primary ? await verifyPrimary(context, attempt.packet) : await verifyCosign(context, attempt.packet);
    const timestamp = now();
    const details = attempt.primary ? {
      attackTag: attempt.packet.attackTag,
      quantumSimulation: attempt.packet.quantumSimulation,
    } : {};
    if (!result.ok) {
      const tx = unit.db.transactions.find(t => t.id === attempt.packet.txId);
      if (tx) recordFailure(unit, tx, attempt.primary ? "primary" : "cosign", result, timestamp, details, attempt.packet);
      else audit(unit, { id: attempt.packet.txId }, timestamp, "TX_POLICY_REJECTED", "WARNING", result.message,
        { ...details, failureCode: result.failureCode, verificationTrace: result.verificationTrace });
      return result;
    }

    const tx = result.transaction;
    tx.verificationTrace = result.verificationTrace;
    if (attempt.primary) tx.primaryTrace = result.verificationTrace;
    updated(unit, tx, timestamp);
    const cosigner = unit.db.users.find(u => u.id === tx.cosignerUserId);
    if (tx.status === "PENDING_COSIGN" && cosigner) {
      audit(unit, tx, timestamp, "COSIGN_TRIGGERED", "INFO", "Запрошена вторая подпись", details);
      unit.emit({ type: "COSIGN_REQUESTED", txId: tx.id, senderId: tx.payload.senderId, cosignerUserId: cosigner.id });
    } else {
      if (!attempt.primary) audit(unit, tx, timestamp, "COSIGN_APPROVED", "INFO", "Получена вторая подпись", {}, tx.cosignerUserId);
      audit(unit, tx, timestamp, "TX_EXECUTED", "INFO", "Операция исполнена", details);
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

  getTransaction(id: string) {
    return this.run(unit => {
      const tx = unit.db.transactions.find(item => item.id === id);
      requireTx(tx, "ERR_TX_NOT_FOUND");
      const now = this.clock();
      if (isExpired(tx, now)) expire(unit, tx, now);
      return { ok: true as const, transaction: tx };
    });
  }

  listTransactions(filter: { status?: TxStatus; userId?: string } = {}) {
    return this.run(unit => {
      const now = this.clock();
      for (const tx of unit.db.transactions) {
        if (isExpired(tx, now)) expire(unit, tx, now);
      }
      const transactions = unit.db.transactions.filter(tx =>
        (!filter.status || tx.status === filter.status) &&
        (!filter.userId || tx.payload.senderId === filter.userId || tx.cosignerUserId === filter.userId));
      return { ok: true as const, transactions, serverTimeMs: now.getTime() };
    });
  }
}
