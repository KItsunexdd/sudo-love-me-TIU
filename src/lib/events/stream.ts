import { matches } from "./filter";
import { currentCursor, subscribe, type EventFilter } from "./bus";

export function streamEvents(signal: AbortSignal, filter: EventFilter) {
  const encoder = new TextEncoder();
  let cancel: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function write(chunk: string) {
        try { controller.enqueue(encoder.encode(chunk)); }
        catch { cancel(); }
      }
      const send = (event: string, data: unknown, cursor: number) => {
        write(`id: ${cursor}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const unsubscribe = subscribe((event, cursor) => {
        if (matches(event, filter)) send(event.type, event, cursor);
      });
      const heartbeat = setInterval(() => write(": heartbeat\n\n"), 15_000);
      cancel = () => {
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener("abort", abort);
      };
      function abort() {
        cancel();
        controller.close();
      }
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      const cursor = currentCursor();
      send("hello", { cursor }, cursor);
    },
    cancel() { cancel(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
  } });
}
