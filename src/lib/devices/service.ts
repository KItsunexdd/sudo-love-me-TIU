import { z } from "zod";
import { fromBase64Url } from "@/lib/crypto/canonical";
import { ML_DSA_BYTES } from "@/lib/crypto/mldsa";
import { registrationOptions, relyingParty, verifyRegistration } from "@/lib/crypto/webauthn";
import { getStorage } from "@/lib/db/store";
import { authenticatorData, clientDataJSON, text } from "@/lib/tx/inputs";
import { requireTx, TxError } from "@/lib/tx/errors";

const registration = z.object({
  userId: text, deviceName: z.string().trim().min(1).max(120), deviceKind: z.enum(["PLATFORM_PASSKEY", "SOFTWARE_FALLBACK"]).optional(),
});
const attestation = z.object({
  type: z.literal("public-key"), id: z.string().min(1).max(1400), rawId: z.string().min(1).max(1400),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.object({}),
  response: z.object({
    clientDataJSON, attestationObject: z.string().min(1).max(131072),
    authenticatorData: authenticatorData.optional(), transports: z.array(z.string().max(32)).max(16).optional(),
    publicKeyAlgorithm: z.number().int().optional(), publicKey: z.string().max(8192).optional(),
  }),
});
const verification = registration.extend({
  challengeId: text.optional(), attestationResponse: attestation,
  pqPublicKeyBase64: z.string().length(4 * Math.ceil(ML_DSA_BYTES.publicKey / 3)),
  pqProofOfPossessionBase64: z.string().length(4 * Math.ceil(ML_DSA_BYTES.signature / 3)),
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
    clientData = z.object({ challenge: z.string(), origin: z.string(), crossOrigin: z.boolean().optional() })
      .parse(JSON.parse(new TextDecoder().decode(raw)));
  } catch { throw new TxError("ERR_WEBAUTHN_INVALID"); }
  requireTx(clientData.origin === origin && !clientData.crossOrigin, "ERR_ORIGIN_MISMATCH");
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
      pqProofOfPossessionBase64: input.pqProofOfPossessionBase64,
    }).catch(error => { throw error instanceof TxError ? error : new TxError("ERR_WEBAUTHN_INVALID"); });
    requireTx(!db.devices.some(d => d.credentialId === device.credentialId ||
      d.webAuthnPublicKey === device.webAuthnPublicKey || d.pqPublicKey === device.pqPublicKey), "ERR_DEVICE_NOT_ALLOWED");
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
    // Preserve independence checks for pending transactions signed before key snapshots existed.
    for (const tx of db.transactions) {
      const first = tx.primarySignature;
      if (tx.status === "PENDING_COSIGN" && first?.deviceId === id) {
        first.webAuthnPublicKey ??= db.devices[index].webAuthnPublicKey;
        first.pqPublicKey ??= db.devices[index].pqPublicKey;
      }
    }
    db.devices.splice(index, 1);
    return { status: "REVOKED", deviceId: id };
  });
}
