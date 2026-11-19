"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { shortHash } from "@/lib/ui/format";

export function HashChip({ value, label = "SHA-256", tone = "success", visible = 8 }: {
  value: string; label?: string; tone?: "success" | "info" | "danger"; visible?: number;
}) {
  const [feedback, setFeedback] = useState<"copied" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const color = { success: "text-bcc", info: "text-quantum", danger: "text-danger-text" }[tone];

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
    <span title={value} className="mono-data inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border-default bg-terminal px-2.5 py-1.5">
      {label && <span className="text-ink-muted">{label}</span>}
      <code className={`min-w-0 break-all ${color}`}>{shortHash(value, visible)}</code>
      <button type="button" aria-label="Скопировать полный хэш" onClick={() => void copy()}
        className="rounded p-1 text-ink-secondary hover:bg-elevated">
        {feedback === "copied" ? <Check aria-hidden="true" className="size-3.5 text-bcc" /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
      <span role="status">
        {feedback === "copied" && <span className="text-bcc">Скопировано</span>}
        {feedback === "error" && <span className="text-danger-text">Копирование недоступно</span>}
      </span>
    </span>
  );
}
