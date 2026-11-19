import { afterEach, expect, it, vi } from "vitest";
import { tabEvents } from "@/lib/client/useEventStream";
import type { DemoEvent } from "@/lib/events/filter";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("[DEMO-01] подписчики делят один транспорт и получают события своих участников", () => {
  vi.useFakeTimers();
  const sources: Source[] = [];
  class Source extends EventTarget {
    closed = false;
    constructor(readonly url: string) {
      super();
      expect(sources.every(source => source.closed)).toBe(true);
      sources.push(this);
    }
    close() { this.closed = true; }
    emit(id: number, event: DemoEvent | { type: "hello" }) {
      this.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event), lastEventId: String(id) }));
    }
  }
  vi.stubGlobal("EventSource", Source);
  const sender = tabEvents.select({ userId: "usr_aigul" });
  const cosigner = tabEvents.select({ channel: "cosign", userId: "usr_arman" });
  const unrelated = tabEvents.select({ channel: "cosign", userId: "usr_timur" });
  const stops = [sender, cosigner, unrelated].map(read => tabEvents.subscribe(read));
  const stopBank = tabEvents.open({ userId: "usr_aigul" });
  let stopSoc: (() => void) | undefined;
  try {
    expect(sources.map(source => source.url)).toEqual(["/api/events/stream?userId=usr_aigul"]);
    sources[0].emit(10, { type: "hello" });
    const before = unrelated();
    sources[0].emit(11, { type: "COSIGN_REQUESTED", senderId: "usr_aigul", cosignerUserId: "usr_arman", txId: "tx_1" });
    expect(sender().lastEvent?.id).toBe(11);
    expect(cosigner().lastEvent?.id).toBe(11);
    expect(unrelated()).toBe(before);
    sources[0].emit(12, { type: "DEMO_RESET", keepDevices: true });
    expect(cosigner().events.map(event => event.id)).toEqual([12]);
    stopSoc = tabEvents.open({ channel: "soc" });
    stopBank();
    expect(sources.map(source => source.closed)).toEqual([true, false]);
    expect(sender().events).toEqual([]);
  } finally {
    stopBank();
    stopSoc?.();
    stops.forEach(stop => stop());
  }
  expect(vi.getTimerCount()).toBe(0);
});
