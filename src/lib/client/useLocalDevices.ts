"use client";

import { useEffect, useState } from "react";
import { listLocalDevices, subscribeLocalDevices, type LocalDevice } from "./client-keystore";

export function useLocalDevices() {
  const [devices, setDevices] = useState<LocalDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let version = 0;
    function load() {
      const request = ++version;
      void listLocalDevices().then(next => {
        if (!active || request !== version) return;
        setDevices(next);
        setUnavailable(false);
        setLoading(false);
      }, () => {
        if (!active || request !== version) return;
        setUnavailable(true);
        setLoading(false);
      });
    }
    const unsubscribe = subscribeLocalDevices(load);
    window.addEventListener("focus", load);
    load();
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", load);
    };
  }, []);
  return { devices, loading, unavailable };
}
