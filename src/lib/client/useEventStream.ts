"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, eventStreamUrl, type DemoEvent, type EventFilter } from "./api";

import { matches } from "@/lib/events/filter";

export type StreamEvent = DemoEvent & { id: number };
export type ConnectionStatus = "connecting" | "live" | "polling" | "offline";

interface Snapshot {
  events: StreamEvent[];
  lastEvent: StreamEvent | null;
  status: ConnectionStatus;
  syncVersion: number;
  resyncVersion: number;
}

const initial: Snapshot = { events: [], lastEvent: null, status: "connecting", syncVersion: 0, resyncVersion: 0 };
const eventTypes = ["COSIGN_REQUESTED", "TX_UPDATED", "SECURITY_ALERT", "DEMO_RESET"] as const;
const maxEvents = 100;
type Listener = () => void;

function connect(filter: EventFilter, set: (update: (previous: Snapshot) => Snapshot) => void) {
  const lifetime = new AbortController();
  let source: EventSource | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;
  let cursor: number | undefined;
  let hello = false;
  let live = false;
  let pendingPoll = false;
  let pollAgain = false;
  let buffered: StreamEvent[] = [];

  function status(value: ConnectionStatus) {
    set(previous => previous.status === value ? previous : { ...previous, status: value });
  }

  function accept(batch: StreamEvent[], reset = false) {
    const unique: StreamEvent[] = [];
    if (reset) cursor = undefined;
    for (const event of batch.sort((left, right) => left.id - right.id)) {
      if (event.id <= (cursor ?? -1)) continue;
      cursor = event.id;
      if (event.type === "DEMO_RESET") unique.length = 0;
      unique.push(event);
    }
    if (!unique.length && !reset) return;
    set(previous => {
      const dropHistory = reset || unique[0]?.type === "DEMO_RESET";
      const events = [...(dropHistory ? [] : previous.events), ...unique].slice(-maxEvents);
      return {
        ...previous, events, lastEvent: events.at(-1) ?? null,
        resyncVersion: previous.resyncVersion + Number(reset),
      };
    });
  }

  function markLive() {
    live = true;
    retryDelay = 1_000;
    accept(buffered);
    buffered = [];
    set(previous => ({ ...previous, status: "live", syncVersion: previous.syncVersion + 1 }));
  }

  async function poll() {
    if (lifetime.signal.aborted || live) return;
    if (pendingPoll) {
      pollAgain = true;
      return;
    }
    pendingPoll = true;
    const connectedSource = hello ? source : undefined;
    const result = await api.pollEvents({ ...filter, since: cursor ?? 0 }, lifetime.signal);
    pendingPoll = false;
    if (lifetime.signal.aborted) return;
    if (result.ok && Array.isArray(result.data.events) && Number.isSafeInteger(result.data.cursor)) {
      accept(result.data.events, result.data.resyncRequired);
      cursor = result.data.cursor;
      if (connectedSource && connectedSource === source && hello) markLive();
      else status("polling");
    } else status("offline");

    if (pollAgain) {
      pollAgain = false;
      void poll();
    }
  }

  function open() {
    if (lifetime.signal.aborted || typeof EventSource === "undefined") return;
    let connection: EventSource;
    try {
      connection = new EventSource(eventStreamUrl(filter));
    } catch {
      recover();
      return;
    }
    source = connection;
    handshake = setTimeout(recover, 5_000);
    connection.addEventListener("hello", (message: MessageEvent<string>) => {
      if (source !== connection || hello) return;
      const value = Number(message.lastEventId);
      if (!Number.isSafeInteger(value) || value < 0) return recover();
      clearTimeout(handshake);
      hello = true;
      if (cursor === undefined && !pendingPoll) {
        cursor = value;
        markLive();
      } else void poll();
    });
    for (const type of eventTypes) {
      connection.addEventListener(type, (message: MessageEvent<string>) => {
        if (source !== connection) return;
        try {
          const data: DemoEvent = JSON.parse(message.data);
          const id = Number(message.lastEventId);
          if (!Number.isSafeInteger(id) || id < 1 || data.type !== type) throw new Error();
          const event = { ...data, id };
          if (live) accept([event]);
          else buffered.push(event);
        } catch {
          recover();
        }
      });
    }
    connection.onerror = () => { if (source === connection) recover(); };
  }

  function recover() {
    clearTimeout(handshake);
    source?.close();
    source = undefined;
    hello = false;
    live = false;
    buffered = [];
    if (reconnect) return;
    status("connecting");
    void poll();
    reconnect = setTimeout(() => {
      reconnect = undefined;
      open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  }

  open();
  if (typeof EventSource === "undefined") void poll();
  const interval = setInterval(() => { if (!live) void poll(); }, 2_000);
  return () => {
    lifetime.abort();
    source?.close();
    source = undefined;
    clearTimeout(reconnect);
    clearTimeout(handshake);
    clearInterval(interval);
  };
}

let snapshot = initial;
let stopConnection: (() => void) | undefined;
const listeners = new Set<Listener>();
const serverSnapshot = () => initial;

function updateSnapshot(next: Snapshot) {
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach(notify => notify());
}

// One transport per tab. Changing the page or persona closes the old scope first.
export const tabEvents = {
  open(scope: EventFilter) {
    stopConnection?.();
    updateSnapshot(initial);
    const stop = connect(scope, fn => updateSnapshot(fn(snapshot)));
    stopConnection = stop;
    return () => {
      if (stopConnection !== stop) return;
      stop();
      stopConnection = undefined;
      updateSnapshot(initial);
    };
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  select(filter: EventFilter) {
    let previous = initial;
    let source: Snapshot | undefined;
    return () => {
      if (source === snapshot) return previous;
      source = snapshot;
      const filtered = snapshot.events.filter(event => matches(event, filter));
      const events = filtered.length === previous.events.length && filtered.every((event, i) => event === previous.events[i])
        ? previous.events : filtered;
      if (events !== previous.events || snapshot.status !== previous.status ||
          snapshot.syncVersion !== previous.syncVersion || snapshot.resyncVersion !== previous.resyncVersion) {
        previous = { ...snapshot, events, lastEvent: events.at(-1) ?? null };
      }
      return previous;
    };
  },
};

export function useTabEventConnection({ userId, channel }: EventFilter, enabled: boolean) {
  useEffect(() => {
    if (enabled) return tabEvents.open({ userId, channel });
  }, [userId, channel, enabled]);
}

export function useEventStream({ userId, channel }: EventFilter) {
  const select = useMemo(() => tabEvents.select({ userId, channel }), [userId, channel]);
  return useSyncExternalStore(tabEvents.subscribe, select, serverSnapshot);
}
