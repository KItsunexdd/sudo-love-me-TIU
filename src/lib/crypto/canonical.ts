import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { TamperDiff } from "@/lib/db/types";

export { sha256, bytesToHex };
export const utf8 = (value: string) => new TextEncoder().encode(value);

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (toBase64(bytes) !== value) throw new TypeError("Некорректный Base64");
  return bytes;
}

export function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError("Некорректный Base64URL");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  if (toBase64Url(bytes) !== value) throw new TypeError("Некорректный Base64URL");
  return bytes;
}

export function serializeCanonicalJSON(value: unknown): string {
  const parents = new Set<object>();
  function serialize(item: unknown): string {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || item === null || parents.has(item)) throw new TypeError("Недопустимое значение JSON");
    parents.add(item);
    let result: string;
    if (Array.isArray(item)) {
      result = "[" + Array.from(item, entry => serialize(entry)).join(",") + "]";
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && prototype !== Object.prototype) throw new TypeError("Ожидается объект JSON");
      const entries = Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      result = "{" + entries.map(([name, entry]) => JSON.stringify(name) + ":" + serialize(entry)).join(",") + "}";
    }
    parents.delete(item);
    return result;
  }
  return serialize(value);
}

export function hashPayload(payload: unknown) {
  const canonicalJson = serializeCanonicalJSON(payload);
  const hashBytes = sha256(utf8(canonicalJson));
  return { canonicalJson, hashBytes, txHashHex: bytesToHex(hashBytes), webAuthnChallenge: toBase64Url(hashBytes) };
}

export function computeTamperDiff(original: object, submitted: object): TamperDiff {
  const before = new Map(Object.entries(original));
  const after = new Map(Object.entries(submitted));
  const diff: TamperDiff = [];
  const show = (value: unknown) => value === undefined ? "(отсутствует)" :
    typeof value === "string" ? value : serializeCanonicalJSON(value);
  for (const field of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a: unknown = before.get(field);
    const b: unknown = after.get(field);
    if (a === undefined || b === undefined || serializeCanonicalJSON(a) !== serializeCanonicalJSON(b)) {
      const original = show(a);
      const tampered = show(b);
      // Show a change of type even when both values have identical display text.
      diff.push({ field, original, tampered: typeof b === "string" && original === tampered ? JSON.stringify(b) : tampered });
    }
  }
  return diff;
}
