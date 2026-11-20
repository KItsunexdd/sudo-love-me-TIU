import { isMessageKey, t, type Locale, type MessageKey } from "./index";
import { ru } from "./ru";

const legacyReasons = new Map<string, MessageKey>();
const diagnosticMessages = new Map<string, MessageKey>();
for (const key of Object.keys(ru)) {
  if (!isMessageKey(key)) continue;
  if (key.startsWith("risk.")) legacyReasons.set(ru[key], key);
  if (key.startsWith("ERR_") || key.startsWith("detail.")) diagnosticMessages.set(ru[key], key);
}

export function failureText(locale: Locale, code: string, original: string) {
  if (locale === "ru" || !code.startsWith("ERR_") || !isMessageKey(code)) return original;
  return t(locale, code);
}

export function riskReason(locale: Locale, code: string | undefined, reason: string, corporate = false) {
  const candidate = `risk.${code}`;
  const key = code ? (isMessageKey(candidate) ? candidate : undefined) : legacyReasons.get(reason);
  if (corporate && key === "risk.SUSPICIOUS_CALL_FLAG") return t(locale, "risk.callShort");
  return locale === "kk" && key ? t(locale, key) : reason;
}

/** Older traces and journal entries store each check's explanation as Russian text. */
export function diagnosticText(locale: Locale, original: string) {
  const key = diagnosticMessages.get(original);
  return key ? t(locale, key) : original;
}
