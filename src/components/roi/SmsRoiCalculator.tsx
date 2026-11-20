"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RotateCcw } from "lucide-react";
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
import { TWEEN_ENTER } from "@/lib/ui/motion";
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
  const afterShare = result.yearlySmsCostBefore > 0
    ? result.yearlySmsCostAfter / result.yearlySmsCostBefore
    : 0;

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="space-y-1">
          <h1 className="display-hero">{t("smsRoiCalculator.heading")}</h1>
          <p className="type-body text-ink-secondary">{t("smsRoiCalculator.intro")}</p>
        </div>

        <div
          role="group"
          aria-label={t("smsRoiCalculator.presets")}
          className="grid gap-1 rounded-xl border border-border-default bg-terminal p-1 sm:grid-cols-3"
        >
          {presets.map(preset => {
            const selected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                onClick={() => applyPreset(preset.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? "border-border-strong bg-elevated text-ink-primary"
                    : "border-transparent text-ink-secondary hover:bg-surface hover:text-ink-primary"
                }`}
              >
                <span className="block text-sm font-medium">{preset.label}</span>
                <span className="mt-1 block font-mono text-xs tabular-nums text-ink-muted">{preset.shortNote}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card
          heading={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-h2">{t("smsRoiCalculator.settings")}</h2>
              <span className="type-micro text-ink-muted">
                {activePreset === "custom"
                  ? t("smsRoiCalculator.custom")
                  : presets.find(p => p.id === activePreset)?.label}
              </span>
              {activePreset === "custom" && (
                <Button variant="ghost" size="sm" icon={<RotateCcw size={16} strokeWidth={1.75} />} onClick={() => applyPreset("base")}>
                  {t("smsRoiCalculator.reset")}
                </Button>
              )}
            </div>
          }
          divided
        >
          <div className="space-y-5">
            <section aria-labelledby="roi-sms-params-heading" className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id="roi-sms-params-heading" className="type-label font-medium">
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
                onChange={v => updateField("migrationPercent", v)}
              />
            </section>

            <hr className="border-border-subtle" />

            <section aria-labelledby="roi-fraud-params-heading" className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id="roi-fraud-params-heading" className="type-label font-medium">
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
                onChange={v => updateField("fraudPreventionPercent", v)}
              />
            </section>
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          <div data-testid="roi-annual-savings" className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col">
              <h2 className="type-label">{t("common.direct")}</h2>
              <div className="display-kpi mt-3 text-bcc">
                <RoiAnimatedNumber value={result.yearlySmsSavings} format={formatCompactTenge} />
              </div>
              <p className="mono-data mt-1 text-ink-muted">
                {formatTenge(Math.round(result.yearlySmsSavings))} {t("smsRoiCalculator.year")}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-default pt-3">
                <div>
                  <dt className="type-micro text-ink-muted">{t("smsRoiCalculator.monthly")}</dt>
                  <dd className="mono-data text-ink-secondary">
                    <RoiAnimatedNumber value={result.monthlySmsSavings} format={formatCompactTenge} />
                  </dd>
                </div>
                <div>
                  <dt className="type-micro text-ink-muted">{t("smsRoiCalculator.smsReplaced")}</dt>
                  <dd className="mono-data text-ink-secondary">{formatCompactCount(result.yearlySmsReplaced, locale)}</dd>
                </div>
              </dl>
              <p className="mt-auto flex flex-wrap justify-between gap-x-3 pt-3 font-mono text-xs tabular-nums text-ink-muted">
                <span>{t("smsRoiCalculator.profit")}</span>
                <span>−{Math.round(result.inputs.migrationPercent)}% SMS</span>
              </p>
            </Card>

            <Card className="flex flex-col">
              <h2 className="type-label">{t("smsRoiCalculator.saved")}</h2>
              <div className="display-kpi mt-3 text-ink-primary">
                <RoiAnimatedNumber value={result.yearlyFraudSavings} format={formatCompactTenge} />
              </div>
              <p className="mono-data mt-1 text-ink-muted">
                {formatTenge(Math.round(result.yearlyFraudSavings))} {t("smsRoiCalculator.year")}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-default pt-3">
                <div>
                  <dt className="type-micro text-ink-muted">{t("smsRoiCalculator.monthly")}</dt>
                  <dd className="mono-data text-ink-secondary">
                    <RoiAnimatedNumber value={result.monthlyFraudSavings} format={formatCompactTenge} />
                  </dd>
                </div>
                <div>
                  <dt className="type-micro text-ink-muted">{t("smsRoiCalculator.baseline")}</dt>
                  <dd className="mono-data text-ink-secondary">{formatCompactTenge(result.inputs.annualFraudLossTenge)}</dd>
                </div>
              </dl>
              <p className="mt-auto flex flex-wrap justify-between gap-x-3 pt-3 font-mono text-xs tabular-nums text-ink-muted">
                <span>{t("roi.smsRoiCalculator.antiFraud")}</span>
                <span>−{Math.round(result.inputs.fraudPreventionPercent)}{t("smsRoiCalculator.fraudShare")}</span>
              </p>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border-default px-1 pb-4">
            <div className="min-w-48 flex-1">
              <p className="type-label">
                <span className="font-medium text-ink-primary">{t("common.total")}</span>
                <span className="ml-2 text-ink-muted">{t("smsRoiCalculator.combined")}</span>
              </p>
              <p className="type-micro mt-1 text-ink-muted">{t("smsRoiCalculator.totalHint")}</p>
            </div>
            <div className="font-mono tabular-nums sm:text-right">
              <p className="text-base font-medium text-ink-primary">
                <RoiAnimatedNumber value={result.totalYearlyImpact} format={formatCompactTenge} /> {t("smsRoiCalculator.year")}
              </p>
              <p className="type-micro mt-1 text-ink-muted">
                ≈ <RoiAnimatedNumber value={result.monthlyTotalImpact} format={formatCompactTenge} /> {t("smsRoiCalculator.month")}
              </p>
            </div>
          </div>

          <Card heading={
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="type-h2">{t("smsRoiCalculator.annualSms")}</h2>
              <span className="font-mono text-xs tabular-nums text-ink-muted">
                {t("smsRoiCalculator.savings")} {formatCompactTenge(result.yearlySmsSavings)}{t("smsRoiCalculator.perYear")}
              </span>
            </div>
          }>
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="type-label">{t("smsRoiCalculator.now", { volume: formatCompactCount(result.monthlySmsVolumeBefore, locale) })}</span>
                  <span className="mono-data">{formatCompactTenge(result.yearlySmsCostBefore)} {t("smsRoiCalculator.year")}</span>
                </div>
                <div aria-hidden="true" className="h-1 bg-elevated">
                  <motion.div
                    initial={false}
                    animate={{ scaleX: result.yearlySmsCostBefore > 0 ? 1 : 0 }}
                    transition={reduce ? { duration: 0 } : TWEEN_ENTER}
                    className="h-full origin-left bg-ink-muted"
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="type-label">{t("smsRoiCalculator.after", { share: remainingSmsShare })}</span>
                  <span className="mono-data">{formatCompactTenge(result.yearlySmsCostAfter)} {t("smsRoiCalculator.year")}</span>
                </div>
                <div aria-hidden="true" className="h-1 bg-elevated">
                  <motion.div
                    initial={false}
                    animate={{ scaleX: afterShare }}
                    transition={reduce ? { duration: 0 } : TWEEN_ENTER}
                    className="h-full origin-left bg-bcc"
                  />
                </div>
              </div>
            </div>
          </Card>

          <RoiCumulativeChart points={result.cumulative12Months} />
        </div>
      </div>

      <Card
        heading={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-h2">{t("smsRoiCalculator.assumptions")}</h2>
            <span className="type-micro text-ink-muted">{t("smsRoiCalculator.model")}</span>
          </div>
        }
        divided
      >
        <div className="space-y-4 text-sm text-ink-secondary">
          <p className="max-w-5xl">
            {t("smsRoiCalculator.defaults")} <strong className="font-medium text-ink-primary">{t("smsRoiCalculator.estimates")}</strong> {t("smsRoiCalculator.basis")}
          </p>

          <div className="grid gap-5 border-t border-border-default pt-4 md:grid-cols-3">
            <div>
              <h3 className="type-h3 text-ink-primary">{t("smsRoiCalculator.split")}</h3>
              <p className="mt-2 text-sm leading-5 text-ink-secondary">
                {t("smsRoiCalculator.smsSaving")}<code className="font-mono text-ink-primary">U × N × P × M% × 12</code>{t("smsRoiCalculator.carriers")}<code className="font-mono text-ink-primary">F × R%</code>{t("smsRoiCalculator.protected")}
              </p>
            </div>

            <div>
              <h3 className="type-h3 text-ink-primary">{t("smsRoiCalculator.residualTraffic")}</h3>
              <p className="mt-2 text-sm leading-5 text-ink-secondary">
                {t("smsRoiCalculator.reserve")} <code className="font-mono text-ink-primary">100% − M</code> {t("smsRoiCalculator.recovery")}
              </p>
            </div>

            <div>
              <h3 className="type-h3 text-ink-primary">{t("smsRoiCalculator.stress")}</h3>
              <p className="mt-2 text-sm leading-5 text-ink-secondary">
                {t("smsRoiCalculator.conservative")}<code className="font-mono text-ink-primary">{t("smsRoiCalculator.million")}</code> {t("smsRoiCalculator.active")} <code className="font-mono text-ink-primary">{t("smsRoiCalculator.messages")}</code>{t("smsRoiCalculator.wholesale")} <code className="font-mono text-ink-primary">8 ₸</code>, <code className="font-mono text-ink-primary">50%</code> {t("smsRoiCalculator.migrationYear")} <strong className="font-mono font-medium text-ink-primary">{t("smsRoiCalculator.saving")}</strong>{t("smsRoiCalculator.plus")} <strong className="font-mono font-medium text-ink-primary">{t("smsRoiCalculator.prevented")}</strong> {t("smsRoiCalculator.fraudLoss")}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
