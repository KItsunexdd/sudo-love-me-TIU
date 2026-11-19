import type { Mode, OperationType, RiskLevel, User } from "@/lib/db/types";

export interface RiskInput {
  mode: Mode;
  operationType: OperationType;
  amountTenge: number;
  recipientAccount: string;
  simulatedContext?: { nightTimeOverride?: boolean; activeUnknownCall?: boolean };
}
const almatyHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Almaty", hour: "2-digit", hourCycle: "h23",
});
export const riskLevel = (score: number): RiskLevel => score >= 60 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";

export function assessRisk(input: RiskInput, sender: User, blacklist: string[], now = new Date()) {
  const { amountTenge, recipientAccount, mode, operationType, simulatedContext } = input;
  const rules: Array<[code: string, active: boolean, weight: number, reason: string]> = [
    ["NEW_RECIPIENT", !sender.trustedRecipients.some(r => r.recipientAccount === recipientAccount),
      30, "Вы переводите этому получателю впервые"],
    ["HIGH_AMOUNT_B2C", mode === "B2C" && amountTenge >= 200_000, 35, "Крупная сумма от 200 000 ₸"],
    ["VERY_HIGH_AMOUNT_B2C", mode === "B2C" && amountTenge >= 500_000, 25, "Критически крупная сумма от 500 000 ₸"],
    ["CRITICAL_OP_TYPE", operationType === "DEPOSIT_CLOSE" || operationType === "ONLINE_LOAN",
      55, "Высокорисковая операция — досрочное закрытие депозита или оформление кредита"],
    ["B2B_DUAL_CONTROL", mode === "B2B" && amountTenge >= 500_000, 60, "Платежи от 500 000 ₸ требуют подписи директора"],
    ["NIGHT_OPERATION", Boolean(simulatedContext?.nightTimeOverride) || Number(almatyHour.format(now)) < 6,
      15, "Нетипичное ночное время операции"],
    ["SUSPICIOUS_CALL_FLAG", simulatedContext?.activeUnknownCall === true, 40,
      "Обнаружен звонок с незнакомого номера во время перевода — частый признак мошенников"],
    ["DROP_ACCOUNT_PATTERN", blacklist.includes(recipientAccount), 50, "Счёт получателя имеет признаки дроппер-аккаунта"],
  ];
  const hits = rules.filter(([, active]) => active);
  const score = Math.min(100, Math.max(0, hits.reduce((sum, [, , weight]) => sum + weight, 0)));
  const level = riskLevel(score);
  return { score, level, requiresCoSign: level === "HIGH", requiresAcknowledgement: level === "MEDIUM",
    reasons: hits.map(([, , , reason]) => reason), codes: hits.map(([code]) => code) };
}
