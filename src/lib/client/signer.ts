import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { concatBytes } from "@noble/hashes/utils.js";
import { bytesToHex, fromBase64, hashPayload, sha256, toBase64, toBase64Url, utf8 } from "@/lib/crypto/canonical";
import {
  getLocalDevice, listLocalDevices, openSoftwareCredential, prepareKeystore, readPqSecretKey, saveLocalDevice,
  type LocalDevice,
} from "@/lib/crypto/client-keystore";
import type { SoftwareCredential } from "@/lib/crypto/software-authenticator";
import { api, type ApiError, type CosignPrepareResponse, type PrepareResponse } from "./api";

export { listLocalDevices };

export class SignerError extends Error {
  constructor(readonly details: ApiError, options?: ErrorOptions) {
    super(details.message, options);
    this.name = "SignerError";
  }
}

function signerError(failureCode: string, message: string, cause?: unknown) {
  return new SignerError({ status: "ERROR", failureCode, message }, { cause });
}

export function toClientError(error: unknown): ApiError {
  if (error instanceof SignerError) return error.details;
  return { status: "ERROR", failureCode: "ERR_CLIENT", message: "Не удалось завершить действие в браузере." };
}

const webAuthnAvailable = () => typeof PublicKeyCredential !== "undefined" &&
  typeof navigator.credentials?.create === "function" && typeof navigator.credentials?.get === "function";

function mayFallback(error: unknown) {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "NotSupportedError");
}

function webAuthnError(error: unknown) {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "NotAllowedError")) {
    return signerError("ERR_WEBAUTHN_CANCELLED", "Подтверждение устройством отменено.", error);
  }
  if (error instanceof Error && error.name === "NotSupportedError") {
    return signerError("ERR_WEBAUTHN_UNSUPPORTED", "На устройстве недоступен Passkey.", error);
  }
  return signerError("ERR_WEBAUTHN_INVALID", "Устройство не смогло подтвердить запрос SafeSign.", error);
}

async function withKeystore<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SignerError) throw error;
    throw signerError("ERR_CLIENT_KEYSTORE", "Не удалось открыть или сохранить ключ. Проверьте доступ к хранилищу браузера и HTTPS.", error);
  }
}

function pqProofOfPossession(
  userId: string, credentialId: string, registrationChallenge: string, secretKey: Uint8Array,
  sign: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array,
) {
  const digest = sha256(concatBytes(utf8(userId), Uint8Array.of(0), utf8(credentialId), Uint8Array.of(0), utf8(registrationChallenge)));
  const message = concatBytes(utf8("BCC-SAFESIGN-V1:PQ-POP:"), digest);
  return toBase64(sign(message, secretKey));
}

export async function registerDevice(userId: string, { preferSoftware = false, deviceName = "Этот браузер" } = {}) {
  await withKeystore(prepareKeystore);
  const begin = () => api.registerOptions({ userId, deviceName });
  let options = await begin();
  if (!options.ok) throw new SignerError(options.error);
  let attestationResponse: RegistrationResponseJSON | undefined;
  let software: SoftwareCredential | undefined;

  if (!preferSoftware && webAuthnAvailable()) {
    const { startRegistration } = await import("@simplewebauthn/browser");
    try {
      attestationResponse = await startRegistration({ optionsJSON: options.data });
    } catch (error) {
      if (!mayFallback(error)) throw webAuthnError(error);
      // The hardware prompt can outlive the original challenge.
      options = await begin();
      if (!options.ok) throw new SignerError(options.error);
    }
  }
  if (!attestationResponse) {
    const { registerSoftware } = await import("@/lib/crypto/software-authenticator");
    try {
      const result = await registerSoftware(options.data, { extractable: true });
      attestationResponse = result.response;
      software = result.credential;
    } catch (error) {
      throw signerError("ERR_WEBAUTHN_UNSUPPORTED", "Не удалось создать программный ключ на текущем домене.", error);
    }
  }

  const { keygen, sign } = await import("@/lib/crypto/mldsa");
  const { publicKey, secretKey } = keygen();
  try {
    const verified = await api.registerVerify({
      userId, deviceName, deviceKind: software ? "SOFTWARE_FALLBACK" : "PLATFORM_PASSKEY",
      challengeId: options.data.challengeId, attestationResponse,
      pqPublicKeyBase64: toBase64(publicKey),
      pqProofOfPossessionBase64: pqProofOfPossession(userId, attestationResponse.id, options.data.challenge, secretKey, sign),
    });
    if (!verified.ok) throw new SignerError(verified.error);
    const { device } = verified.data;
    const { id, deviceKind, credentialId, pqKeyFingerprint, rpId, createdAt } = device;
    const local: LocalDevice = { id, userId, deviceName: device.deviceName, deviceKind, credentialId, pqKeyFingerprint, rpId, createdAt };
    try {
      await withKeystore(() => saveLocalDevice(local, secretKey, software));
    } catch (error) {
      await api.revokeDevice(id);
      throw error;
    }
    return device;
  } finally {
    secretKey.fill(0);
  }
}

