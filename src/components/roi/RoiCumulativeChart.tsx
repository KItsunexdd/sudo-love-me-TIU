"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/shell/LocaleProvider";
import { Card } from "@/components/ui/Card";
import { formatCompactTenge, type RoiMonthlyPoint } from "@/lib/roi/calc";

interface RoiCumulativeChartProps {
  points: readonly RoiMonthlyPoint[];
}

const series = [
  { key: "fraudCumulative", label: "roiCumulativeChart.fraud", ink: "text-ink-muted", dashed: true },
  { key: "smsCumulative", label: "roiCumulativeChart.sms", ink: "text-ink-secondary", dashed: false },
  { key: "totalCumulative", label: "common.total", ink: "text-bcc", dashed: false },
] as const;
const legendSeries = [...series].reverse();

function axisTicks(maximum: number) {
  const targetStep = Math.max(1, maximum / 4);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = ([1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= targetStep) ?? 10) * magnitude;
  const intervals = Math.max(1, Math.ceil(maximum / step));
  return Array.from({ length: intervals + 1 }, (_, index) => index * step);
}

export function RoiCumulativeChart({ points }: RoiCumulativeChartProps) {
  const { t } = useT();
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [selectedIndex, setSelectedIndex] = useState(11);
  const index = Math.min(selectedIndex, points.length - 1);
  const activePoint = points[index];

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  const ticks = axisTicks(Math.max(0, ...points.map(point => point.totalCumulative)));
  const tickLabels = ticks.map(formatCompactTenge);
  const max = ticks[ticks.length - 1];
  const height = width < 480 ? 244 : 320;
  const bottom = height - 28;
  const top = 8;
  const left = 12 + 8 * Math.max(...tickLabels.map(label => label.length));
  const right = width - 16;
  const step = (right - left) / Math.max(1, points.length - 1);
  const x = (i: number) => left + i * step;
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const labelInterval = Math.max(1, Math.ceil(36 / Math.max(1, step)));

  return (
    <Card
      heading={
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="type-h2">{t("roiCumulativeChart.heading")}</h2>
          <span className="font-mono text-xs text-ink-muted">{t("roiCumulativeChart.linear")}</span>
        </div>
      }
    >
      <div ref={plotRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="group"
          aria-label={t("roiCumulativeChart.chart")}
          className="block w-full select-none font-mono text-xs tabular-nums"
        >
          {ticks.map((tick, i) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="stroke-border-default" />
              <text x={left - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-muted">
                {tickLabels[i]}
              </text>
            </g>
          ))}

          {activePoint && (
            <line x1={x(index)} x2={x(index)} y1={top} y2={bottom} className="stroke-ink-disabled" />
          )}

          {series.map(({ key, ink, dashed }) => (
            <g key={key} className={ink}>
              <polyline
                points={points.map((point, i) => `${x(i)},${y(point[key])}`).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth={key === "totalCumulative" ? 2.5 : 1.5}
                strokeDasharray={dashed ? "4 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {activePoint && (
                <circle cx={x(index)} cy={y(activePoint[key])} r={3.5} className="fill-surface" stroke="currentColor" strokeWidth={2} />
              )}
            </g>
          ))}

          {points.map((point, i) => {
            const last = i === points.length - 1;
            const zoneStart = i === 0 ? left - 8 : x(i) - step / 2;
            const zoneEnd = last ? right + 8 : x(i) + step / 2;
            const showLabel = i === 0 || last || (i % labelInterval === 0 && right - x(i) >= 28);
            return (
              <g key={point.month}>
                {showLabel && (
                  <text x={x(i)} y={height - 8} textAnchor="middle" className={i === index ? "fill-ink-primary" : "fill-ink-muted"}>
                    {point.shortLabel}
                  </text>
                )}
                <rect
                  x={zoneStart}
                  y={top}
                  width={zoneEnd - zoneStart}
                  height={height - top - 2}
                  fill="transparent"
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-bcc"
                  role="button"
                  tabIndex={0}
                  aria-pressed={i === index}
                  aria-label={t("roiCumulativeChart.point", {
                    label: point.label,
                    value: formatCompactTenge(point.smsCumulative),
                    value2: formatCompactTenge(point.totalCumulative),
                  })}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onFocus={() => setSelectedIndex(i)}
                  onClick={() => setSelectedIndex(i)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIndex(i);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {activePoint && (
        <div className="mt-3 border-t border-border-default pt-3">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="mono-data text-ink-primary">{activePoint.label}</span>
            <p className="type-micro text-ink-muted">{t("roiCumulativeChart.selectMonth")}</p>
          </div>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
            {legendSeries.map(({ key, label, ink, dashed }) => (
              <div key={key} className="flex items-baseline justify-between gap-3 sm:block">
                <dt className="type-micro flex items-center gap-2 text-ink-secondary">
                  <span aria-hidden="true" className={`w-4 shrink-0 border-t-2 ${ink} ${dashed ? "border-dashed" : ""} border-current`} />
                  {t(label)}
                </dt>
                <dd className="mono-data text-ink-secondary sm:mt-1 sm:pl-6">{formatCompactTenge(activePoint[key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}
