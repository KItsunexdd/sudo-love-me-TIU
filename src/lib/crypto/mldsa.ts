import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { sha256, toBase64, utf8 } from "./canonical";

export const ML_DSA_BYTES = { publicKey: 1952, secretKey: 4032, signature: 3309 } as const;

export function pqProofMessage(userId: string, credentialId: string, registrationChallenge: string) {
  const separator = Uint8Array.of(0);
  const binding = concatBytes(utf8(userId), separator, utf8(credentialId), separator, utf8(registrationChallenge));
  return concatBytes(utf8("BCC-SAFESIGN-V1:PQ-POP:"), sha256(binding));
}

/** Returns the Base64 value for register/verify's pqProofOfPossessionBase64 field. */
export function createPqProofOfPossession(userId: string, credentialId: string, registrationChallenge: string, pqSecretKey: Uint8Array) {
  return toBase64(ml_dsa65.sign(pqProofMessage(userId, credentialId, registrationChallenge), pqSecretKey));
}

export function isValidPqPublicKey(key: Uint8Array) {
  // rho occupies 32 bytes. Every packed 10-bit t1 coefficient is in range.
  return key.length === ML_DSA_BYTES.publicKey && key.subarray(32).some(byte => byte !== 0);
}

export function primaryMessage(txHash: Uint8Array) {
  if (txHash.length !== 32) throw new RangeError("Ожидается SHA-256");
  return concatBytes(utf8("BCC-SAFESIGN-V1:PRIMARY:"), txHash);
}

export function cosignMessage(txHash: Uint8Array, primarySignature: Uint8Array) {
  if (txHash.length !== 32 || primarySignature.length !== ML_DSA_BYTES.signature) {
    throw new RangeError("Некорректная длина звена подписи");
  }
  return concatBytes(utf8("BCC-SAFESIGN-V1:COSIGN:"), txHash, sha256(primarySignature));
}

// WebAuthn challenge = base64url(SHA-256(COSIGN prefix || txHash || SHA-256(primary PQ signature))).
export function cosignChallenge(txHash: Uint8Array, primarySignature: Uint8Array) {
  return sha256(cosignMessage(txHash, primarySignature));
}

export const keygen = () => ml_dsa65.keygen();
export const sign = (message: Uint8Array, secretKey: Uint8Array) => ml_dsa65.sign(message, secretKey);
export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) {
  return signature.length === ML_DSA_BYTES.signature && isValidPqPublicKey(publicKey)
    && ml_dsa65.verify(signature, message, publicKey);
}
