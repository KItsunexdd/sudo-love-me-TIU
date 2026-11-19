import { formatTenge } from "@/lib/ui/format";

export interface RoiInputs {
  /** U — активные клиенты bcc.kz */
  activeUsers: number;
  /** N — среднее число SMS-кодов на клиента в месяц */
  smsPerUserMonth: number;
  /** P — стоимость 1 транзакционного SMS у операторов РК (₸) */
  smsCostTenge: number;
  /** M — доля операций, переведённых на SafeSign (%) */
  migrationPercent: number;
  /** F — годовые потери банка/клиентов от фишинга и социнженерии (₸) */
  annualFraudLossTenge: number;
  /** R — доля предотвращения фрода (%) */
  fraudPreventionPercent: number;
}

export interface RoiMonthlyPoint {
  month: number;
  label: string;
  shortLabel: string;
  smsCumulative: number;
  fraudCumulative: number;
  totalCumulative: number;
}

export interface RoiResult {
  inputs: RoiInputs;
  monthlySmsVolumeBefore: number;
  monthlySmsReplaced: number;
  yearlySmsReplaced: number;
  monthlySmsCostBefore: number;
  yearlySmsCostBefore: number;
  /** Прямая экономия банка (OpEx на SMS) в месяц */
  monthlySmsSavings: number;
  /** Прямая экономия банка (OpEx на SMS) в год */
  yearlySmsSavings: number;
  yearlySmsCostAfter: number;
  /** Предотвращённые потери (клиенты и банк) в месяц */
  monthlyFraudSavings: number;
  /** Предотвращённые потери (клиенты и банк) в год */
  yearlyFraudSavings: number;
  /** Совокупный эффект в месяц */
  monthlyTotalImpact: number;
  /** Совокупный эффект в год */
  totalYearlyImpact: number;
  /** Накопленный эффект по месяцам за 12 месяцев */
  cumulative12Months: RoiMonthlyPoint[];
}

export type RoiPresetId = "conservative" | "base" | "optimistic";

export interface RoiPreset {
  id: RoiPresetId;
  label: string;
  shortNote: string;
  inputs: RoiInputs;
}

export const ROI_DEFAULTS: RoiInputs = {
  activeUsers: 3_000_000,
  smsPerUserMonth: 7,
  smsCostTenge: 12,
  migrationPercent: 75,
  annualFraudLossTenge: 1_500_000_000,
  fraudPreventionPercent: 70,
};

export const ROI_PRESETS: readonly RoiPreset[] = [
  {
    id: "conservative",
    label: "Консервативный",
    shortNote: "1,5 млн MAU · 5 SMS · 8 ₸ · 50% переход",
    inputs: {
      activeUsers: 1_500_000,
      smsPerUserMonth: 5,
      smsCostTenge: 8,
      migrationPercent: 50,
      annualFraudLossTenge: 800_000_000,
      fraudPreventionPercent: 50,
    },
  },
  {
    id: "base",
    label: "Базовый (ТЗ)",
    shortNote: "3 млн клиентов · 7 SMS · 12 ₸ · 75% переход",
    inputs: ROI_DEFAULTS,
  },
  {
    id: "optimistic",
    label: "Оптимистичный",
    shortNote: "3 млн клиентов · 8 SMS · 15 ₸ · 95% переход",
    inputs: {
      activeUsers: 3_000_000,
      smsPerUserMonth: 8,
      smsCostTenge: 15,
      migrationPercent: 95,
      annualFraudLossTenge: 2_000_000_000,
      fraudPreventionPercent: 85,
    },
  },
] as const;

export const ROI_RANGES = {
  activeUsers: { min: 100_000, max: 5_000_000, step: 100_000 },
  smsPerUserMonth: { min: 1, max: 20, step: 1 },
  smsCostTenge: { min: 4, max: 25, step: 1 },
  migrationPercent: { min: 10, max: 100, step: 1 },
  annualFraudLossTenge: { min: 100_000_000, max: 5_000_000_000, step: 50_000_000 },
  fraudPreventionPercent: { min: 10, max: 95, step: 1 },
} as const;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeRoiInputs(raw: Partial<RoiInputs>): RoiInputs {
  return {
    activeUsers: Math.round(clampNumber(raw.activeUsers, ROI_DEFAULTS.activeUsers, 0, 100_000_000)),
    smsPerUserMonth: clampNumber(raw.smsPerUserMonth, ROI_DEFAULTS.smsPerUserMonth, 0, 500),
    smsCostTenge: clampNumber(raw.smsCostTenge, ROI_DEFAULTS.smsCostTenge, 0, 1_000),
    migrationPercent: clampNumber(raw.migrationPercent, ROI_DEFAULTS.migrationPercent, 0, 100),
    annualFraudLossTenge: Math.round(clampNumber(raw.annualFraudLossTenge, ROI_DEFAULTS.annualFraudLossTenge, 0, 1_000_000_000_000)),
    fraudPreventionPercent: clampNumber(raw.fraudPreventionPercent, ROI_DEFAULTS.fraudPreventionPercent, 0, 100),
  };
}

