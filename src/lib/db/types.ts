export type UserRole = "CLIENT_B2C" | "COSIGNER_FAMILY" | "ACCOUNTANT_B2B" | "DIRECTOR_B2B";
export type Mode = "B2C" | "B2B";
export type OperationType = "P2P_TRANSFER" | "DEPOSIT_CLOSE" | "ONLINE_LOAN" | "B2B_INVOICE";
export type DeviceKind = "PLATFORM_PASSKEY" | "SOFTWARE_FALLBACK";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface CanonicalTxPayload {
  amountTenge: number;
  createdAt: string;
  currency: "KZT";
  expiresAt: string;
  mode: Mode;
  nonce: string;
  operationType: OperationType;
  purpose: string;
  recipientAccount: string;
  recipientName: string;
  rpId: string;
  senderAccount: string;
  senderId: string;
  txId: string;
  version: "1.0";
}

export interface Recipient {
  recipientName: string;
  recipientAccount: string;
}

export interface User {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountIban: string;
  balanceTenge: number;
  depositBalanceTenge: number;
  loanBalanceTenge?: number;
  linkedCosignerId?: string;
  coolingOffUntil?: string | null;
  trustedRecipients: Recipient[];
}

export interface RegisteredDevice {
  id: string;
  userId: string;
  deviceName: string;
  deviceKind: DeviceKind;
  credentialId: string;
  webAuthnPublicKey: string;
  webAuthnCounter: number;
  transports: string[];
  pqAlgorithm: "ML-DSA-65";
  pqPublicKey: string;
  pqKeyFingerprint: string;
  rpId: string;
  createdAt: string;
}

export interface VerificationStepResult {
  step: number;
  code: string;
  label: string;
  passed: boolean;
  outcome: "PASS" | "FAIL" | "SKIPPED" | "COMPROMISED";
  durationMs: number;
  details: string;
}

export interface SignatureBundle {
  signerUserId: string;
  deviceId: string;
  signedAt: string;
  webAuthnCredentialId: string;
  webAuthnClientDataJson: string;
  webAuthnSignatureBytesLength: number;
  pqAlgorithm: "ML-DSA-65";
  pqSignatureHexPreview: string;
  pqSignatureBytesLength: number;
  pqSignatureBase64: string;
  verifyTimeMs: number;
}

export type TxStatus = "CHALLENGE_ISSUED" | "PENDING_COSIGN" | "EXECUTED" |
  "REJECTED_CRYPTO" | "BLOCKED_BY_COSIGNER" | "EXPIRED";

export const failureMessages = {
  ERR_TX_NOT_FOUND: "Операция не найдена",
  ERR_TX_EXPIRED: "Истёк срок подтверждения операции",
  ERR_REPLAY_DETECTED: "Одноразовое подтверждение уже использовано",
  ERR_WYSIWYS_TAMPERED: "После подписи изменились реквизиты операции",
  ERR_ORIGIN_MISMATCH: "Источник запроса или домен устройства отличается от домена банка",
  ERR_WEBAUTHN_INVALID: "Подпись устройства или его счётчик не прошли проверку",
  ERR_PQ_SIGNATURE_INVALID: "Постквантовая подпись недействительна",
  ERR_TX_STATE: "Текущее состояние операции исключает это действие",
  ERR_USER_NOT_FOUND: "Пользователь не найден",
  ERR_DEVICE_NOT_FOUND: "У пользователя нет подходящего устройства",
  ERR_COSIGNER: "Подтверждение доступно только назначенному доверенному лицу",
  ERR_COOLING_OFF: "По просьбе доверенного лица действует период охлаждения",
  ERR_INSUFFICIENT_FUNDS: "Недостаточно средств для исполнения",
  ERR_ACK_REQUIRED: "Требуется подтверждение предупреждения о мошенничестве",
  ERR_INVALID_INPUT: "Проверьте параметры операции",
  ERR_SIMULATION_ONLY: "Диагностический режим исключает исполнение операции",
  ERR_STORAGE: "Не удалось завершить операцию с хранилищем",
} as const;
export type FailureCode = keyof typeof failureMessages;
export type TamperDiff = Array<{ field: string; original: string; tampered: string }>;

export interface TransactionRecord {
  id: string;
  status: TxStatus;
  payload: CanonicalTxPayload;
  canonicalJson: string;
  txHashHex: string;
  nonceUsed: boolean;
  cosignNonceUsed: boolean;
  cosignExpiresAt?: string;
  riskScore: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
  requiresCoSign: boolean;
  cosignerUserId?: string;
  primarySignature?: SignatureBundle;
  cosignSignature?: SignatureBundle;
  verificationTrace: VerificationStepResult[];
  primaryTrace?: VerificationStepResult[];
  failureCode?: FailureCode;
  tamperDiff?: TamperDiff;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  eventType: "DEVICE_REGISTERED" | "TX_EXECUTED" | "ATTACK_MITM_BLOCKED" |
    "ATTACK_REPLAY_BLOCKED" | "ATTACK_PHISHING_BLOCKED" | "COSIGN_TRIGGERED" |
    "COSIGN_APPROVED" | "SOCENG_STOPPED_BY_COSIGNER" | "PQ_SIGNATURE_REJECTED" |
    "WEBAUTHN_REJECTED" | "TX_POLICY_REJECTED" | "TX_EXPIRED";
  txId?: string;
  actorName: string;
  amountTenge?: number;
  summary: string;
  technicalDetails: Record<string, unknown> & { verificationTrace?: VerificationStepResult[]; tamperDiff?: TamperDiff };
}

export interface Database {
  registrationChallenges?: {
    challenge: string; userId: string; deviceName: string; deviceKind?: DeviceKind; expiresAt: number;
  }[];
  users: User[];
  devices: RegisteredDevice[];
  transactions: TransactionRecord[];
  securityEvents: SecurityEvent[];
  blacklist: string[];
}
