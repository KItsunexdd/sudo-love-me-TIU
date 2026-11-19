"use client";

import { useId, useState } from "react";

interface RoiSliderFieldProps {
  symbol: "U" | "N" | "P" | "M" | "F" | "R";
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Масштаб для поля ручного ввода (например, 1_000_000 для ввода в млн ₸) */
  inputScale?: number;
  inputUnit?: string;
  formatValue: (value: number) => string;
  formatBound: (value: number) => string;
  tone?: "emerald" | "gold";
  onChange: (next: number) => void;
}

export function RoiSliderField({
  symbol,
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  inputScale = 1,
  inputUnit,
  formatValue,
  formatBound,
  tone = "emerald",
  onChange,
}: RoiSliderFieldProps) {
  const sliderId = useId();
  const numberId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const clampedForTrack = Math.min(max, Math.max(min, value));
  const percent = max > min ? ((clampedForTrack - min) / (max - min)) * 100 : 0;

  const isGold = tone === "gold";
  const accentFill = isGold ? "bg-gold" : "bg-bcc";
  const accentBadge = isGold
    ? "border-gold/40 bg-gold/15 text-amber-300"
    : "border-bcc/40 bg-bcc/[.12] text-emerald-300";
  const thumbShadow = isGold
    ? "border-gold bg-[#04120D] shadow-glow-gold"
    : "border-bcc bg-[#04120D] shadow-glow-bcc";
  const dotColor = isGold ? "bg-gold" : "bg-bcc";

  const scaledValue = value / inputScale;
  const displayInput = draft ?? String(Number(scaledValue.toFixed(2)));
  const scaledMax = max / inputScale;
  const scaledStep = step / inputScale;

  function commitNumber(rawText: string) {
    const normalized = rawText.replace(/\s+/g, "").replace(",", ".");
    if (!normalized) return;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return;
    const rawValue = parsed * inputScale;
    const bounded = Math.min(max * 2, Math.max(0, rawValue));
    onChange(inputScale >= 1 ? Math.round(bounded) : bounded);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={sliderId} className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-bold ${accentBadge}`}>
              {symbol}
            </span>
            <span className="leading-snug">{label}</span>
          </label>
          {hint && <p className="mt-0.5 pl-8 text-xs text-ink-muted">{hint}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center rounded-xl border border-border-default bg-terminal px-2.5 py-1 transition-colors hover:border-border-strong focus-within:border-bcc/70 focus-within:ring-2 focus-within:ring-bcc/45">
            <label htmlFor={numberId} className="sr-only">
              {label} ({inputUnit ?? unit})
            </label>
            <input
              id={numberId}
              type="number"
              inputMode="decimal"
              min={0}
              max={scaledMax * 2}
              step={scaledStep}
              value={displayInput}
              onFocus={() => setDraft(String(Number(scaledValue.toFixed(2))))}
              onChange={event => {
                const nextText = event.target.value;
                setDraft(nextText);
                commitNumber(nextText);
              }}
              onBlur={() => {
                if (draft !== null) {
                  const normalized = draft.replace(/\s+/g, "").replace(",", ".");
                  const parsed = Number(normalized);
                  if (Number.isFinite(parsed)) {
                    const bounded = Math.min(max, Math.max(min, parsed * inputScale));
                    onChange(Math.round(bounded));
                  }
                }
                setDraft(null);
              }}
              className="w-24 bg-transparent text-right font-mono text-sm font-semibold tabular-nums text-ink-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="ml-1.5 select-none font-mono text-xs text-ink-muted">{inputUnit ?? unit}</span>
          </div>
        </div>
      </div>

      <div className="relative flex h-7 items-center">
        <input
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampedForTrack}
          aria-valuetext={formatValue(value)}
          onChange={event => {
            setDraft(null);
            onChange(event.currentTarget.valueAsNumber);
          }}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />

        <div aria-hidden="true" className="relative h-2 w-full overflow-hidden rounded-full border border-border-default bg-terminal peer-focus-visible:ring-2 peer-focus-visible:ring-bcc/80 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface">
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${accentFill}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 transition-[left,transform] duration-75 peer-focus-visible:scale-110 ${thumbShadow}`}
          style={{ left: `${percent}%` }}
        >
          <span className={`size-2 rounded-full ${dotColor}`} />
        </div>
      </div>

      <div className="flex items-center justify-between font-mono text-xs tabular-nums text-ink-muted">
        <span>{formatBound(min)}</span>
        <span className="font-semibold text-ink-secondary">{formatValue(value)}</span>
        <span>{formatBound(max)}</span>
      </div>
    </div>
  );
}
