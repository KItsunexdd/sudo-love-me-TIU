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

const CANONICAL_ATTACK_META: readonly {
  key: SocAttackCategory;
  label: string;
  shortLabel: string;
  color: string;
}[] = [
  { key: "MITM_AMOUNT", label: "MITM: подмена суммы", shortLabel: "MITM сумма", color: "#EF4444" },
  { key: "MITM_RECIPIENT", label: "MITM: подмена IBAN", shortLabel: "MITM IBAN", color: "#F97316" },
  { key: "REPLAY", label: "Replay-атака", shortLabel: "Replay", color: "#F59E0B" },
  { key: "PHISHING_ORIGIN", label: "Фишинг / чужой Origin", shortLabel: "Phishing / Origin", color: "#FB7185" },
  { key: "SOCIAL_ENGINEERING", label: "Социнженерия (2-of-2)", shortLabel: "Социнженерия", color: "#FBBF24" },
  { key: "PQ_SIGNATURE", label: "Квант / ML-DSA-65", shortLabel: "Квант (ML-DSA)", color: "#38BDF8" },
];

/**
 * Классификация событий согласована с серверной функцией attackType() в src/lib/soc/service.ts.
 */
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

export function getEventMeta(event: SecurityEvent): EventMeta {
  const category = classifyEventCategory(event);
  switch (event.eventType) {
    case "ATTACK_MITM_BLOCKED":
      if (category === "MITM_AMOUNT") {
        return { category, label: "MITM сумма", tone: "danger", isAttack: true };
      }
      if (category === "MITM_RECIPIENT") {
        return { category, label: "MITM IBAN", tone: "danger", isAttack: true };
      }
      return { category, label: "MITM подмена", tone: "danger", isAttack: true };
    case "ATTACK_REPLAY_BLOCKED":
      return { category, label: "Replay", tone: "warning", isAttack: true };
    case "ATTACK_PHISHING_BLOCKED":
      return { category, label: "Phishing / Origin", tone: "danger", isAttack: true };
    case "SOCENG_STOPPED_BY_COSIGNER":
      return { category, label: "Социнженерия", tone: "danger", isAttack: true };
    case "PQ_SIGNATURE_REJECTED":
      return { category, label: "Квант (ML-DSA)", tone: "info", isAttack: true };
    case "WEBAUTHN_REJECTED":
      return { category, label: "Отказ WebAuthn", tone: "danger", isAttack: true };
    case "TX_EXECUTED":
      return { category, label: "Подписано без SMS", tone: "success", isAttack: false };
    case "COSIGN_TRIGGERED":
      return { category, label: "Запрос Второй руки", tone: "warning", isAttack: false };
    case "COSIGN_APPROVED":
      return { category, label: "Вторая подпись OK", tone: "success", isAttack: false };
    case "DEVICE_REGISTERED":
      return { category, label: "Новое устройство", tone: "info", isAttack: false };
    case "TX_EXPIRED":
      return { category, label: "Истёк TTL", tone: "neutral", isAttack: false };
    case "TX_POLICY_REJECTED":
      return { category, label: "Отказ политики", tone: "warning", isAttack: false };
  }
}

export function buildAttackBreakdown(blockedByType: Record<string, number>): AttackBreakdownItem[] {
  const otherCount = (blockedByType.MITM_PAYLOAD ?? 0) + (blockedByType.WEBAUTHN ?? 0);
  const raw = CANONICAL_ATTACK_META.map(meta => ({
    ...meta,
    count: blockedByType[meta.key] ?? 0,
  }));
  const items: Array<{ key: SocAttackCategory | "OTHER_ATTACK"; label: string; shortLabel: string; color: string; count: number }> = [...raw];
  if (otherCount > 0) {
    items.push({
      key: "OTHER_ATTACK",
      label: "Прочие крипто-отказы",
      shortLabel: "Прочие крипто",
      color: "#A78BFA",
      count: otherCount,
    });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items.map(item => ({
    ...item,
    sharePercent: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }));
}

export function extractFailureCode(event: SecurityEvent): string | undefined {
  const code = event.technicalDetails.failureCode;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatter.format(date);
}

export function formatEventDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}
