import { describe, expect, it, vi } from "vitest";
import { cosignHref, cosignMode, formatCosignTimer, remainingSeconds, selectCosigner, watchCosignDeadline } from "@/components/cosign/cosignDetails";

describe("Co-Sign timer", () => {
  it("№6 — сверяет срок с сервером при сдвиге часов и возобновляет отсчёт после ответа PENDING", () => {
    vi.useFakeTimers();
    try {
      const deadline = "2026-11-19T14:15:00.000Z";
      const end = Date.parse(deadline);
      vi.setSystemTime(end + 120_000);
      const tick = vi.fn(), refresh = vi.fn();
      const start = (remainingMs: number) => watchCosignDeadline(deadline, {
        serverTimeMs: end - remainingMs, receivedAt: performance.now(),
      }, tick, refresh);
      const stop = start(1_500);
      expect(tick).toHaveBeenLastCalledWith(2);
      vi.advanceTimersByTime(1_000);
      vi.setSystemTime(end - 120_000);
      expect(tick).toHaveBeenLastCalledWith(1);
      vi.advanceTimersByTime(499);
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(tick).toHaveBeenLastCalledWith(0);
      expect(refresh).toHaveBeenCalledTimes(1);
      stop();

      const stopPending = start(250);
      expect(tick).toHaveBeenLastCalledWith(1);
      vi.advanceTimersByTime(250);
      expect(refresh).toHaveBeenCalledTimes(2);
      stopPending();
      const unmount = start(500);
      unmount();
      vi.advanceTimersByTime(1_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("formats the full 15-minute window and pads seconds", () => {
    expect(formatCosignTimer(900)).toBe("15:00");
    expect(formatCosignTimer(65)).toBe("01:05");
  });

  it("shows one second up to the deadline, then clamps to zero", () => {
    const deadline = "2026-11-19T14:15:00.000Z";
    const end = Date.parse(deadline);
    expect(formatCosignTimer(remainingSeconds(deadline, end - 1))).toBe("00:01");
    expect(formatCosignTimer(remainingSeconds(deadline, end))).toBe("00:00");
    expect(formatCosignTimer(remainingSeconds(deadline, end + 1_000))).toBe("00:00");
    expect(formatCosignTimer(remainingSeconds(undefined, end))).toBe("00:00");
  });
});

describe("Co-Sign profiles", () => {
  it("selects the participant for each mode", () => {
    expect(selectCosigner("B2C")).toBe("usr_arman");
    expect(selectCosigner("B2B", " ")).toBe("usr_timur");
  });

  it("accepts an explicitly selected cosigner", () => {
    expect(selectCosigner("B2C", " usr_custom ")).toBe("usr_custom");
    expect(cosignMode("B2C", "usr_timur")).toBe("B2B");
    expect(cosignMode("B2B", "usr_arman")).toBe("B2C");
  });

  it("builds shareable links for both profiles", () => {
    expect(cosignHref("B2C")).toBe("/cosign?userId=usr_arman");
    expect(cosignHref("B2B")).toBe("/cosign?userId=usr_timur&mode=B2B");
  });
});
