"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useId, type ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  variant?: "default" | "attack";
  disabled?: boolean;
  description?: string;
}

export function Toggle({ checked, onChange, label, variant = "default", disabled, description }: ToggleProps) {
  const { t } = useT();
  const id = useId();
  const armed = variant === "attack" && checked;
  const track = armed ? "border-danger-solid bg-danger-solid" : checked ? "border-bcc bg-bcc" : "border-border-strong bg-terminal";
  return (
    <div className="flex items-center gap-3">
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:opacity-45 ${track}`}>
        <span aria-hidden="true"
          className={`size-3.5 rounded-full bg-ink-primary transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
      <span className="min-w-0 text-sm text-ink-secondary">
        <span id={`${id}-label`} className="text-ink-primary">{label}</span>
        {description && <span id={`${id}-description`} className="mt-0.5 block text-xs">{description}</span>}
      </span>
      {armed && <span className="font-mono text-xs text-danger-text">{t("toggle.on")}</span>}
    </div>
  );
}
