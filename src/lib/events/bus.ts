import type { SecurityEvent, TxStatus } from "@/lib/db/types";

interface Participants { senderId?: string; cosignerUserId?: string }
export type DemoEvent =
  | { type: "COSIGN_REQUESTED"; txId: string; cosignerUserId: string }
  | ({ type: "TX_UPDATED"; txId: string; status: TxStatus } & Participants)
  | ({ type: "SECURITY_ALERT"; event: SecurityEvent } & Participants)
  | { type: "DEMO_RESET"; keepDevices: boolean };

export interface EventFilter { userId?: string; channel?: "cosign" | "soc" }
type Listener = (event: DemoEvent, cursor: number) => void;
const runtime = globalThis as typeof globalThis & {
  safeSignListeners?: Set<Listener>;
  safeSignJournal?: { cursor: number; discardedThrough: number; entries: { id: number; event: DemoEvent }[] };
};
const listeners = runtime.safeSignListeners ??= new Set();
const journal = runtime.safeSignJournal ??= { cursor: 0, discardedThrough: 0, entries: [] };
const historyLimit = 512;

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publish(event: DemoEvent) {
  const id = journal.cursor = Math.max(Date.now(), journal.cursor + 1);
  if (event.type === "DEMO_RESET") {
    journal.entries.length = 0;
    journal.discardedThrough = 0;
  }
  journal.entries.push({ id, event: structuredClone(event) });
  if (journal.entries.length > historyLimit) journal.discardedThrough = journal.entries.shift()!.id;
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(event), id);
    } catch {
      listeners.delete(listener);
    }
  }
}

export function matches(event: DemoEvent, { userId, channel }: EventFilter) {
  if (event.type === "DEMO_RESET") return true;
  if (userId && userId !== event.cosignerUserId && !("senderId" in event && event.senderId === userId)) return false;
  if (channel === "soc") return event.type !== "COSIGN_REQUESTED";
  if (channel === "cosign") return event.type === "COSIGN_REQUESTED" ||
    (event.type === "TX_UPDATED" && Boolean(event.cosignerUserId) && event.status !== "CHALLENGE_ISSUED");
  return true;
}

export const currentCursor = () => journal.cursor;

export function pollEvents(since: number, filter: EventFilter) {
  const events = journal.entries.filter(e => e.id > since && matches(e.event, filter))
    .map(({ id, event }) => ({ id, ...event }));
  return { events, cursor: currentCursor(), resyncRequired: since < journal.discardedThrough || since > currentCursor() };
}
