"use client";

import { motion, useReducedMotion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { AttackBreakdownItem, SocTypeFilter } from "./socHelpers";

interface AttackBreakdownChartProps {
  items: readonly AttackBreakdownItem[];
  totalAttacks: number;
  activeFilter: SocTypeFilter;
  onSelectCategory: (category: SocTypeFilter) => void;
  projectorMode?: boolean;
}

const SVG_WIDTH = 560;
const LABEL_WIDTH = 152;
const VALUE_WIDTH = 74;
const BAR_MAX_WIDTH = SVG_WIDTH - LABEL_WIDTH - VALUE_WIDTH - 16;

export function AttackBreakdownChart({
  items,
  totalAttacks,
  activeFilter,
  onSelectCategory,
  projectorMode = false,
}: AttackBreakdownChartProps) {
  const reduce = useReducedMotion();
  const rowHeight = projectorMode ? 42 : 34;
  const barHeight = projectorMode ? 18 : 14;
  const svgHeight = Math.max(180, items.length * rowHeight + 16);
  const maxCount = Math.max(1, ...items.map(item => item.count));

  return (
    <Card
      heading={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 aria-hidden="true" className="size-5 text-bcc" />
            <h2 className="type-h2">Разбивка атак по типам</h2>
          </div>
          <div className="flex items-center gap-2">
            {activeFilter !== "ALL" && activeFilter !== "OPERATIONS" && (
              <button
                type="button"
                onClick={() => onSelectCategory("ALL")}
                className="rounded-lg border border-border-strong bg-elevated px-2.5 py-1 text-xs font-semibold text-ink-secondary hover:text-ink-primary"
              >
                Показать все
              </button>
            )}
            <Badge tone={totalAttacks > 0 ? "danger" : "neutral"} className="font-mono tabular-nums">
              Всего: {totalAttacks}
            </Badge>
          </div>
        </div>
      }
      divided
    >
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
          role="img"
          aria-label={`Распределение отражённых атак по типам: всего ${totalAttacks}`}
          className="h-auto w-full min-w-[420px] select-none"
        >
          {/* Тонкие вертикальные направляющие */}
          {[0.25, 0.5, 0.75, 1].map(step => {
            const x = LABEL_WIDTH + BAR_MAX_WIDTH * step;
            return (
              <line
                key={step}
                x1={x}
                x2={x}
                y1={6}
                y2={svgHeight - 8}
                stroke="#152B24"
                strokeDasharray="3 4"
                strokeWidth={1}
              />
            );
          })}

          {items.map((item, index) => {
            const y = 8 + index * rowHeight;
            const barY = y + (rowHeight - barHeight) / 2;
            const ratio = item.count > 0 ? Math.max(0.05, item.count / maxCount) : 0;
            const barWidth = BAR_MAX_WIDTH * ratio;
            const selected = activeFilter === item.key;
            const dimmed = activeFilter !== "ALL" && activeFilter !== "OPERATIONS" && !selected;

            return (
              <g
                key={item.key}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${item.label}: ${item.count} (${item.sharePercent}%). Нажмите, чтобы отфильтровать таблицу.`}
                onClick={() => onSelectCategory(selected ? "ALL" : item.key)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectCategory(selected ? "ALL" : item.key);
                  }
                }}
                className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-bcc"
                style={{ opacity: dimmed ? 0.45 : 1 }}
              >
                {/* Подсветка активной строки */}
                <rect
                  x={0}
                  y={y + 2}
                  width={SVG_WIDTH}
                  height={rowHeight - 4}
                  rx={8}
                  fill={selected ? "rgba(0, 208, 132, 0.10)" : "transparent"}
                  stroke={selected ? "rgba(0, 208, 132, 0.40)" : "transparent"}
                  strokeWidth={1}
                />

                {/* Цветная точка и название типа атаки */}
                <circle
                  cx={12}
                  cy={y + rowHeight / 2}
                  r={4.5}
                  fill={item.color}
                />
                <text
                  x={24}
                  y={y + rowHeight / 2 + 4.5}
                  fill={selected ? "#F0FDF8" : "#A7C4BA"}
                  fontSize={projectorMode ? 14 : 13}
                  fontWeight={selected ? 700 : 600}
                  fontFamily="var(--font-sans)"
                >
                  {item.shortLabel}
                </text>

                {/* Трек */}
                <rect
                  x={LABEL_WIDTH}
                  y={barY}
                  width={BAR_MAX_WIDTH}
                  height={barHeight}
                  rx={barHeight / 2}
                  fill="#050C0A"
                  stroke="#1C382F"
                  strokeWidth={1}
                />

                {/* Заполнение столбца */}
                {item.count > 0 && (
                  <motion.rect
                    x={LABEL_WIDTH}
                    y={barY}
                    height={barHeight}
                    rx={barHeight / 2}
                    fill={item.color}
                    initial={reduce ? { width: barWidth } : { width: 0 }}
                    animate={{ width: barWidth }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 28 }}
                  />
                )}

                {/* Значение и доля */}
                <text
                  x={SVG_WIDTH - 8}
                  y={y + rowHeight / 2 + 4.5}
                  textAnchor="end"
                  fill={item.count > 0 ? "#F0FDF8" : "#7FA397"}
                  fontSize={projectorMode ? 14 : 13}
                  fontWeight={700}
                  fontFamily="var(--font-mono)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {item.count > 0 ? `${item.count} (${item.sharePercent}%)` : "0"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        Нажмите на любой столбец, чтобы отфильтровать таблицу инцидентов по этому вектору атаки.
      </p>
    </Card>
  );
}
