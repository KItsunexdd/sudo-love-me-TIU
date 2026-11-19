import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CosignCabinet } from "@/app/cosign/CosignCabinet";
import { AppProviders } from "@/components/shell/AppProviders";
import { Topbar } from "@/components/shell/Topbar";
import * as attacks from "@/components/hacker/attacks";
import { api } from "@/lib/client/api";
import { tabEvents, useTabEventConnection } from "@/lib/client/useEventStream";
import * as keystore from "@/lib/crypto/client-keystore";
import type { Mode, RegisteredDevice } from "@/lib/db/types";
import { currentCursor, pollEvents, publish } from "@/lib/events/bus";

let url: URL;
let chooseMode: (mode: Mode) => void;

vi.mock("next/navigation", () => ({
  usePathname: () => url.pathname,
  useSearchParams: () => url.searchParams,
  useRouter: () => ({ replace: (href: string) => { url = new URL(href, url); } }),
}));
vi.mock("@/components/ui/Drawer", () => ({ Drawer: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ui/SegmentedControl", () => ({
  SegmentedControl: ({ label, onChange }: { label: string; onChange: typeof chooseMode }) => {
    if (label === "Режим демо") chooseMode = onChange;
    return null;
  },
}));
vi.mock("@/components/cosign/CosignFeed", () => ({
  CosignFeed: ({ mode, userId }: { mode: Mode; userId: string }) => [mode, userId].join("/"),
}));
vi.mock("@/lib/client/useEventStream", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/client/useEventStream")>(),
  useTabEventConnection: vi.fn(),
}));

function renderShell(children: ReactNode = null) {
  return renderToStaticMarkup(createElement(AppProviders, null, children));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("№2 — меню QR-кабинета меняет участника в ссылке, ленте и подписке в обе стороны", () => {
  url = new URL("https://bank.test/cosign?mode=B2C&userId=usr_arman");
  vi.stubGlobal("window", {
    get location() { return url; },
    history: { replaceState: (_state: unknown, _title: string, next: URL) => { url = next; } },
    localStorage: { setItem: vi.fn() }, dispatchEvent: vi.fn(),
  });
  for (const [mode, id] of [["B2B", "usr_timur"], ["B2C", "usr_arman"]] as const) {
    renderShell(createElement(Topbar));
    chooseMode(mode);
    expect(url.searchParams.get("userId")).toBe(id);
    expect(url.searchParams.get("mode") ?? "B2C").toBe(mode);
    expect(renderShell(createElement(CosignCabinet))).toContain(mode + "/" + id);
    expect(vi.mocked(useTabEventConnection).mock.lastCall?.[0]).toEqual({ channel: "cosign", userId: id });
  }
});

function startPolling(path: string) {
  url = new URL(path, "https://bank.test");
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", undefined);
  const initialCursor = currentCursor();
  vi.spyOn(api, "pollEvents").mockImplementation(async (query = {}) => {
    const data = pollEvents(Number(query.since) || initialCursor, query);
    return { ok: true, status: 200, data, error: null };
  });
  renderShell();
  const [scope, enabled, onReset] = vi.mocked(useTabEventConnection).mock.lastCall!;
  expect(enabled).toBe(true);
  return tabEvents.open(scope, onReset);
}

it("№3 — каждый сброс в SOC очищает состояние панели, пока стенд размонтирован", async () => {
  vi.spyOn(keystore, "listLocalDevices").mockResolvedValue([]);
  vi.spyOn(keystore, "clearLocalDevices").mockResolvedValue(undefined);
  const reset = vi.spyOn(attacks, "resetAttackState");
  const stop = startPolling("/soc");
  try {
    for (const keepDevices of [true, false]) {
      publish({ type: "DEMO_RESET", keepDevices });
      await vi.advanceTimersByTimeAsync(2_000);
    }
    expect(reset).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});

it("№8 — после двух сбросов между опросами удаляется только отозванный ключ", async () => {
  const active: RegisteredDevice = {
    id: "current", userId: "usr_arman", deviceKind: "SOFTWARE_FALLBACK", deviceName: "Телефон",
    credentialId: "cred", pqKeyFingerprint: "fp", rpId: "bank.test", createdAt: "2026-01-01T00:00:00Z",
    webAuthnPublicKey: "", webAuthnCounter: 0, transports: [], pqAlgorithm: "ML-DSA-65", pqPublicKey: "",
  };
  vi.spyOn(keystore, "listLocalDevices").mockResolvedValue([{ ...active, id: "revoked" }, active]);
  const clear = vi.spyOn(keystore, "clearLocalDevices").mockResolvedValue(undefined);
  vi.spyOn(api, "listDevices").mockResolvedValue({ ok: true, status: 200, data: { devices: [active] }, error: null });
  const stop = startPolling("/cosign?userId=usr_arman");
  try {
    const since = currentCursor();
    publish({ type: "DEMO_RESET", keepDevices: false });
    publish({ type: "DEMO_RESET", keepDevices: true });
    expect(pollEvents(since, {}).events).toEqual([expect.objectContaining({ keepDevices: true })]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.listDevices).toHaveBeenCalledWith("usr_arman");
    expect(clear).toHaveBeenCalledExactlyOnceWith(["revoked"]);
  } finally { stop(); }
});
