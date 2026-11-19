"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client/api";
import { useEventStream } from "@/lib/client/useEventStream";
import type { Mode, TransactionRecord } from "@/lib/db/types";

function useRequestPing() {
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof AudioContext !== "function") return;
    function unlock(event?: Event) {
      if (event ? !event.isTrusted : !navigator.userActivation?.hasBeenActive) return;
      try {
        const context = audio.current ??= new AudioContext();
        if (context.state === "suspended") void context.resume().catch(() => {});
      } catch {
        // Audio can be unavailable even after a gesture.
      }
    }
    unlock();
    window.addEventListener("click", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);

  return useCallback(() => {
    try {
      navigator.vibrate?.([100, 65, 100]);
    } catch {
      // Vibration is optional and may be blocked by the browser.
    }
    const context = audio.current;
    if (context?.state !== "running") return;
    try {
      const tone = context.createOscillator();
      const volume = context.createGain();
      const start = context.currentTime;
      tone.type = "sine";
      tone.frequency.setValueAtTime(780, start);
      tone.frequency.setValueAtTime(990, start + 0.07);
      volume.gain.setValueAtTime(0.001, start);
      volume.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      tone.connect(volume).connect(context.destination);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      tone.start(start);
      tone.stop(start + 0.18);
    } catch {
      // An interrupted audio context must never break the feed.
    }
  }, []);
}

export function useCosignFeed(cosignerUserId: string, mode: Mode) {
  const { events, status, syncVersion, resyncVersion } = useEventStream({ channel: "cosign", userId: cosignerUserId });
  const resetId = events.findLast(event => event.type === "DEMO_RESET")?.id;
  const seenEventId = useRef(events.at(-1)?.id ?? 0);
  const [data, setData] = useState<{ pending: TransactionRecord[]; history: TransactionRecord[]; resetId?: number }>();
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);
  const ping = useRequestPing();

  useEffect(() => {
    const controller = new AbortController();
    const query = { userId: cosignerUserId };
    const belongsToFeed = (tx: TransactionRecord) => tx.cosignerUserId === cosignerUserId && tx.payload.mode === mode;
    const newestFirst = (a: TransactionRecord, b: TransactionRecord) => b.updatedAt.localeCompare(a.updatedAt);

    void Promise.all([
      api.listTransactions({ ...query, status: "PENDING_COSIGN" }, controller.signal),
      api.listTransactions(query, controller.signal),
    ]).then(([pendingResult, historyResult]) => {
      if (controller.signal.aborted) return;
      setError(pendingResult.error ?? historyResult.error);
      if (!pendingResult.ok || !historyResult.ok) return;

      const history = historyResult.data.transactions.filter(tx => belongsToFeed(tx) && tx.primarySignature &&
        tx.status !== "PENDING_COSIGN" && tx.status !== "CHALLENGE_ISSUED").sort(newestFirst);
      const decided = new Set(history.map(tx => tx.id));
      const pending = pendingResult.data.transactions.filter(tx => belongsToFeed(tx) && !decided.has(tx.id)).sort(newestFirst);
      const pendingIds = new Set(pending.map(tx => tx.id));
      if (events.some(event => event.id > seenEventId.current && event.type === "COSIGN_REQUESTED" &&
        event.cosignerUserId === cosignerUserId && pendingIds.has(event.txId))) ping();

      seenEventId.current = events.at(-1)?.id ?? seenEventId.current;
      setData({ pending, history, resetId });
    });
    return () => controller.abort();
  }, [cosignerUserId, mode, events, resetId, syncVersion, resyncVersion, refreshVersion, ping]);

  const current = data?.resetId === resetId ? data : undefined;
  return {
    pending: current?.pending ?? [],
    history: current?.history ?? [],
    loading: !current && !error,
    error, status, resetId, syncVersion, resyncVersion, refresh,
  };
}
