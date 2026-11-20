"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatTenge } from "@/lib/ui/format";
import { TWEEN_ENTER } from "@/lib/ui/motion";
import type { AttackBreakdownItem, SocTypeFilter } from "./socHelpers";

interface AttackBreakdownChartProps {
  items: readonly AttackBreakdownItem[];
  totalAttacks: number;
  preventedTamperAmountTenge?: number;
  activeFilter: SocTypeFilter;
  onSelectCategory: (category: SocTypeFilter) => void;
  projectorMode?: boolean;
}

export function AttackBreakdownChart({
  items,
  totalAttacks,
  preventedTamperAmountTenge,
  activeFilter,
  onSelectCategory,
  projectorMode = false,
}: AttackBreakdownChartProps) {
  const { t } = useT();
  const reduce = useReducedMotion();
  const rowHeight = projectorMode ? 40 : 32;
  const maxCount = Math.max(1, ...items.map(item => item.count));
  const countWidth = `${maxCount.toLocaleString("ru-KZ").length}ch`;
  const hasSelection = items.some(item => item.key === activeFilter);

  return (
    <Card className="h-full" heading={
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className={projectorMode ? "text-xl font-medium" : "type-h2"}>{t("attackBreakdownChart.breakdown")}</h2>
        <div className="flex items-center gap-3">
          {hasSelection && (
            <Button size="sm" variant="ghost" onClick={() => onSelectCategory("ALL")}>
              {t("attackBreakdownChart.showAll")}
            </Button>
          )}
          <span className="mono-data text-ink-muted">{t("attackBreakdownChart.total")} {totalAttacks.toLocaleString("ru-KZ")}</span>
        </div>
      </div>
    }>
      <svg width="100%" height={items.length * rowHeight} role="group"
        aria-label={t("attackBreakdownChart.chart", { totalAttacks })} className="block overflow-visible">
        {items.map((item, index) => {
          const selected = activeFilter === item.key;
          const accent = selected || (!hasSelection && index === 0 && item.count > 0);
          const toggle = () => onSelectCategory(selected ? "ALL" : item.key);
          return (
            <g key={item.key} role="button" tabIndex={0} aria-pressed={selected}
              aria-label={t("attackBreakdownChart.filterBar", { label: item.label, count: item.count, sharePercent: item.sharePercent })}
              onClick={toggle} onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }}
              className="group cursor-pointer">
              <foreignObject x="0" y={index * rowHeight} width="100%" height={rowHeight}>
                <div className={`grid h-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[1fr_4px] items-center gap-x-2 rounded-lg px-2 pb-1 transition-colors group-hover:bg-surface-hover group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-bcc md:grid-cols-[38%_minmax(0,1fr)_auto] md:grid-rows-1 md:gap-x-4 md:pb-0 ${selected ? "bg-elevated" : ""}`}>
                  <span title={item.label} className={`truncate ${projectorMode ? "text-base" : "text-sm"} ${accent ? "font-medium text-bcc" : "text-ink-secondary"}`}>
                    <span className="md:hidden">{item.shortLabel}</span>
                    <span className="hidden md:inline">{item.label}</span>
                  </span>
                  <span aria-hidden="true" className="order-last col-span-2 h-1 bg-border-default md:order-none md:col-span-1">
                    <motion.span className="block h-full" initial={false}
                      style={{ originX: 0, backgroundColor: accent ? "var(--accent-primary)" : item.color }}
                      animate={{ scaleX: item.count / maxCount }} transition={reduce ? { duration: 0 } : TWEEN_ENTER} />
                  </span>
                  <span className={`flex items-baseline justify-end gap-2 font-mono tabular-nums ${projectorMode ? "text-base" : "text-sm"}`}>
                    <span className="text-right text-ink-primary" style={{ minWidth: countWidth }}>
                      {item.count.toLocaleString("ru-KZ")}
                    </span>
                    <span className="w-[4ch] text-right text-xs text-ink-muted">{item.sharePercent}%</span>
                  </span>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-xs leading-4 text-ink-muted">
        {preventedTamperAmountTenge !== undefined && (
          <p className="font-mono tabular-nums">{t("socDashboard.tampering")} {formatTenge(preventedTamperAmountTenge)}</p>
        )}
        <p>{t("attackBreakdownChart.filterHint")}</p>
      </div>
    </Card>
  );
}
