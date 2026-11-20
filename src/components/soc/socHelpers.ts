import { diagnosticText, failureText } from "@/lib/i18n/server-text";
import { regions, russian, type Locale, type Translate } from "@/lib/i18n";
import type { BadgeTone } from "@/components/ui/Badge";
import type { SecurityEvent } from "@/lib/db/types";

export type SocAttackCategory =
  | "MITM_AMOUNT"
  | "MITM_RECIPIENT"
  | "REPLAY"
  | "PHISHING_ORIGIN"
  | "SOCIAL_ENGINEERING"
  | "PQ_SIGNATURE";

export type SocEventCategory = SocAttackCategory | "OTHER_ATTACK" | "OPERATIONS";
export type SocTypeFilter = "ALL" | SocEventCategory;
export type SocSeverityFilter = "ALL" | SecurityEvent["severity"];

export interface AttackBreakdownItem {
  key: SocAttackCategory | "OTHER_ATTACK";
  label: string;
  shortLabel: string;
  count: number;
  color: string;
  sharePercent: number;
}

export interface EventMeta {
  category: SocEventCategory;
  label: string;
  tone: BadgeTone;
  isAttack: boolean;
}

const getAttackCategories = (t: Translate): readonly {
  key: SocAttackCategory;
  label: string;
  shortLabel: string;
}[] => ([
  { key: "MITM_AMOUNT", label: t("socHelpers.amount"), shortLabel: t("common.mitmAmount") },
  { key: "MITM_RECIPIENT", label: t("socHelpers.iban"), shortLabel: "MITM IBAN" },
  { key: "REPLAY", label: t("socHelpers.replay"), shortLabel: "Replay" },
  { key: "PHISHING_ORIGIN", label: t("socHelpers.phishing"), shortLabel: "Phishing / Origin" },
  { key: "SOCIAL_ENGINEERING", label: t("socHelpers.social"), shortLabel: t("common.social") },
  { key: "PQ_SIGNATURE", label: t("socHelpers.quantum"), shortLabel: t("socHelpers.pq") },
]);

// Match the categories used by the SOC report.
export function classifyEventCategory(event: SecurityEvent): SocEventCategory {
  switch (event.eventType) {
    case "ATTACK_MITM_BLOCKED": {
      const fields = event.technicalDetails.tamperDiff?.map(d => d.field) ?? [];
      if (fields.includes("amountTenge")) return "MITM_AMOUNT";
      if (fields.includes("recipientAccount") || fields.includes("recipientName")) return "MITM_RECIPIENT";
      return "OTHER_ATTACK";
    }
    case "ATTACK_REPLAY_BLOCKED":
      return "REPLAY";
    case "ATTACK_PHISHING_BLOCKED":
      return "PHISHING_ORIGIN";
    case "SOCENG_STOPPED_BY_COSIGNER":
      return "SOCIAL_ENGINEERING";
    case "PQ_SIGNATURE_REJECTED":
      return "PQ_SIGNATURE";
    case "WEBAUTHN_REJECTED":
      return "OTHER_ATTACK";
    default:
      return "OPERATIONS";
  }
}

export function getEventMeta(event: SecurityEvent, t: Translate = russian): EventMeta {
  const category = classifyEventCategory(event);
  switch (event.eventType) {
    case "ATTACK_MITM_BLOCKED":
      if (category === "MITM_AMOUNT") {
        return { category, label: t("common.mitmAmount"), tone: "danger", isAttack: true };
      }
      if (category === "MITM_RECIPIENT") {
        return { category, label: "MITM IBAN", tone: "danger", isAttack: true };
      }
      return { category, label: t("socHelpers.mitm"), tone: "danger", isAttack: true };
    case "ATTACK_REPLAY_BLOCKED":
      return { category, label: "Replay", tone: "warning", isAttack: true };
    case "ATTACK_PHISHING_BLOCKED":
      return { category, label: "Phishing / Origin", tone: "danger", isAttack: true };
    case "SOCENG_STOPPED_BY_COSIGNER":
      return { category, label: t("common.social"), tone: "danger", isAttack: true };
    case "PQ_SIGNATURE_REJECTED":
      return { category, label: t("socHelpers.pq"), tone: "info", isAttack: true };
    case "WEBAUTHN_REJECTED":
      return { category, label: t("socHelpers.webauthn"), tone: "danger", isAttack: true };
    case "TX_EXECUTED":
      return { category, label: t("common.signed"), tone: "success", isAttack: false };
    case "COSIGN_TRIGGERED":
      return { category, label: t("socHelpers.cosign"), tone: "warning", isAttack: false };
    case "COSIGN_APPROVED":
      return { category, label: t("socHelpers.approved"), tone: "success", isAttack: false };
    case "DEVICE_REGISTERED":
      return { category, label: t("socHelpers.device"), tone: "info", isAttack: false };
    case "TX_EXPIRED":
      return { category, label: t("socHelpers.expired"), tone: "neutral", isAttack: false };
    case "TX_POLICY_REJECTED":
      return { category, label: t("socHelpers.policy"), tone: "warning", isAttack: false };
  }
}

export function buildAttackBreakdown(blockedByType: Record<string, number>, t: Translate = russian): AttackBreakdownItem[] {
  const categories = getAttackCategories(t);
  const otherCount = (blockedByType.MITM_PAYLOAD ?? 0) + (blockedByType.WEBAUTHN ?? 0);
  const items: Omit<AttackBreakdownItem, "color" | "sharePercent">[] = categories.map(meta => ({
    ...meta,
    count: blockedByType[meta.key] ?? 0,
  }));
  if (otherCount > 0) {
    items.push({
      key: "OTHER_ATTACK",
      label: t("socHelpers.other"),
      shortLabel: t("common.other"),
      count: otherCount,
    });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const neutralSteps = ["var(--text-secondary)", "var(--text-muted)", "var(--text-disabled)"];
  return items.sort((left, right) => right.count - left.count).map((item, index) => ({
    color: neutralSteps[Math.min(index, neutralSteps.length - 1)],
    ...item,
    sharePercent: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }));
}

export function extractFailureCode(event: SecurityEvent): string | undefined {
  const code = event.technicalDetails.failureCode;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

export function eventSummary(event: SecurityEvent, locale: Locale) {
  const code = extractFailureCode(event);
  return code ? failureText(locale, code, event.summary) : diagnosticText(locale, event.summary);
}

function eventFormatters(region: string) {
  const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  return {
    time: new Intl.DateTimeFormat(region, time),
    dateTime: new Intl.DateTimeFormat(region, { ...time, day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}
const formats = { ru: eventFormatters(regions.ru), kk: eventFormatters(regions.kk) };

export function formatEventTime(iso: string, locale: Locale = "ru") {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : formats[locale].time.format(date);
}

export function formatEventDateTime(iso: string, locale: Locale = "ru") {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : formats[locale].dateTime.format(date);
}
