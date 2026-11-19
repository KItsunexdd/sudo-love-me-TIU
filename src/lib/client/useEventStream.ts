"use client";

import { useCallback, useSyncExternalStore } from "react";
import { api, eventStreamUrl, type DemoEvent, type EventFilter } from "./api";

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
    clearTimeout(reconnect);
    clearTimeout(handshake);
    clearInterval(interval);
  };
}

// Identical filters share a connection, including the shell and any mounted demo screen.
function createStore(filter: EventFilter, dispose: () => void) {
  let snapshot = initial;
  let stop: (() => void) | undefined;
  const listeners = new Set<Listener>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: Listener) {
      listeners.add(listener);
      stop ??= connect(filter, update => {
        const next = update(snapshot);
        if (next === snapshot) return;
        snapshot = next;
        listeners.forEach(notify => notify());
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stop?.();
        stop = undefined;
        snapshot = initial;
        dispose();
      };
    },
  };
}

const stores = new Map<string, ReturnType<typeof createStore>>();
const serverSnapshot = () => initial;

export function useEventStream({ userId, channel }: EventFilter = {}) {
  const key = eventStreamUrl({ userId, channel });
  const subscribe = useCallback((listener: Listener) => {
    let store = stores.get(key);
    if (!store) {
      store = createStore({ userId, channel }, () => stores.delete(key));
      stores.set(key, store);
    }
    return store.subscribe(listener);
  }, [key, userId, channel]);
  return useSyncExternalStore(subscribe, () => stores.get(key)?.getSnapshot() ?? initial, serverSnapshot);
}
