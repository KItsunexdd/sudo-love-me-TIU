"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiError, type DemoUsersResponse } from "./api";
import { useEventStream } from "./useEventStream";

export function useDemoState(userId: string) {
  const { lastEvent, status: connectionStatus, syncVersion, resyncVersion } = useEventStream({ userId });
  const [data, setData] = useState<DemoUsersResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void api.users(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) setData(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => controller.abort();
  }, [lastEvent, syncVersion, resyncVersion, refreshVersion]);

  return { data, users: data?.users ?? [], recipientPresets: data?.recipientPresets, connectionStatus, loading, error, refresh };
}
