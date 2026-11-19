import type { ReactNode } from "react";
import { Clock, Hand, KeyRound, ShieldAlert, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { DeviceKind, RiskLevel, SecurityEvent, TxStatus } from "@/lib/db/types";

const tones = {
  success: "border-bcc/40 bg-bcc/[.12] text-emerald-300",
  warning: "border-gold/[.45] bg-gold/15 text-amber-300",
  danger: "border-danger/[.55] bg-danger/[.16] text-danger-text",
  info: "border-quantum/35 bg-quantum/[.12] text-sky-300",
  neutral: "border-border-strong bg-ink-muted/15 text-ink-secondary",
};

export type BadgeTone = keyof typeof tones;
type BadgeStatus = TxStatus | RiskLevel | DeviceKind | SecurityEvent["severity"];
interface Label { text: string; tone: BadgeTone; icon?: LucideIcon; dot?: "static" | "pulse" }

const labels: Record<BadgeStatus, Label> = {
  CHALLENGE_ISSUED: { text: "Ожидает подписи", tone: "info", icon: KeyRound },
  PENDING_COSIGN: { text: "Ждёт Вторую руку", tone: "warning", icon: Users, dot: "pulse" },
  EXECUTED: { text: "Исполнено", tone: "success", icon: ShieldCheck },
  REJECTED_CRYPTO: { text: "Атака отражена", tone: "danger", icon: ShieldAlert },
  BLOCKED_BY_COSIGNER: { text: "Остановлено (Фрод)", tone: "danger", icon: Hand },
  EXPIRED: { text: "Истёк срок (TTL)", tone: "neutral", icon: Clock },
  LOW: { text: "Низкий риск", tone: "success" },
  MEDIUM: { text: "Повышенный риск", tone: "warning" },
  HIGH: { text: "Критический • Co-Sign", tone: "danger" },
  PLATFORM_PASSKEY: { text: "Passkey + ML-DSA-65", tone: "success", dot: "static" },
  SOFTWARE_FALLBACK: { text: "WebCrypto ECDSA + ML-DSA (Fallback)", tone: "warning", dot: "static" },
  INFO: { text: "ИНФО", tone: "info" },
  WARNING: { text: "РИСК", tone: "warning" },
  CRITICAL: { text: "АТАКА", tone: "danger" },
};

export function Badge({ status, tone, children, className = "" }: {
  status?: BadgeStatus; tone?: BadgeTone; children?: ReactNode; className?: string;
}) {
  const label = status && labels[status];
  const Icon = label ? label.icon : undefined;
  const dot = label ? label.dot : undefined;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${tones[tone ?? (label ? label.tone : "neutral")]} ${className}`}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {dot && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-current ${dot === "pulse" ? "animate-pulse" : ""}`} />}
      {children ?? (label ? label.text : status)}
    </span>
  );
}
