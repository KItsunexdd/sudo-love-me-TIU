import { matches, type DemoEvent, type EventFilter } from "./filter";
export type { DemoEvent, EventFilter } from "./filter";

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

export const currentCursor = () => journal.cursor;

export function pollEvents(since: number, filter: EventFilter) {
  const events = journal.entries.filter(e => e.id > since && matches(e.event, filter))
    .map(({ id, event }) => ({ id, ...event }));
  return { events, cursor: currentCursor(), resyncRequired: since < journal.discardedThrough || since > currentCursor() };
}
