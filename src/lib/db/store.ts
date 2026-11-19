import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { publish, type DemoEvent } from "@/lib/events/bus";
import { createSeed } from "./seed";
import type { Database } from "./types";

export type SigningRole = "primary" | "cosign";
export interface UnitOfWork {
  db: Database;
  consumeNonce(txId: string, role?: SigningRole): boolean;
  emit(event: DemoEvent): void;
}
export interface StorageAdapter {
  snapshot(): Promise<Database>;
  transact<T>(action: (unit: UnitOfWork) => T | Promise<T>): Promise<T>;
  consumeNonce(txId: string, role?: SigningRole): Promise<boolean>;
  resetDemo(options: { keepDevices: boolean }): Promise<void>;
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(action);
    this.tail = pending.catch(() => {});
    return pending;
  }
}

const runtime = globalThis as typeof globalThis & {
  safeSignLocks?: Map<string, Mutex>;
  safeSignMemory?: Database;
  safeSignMemoryAdapter?: MemoryAdapter;
};
const locks = runtime.safeSignLocks ??= new Map();

abstract class SerializedAdapter implements StorageAdapter {
  protected readonly lock: Mutex;
  constructor(key: string) {
    this.lock = locks.get(key) ?? new Mutex();
    locks.set(key, this.lock);
  }

  protected abstract load(): Promise<Database>;
  protected abstract save(db: Database): Promise<void>;

  snapshot() {
    return this.lock.run(async () => structuredClone(await this.load()));
  }

  transact<T>(action: (unit: UnitOfWork) => T | Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      const db = structuredClone(await this.load());
      const events: DemoEvent[] = [];
      const result = await action({
        db,
        consumeNonce(txId, role = "primary") {
          const tx = db.transactions.find(item => item.id === txId);
          const key = role === "primary" ? "nonceUsed" : "cosignNonceUsed";
          const requiredState = role === "primary" ? "CHALLENGE_ISSUED" : "PENDING_COSIGN";
          if (!tx || tx[key] || tx.status !== requiredState) return false;
          tx[key] = true;
          return true;
        },
        emit: event => events.push(event),
      });
      const detached = structuredClone(result);
      await this.save(db);
      events.forEach(publish);
      return detached;
    });
  }

  consumeNonce(txId: string, role: SigningRole = "primary") {
    return this.transact(unit => unit.consumeNonce(txId, role));
  }

  resetDemo({ keepDevices }: { keepDevices: boolean }) {
    return this.transact(({ db, emit }) => {
      const seed = createSeed();
      if (keepDevices) seed.devices = db.devices;
      Object.assign(db, seed);
      emit({ type: "DEMO_RESET", keepDevices });
    });
  }
}

export class MemoryAdapter extends SerializedAdapter {
  constructor() { super("memory"); }
  protected async load() { return runtime.safeSignMemory ??= createSeed(); }
  protected async save(db: Database) { runtime.safeSignMemory = structuredClone(db); }
}

export class JsonFileAdapter extends SerializedAdapter {
  private readonly path: string;
  constructor(path = "./data/store.json") {
    super(resolve(path));
    this.path = resolve(path);
  }

  protected async load(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const db = createSeed();
      await this.save(db);
      return db;
    }
  }

  protected async save(db: Database) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + "." + crypto.randomUUID() + ".tmp";
    try {
      await writeFile(tmp, JSON.stringify(db), { mode: 0o600, flag: "wx" });
      await rename(tmp, this.path);
    } finally {
      await rm(tmp, { force: true });
    }
  }
}

export function getStorage(): StorageAdapter {
  const kind = process.env.SAFESIGN_STORAGE ?? (process.env.VERCEL ? "memory" : "file");
  if (kind === "memory") return runtime.safeSignMemoryAdapter ??= new MemoryAdapter();
  if (kind === "file") return new JsonFileAdapter();
  throw new Error("Неизвестный режим SAFESIGN_STORAGE");
}
