"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useId, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatCompactTenge, type RoiMonthlyPoint } from "@/lib/roi/calc";

interface RoiCumulativeChartProps {
  points: readonly RoiMonthlyPoint[];
}

const WIDTH = 680;
const HEIGHT = 250;
const PAD = { top: 20, right: 20, bottom: 34, left: 78 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function formatAxisTick(value: number): string {
  if (value <= 0) return "0";
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    return `${billions.toLocaleString("ru-KZ", { maximumFractionDigits: 1 })} млрд`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toLocaleString("ru-KZ", { maximumFractionDigits: 0 })} млн`;
  }
  return value.toLocaleString("ru-KZ", { maximumFractionDigits: 0 });
}

export function RoiCumulativeChart({ points }: RoiCumulativeChartProps) {
  const { t } = useT();
  const uid = useId();
  const [selectedIndex, setSelectedIndex] = useState(11);
  const safeIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, points.length - 1));
  const activePoint = points[safeIndex];

  const maxTotal = Math.max(1, ...points.map(p => p.totalCumulative));
  const yMax = maxTotal * 1.08;

  const xAt = (index: number) =>
    points.length <= 1 ? PAD.left : PAD.left + (index / (points.length - 1)) * PLOT_W;
  const yAt = (val: number) => PAD.top + PLOT_H - (Math.max(0, val) / yMax) * PLOT_H;

  const smsCoords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.smsCumulative) }));
  const totalCoords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.totalCumulative) }));

  const linePath = (coords: { x: number; y: number }[]) =>
    coords.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");

  const areaPath = (coords: { x: number; y: number }[]) => {
    if (!coords.length) return "";
    const baseline = (PAD.top + PLOT_H).toFixed(1);
    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    return `${linePath(coords)} L${lastX},${baseline} L${firstX},${baseline} Z`;
  };

  const gridTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    value: yMax * ratio,
    y: PAD.top + PLOT_H * (1 - ratio),
  }));

  const smsGradId = `${uid}-sms-grad`;
  const totalGradId = `${uid}-total-grad`;
  const stepWidth = PLOT_W / Math.max(1, points.length - 1);

  return (
    <Card
      heading={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="type-h2">{t("roiCumulativeChart.heading")}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {t("roiCumulativeChart.selectMonth")}
            </p>
          </div>
          {activePoint && (
            <Badge tone="neutral" className="font-mono tabular-nums">
              {activePoint.label}
            </Badge>
          )}
        </div>
      }
      divided
    >
      {activePoint && (
        <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-border-subtle bg-terminal px-3.5 py-2.5 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span aria-hidden="true" className="size-2 rounded-full bg-bcc" />
              {t("roiCumulativeChart.sms")}
            </div>
            <div className="mono-data mt-0.5 font-bold text-bcc">
              {formatCompactTenge(activePoint.smsCumulative)}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span aria-hidden="true" className="size-2 rounded-full bg-gold" />
              {t("roiCumulativeChart.fraud")}
            </div>
            <div className="mono-data mt-0.5 font-bold text-amber-300">
              {formatCompactTenge(activePoint.fraudCumulative)}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <span aria-hidden="true" className="size-2 rounded-full bg-quantum" />
              {t("common.total")}
            </div>
            <div className="mono-data mt-0.5 font-bold text-ink-primary">
              {formatCompactTenge(activePoint.totalCumulative)}
            </div>
          </div>
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={t("roiCumulativeChart.chart")}
          className="h-auto w-full min-w-[460px] select-none"
        >
          <defs>
            <linearGradient id={totalGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={smsGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00D084" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#00D084" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {gridTicks.map((tick, index) => (
            <g key={index}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={tick.y}
                y2={tick.y}
                stroke="#152B24"
                strokeDasharray={index === 0 ? undefined : "4 4"}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={tick.y + 4}
                textAnchor="end"
                fill="#7FA397"
                fontSize={12}
                fontFamily="var(--font-mono)"
              >
                {formatAxisTick(tick.value)}
              </text>
            </g>
          ))}

          {/* Совокупный эффект (OpEx + фрод) */}
          <path d={areaPath(totalCoords)} fill={`url(#${totalGradId})`} />
          <path
            d={linePath(totalCoords)}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Прямая экономия банка (OpEx на SMS) */}
          <path d={areaPath(smsCoords)} fill={`url(#${smsGradId})`} />
          <path
            d={linePath(smsCoords)}
            fill="none"
            stroke="#00D084"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Вертикальный индикатор активного месяца */}
          {totalCoords[safeIndex] && smsCoords[safeIndex] && (
            <g>
              <line
                x1={totalCoords[safeIndex].x}
                x2={totalCoords[safeIndex].x}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="#2B5447"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <circle
                cx={totalCoords[safeIndex].x}
                cy={totalCoords[safeIndex].y}
                r={5.5}
                fill="#07110E"
                stroke="#F59E0B"
                strokeWidth={2.5}
              />
              <circle
                cx={smsCoords[safeIndex].x}
                cy={smsCoords[safeIndex].y}
                r={5.5}
                fill="#07110E"
                stroke="#00D084"
                strokeWidth={2.5}
              />
            </g>
          )}

          {/* Подписи месяцев и интерактивные зоны */}
          {points.map((point, index) => {
            const cx = xAt(index);
            const active = index === safeIndex;
            const zoneX = index === 0 ? PAD.left : cx - stepWidth / 2;
            const zoneW = index === 0 || index === points.length - 1 ? stepWidth / 2 : stepWidth;
            return (
              <g key={point.month}>
                <text
                  x={cx}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  fill={active ? "#F0FDF8" : "#7FA397"}
                  fontSize={12}
                  fontWeight={active ? 700 : 500}
                  fontFamily="var(--font-mono)"
                >
                  {point.shortLabel}
                </text>
                <rect
                  x={zoneX}
                  y={PAD.top}
                  width={Math.max(16, zoneW)}
                  height={PLOT_H + 28}
                  fill="transparent"
                  className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-bcc"
                  role="button"
                  tabIndex={0}
                  aria-label={t("roiCumulativeChart.point", { label: point.label, value: formatCompactTenge(point.smsCumulative), value2: formatCompactTenge(point.totalCumulative) })}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onFocus={() => setSelectedIndex(index)}
                  onClick={() => setSelectedIndex(index)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded bg-bcc" />
            {t("common.direct")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded bg-gold" />
            {t("roiCumulativeChart.combined")}
          </span>
        </div>
        <span className="font-mono text-ink-muted">{t("roiCumulativeChart.linear")}</span>
      </div>
    </Card>
  );
}
