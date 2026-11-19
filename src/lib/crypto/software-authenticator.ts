import { encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { concatBytes } from "@noble/hashes/utils.js";
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { sha256, toBase64Url, utf8 } from "./canonical";

export interface SoftwareCredential {
  id: string;
  privateKey: CryptoKey;
  rpId: string;
  origin: string;
  userHandle: string;
  signCount: number;
}

const currentOrigin = () => globalThis.location?.origin ?? "http://localhost:3000";

function clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  return utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function authData(rpId: string, flags: number, signCount: number) {
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, signCount);
  return concatBytes(sha256(utf8(rpId)), Uint8Array.of(flags), counter);
}

function encodeMap(entries: Array<[string | number, CBORType]>) {
  return encodeCBOR(new Map(entries));
}

export async function registerSoftware(options: PublicKeyCredentialCreationOptionsJSON, { extractable = false } = {}) {
  const origin = currentOrigin();
  const hostname = new URL(origin).hostname;
  const rpId = options.rp.id ?? hostname;
  if (hostname !== rpId || !options.pubKeyCredParams.some(p => p.alg === -7)) {
    throw new Error("Программный ключ требует домен банка и алгоритм ES256");
  }
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, extractable, ["sign", "verify"]);
  const point = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  // COSE EC2 / ES256 / P-256, followed by the affine x and y coordinates.
  const cose = encodeMap([[1, 2], [3, -7], [-1, 1], [-2, point.slice(1, 33)], [-3, point.slice(33)]]);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const id = toBase64Url(credentialId);
  const attestedData = concatBytes(authData(rpId, 0x45, 0), new Uint8Array(16),
    Uint8Array.of(0, credentialId.length), credentialId, cose);
  const response: RegistrationResponseJSON = {
    id, rawId: id, type: "public-key", clientExtensionResults: {},
    response: {
      attestationObject: toBase64Url(encodeMap([["fmt", "none"], ["attStmt", new Map()], ["authData", attestedData]])),
      clientDataJSON: toBase64Url(clientData("webauthn.create", options.challenge, origin)),
      transports: ["internal"], publicKeyAlgorithm: -7,
    },
  };
  const credential: SoftwareCredential = {
    id, rpId, origin, privateKey: key.privateKey, userHandle: options.user.id, signCount: 0,
  };
  return { response, credential };
}

// WebCrypto returns fixed-width r || s. ES256 assertions carry an ASN.1 DER sequence.
function derInteger(raw: Uint8Array) {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start++;
  const magnitude = raw.subarray(start);
  const positive = magnitude[0] >= 128 ? concatBytes(Uint8Array.of(0), magnitude) : magnitude;
  return concatBytes(Uint8Array.of(2, positive.length), positive);
}

export async function assertSoftware(credential: SoftwareCredential,
  options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON> {
  if (credential.origin !== currentOrigin() || options.rpId !== credential.rpId ||
      (options.allowCredentials?.length && !options.allowCredentials.some(d => d.id === credential.id))) {
    throw new Error("Программный ключ недоступен для этого домена или операции");
  }
  if (credential.signCount >= 0xffffffff) throw new Error("Исчерпан счётчик устройства");
  const data = clientData("webauthn.get", options.challenge, credential.origin);
  const authenticatorData = authData(credential.rpId, 0x05, ++credential.signCount);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
    credential.privateKey, new Uint8Array(concatBytes(authenticatorData, sha256(data)))));
  const integers = concatBytes(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  return {
    id: credential.id, rawId: credential.id, type: "public-key", clientExtensionResults: {},
    response: {
      clientDataJSON: toBase64Url(data), authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(concatBytes(Uint8Array.of(0x30, integers.length), integers)),
      userHandle: credential.userHandle,
    },
  };
}