/**
 * Расчёт ROI отказа от SMS по формулам ТЗ §9.5:
 *   monthlySmsSavings = U * N * P * (M / 100)
 *   yearlySmsSavings = monthlySmsSavings * 12
 *   yearlyFraudSavings = F * (R / 100)
 *   totalYearlyImpact = yearlySmsSavings + yearlyFraudSavings
 */
export function calcRoi(rawInputs: Partial<RoiInputs> = ROI_DEFAULTS): RoiResult {
  const inputs = sanitizeRoiInputs(rawInputs);
  const { activeUsers: U, smsPerUserMonth: N, smsCostTenge: P, migrationPercent: M, annualFraudLossTenge: F, fraudPreventionPercent: R } = inputs;

  const monthlySmsVolumeBefore = U * N;
  const monthlySmsReplaced = (monthlySmsVolumeBefore * M) / 100;
  const yearlySmsReplaced = monthlySmsReplaced * 12;

  const monthlySmsCostBefore = monthlySmsVolumeBefore * P;
  const yearlySmsCostBefore = monthlySmsCostBefore * 12;

  const monthlySmsSavings = (monthlySmsCostBefore * M) / 100;
  const yearlySmsSavings = monthlySmsSavings * 12;
  const yearlySmsCostAfter = Math.max(0, yearlySmsCostBefore - yearlySmsSavings);

  const yearlyFraudSavings = (F * R) / 100;
  const monthlyFraudSavings = yearlyFraudSavings / 12;

  const monthlyTotalImpact = monthlySmsSavings + monthlyFraudSavings;
  const totalYearlyImpact = yearlySmsSavings + yearlyFraudSavings;

  const cumulative12Months: RoiMonthlyPoint[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const smsCumulative = monthlySmsSavings * month;
    const fraudCumulative = (yearlyFraudSavings * month) / 12;
    return {
      month,
      label: `Месяц ${month}`,
      shortLabel: `М${month}`,
      smsCumulative,
      fraudCumulative,
      totalCumulative: smsCumulative + fraudCumulative,
    };
  });

  return {
    inputs,
    monthlySmsVolumeBefore,
    monthlySmsReplaced,
    yearlySmsReplaced,
    monthlySmsCostBefore,
    yearlySmsCostBefore,
    monthlySmsSavings,
    yearlySmsSavings,
    yearlySmsCostAfter,
    monthlyFraudSavings,
    yearlyFraudSavings,
    monthlyTotalImpact,
    totalYearlyImpact,
    cumulative12Months,
  };
}

export function detectPreset(inputs: RoiInputs): RoiPresetId | "custom" {
  const matched = ROI_PRESETS.find(({ inputs: preset }) =>
    preset.activeUsers === inputs.activeUsers &&
    preset.smsPerUserMonth === inputs.smsPerUserMonth &&
    preset.smsCostTenge === inputs.smsCostTenge &&
    preset.migrationPercent === inputs.migrationPercent &&
    preset.annualFraudLossTenge === inputs.annualFraudLossTenge &&
    preset.fraudPreventionPercent === inputs.fraudPreventionPercent,
  );
  return matched ? matched.id : "custom";
}

const NBSP = "\u00a0";
const billionFormat = new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const millionFormat = new Intl.NumberFormat("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function normalizeParts(formatter: Intl.NumberFormat, value: number): string {
  return formatter
    .formatToParts(value)
    .map(part => (part.type === "group" ? NBSP : part.value))
    .join("");
}

/**
 * Компактный формат тенге для KPI и ROI:
 *   2_268_000_000 -> "2,268 млрд ₸"
 *   1_050_000_000 -> "1,05 млрд ₸"
 *     189_000_000 -> "189 млн ₸"
 */
export function formatCompactTenge(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) {
    return `${normalizeParts(billionFormat, amount / 1_000_000_000)}${NBSP}млрд${NBSP}₸`;
  }
  if (abs >= 1_000_000) {
    return `${normalizeParts(millionFormat, amount / 1_000_000)}${NBSP}млн${NBSP}₸`;
  }
  return formatTenge(Math.round(amount));
}

export function formatCompactCount(count: number): string {
  if (!Number.isFinite(count)) return "—";
  const abs = Math.abs(count);
  if (abs >= 1_000_000_000) {
    return `${normalizeParts(millionFormat, count / 1_000_000_000)}${NBSP}млрд`;
  }
  if (abs >= 1_000_000) {
    return `${normalizeParts(millionFormat, count / 1_000_000)}${NBSP}млн`;
  }
  if (abs >= 1_000) {
    return `${normalizeParts(millionFormat, count / 1_000)}${NBSP}тыс.`;
  }
  return normalizeParts(millionFormat, Math.round(count));
}
