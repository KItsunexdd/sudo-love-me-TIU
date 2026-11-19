import { hexToBytes } from "@noble/hashes/utils.js";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { toBase64 } from "../src/lib/crypto/canonical";
import { primaryMessage, sign } from "../src/lib/crypto/mldsa";
import { assertSoftware, type SoftwareCredential } from "../src/lib/crypto/software-authenticator";
import { recipientPresets } from "../src/lib/db/seed";
import type { CanonicalTxPayload } from "../src/lib/db/types";

export const demoTransfer = {
  senderId: "usr_aigul", mode: "B2C", operationType: "P2P_TRANSFER", purpose: "На продукты",
  ...recipientPresets.son,
} as const;

export interface PreparedTransfer {
  txId: string;
  payload: CanonicalTxPayload;
  txHashHex: string;
  webAuthnOptions: PublicKeyCredentialRequestOptionsJSON;
}

export async function signTransfer(
  prepared: PreparedTransfer, deviceId: string, credential: SoftwareCredential,
  secretKey: Uint8Array, originOverride?: string,
) {
  return {
    txId: prepared.txId,
    submittedPayload: prepared.payload,
    deviceId,
    webAuthnAssertion: await assertSoftware(credential, prepared.webAuthnOptions, { originOverride }),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(prepared.txHashHex)), secretKey)),
  };
}
