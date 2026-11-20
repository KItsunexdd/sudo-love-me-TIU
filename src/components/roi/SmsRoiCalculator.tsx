"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  Building2,
  Calculator,
  Info,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  calcRoi,
  detectPreset,
  formatCompactCount,
  formatCompactTenge,
  ROI_DEFAULTS,
  getRoiPresets,
  ROI_RANGES,
  type RoiInputs,
  type RoiPresetId,
} from "@/lib/roi/calc";
import { formatTenge } from "@/lib/ui/format";
import { RoiAnimatedNumber } from "./RoiAnimatedNumber";
import { RoiCumulativeChart } from "./RoiCumulativeChart";
import { RoiSliderField } from "./RoiSliderField";

export function SmsRoiCalculator() {
  const { locale, t } = useT();
  const presets = useMemo(() => getRoiPresets(t), [t]);
  const [inputs, setInputs] = useState<RoiInputs>(ROI_DEFAULTS);
  const reduce = useReducedMotion();

  const result = useMemo(() => calcRoi(inputs, t), [inputs, t]);
  const activePreset = useMemo(() => detectPreset(result.inputs), [result.inputs]);

  function updateField<K extends keyof RoiInputs>(key: K, value: RoiInputs[K]) {
    setInputs(previous => ({ ...previous, [key]: value }));
  }

  function applyPreset(presetId: RoiPresetId) {
    const found = presets.find(preset => preset.id === presetId);
    if (found) setInputs(found.inputs);
  }

  const remainingSmsShare = Math.max(0, 100 - result.inputs.migrationPercent);
  const afterBarWidth =
    result.yearlySmsCostBefore > 0
      ? Math.min(100, Math.max(0, (result.yearlySmsCostAfter / result.yearlySmsCostBefore) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* Шапка и пресеты */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bcc/40 bg-bcc/[.12] px-3 py-1 text-xs font-semibold text-emerald-300">
              <Calculator aria-hidden="true" className="size-3.5" />
              {t("smsRoiCalculator.economics")}
            </span>
            <Badge tone="info" className="font-mono">
              {t("smsRoiCalculator.noSms")}
            </Badge>
          </div>
          <h1 className="type-h1 mt-2">{t("smsRoiCalculator.heading")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            {t("smsRoiCalculator.intro")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("smsRoiCalculator.presets")} className="flex flex-wrap items-center gap-2">
            {presets.map(preset => {
              const selected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => applyPreset(preset.id)}
                  className={`rounded-xl border px-3.5 py-2 text-left transition duration-150 ${
                    selected
                      ? preset.id === "conservative"
                        ? "border-gold/50 bg-gold/15 text-amber-200 shadow-glow-gold"
                        : "border-bcc/55 bg-bcc/[.14] text-emerald-200 shadow-glow-bcc"
                      : "border-border-default bg-surface text-ink-secondary hover:border-border-strong hover:bg-elevated hover:text-ink-primary"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                    {preset.id === "base" && <BadgeCheck aria-hidden="true" className="size-4 text-bcc" />}
                    {preset.id === "optimistic" && <Sparkles aria-hidden="true" className="size-4 text-quantum" />}
                    <span>{preset.label}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-ink-muted">{preset.shortNote}</div>
                </button>
              );
            })}
          </div>

          {activePreset === "custom" && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="size-4" />}
              onClick={() => applyPreset("base")}
            >
              {t("smsRoiCalculator.reset")}
            </Button>
          )}
        </div>
      </div>

      {/* Основная сетка: параметры слева, эффект справа */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* Левая колонка — ползунки и поля */}
        <Card
          className="lg:col-span-5"
          heading={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-h2">{t("smsRoiCalculator.settings")}</h2>
              <Badge tone={activePreset === "custom" ? "warning" : "neutral"}>
                {activePreset === "custom"
                  ? t("smsRoiCalculator.custom")
                  : presets.find(p => p.id === activePreset)?.label}
              </Badge>
            </div>
          }
          divided
        >
          <div className="space-y-6">
            {/* Секция 1: OpEx на SMS */}
            <section aria-labelledby="roi-sms-params-heading" className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h3 id="roi-sms-params-heading" className="type-h3 text-emerald-300">
                  {t("smsRoiCalculator.traffic")}
                </h3>
                <span className="font-mono text-xs text-ink-muted">U × N × P × M%</span>
              </div>

              <RoiSliderField
                symbol="U"
                label={t("smsRoiCalculator.users")}
                hint={t("smsRoiCalculator.retail")}
                value={inputs.activeUsers}
                min={ROI_RANGES.activeUsers.min}
                max={ROI_RANGES.activeUsers.max}
                step={ROI_RANGES.activeUsers.step}
                unit={t("smsRoiCalculator.people")}
                formatValue={v => t("smsRoiCalculator.clientCount", { value: formatCompactCount(v, locale) })}
                formatBound={v => formatCompactCount(v, locale)}
                tone="emerald"
                onChange={v => updateField("activeUsers", v)}
              />

              <RoiSliderField
                symbol="N"
                label={t("smsRoiCalculator.smsPerClient")}
                hint={t("smsRoiCalculator.average")}
                value={inputs.smsPerUserMonth}
                min={ROI_RANGES.smsPerUserMonth.min}
                max={ROI_RANGES.smsPerUserMonth.max}
                step={ROI_RANGES.smsPerUserMonth.step}
                unit="SMS"
                formatValue={v => t("smsRoiCalculator.smsMonth", { value: Math.round(v) })}
                formatBound={v => `${v} SMS`}
                tone="emerald"
                onChange={v => updateField("smsPerUserMonth", v)}
              />

              <RoiSliderField
                symbol="P"
                label={t("smsRoiCalculator.smsCost")}
                hint={t("smsRoiCalculator.tariff")}
                value={inputs.smsCostTenge}
                min={ROI_RANGES.smsCostTenge.min}
                max={ROI_RANGES.smsCostTenge.max}
                step={ROI_RANGES.smsCostTenge.step}
                unit="₸"
                formatValue={v => `${Math.round(v)} ₸ / SMS`}
                formatBound={v => `${v} ₸`}
                tone="emerald"
                onChange={v => updateField("smsCostTenge", v)}
              />

              <RoiSliderField
                symbol="M"
                label={t("smsRoiCalculator.migration")}
                hint={t("smsRoiCalculator.remaining")}
                value={inputs.migrationPercent}
                min={ROI_RANGES.migrationPercent.min}
                max={ROI_RANGES.migrationPercent.max}
                step={ROI_RANGES.migrationPercent.step}
                unit="%"
                formatValue={v => t("smsRoiCalculator.share", { value: Math.round(v) })}
                formatBound={v => `${v}%`}
                tone="emerald"
                onChange={v => updateField("migrationPercent", v)}
              />
            </section>

            <hr className="border-border-subtle" />

            {/* Секция 2: Антифрод */}
            <section aria-labelledby="roi-fraud-params-heading" className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h3 id="roi-fraud-params-heading" className="type-h3 text-amber-300">
                  {t("smsRoiCalculator.antiFraud")}
                </h3>
                <span className="font-mono text-xs text-ink-muted">F × R%</span>
              </div>

              <RoiSliderField
                symbol="F"
                label={t("smsRoiCalculator.annualLoss")}
                hint={t("smsRoiCalculator.lossHint")}
                value={inputs.annualFraudLossTenge}
                min={ROI_RANGES.annualFraudLossTenge.min}
                max={ROI_RANGES.annualFraudLossTenge.max}
                step={ROI_RANGES.annualFraudLossTenge.step}
                unit="₸"
                inputScale={1_000_000}
                inputUnit={t("smsRoiCalculator.millions")}
                formatValue={v => formatCompactTenge(v)}
                formatBound={v => formatCompactTenge(v)}
                tone="gold"
                onChange={v => updateField("annualFraudLossTenge", v)}
              />

              <RoiSliderField
                symbol="R"
                label={t("smsRoiCalculator.prevention")}
                hint={t("smsRoiCalculator.preventionHint")}
                value={inputs.fraudPreventionPercent}
                min={ROI_RANGES.fraudPreventionPercent.min}
                max={ROI_RANGES.fraudPreventionPercent.max}
                step={ROI_RANGES.fraudPreventionPercent.step}
                unit="%"
                formatValue={v => t("smsRoiCalculator.lossShare", { value: Math.round(v) })}
                formatBound={v => `${v}%`}
                tone="gold"
                onChange={v => updateField("fraudPreventionPercent", v)}
              />
            </section>
          </div>
        </Card>

        {/* Правая колонка — раздельный финансовый эффект, сравнение и SVG-график */}
        <div className="space-y-5 lg:col-span-7">
          {/* РАЗДЕЛЬНЫЕ главные карточки (замечание аудитора питча) */}
          <div data-testid="roi-annual-savings" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card variant="success" className="flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone="success">
                    <Building2 aria-hidden="true" className="size-3.5" />
                    {t("smsRoiCalculator.profit")}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-emerald-300">
                    −{Math.round(result.inputs.migrationPercent)}% SMS
                  </span>
                </div>

                <h2 className="mt-3 text-sm font-semibold text-ink-secondary">
                  {t("common.direct")}
                </h2>

                <div className="display-hero mt-2 font-mono text-bcc">
                  <RoiAnimatedNumber value={result.yearlySmsSavings} format={formatCompactTenge} />
                </div>
                <p className="mono-data mt-1 text-ink-secondary">
                  {formatTenge(Math.round(result.yearlySmsSavings))} {t("smsRoiCalculator.year")}
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-bcc/20 pt-3">
                <div>
                  <dt className="text-xs text-ink-muted">{t("smsRoiCalculator.monthly")}</dt>
                  <dd className="mono-data mt-0.5 font-bold text-ink-primary">
                    <RoiAnimatedNumber value={result.monthlySmsSavings} format={formatCompactTenge} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{t("smsRoiCalculator.smsReplaced")}</dt>
                  <dd className="mono-data mt-0.5 font-bold text-emerald-300">
                    {formatCompactCount(result.yearlySmsReplaced, locale)}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card variant="warning" className="flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone="warning">
                    <ShieldCheck aria-hidden="true" className="size-3.5" />
                    {t("roi.smsRoiCalculator.antiFraud")}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-amber-300">
                    −{Math.round(result.inputs.fraudPreventionPercent)}{t("smsRoiCalculator.fraudShare")}
                  </span>
                </div>

                <h2 className="mt-3 text-sm font-semibold text-ink-secondary">
                  {t("smsRoiCalculator.saved")}
                </h2>

                <div className="display-hero mt-2 font-mono text-amber-300">
                  <RoiAnimatedNumber value={result.yearlyFraudSavings} format={formatCompactTenge} />
                </div>
                <p className="mono-data mt-1 text-ink-secondary">
                  {formatTenge(Math.round(result.yearlyFraudSavings))} {t("smsRoiCalculator.year")}
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gold/25 pt-3">
                <div>
                  <dt className="text-xs text-ink-muted">{t("smsRoiCalculator.monthly")}</dt>
                  <dd className="mono-data mt-0.5 font-bold text-ink-primary">
                    <RoiAnimatedNumber value={result.monthlyFraudSavings} format={formatCompactTenge} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{t("smsRoiCalculator.baseline")}</dt>
                  <dd className="mono-data mt-0.5 font-bold text-amber-200">
                    {formatCompactTenge(result.inputs.annualFraudLossTenge)}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          {/* Совокупный эффект (подписан отдельно, с пояснением) */}
          <Card variant="elevated" className="border-border-strong">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-quantum">
                    {t("common.total")}
                  </span>
                  <Badge tone="info">{t("smsRoiCalculator.combined")}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {t("smsRoiCalculator.totalHint")}
                </p>
              </div>

              <div className="shrink-0 sm:text-right">
                <div className="display-kpi text-ink-primary">
                  <RoiAnimatedNumber value={result.totalYearlyImpact} format={formatCompactTenge} />
                  <span className="ml-1.5 font-sans text-sm font-semibold text-ink-secondary">{t("smsRoiCalculator.year")}</span>
                </div>
                <div className="mono-data mt-0.5 text-ink-secondary">
                  ≈ <RoiAnimatedNumber value={result.monthlyTotalImpact} format={formatCompactTenge} /> {t("smsRoiCalculator.month")}
                </div>
              </div>
            </div>
          </Card>

          {/* Годовые расходы на SMS: До vs После */}
          <Card
            heading={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="type-h2 flex items-center gap-2">
                  <TrendingDown aria-hidden="true" className="size-5 text-bcc" />
                  {t("smsRoiCalculator.annualSms")}
                </h2>
                <Badge tone="success" className="font-mono tabular-nums">
                  {t("smsRoiCalculator.savings")} {formatCompactTenge(result.yearlySmsSavings)}{t("smsRoiCalculator.perYear")}
                </Badge>
              </div>
            }
            divided
          >
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-secondary">{t("smsRoiCalculator.now", { volume: formatCompactCount(result.monthlySmsVolumeBefore, locale) })}</span>
                  <span className="mono-data font-bold text-ink-primary">
                    {formatCompactTenge(result.yearlySmsCostBefore)} {t("smsRoiCalculator.year")}
                  </span>
                </div>
                <div className="h-3.5 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <div className="h-full w-full rounded-full bg-danger/75" />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-secondary">
                    {t("smsRoiCalculator.after", { share: remainingSmsShare })}
                  </span>
                  <span className="mono-data font-bold text-bcc">
                    {formatCompactTenge(result.yearlySmsCostAfter)} {t("smsRoiCalculator.year")}
                  </span>
                </div>
                <div className="h-3.5 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <motion.div
                    initial={false}
                    animate={{ width: `${afterBarWidth}%` }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
                    className="h-full rounded-full bg-bcc"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* SVG-график накопленного эффекта за 12 месяцев */}
          <RoiCumulativeChart points={result.cumulative12Months} />
        </div>
      </div>

      {/* Блок «Допущения и источники» */}
      <Card
        heading={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-h2 flex items-center gap-2">
              <Info aria-hidden="true" className="size-5 text-quantum" />
              {t("smsRoiCalculator.assumptions")}
            </h2>
            <Badge tone="neutral">{t("smsRoiCalculator.model")}</Badge>
          </div>
        }
        divided
      >
        <div className="space-y-4 text-sm text-ink-secondary">
          <p className="rounded-xl border border-quantum/30 bg-quantum/[.08] px-4 py-3 text-ink-primary">
            {t("smsRoiCalculator.defaults")} <strong className="font-semibold">{t("smsRoiCalculator.estimates")}</strong> {t("smsRoiCalculator.basis")}
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border-subtle bg-terminal/70 p-4">
              <h3 className="type-h3 text-emerald-300">{t("smsRoiCalculator.split")}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                {t("smsRoiCalculator.smsSaving")}<code className="font-mono text-ink-primary">U × N × P × M% × 12</code>{t("smsRoiCalculator.carriers")}<code className="font-mono text-ink-primary">F × R%</code>{t("smsRoiCalculator.protected")}
              </p>
            </div>

            <div className="rounded-xl border border-border-subtle bg-terminal/70 p-4">
              <h3 className="type-h3 text-amber-300">{t("smsRoiCalculator.residualTraffic")}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                {t("smsRoiCalculator.reserve")} <code className="font-mono text-ink-primary">100% − M</code> {t("smsRoiCalculator.recovery")}
              </p>
            </div>

            <div className="rounded-xl border border-border-subtle bg-terminal/70 p-4">
              <h3 className="type-h3 text-quantum">{t("smsRoiCalculator.stress")}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                {t("smsRoiCalculator.conservative")}<code className="font-mono text-ink-primary">{t("smsRoiCalculator.million")}</code> {t("smsRoiCalculator.active")} <code className="font-mono text-ink-primary">{t("smsRoiCalculator.messages")}</code>{t("smsRoiCalculator.wholesale")} <code className="font-mono text-ink-primary">8 ₸</code>, <code className="font-mono text-ink-primary">50%</code> {t("smsRoiCalculator.migrationYear")} <strong className="font-mono text-ink-primary">{t("smsRoiCalculator.saving")}</strong>{t("smsRoiCalculator.plus")} <strong className="font-mono text-ink-primary">{t("smsRoiCalculator.prevented")}</strong> {t("smsRoiCalculator.fraudLoss")}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
