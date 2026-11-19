import type { SecurityEvent, TxStatus } from "@/lib/db/types";

export type DemoEvent =
  | { type: "COSIGN_REQUESTED"; txId: string; cosignerUserId: string }
  | { type: "TX_UPDATED"; txId: string; status: TxStatus }
  | { type: "SECURITY_ALERT"; event: SecurityEvent }
  | { type: "DEMO_RESET"; keepDevices: boolean };

type Listener = (event: DemoEvent) => void;
const runtime = globalThis as typeof globalThis & { safeSignListeners?: Set<Listener> };
const listeners = runtime.safeSignListeners ??= new Set();

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publish(event: DemoEvent) {
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(event));
    } catch {
      // A disconnected SSE stream must not interrupt delivery to the remaining clients.
      listeners.delete(listener);
    }
  }
}
