"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { fingerprint } from "@/lib/ui/format";

/**
 * The product's signature detail: a digest printed as a fingerprint in mono, the same on the phone,
 * in the signing dialog, in the server trace, on the second hand and in SOC. Only a mismatch turns red.
 */
export function HashChip({ value, label = "SHA-256", tone = "success", visible = 8 }: {
  value: string; label?: string; tone?: "success" | "info" | "danger"; visible?: number;
}) {
  const { t } = useT();
  const [feedback, setFeedback] = useState<"copied" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mismatch = tone === "danger";

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("copied");
    } catch {
      setFeedback("error");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 1_500);
  }

  return (
    <span title={value}
      className={`inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-terminal py-1 pl-2 pr-1 ${mismatch ? "border-danger/45" : "border-border-default"}`}>
      {label && <span className="text-xs text-ink-muted">{label}</span>}
      <code className={`fingerprint min-w-0 break-all ${mismatch ? "text-danger-text" : "text-ink-primary"}`}>{fingerprint(value, visible <= 5 ? 1 : 2)}</code>
      <button type="button" aria-label={t("hashChip.copy", { value: label || t("hashChip.hash") })} onClick={() => void copy()}
        className="rounded p-1 text-ink-muted transition-colors hover:bg-elevated hover:text-ink-primary">
        {feedback === "copied" ? <Check aria-hidden="true" className="size-3.5 text-bcc" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
      <span role="status" className="text-xs">
        {feedback === "copied" && <span className="text-bcc">{t("hashChip.copied")}</span>}
        {feedback === "error" && <span className="text-danger-text">{t("hashChip.clipboard")}</span>}
      </span>
    </span>
  );
}
