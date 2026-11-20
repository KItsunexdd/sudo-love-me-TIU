"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import type { ReactNode } from "react";
import type { DeviceKind, RiskLevel, SecurityEvent, TxStatus } from "@/lib/db/types";

// A status is quiet text with a small dot in the colour of its meaning, never a glowing pill.
const tones = {
  success: "text-bcc",
  warning: "text-gold-text",
  danger: "text-danger-text",
  info: "text-ink-secondary",
  neutral: "text-ink-muted",
};

export type BadgeTone = keyof typeof tones;
type BadgeStatus = TxStatus | RiskLevel | DeviceKind | SecurityEvent["severity"];
interface Label { text: string; tone: BadgeTone }

const getLabels = (t: Translate): Record<BadgeStatus, Label> => ({
  CHALLENGE_ISSUED: { text: t("common.unsigned"), tone: "info" },
  PENDING_COSIGN: { text: t("badge.pending"), tone: "warning" },
  EXECUTED: { text: t("badge.executed"), tone: "success" },
  REJECTED_CRYPTO: { text: t("common.repelled"), tone: "danger" },
  BLOCKED_BY_COSIGNER: { text: t("badge.stopped"), tone: "danger" },
  EXPIRED: { text: t("badge.expired"), tone: "neutral" },
  LOW: { text: t("badge.low"), tone: "success" },
  MEDIUM: { text: t("badge.medium"), tone: "warning" },
  HIGH: { text: t("badge.high"), tone: "danger" },
  PLATFORM_PASSKEY: { text: "Passkey + ML-DSA-65", tone: "success" },
  SOFTWARE_FALLBACK: { text: "WebCrypto ECDSA + ML-DSA (Fallback)", tone: "warning" },
  INFO: { text: t("common.info"), tone: "info" },
  WARNING: { text: t("common.riskBadge"), tone: "warning" },
  CRITICAL: { text: t("common.attack"), tone: "danger" },
});

export function Badge({ status, tone, dot, children, className = "" }: {
  status?: BadgeStatus; tone?: BadgeTone; dot?: boolean; children?: ReactNode; className?: string;
}) {
  const { t } = useT();
  const label = status ? getLabels(t)[status] : undefined;
  const resolved = tone ?? label?.tone ?? "neutral";
  const showDot = dot ?? (Boolean(status) || resolved === "success" || resolved === "warning" || resolved === "danger");
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium leading-4 ${tones[resolved]} ${className}`}>
      {showDot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children ?? label?.text ?? status}
    </span>
  );
}
