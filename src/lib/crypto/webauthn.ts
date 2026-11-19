import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { DeviceKind, RegisteredDevice, User } from "@/lib/db/types";
import { bytesToHex, fromBase64, fromBase64Url, sha256, toBase64Url, utf8 } from "./canonical";
import { ML_DSA_BYTES } from "./mldsa";

export function relyingParty() {
  return {
    rpName: "BCC SafeSign",
    rpId: process.env.SAFESIGN_RP_ID ?? "localhost",
    expectedOrigin: process.env.SAFESIGN_ORIGIN ?? "http://localhost:3000",
  };
}

function credentials(devices: RegisteredDevice[], userId: string) {
  return devices.filter(d => d.userId === userId && d.rpId === relyingParty().rpId)
    .map(d => ({ id: d.credentialId, transports: d.transports }));
}

export function registrationOptions(user: User, devices: RegisteredDevice[] = []) {
  const { rpName, rpId } = relyingParty();
  return generateRegistrationOptions({
    rpName, rpID: rpId, userID: utf8(user.id), userName: user.id, userDisplayName: user.fullName,
    supportedAlgorithmIDs: [-7], attestationType: "none",
    authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
    excludeCredentials: credentials(devices, user.id),
  });
}

// expectedChallenge and user must come from the same server-side registration ceremony.
export async function verifyRegistration(input: {
  user: User; deviceName: string; deviceKind: DeviceKind; expectedChallenge: string;
  response: RegistrationResponseJSON; pqPublicKeyBase64: string;
}): Promise<RegisteredDevice> {
  const { rpId, expectedOrigin } = relyingParty();
  const publicKey = fromBase64(input.pqPublicKeyBase64);
  if (publicKey.length !== ML_DSA_BYTES.publicKey) throw new TypeError("Некорректный размер открытого ключа ML-DSA-65");
  const result = await verifyRegistrationResponse({
    response: input.response, expectedChallenge: input.expectedChallenge,
    expectedOrigin, expectedRPID: rpId, supportedAlgorithmIDs: [-7], requireUserVerification: true,
  });
  if (!result.verified || result.registrationInfo.credential.id !== input.response.id) {
    throw new Error("Регистрация устройства отклонена");
  }
  const { credential } = result.registrationInfo;
  return {
    id: "dev_" + crypto.randomUUID(), userId: input.user.id, deviceName: input.deviceName,
    deviceKind: input.deviceKind, credentialId: credential.id, webAuthnPublicKey: toBase64Url(credential.publicKey),
    webAuthnCounter: credential.counter, transports: credential.transports ?? [],
    pqPublicKey: input.pqPublicKeyBase64, pqAlgorithm: "ML-DSA-65",
    pqKeyFingerprint: bytesToHex(sha256(publicKey)).slice(0, 16),
    rpId, createdAt: new Date().toISOString(),
  };
}

export function authenticationOptions(userId: string, devices: RegisteredDevice[], challenge: Uint8Array) {
  return generateAuthenticationOptions({
    rpID: relyingParty().rpId, challenge: new Uint8Array(challenge),
    allowCredentials: credentials(devices, userId), userVerification: "required",
  });
}

export async function verifyAuthentication(device: RegisteredDevice, response: AuthenticationResponseJSON, expectedChallenge: string) {
  const { rpId, expectedOrigin } = relyingParty();
  if (device.credentialId !== response.id || device.rpId !== rpId) throw new Error("Ключ не принадлежит устройству");
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin, expectedRPID: rpId, requireUserVerification: true,
    credential: { id: device.credentialId, publicKey: fromBase64Url(device.webAuthnPublicKey),
      counter: device.webAuthnCounter, transports: device.transports },
  });
  if (!result.verified) throw new Error("Подпись устройства недействительна");
  return result.authenticationInfo;
}
