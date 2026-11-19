"use client";
import { demoParticipants } from "@/lib/demo/participants";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Mode } from "@/lib/db/types";

const storageKey = "safesign:demo-mode";
const modeEvent = "safesign:mode-change";
const defaultMode: Mode = "B2C";
export { demoParticipants };

function parseMode(value: string | null) {
  const mode = value?.toUpperCase();
  return mode === "B2C" || mode === "B2B" ? mode : undefined;
}

function getMode(): Mode {
  const fromUrl = parseMode(new URLSearchParams(window.location.search).get("mode"));
  if (fromUrl) return fromUrl;
  try {
    return parseMode(window.localStorage.getItem(storageKey)) ?? defaultMode;
  } catch {
    return defaultMode;
  }
}

function setMode(mode: Mode) {
  try {
    window.localStorage.setItem(storageKey, mode);
  } catch {
    // The URL still carries the mode when storage is unavailable.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("mode") !== mode) {
    url.searchParams.set("mode", mode);
    window.history.replaceState(null, "", url);
  }
  window.dispatchEvent(new Event(modeEvent));
}

function subscribe(notify: () => void) {
  window.addEventListener(modeEvent, notify);
  window.addEventListener("popstate", notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(modeEvent, notify);
    window.removeEventListener("popstate", notify);
    window.removeEventListener("storage", notify);
  };
}

const serverMode = () => defaultMode;
const DemoModeContext = createContext<{ mode: Mode; setMode: (mode: Mode) => void } | null>(null);

function SyncModeWithUrl() {
  const query = useSearchParams().toString();
  useEffect(() => {
    // Search params can also change through a Next.js link on the same route.
    setMode(getMode());
  }, [query]);
  return null;
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribe, getMode, serverMode);
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return (
    <DemoModeContext.Provider value={value}>
      <Suspense fallback={null}><SyncModeWithUrl /></Suspense>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  const value = useContext(DemoModeContext);
  if (!value) throw new Error("useDemoMode требует DemoModeProvider.");
  return { ...value, ...demoParticipants[value.mode] };
}
