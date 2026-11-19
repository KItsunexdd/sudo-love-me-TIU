import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { getStorage, JsonFileAdapter, MemoryAdapter } from "@/lib/db/store";
import { subscribe, type DemoEvent } from "@/lib/events/bus";
import type { TransactionRecord } from "@/lib/db/types";
import { hashPayload } from "@/lib/crypto/canonical";

const payload = {
  txId: "tx_storage", amountTenge: 1, createdAt: "2026-04-01T00:00:00Z", expiresAt: "2026-04-01T00:05:00Z",
  currency: "KZT", mode: "B2C", nonce: "0".repeat(64), operationType: "P2P_TRANSFER", purpose: "",
  recipientAccount: "KZ", recipientName: "Тест", rpId: "localhost", senderAccount: "KZ1",
  senderId: "usr_aigul", version: "1.0",
} as const;
const { txHashHex, canonicalJson } = hashPayload(payload);
const tx: TransactionRecord = {
  id: payload.txId, payload, status: "CHALLENGE_ISSUED", txHashHex, canonicalJson, nonceUsed: false, cosignNonceUsed: false,
  riskScore: 0, riskLevel: "LOW", riskReasons: [], requiresCoSign: false,
  createdAt: payload.createdAt, updatedAt: payload.createdAt, verificationTrace: [],
};

afterEach(() => vi.unstubAllEnvs());

it.each(["file", "memory"])("CAS и откат операций между экземплярами адаптера %s", async kind => {
  const folder = await mkdtemp(join(tmpdir(), "safesign-"));
  const build = () => kind === "file" ? new JsonFileAdapter(join(folder, "data", "store.json")) : new MemoryAdapter();
  const a = build(), b = build();
  const events: DemoEvent[] = [];
  const unsub = subscribe(e => events.push(e));
  try {
    await a.resetDemo({ keepDevices: false });
    await a.transact(({ db }) => { db.transactions.push(structuredClone(tx)); });
    const won = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).consumeNonce(tx.id)));
    expect(won.filter(Boolean)).toHaveLength(1);
    await expect(b.transact(({ db, emit }) => {
      db.users[0].balanceTenge = -1;
      emit({ type: "TX_UPDATED", txId: tx.id, status: "EXECUTED" });
      throw new Error("откат");
    })).rejects.toThrow("откат");
    const snapshot = await b.snapshot();
    expect(snapshot.users[0].balanceTenge).toBe(450_000);
    snapshot.users.length = 0;
    expect((await a.snapshot()).users).toHaveLength(4);
    expect((await a.snapshot()).transactions[0].nonceUsed).toBe(true);
    expect(events).toEqual([{ type: "DEMO_RESET", keepDevices: false }]);
    if (kind === "file") expect(await readdir(join(folder, "data"))).toEqual(["store.json"]);
  } finally {
    unsub();
    await rm(folder, { recursive: true, force: true });
  }
});

it("сохраняет повреждённый файл для диагностики", async () => {
  const folder = await mkdtemp(join(tmpdir(), "safesign-"));
  try {
    const file = join(folder, "store.json");
    await writeFile(file, "{");
    await expect(new JsonFileAdapter(file).snapshot()).rejects.toThrow();
  } finally { await rm(folder, { recursive: true, force: true }); }
});

it("выбирает память на Vercel и учитывает явный SAFESIGN_STORAGE", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("SAFESIGN_STORAGE", undefined);
  expect(getStorage()).toBeInstanceOf(MemoryAdapter);
  vi.stubEnv("SAFESIGN_STORAGE", "file");
  expect(getStorage()).toBeInstanceOf(JsonFileAdapter);
  vi.stubEnv("SAFESIGN_STORAGE", "memory");
  expect(getStorage()).toBeInstanceOf(MemoryAdapter);
});
