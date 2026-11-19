import type { RegisteredDevice } from "@/lib/db/types";
import type { SoftwareCredential } from "./software-authenticator";

export type LocalDevice = Pick<RegisteredDevice,
  "id" | "userId" | "deviceName" | "deviceKind" | "credentialId" | "pqKeyFingerprint" | "rpId" | "createdAt">;

interface EncryptedKey {
  iv: Uint8Array<ArrayBuffer>;
  bytes: ArrayBuffer;
}

interface Entry {
  device: LocalDevice;
  pq: EncryptedKey;
  software?: Omit<SoftwareCredential, "privateKey"> & { key: EncryptedKey };
}

const dbName = "bcc-safesign-keystore";
const changeEvent = "safesign:local-devices";
const keyId = "aes-gcm";
let opening: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore("devices", { keyPath: "device.id" });
      request.result.createObjectStore("keys");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Закройте другие вкладки SafeSign и повторите."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => { db.close(); opening = undefined; };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

async function transact<T>(
  name: "devices" | "keys",
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (result: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error("Операция с хранилищем ключей прервана."));
    run(tx.objectStore(name), result => { value = result; });
  });
}

function wrappingKey(candidate?: CryptoKey) {
  return transact<CryptoKey | undefined>("keys", candidate ? "readwrite" : "readonly", (store, done) => {
    const request = store.get(keyId);
    request.onsuccess = () => {
      const existing = request.result as CryptoKey | undefined;
      if (!existing && candidate) store.add(candidate, keyId);
      done(existing ?? candidate);
    };
  });
}

export async function prepareKeystore() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("Для хранения ключей откройте SafeSign через HTTPS или localhost.");
  }
  const existing = await wrappingKey();
  if (existing) return existing;
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return (await wrappingKey(candidate)) ?? candidate;
}

type KeyPurpose = "ML-DSA-65" | "ECDSA-P256";

function associatedData(device: LocalDevice, purpose: KeyPurpose) {
  return new TextEncoder().encode(JSON.stringify([1, device.userId, device.id, device.credentialId, purpose]));
}

async function encrypt(key: CryptoKey, device: LocalDevice, purpose: KeyPurpose, data: BufferSource): Promise<EncryptedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData(device, purpose) }, key, data);
  return { iv, bytes };
}

function decrypt(key: CryptoKey, device: LocalDevice, purpose: KeyPurpose, value: EncryptedKey) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: value.iv, additionalData: associatedData(device, purpose) }, key, value.bytes);
}

function deviceChannel() {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    return new BroadcastChannel(changeEvent);
  } catch {
    // Local updates remain available when cross-tab messaging is blocked.
  }
}

function announceChange() {
  window.dispatchEvent(new Event(changeEvent));
  const channel = deviceChannel();
  channel?.postMessage(null);
  channel?.close();
}

export function subscribeLocalDevices(refresh: () => void) {
  window.addEventListener(changeEvent, refresh);
  const channel = deviceChannel();
  channel?.addEventListener("message", refresh);
  return () => {
    window.removeEventListener(changeEvent, refresh);
    channel?.close();
  };
}

export async function saveLocalDevice(device: LocalDevice, pqSecretKey: Uint8Array, software?: SoftwareCredential) {
  const key = await prepareKeystore();
  const pqBytes = new Uint8Array(pqSecretKey);
  let pq: EncryptedKey;
  try {
    pq = await encrypt(key, device, "ML-DSA-65", pqBytes);
  } finally {
    pqBytes.fill(0);
  }
  let encryptedSoftware: Entry["software"];
  if (software) {
    const { privateKey, ...metadata } = software;
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
    try {
      encryptedSoftware = { ...metadata, key: await encrypt(key, device, "ECDSA-P256", pkcs8) };
    } finally {
      new Uint8Array(pkcs8).fill(0);
    }
  }
  await transact<void>("devices", "readwrite", (store, done) => {
    const request = store.add({ device, pq, software: encryptedSoftware } satisfies Entry);
    request.onsuccess = () => done();
  });
  announceChange();
}

export function listLocalDevices(): Promise<LocalDevice[]> {
  return transact("devices", "readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as Entry[]).map(entry => entry.device));
  });
}

export function getLocalDevice(deviceId: string): Promise<LocalDevice | undefined> {
  return readEntry(deviceId).then(entry => entry?.device);
}

export async function clearLocalDevices() {
  // Keep the wrapping key consistent with a registration that may be encrypting in another tab.
  await transact<void>("devices", "readwrite", (store, done) => {
    const request = store.clear();
    request.onsuccess = () => done();
  });
  announceChange();
}

function readEntry(deviceId: string) {
  return transact<Entry | undefined>("devices", "readonly", (store, done) => {
    const request = store.get(deviceId);
    request.onsuccess = () => done(request.result);
  });
}

async function keyFor(deviceId: string, userId: string) {
  const [key, entry] = await Promise.all([wrappingKey(), readEntry(deviceId)]);
  if (!key || entry?.device.userId !== userId) throw new Error("Локальный ключ для этого пользователя отсутствует.");
  return { key, entry };
}

export async function readPqSecretKey(deviceId: string, userId: string) {
  const { key, entry } = await keyFor(deviceId, userId);
  return new Uint8Array(await decrypt(key, entry.device, "ML-DSA-65", entry.pq));
}

function reserveSoftwareCounter(deviceId: string, userId: string) {
  return transact<number | undefined>("devices", "readwrite", (store, done) => {
    const request = store.get(deviceId);
    request.onsuccess = () => {
      const entry = request.result as Entry | undefined;
      if (entry?.device.userId !== userId || !entry.software || entry.software.signCount >= 0xffffffff) {
        done(undefined);
        return;
      }
      const previous = entry.software.signCount++;
      const write = store.put(entry);
      write.onsuccess = () => done(previous);
    };
  });
}

export async function openSoftwareCredential(deviceId: string, userId: string): Promise<SoftwareCredential> {
  const { key, entry } = await keyFor(deviceId, userId);
  if (!entry.software) throw new Error("Программный ключ отсутствует.");
  const { key: encrypted, ...metadata } = entry.software;
  const pkcs8 = await decrypt(key, entry.device, "ECDSA-P256", encrypted);
  try {
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    // assertSoftware increments this value when constructing the assertion.
    const signCount = await reserveSoftwareCounter(deviceId, userId);
    if (signCount === undefined) throw new Error("Счётчик программного ключа недоступен. Перевыпустите устройство.");
    return { ...metadata, privateKey, signCount };
  } finally {
    new Uint8Array(pkcs8).fill(0);
  }
}
