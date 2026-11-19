import { z } from "zod";
import { fromBase64Url } from "@/lib/crypto/canonical";
import { ML_DSA_BYTES } from "@/lib/crypto/mldsa";
import { registrationOptions, relyingParty, verifyRegistration } from "@/lib/crypto/webauthn";
import { getStorage } from "@/lib/db/store";
import { text } from "@/lib/tx/inputs";
import { requireTx, TxError } from "@/lib/tx/errors";

const registration = z.object({
  userId: text, deviceName: text, deviceKind: z.enum(["PLATFORM_PASSKEY", "SOFTWARE_FALLBACK"]).optional(),
});
const attestation = z.object({
  type: z.literal("public-key"), id: z.string().min(1).max(1400), rawId: z.string().min(1).max(1400),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.object({}).passthrough(),
  response: z.object({
    clientDataJSON: z.string().min(1), attestationObject: z.string().min(1),
    authenticatorData: z.string().optional(), transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().int().optional(), publicKey: z.string().optional(),
  }),
});
const verification = registration.extend({
  challengeId: text.optional(), attestationResponse: attestation,
  pqPublicKeyBase64: z.string().length(4 * Math.ceil(ML_DSA_BYTES.publicKey / 3)),
});

export async function beginRegistration(body: unknown) {
  const input = registration.parse(body);
  return getStorage().transact(async ({ db }) => {
    const user = db.users.find(u => u.id === input.userId);
    requireTx(user, "ERR_USER_NOT_FOUND");
    const options = await registrationOptions(user, db.devices);
    const now = Date.now();
    db.registrationChallenges = (db.registrationChallenges ?? []).filter(c => c.expiresAt > now);
    db.registrationChallenges.push({ ...input, challenge: options.challenge, expiresAt: now + (options.timeout ?? 60_000) });
    return { ...options, rpId: relyingParty().rpId, challengeId: options.challenge };
  });
}

export async function finishRegistration(body: unknown, origin: string) {
  const input = verification.parse(body);
  requireTx(origin === relyingParty().expectedOrigin, "ERR_ORIGIN_MISMATCH");
  let clientData;
  try {
    const raw = fromBase64Url(input.attestationResponse.response.clientDataJSON);
    clientData = z.object({ challenge: z.string(), origin: z.string() }).parse(JSON.parse(new TextDecoder().decode(raw)));
  } catch { throw new TxError("ERR_WEBAUTHN_INVALID"); }
  requireTx(clientData.origin === origin, "ERR_ORIGIN_MISMATCH");
  const { challenge } = clientData;
  return getStorage().transact(async ({ db }) => {
    const user = db.users.find(u => u.id === input.userId);
    requireTx(user, "ERR_USER_NOT_FOUND");
    const ceremony = db.registrationChallenges?.find(c => c.challenge === challenge && c.userId === user.id);
    requireTx(ceremony && ceremony.expiresAt > Date.now() && ceremony.deviceName === input.deviceName &&
      (!input.challengeId || input.challengeId === ceremony.challenge) &&
      (!ceremony.deviceKind || !input.deviceKind || ceremony.deviceKind === input.deviceKind), "ERR_WEBAUTHN_INVALID");
    const device = await verifyRegistration({
      user, expectedChallenge: ceremony.challenge, response: input.attestationResponse, deviceName: ceremony.deviceName,
      deviceKind: ceremony.deviceKind ?? input.deviceKind ?? "PLATFORM_PASSKEY", pqPublicKeyBase64: input.pqPublicKeyBase64,
    }).catch(error => { throw error instanceof TxError ? error : new TxError("ERR_WEBAUTHN_INVALID"); });
    requireTx(!db.devices.some(d => d.credentialId === device.credentialId), "ERR_WEBAUTHN_INVALID");
    db.devices.push(device);
    db.registrationChallenges = db.registrationChallenges?.filter(c => c.challenge !== ceremony.challenge);
    db.securityEvents.push({
      id: "evt_" + crypto.randomUUID(), timestamp: device.createdAt, severity: "INFO", eventType: "DEVICE_REGISTERED",
      actorName: user.fullName, summary: "Зарегистрировано устройство", technicalDetails: { deviceId: device.id, deviceKind: device.deviceKind },
    });
    return { verified: true, device };
  });
}

export async function listDevices(userId: string) {
  const db = await getStorage().snapshot();
  requireTx(db.users.some(u => u.id === userId), "ERR_USER_NOT_FOUND");
  return { devices: db.devices.filter(d => d.userId === userId) };
}

export async function revokeDevice(id: string) {
  return getStorage().transact(({ db }) => {
    const index = db.devices.findIndex(d => d.id === id);
    requireTx(index >= 0, "ERR_DEVICE_NOT_FOUND");
    db.devices.splice(index, 1);
    return { status: "REVOKED", deviceId: id };
  });
}
