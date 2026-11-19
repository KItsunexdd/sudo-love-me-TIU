"use client";

import { useEffect, useState } from "react";
import { api, type ApiError } from "@/lib/client/api";
import { useEventStream } from "@/lib/client/useEventStream";
import type { TransactionRecord } from "@/lib/db/types";

/** Subscribe first, then read the current record, including after reconnects. */
export function useTransaction(id: string | null, userId: string) {
  const { events, syncVersion, resyncVersion } = useEventStream({ userId });
  const latest = events.findLast(event => event.type === "DEMO_RESET" || ("txId" in event && event.txId === id))?.id;
  const [response, setResponse] = useState<{ id: string; record?: TransactionRecord; error?: ApiError }>();
  const [revision, setRevision] = useState(0);
  const current = response?.id === id ? response : undefined;
  const record = current?.record;
  const expiresAt = record?.status === "PENDING_COSIGN" ? record.cosignExpiresAt :
    record?.status === "CHALLENGE_ISSUED" ? record.payload.expiresAt : undefined;

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void api.getTransaction(id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setResponse({ id, record: result.data.transaction });
      else setResponse(previous => ({ id, error: result.error,
        record: previous?.id === id && result.status !== 404 ? previous.record : undefined }));
    });
    return () => controller.abort();
  }, [id, latest, syncVersion, resyncVersion, revision]);

  useEffect(() => {
    if (!expiresAt) return;
    const timeout = setTimeout(() => setRevision(value => value + 1), Math.max(0, Date.parse(expiresAt) - Date.now()) + 100);
    return () => clearTimeout(timeout);
  }, [id, expiresAt]);

  return { record, error: current?.error, retry: () => setRevision(value => value + 1) };
}