export async function hasDevice(userId: string) {
  const local = (await withKeystore(listLocalDevices)).filter(device => device.userId === userId);
  if (!local.length) return false;
  const registered = await api.listDevices(userId);
  if (!registered.ok) throw new SignerError(registered.error);
  return registered.data.devices.some(device => local.some(item => item.id === device.id));
}

export interface HybridSignature {
  webAuthnAssertion: AuthenticationResponseJSON;
  pqSignatureBase64: string;
  timings: { webauthnMs: number; pqSignMs: number };
}

type AuthenticationOptions = PrepareResponse["webAuthnOptions"];

async function signHybrid(userId: string, deviceId: string, options: AuthenticationOptions, message: Uint8Array): Promise<HybridSignature> {
  const device = await withKeystore(() => getLocalDevice(deviceId));
  if (device?.userId !== userId || !options.allowCredentials?.some(item => item.id === device.credentialId)) {
    throw signerError("ERR_DEVICE_NOT_REGISTERED", "Для этой операции нужен локальный ключ указанного пользователя.");
  }
  const restrictedOptions = { ...options, allowCredentials: options.allowCredentials.filter(item => item.id === device.credentialId) };
  let webAuthnAssertion: AuthenticationResponseJSON;
  let webauthnMs: number;

  if (device.deviceKind === "SOFTWARE_FALLBACK") {
    const { assertSoftware } = await import("@/lib/crypto/software-authenticator");
    const credential = await withKeystore(() => openSoftwareCredential(deviceId, userId));
    const started = performance.now();
    try {
      webAuthnAssertion = await assertSoftware(credential, restrictedOptions);
    } catch (error) {
      throw webAuthnError(error);
    }
    webauthnMs = performance.now() - started;
  } else {
    if (!webAuthnAvailable()) throw signerError("ERR_WEBAUTHN_UNSUPPORTED", "На устройстве недоступен Passkey.");
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const started = performance.now();
    try {
      webAuthnAssertion = await startAuthentication({ optionsJSON: restrictedOptions });
    } catch (error) {
      throw webAuthnError(error);
    }
    webauthnMs = performance.now() - started;
  }
  if (webAuthnAssertion.id !== device.credentialId) {
    throw signerError("ERR_WEBAUTHN_INVALID", "Браузер вернул подпись другого устройства.");
  }
  const { sign } = await import("@/lib/crypto/mldsa");
  const secret = await withKeystore(() => readPqSecretKey(deviceId, userId));
  try {
    const started = performance.now();
    const signature = sign(message, secret);
    const pqSignMs = performance.now() - started;
    return { webAuthnAssertion, pqSignatureBase64: toBase64(signature), timings: { webauthnMs, pqSignMs } };
  } finally {
    secret.fill(0);
  }
}

function invalidChallenge() {
  return signerError("ERR_SIGNING_CHALLENGE", "Хэш реквизитов не совпадает с запросом на подпись. Подготовьте операцию заново.");
}

export async function signPrimary(prepareResponse: PrepareResponse, deviceId: string) {
  const { payload, txId, txHashHex, webAuthnOptions } = prepareResponse;
  const hash = hashPayload(payload);
  if (payload.txId !== txId || hash.txHashHex !== txHashHex || hash.webAuthnChallenge !== webAuthnOptions.challenge) {
    throw invalidChallenge();
  }
  const { primaryMessage } = await import("@/lib/crypto/mldsa");
  return signHybrid(payload.senderId, deviceId, webAuthnOptions, primaryMessage(hash.hashBytes));
}

export async function signCosign(prepareResponse: CosignPrepareResponse, deviceId: string) {
  const { transaction, txHashHex, primarySignatureHashHex, webAuthnOptions } = prepareResponse;
  if (!transaction.primarySignature || !transaction.cosignerUserId) throw invalidChallenge();
  const hash = hashPayload(transaction.payload);
  const first = fromBase64(transaction.primarySignature.pqSignatureBase64);
  const { cosignMessage } = await import("@/lib/crypto/mldsa");
  const message = cosignMessage(hash.hashBytes, first);
  if (hash.txHashHex !== txHashHex || transaction.txHashHex !== txHashHex ||
      bytesToHex(sha256(first)) !== primarySignatureHashHex ||
      toBase64Url(sha256(message)) !== webAuthnOptions.challenge) {
    throw invalidChallenge();
  }
  return signHybrid(transaction.cosignerUserId, deviceId, webAuthnOptions, message);
}
