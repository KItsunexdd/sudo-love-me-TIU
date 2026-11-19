import { describe, expect, it } from "vitest";
import { cosignHref, cosignMode, formatCosignTimer, remainingSeconds, selectCosigner } from "@/components/cosign/cosignDetails";

describe("Co-Sign timer", () => {
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
