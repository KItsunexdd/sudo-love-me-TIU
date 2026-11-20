"use client";

import type { MessageKey } from "@/lib/i18n";
import { failureText } from "@/lib/i18n/server-text";
import { useT } from "@/components/shell/LocaleProvider";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "./Card";

const copy: Partial<Record<string, [title: MessageKey, description: MessageKey]>> = {
  ERR_TX_NOT_FOUND: ["errorCard.missing", "errorCard.missingHint"],
  ERR_TX_EXPIRED: ["errorCard.expired", "errorCard.expiredHint"],
  ERR_REPLAY_DETECTED: ["errorCard.replay", "errorCard.replayHint"],
  ERR_WYSIWYS_TAMPERED: ["errorCard.tampered", "errorCard.tamperedHint"],
  ERR_ORIGIN_MISMATCH: ["errorCard.phishing", "errorCard.phishingHint"],
  ERR_WEBAUTHN_INVALID: ["errorCard.deviceInvalid", "errorCard.deviceInvalidHint"],
  ERR_PQ_SIGNATURE_INVALID: ["errorCard.pqInvalid", "errorCard.pqHint"],
  ERR_COSIGN_SIGNATURE_INVALID: ["errorCard.secondInvalid", "errorCard.secondHint"],
  ERR_COSIGN_ALREADY_DECIDED: ["errorCard.decided", "errorCard.decidedHint"],
  ERR_ACCOUNT_COOLING_OFF: ["errorCard.cooling", "errorCard.coolingHint"],
  ERR_DEVICE_NOT_REGISTERED: ["errorCard.unbound", "errorCard.unboundHint"],
  ERR_WEBAUTHN_CANCELLED: ["errorCard.cancelled", "errorCard.cancelledHint"],
  ERR_WEBAUTHN_UNSUPPORTED: ["errorCard.unsupported", "errorCard.unsupportedHint"],
  ERR_VALIDATION_FAILED: ["errorCard.invalidInput", "errorCard.invalidHint"],
  ERR_NETWORK_TIMEOUT: ["errorCard.timeout", "errorCard.timeoutHint"],
  ERR_NETWORK: ["errorCard.network", "errorCard.timeoutHint"],
  ERR_TX_STATE: ["errorCard.state", "errorCard.stateHint"],
  ERR_USER_NOT_FOUND: ["errorCard.noUser", "errorCard.noUserHint"],
  ERR_COSIGNER: ["errorCard.forbidden", "errorCard.forbiddenHint"],
  ERR_INSUFFICIENT_FUNDS: ["errorCard.funds", "errorCard.fundsHint"],
  ERR_ACK_REQUIRED: ["errorCard.ack", "errorCard.ackHint"],
  ERR_SIMULATION_ONLY: ["errorCard.diagnostic", "errorCard.diagnosticHint"],
  ERR_STORAGE: ["errorCard.storage", "errorCard.storageHint"],
};

const aliases: Record<string, string> = {
  ERR_DEVICE_NOT_FOUND: "ERR_DEVICE_NOT_REGISTERED",
  ERR_COOLING_OFF: "ERR_ACCOUNT_COOLING_OFF",
  ERR_INVALID_INPUT: "ERR_VALIDATION_FAILED",
};

export function ErrorCard({ error, title, action, children, className = "" }: {
  error: { status?: string; failureCode: string; message: string };
  title?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}) {
  const { locale, t } = useT();
  const code = Object.hasOwn(aliases, error.failureCode) ? aliases[error.failureCode] : error.failureCode;
  const known = Object.hasOwn(copy, code) ? copy[code] : undefined;
  return (
    <Card variant="danger" role="alert" className={className}>
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-danger-text" strokeWidth={1.75} />
        <div className="min-w-0 space-y-2">
          <h3 className="type-h3">{title ?? t(known?.[0] ?? "errorCard.failed")}</h3>
          <p className="text-sm text-ink-secondary">{known ? t(known[1]) : (failureText(locale, error.failureCode, error.message) || t("errorCard.retry"))}</p>
          <p className="break-all font-mono text-[0.8125rem] text-danger-text">{error.failureCode}</p>
          {children}
          {action && <div className="pt-1">{action}</div>}
        </div>
      </div>
    </Card>
  );
}
