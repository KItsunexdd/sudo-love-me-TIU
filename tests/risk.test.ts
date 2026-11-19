import { describe, expect, it } from "vitest";
import { assessRisk, riskLevel, type RiskInput } from "@/lib/risk/engine";
import { createSeed, DROP_ACCOUNT } from "@/lib/db/seed";

const db = createSeed();
const [sender, , accountant] = db.users;
const base: RiskInput = {
  mode: "B2C", operationType: "P2P_TRANSFER", recipientAccount: sender.trustedRecipients[0].recipientAccount, amountTenge: 1,
};
const noon = new Date("2026-04-01T07:00:00Z");
const calc = (overrides: Partial<RiskInput>, date = noon) =>
  assessRisk({ ...base, ...overrides }, overrides.mode === "B2B" ? accountant : sender, db.blacklist, date);

describe("Скоринг §5", () => {
  it.each([
    [199_999, 0], [200_000, 35], [499_999, 35], [500_000, 60],
  ])("B2C %i ₸ даёт %i баллов", (amountTenge, score) => {
    expect(calc({ amountTenge }).score).toBe(score);
  });
  it.each([
    [0, "LOW"], [39, "LOW"], [40, "MEDIUM"], [59, "MEDIUM"], [60, "HIGH"], [100, "HIGH"],
  ] as const)("уровень %i — %s", (score, expected) => expect(riskLevel(score)).toBe(expected));
  it.each([
    ["NEW_RECIPIENT", { recipientAccount: "новый" }, 30],
    ["CRITICAL_OP_TYPE", { operationType: "ONLINE_LOAN" }, 55],
    ["CRITICAL_OP_TYPE", { operationType: "DEPOSIT_CLOSE" }, 55],
    ["NIGHT_OPERATION", { simulatedContext: { nightTimeOverride: true } }, 15],
    ["SUSPICIOUS_CALL_FLAG", { simulatedContext: { activeUnknownCall: true } }, 40],
  ] as const)("применяет правило %s", (code, input, score) => {
    const result = calc(input);
    expect(result).toMatchObject({ score, codes: [code] });
    expect(result.reasons[0]).toMatch(/[А-Яа-я]/);
  });
  it("считает ночь по времени Алматы, границы 00:00 включительно и 06:00 исключительно", () => {
    for (const [instant, score] of [
      ["2026-04-01T18:59:59Z", 0], ["2026-04-01T19:00:00Z", 15],
      ["2026-04-02T00:59:59Z", 15], ["2026-04-02T01:00:00Z", 0],
    ] as const) expect(calc({}, new Date(instant)).score).toBe(score);
  });
  it("прибавляет +50 за чёрный список и ограничивает сумму ста баллами", () => {
    expect(calc({ recipientAccount: DROP_ACCOUNT })).toMatchObject({ score: 80, codes: ["NEW_RECIPIENT", "DROP_ACCOUNT_PATTERN"] });
    expect(calc({ recipientAccount: DROP_ACCOUNT, amountTenge: 850_000, simulatedContext: { activeUnknownCall: true } }))
      .toMatchObject({ score: 100, requiresCoSign: true, codes: ["NEW_RECIPIENT", "HIGH_AMOUNT_B2C",
        "VERY_HIGH_AMOUNT_B2C", "SUSPICIOUS_CALL_FLAG", "DROP_ACCOUNT_PATTERN"] });
  });
  it("порог двойного контроля B2B начинается с 500 000 ₸", () => {
    const business = { mode: "B2B" as const, operationType: "B2B_INVOICE" as const,
      recipientAccount: accountant.trustedRecipients[0].recipientAccount };
    expect(calc({ ...business, amountTenge: 499_999 }).score).toBe(0);
    expect(calc({ ...business, amountTenge: 500_000 })).toMatchObject({ score: 60, codes: ["B2B_DUAL_CONTROL"] });
  });
});
