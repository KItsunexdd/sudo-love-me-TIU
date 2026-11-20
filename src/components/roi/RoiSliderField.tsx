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
  /** Base units per unit displayed in the number input. */
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
  onChange,
}: RoiSliderFieldProps) {
  const sliderId = useId();
  const numberId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const clampedForTrack = Math.min(max, Math.max(min, value));
  const share = max > min ? (clampedForTrack - min) / (max - min) : 0;

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
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <label htmlFor={sliderId} className="flex min-h-8 items-center gap-2 text-sm font-medium text-ink-primary">
          <span className="w-3 shrink-0 font-mono text-xs font-normal text-ink-muted">{symbol}</span>
          <span>{label}</span>
        </label>
        <div className="flex h-8 items-center gap-1 rounded-lg border border-border-default bg-elevated px-2 transition-colors hover:border-border-strong focus-within:border-bcc">
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
            className="w-[8ch] rounded-sm bg-transparent text-right font-mono text-sm tabular-nums text-ink-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="select-none whitespace-nowrap font-mono text-xs text-ink-muted">{inputUnit ?? unit}</span>
        </div>
        {hint && <p className="type-micro col-span-2 pl-5 text-ink-muted">{hint}</p>}
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

        <div aria-hidden="true" className="pointer-events-none relative mx-1.5 h-0.5 flex-1 bg-border-strong peer-focus-visible:ring-2 peer-focus-visible:ring-bcc peer-focus-visible:ring-offset-4 peer-focus-visible:ring-offset-surface">
          <div className="h-full origin-left bg-bcc" style={{ transform: `scaleX(${share})` }} />
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bcc"
            style={{ left: `${share * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums text-ink-muted">
        <span>{formatBound(min)}</span>
        <span className="text-center text-ink-secondary">{formatValue(value)}</span>
        <span>{formatBound(max)}</span>
      </div>
    </div>
  );
}
