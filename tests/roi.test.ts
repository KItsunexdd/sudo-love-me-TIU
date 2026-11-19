import { describe, expect, it } from "vitest";
import {
  calcRoi,
  detectPreset,
  formatCompactCount,
  formatCompactTenge,
  ROI_DEFAULTS,
  ROI_PRESETS,
  sanitizeRoiInputs,
} from "@/lib/roi/calc";

describe("ROI-калькулятор БЦК (формулы ТЗ §9.5 и сценарии PITCH §5)", () => {
  it("при значениях по умолчанию (ТЗ §9.5) даёт ровно 2 268 000 000 ₸/год на SMS и 1 050 000 000 ₸/год фрода", () => {
    const result = calcRoi(ROI_DEFAULTS);

    expect(result.monthlySmsVolumeBefore).toBe(21_000_000);
    expect(result.monthlySmsReplaced).toBe(15_750_000);
    expect(result.yearlySmsReplaced).toBe(189_000_000);
    expect(result.monthlySmsCostBefore).toBe(252_000_000);
    expect(result.yearlySmsCostBefore).toBe(3_024_000_000);

    expect(result.monthlySmsSavings).toBe(189_000_000);
    expect(result.yearlySmsSavings).toBe(2_268_000_000);
    expect(result.yearlySmsCostAfter).toBe(756_000_000);

    expect(result.yearlyFraudSavings).toBe(1_050_000_000);
    expect(result.monthlyFraudSavings).toBe(87_500_000);

    expect(result.monthlyTotalImpact).toBe(276_500_000);
    expect(result.totalYearlyImpact).toBe(3_318_000_000);
  });

  it("считает Консервативный сценарий из docs/PITCH.md §5.3 точно до тенге", () => {
    const conservative = ROI_PRESETS.find(preset => preset.id === "conservative");
    expect(conservative).toBeDefined();

    const result = calcRoi(conservative!.inputs);
    expect(result.inputs).toEqual({
      activeUsers: 1_500_000,
      smsPerUserMonth: 5,
      smsCostTenge: 8,
      migrationPercent: 50,
      annualFraudLossTenge: 800_000_000,
      fraudPreventionPercent: 50,
    });
    expect(result.monthlySmsSavings).toBe(30_000_000);
    expect(result.yearlySmsSavings).toBe(360_000_000);
    expect(result.yearlyFraudSavings).toBe(400_000_000);
    expect(result.totalYearlyImpact).toBe(760_000_000);
  });

  it("считает Оптимистичный сценарий согласованно по всем показателям", () => {
    const optimistic = ROI_PRESETS.find(preset => preset.id === "optimistic");
    expect(optimistic).toBeDefined();

    const result = calcRoi(optimistic!.inputs);
    expect(result.monthlySmsSavings).toBe(342_000_000);
    expect(result.yearlySmsSavings).toBe(4_104_000_000);
    expect(result.yearlyFraudSavings).toBe(1_700_000_000);
    expect(result.totalYearlyImpact).toBe(5_804_000_000);
  });

  it("строит монотонный накопленный ряд за 12 месяцев, сходящийся к годовым итогам", () => {
    const result = calcRoi(ROI_DEFAULTS);
    expect(result.cumulative12Months).toHaveLength(12);

    const first = result.cumulative12Months[0];
    const last = result.cumulative12Months[11];

    expect(first.month).toBe(1);
    expect(first.smsCumulative).toBe(result.monthlySmsSavings);
    expect(first.fraudCumulative).toBe(result.monthlyFraudSavings);
    expect(first.totalCumulative).toBe(result.monthlyTotalImpact);

    expect(last.month).toBe(12);
    expect(last.smsCumulative).toBe(result.yearlySmsSavings);
    expect(last.fraudCumulative).toBe(result.yearlyFraudSavings);
    expect(last.totalCumulative).toBe(result.totalYearlyImpact);

    for (let i = 1; i < result.cumulative12Months.length; i++) {
      expect(result.cumulative12Months[i].totalCumulative).toBeGreaterThan(
        result.cumulative12Months[i - 1].totalCumulative,
      );
    }
  });

  it("безопасно обрабатывает нули, границы 0–100% и невалидные значения (Zero-Crash)", () => {
    const zero = calcRoi({
      activeUsers: 0,
      smsPerUserMonth: 0,
      smsCostTenge: 0,
      migrationPercent: 0,
      annualFraudLossTenge: 0,
      fraudPreventionPercent: 0,
    });
    expect(zero.yearlySmsSavings).toBe(0);
    expect(zero.yearlyFraudSavings).toBe(0);
    expect(zero.totalYearlyImpact).toBe(0);
    expect(zero.yearlySmsCostAfter).toBe(0);

    const fullMigration = calcRoi({ ...ROI_DEFAULTS, migrationPercent: 100 });
    expect(fullMigration.yearlySmsCostAfter).toBe(0);
    expect(fullMigration.yearlySmsSavings).toBe(fullMigration.yearlySmsCostBefore);

    const sanitized = sanitizeRoiInputs({
      activeUsers: -100,
      smsPerUserMonth: Number.NaN,
      smsCostTenge: Number.POSITIVE_INFINITY,
      migrationPercent: 150,
      annualFraudLossTenge: -500,
      fraudPreventionPercent: -10,
    });
    expect(sanitized.activeUsers).toBe(0);
    expect(sanitized.smsPerUserMonth).toBe(ROI_DEFAULTS.smsPerUserMonth);
    expect(sanitized.smsCostTenge).toBe(ROI_DEFAULTS.smsCostTenge);
    expect(sanitized.migrationPercent).toBe(100);
    expect(sanitized.annualFraudLossTenge).toBe(0);
    expect(sanitized.fraudPreventionPercent).toBe(0);
  });

  it("распознаёт активный пресет и режим пользовательских параметров", () => {
    for (const preset of ROI_PRESETS) {
      expect(detectPreset(preset.inputs)).toBe(preset.id);
    }
    expect(detectPreset({ ...ROI_DEFAULTS, smsCostTenge: 11 })).toBe("custom");
  });

  it("форматирует суммы в формате «2,268 млрд ₸» и «189 млн ₸»", () => {
    expect(formatCompactTenge(2_268_000_000)).toBe("2,268\u00a0млрд\u00a0₸");
    expect(formatCompactTenge(1_050_000_000)).toBe("1,05\u00a0млрд\u00a0₸");
    expect(formatCompactTenge(3_318_000_000)).toBe("3,318\u00a0млрд\u00a0₸");
    expect(formatCompactTenge(189_000_000)).toBe("189\u00a0млн\u00a0₸");
    expect(formatCompactTenge(360_000_000)).toBe("360\u00a0млн\u00a0₸");
    expect(formatCompactTenge(87_500_000)).toBe("87,5\u00a0млн\u00a0₸");
    expect(formatCompactTenge(500_000)).toBe("500\u00a0000\u00a0₸");
    expect(formatCompactTenge(0)).toBe("0\u00a0₸");
    expect(formatCompactTenge(Number.NaN)).toBe("—");

    expect(formatCompactCount(21_000_000)).toBe("21\u00a0млн");
    expect(formatCompactCount(189_000_000)).toBe("189\u00a0млн");
    expect(formatCompactCount(15_750_000)).toBe("15,75\u00a0млн");
  });
});
