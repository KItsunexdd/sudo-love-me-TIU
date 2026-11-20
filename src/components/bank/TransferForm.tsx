"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import { Fingerprint, KeyRound, PhoneIncoming, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ErrorCard, SegmentedControl, Skeleton, Toggle } from "@/components/ui";
import { useAttackState } from "@/components/hacker/attacks";
import { api, type ApiError, type DemoUsersResponse, type PrepareInput, type PrepareResponse } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import type { Mode, OperationType, User } from "@/lib/db/types";
import { formatTenge } from "@/lib/ui/format";
import { RiskMeter } from "./RiskMeter";

type Presets = DemoUsersResponse["recipientPresets"];
export type PresetName = keyof Presets | "office";
const getProductOptions = (t: Translate) => ([
  { value: "P2P_TRANSFER", label: t("common.transfer") },
  { value: "DEPOSIT_CLOSE", label: t("transferForm.closeDeposit") },
  { value: "ONLINE_LOAN", label: t("common.loan") },
] as const);

function presetValues(name: PresetName, presets: Presets) {
  const recipient = name === "office" ? { ...presets.supplier, amountTenge: 120000 } : presets[name];
  const purposes = { son: "На продукты", unknown: "Перевод на безопасный счёт", supplier: "Оплата по счёту", office: "Канцтовары для офиса" };
  return { ...recipient, amount: String(recipient.amountTenge), purpose: purposes[name], call: name === "unknown", night: false };
}

function RiskMeterSkeleton() {
  const { t } = useT();
  return (
    <div aria-busy="true" aria-label={t("transferForm.assessing")} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-1 w-full rounded-full" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

export function TransferForm({ mode, sender, presets, initialPreset, device, deviceLoading, busy, cooling, onRegister, onPrepare }: {
  mode: Mode; sender: User; presets: Presets; initialPreset: PresetName; device?: LocalDevice; deviceLoading: boolean;
  busy: boolean; cooling: boolean; onRegister: () => void; onPrepare: (input: PrepareInput) => void;
}) {
  const { t } = useT();
  const productOptions = getProductOptions(t);
  const business = mode === "B2B";
  const [form, setForm] = useState(() => presetValues(initialPreset, presets));
  const [operation, setOperation] = useState<OperationType>(business ? "B2B_INVOICE" : "P2P_TRANSFER");
  const { recipientName, recipientAccount, amount, purpose, call, night } = form;
  const [preview, setPreview] = useState<{ input: object; risk?: PrepareResponse["risk"]; error?: ApiError }>();
  const { armed } = useAttackState();
  const amountTenge = Number(amount);
  const riskInput = useMemo(() => ({
    senderId: sender.id,
    mode,
    operationType: operation,
    amountTenge,
    recipientAccount: recipientAccount.trim(),
    simulatedContext: { activeUnknownCall: call, nightTimeOverride: night },
  }), [sender.id, mode, operation, amountTenge, recipientAccount, call, night]);
  const valid = Number.isSafeInteger(amountTenge) && amountTenge > 0 && Boolean(recipientAccount.trim());
  const current = preview?.input === riskInput ? preview : undefined;

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await api.riskPreview(riskInput, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) setPreview({ input: riskInput, error: result.error });
      else if ("risk" in result.data) setPreview({ input: riskInput, risk: result.data.risk });
      else setPreview({ input: riskInput, error: result.data });
    }, 240);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [riskInput, valid]);

  function applyPreset(name: PresetName) {
    setOperation(business ? "B2B_INVOICE" : "P2P_TRANSFER");
    setForm(presetValues(name, presets));
  }

  function chooseOperation(next: OperationType) {
    if (next === operation) return;
    if (next === "P2P_TRANSFER") return applyPreset("son");
    setOperation(next);
    const deposit = next === "DEPOSIT_CLOSE";
    setForm(previous => ({
      ...previous,
      amount: String(deposit ? sender.depositBalanceTenge : 1500000),
      recipientName: sender.fullName,
      recipientAccount: sender.accountIban,
      purpose: deposit ? "Зачисление депозита на свой счёт" : "Зачисление онлайн-кредита",
      call: false,
      night: false,
    }));
  }

  const fieldClass = "mt-1.5 h-10 w-full min-w-0 rounded-lg border border-border-default bg-elevated px-3 text-sm text-ink-primary transition-colors hover:border-border-strong focus-visible:border-bcc/60 read-only:text-ink-secondary disabled:text-ink-secondary";

  return (
    <form onSubmit={event => { event.preventDefault(); if (valid && device && !busy && !cooling) onPrepare({ ...riskInput, recipientName, purpose }); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {business ? (
          <h2 className="type-h2">{t("common.invoice")}</h2>
        ) : (
          <SegmentedControl
            label={t("common.type")}
            value={operation}
            onChange={chooseOperation}
            options={productOptions}
            className="flex w-full [&_button]:whitespace-normal [&_button]:px-2"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="tabular-nums"
            icon={<UserRound />}
            onClick={() => applyPreset(business ? "office" : "son")}
          >
            {business ? t("transferForm.office", { value: formatTenge(120_000) }) : t("transferForm.son", { value: formatTenge(presets.son.amountTenge) })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="tabular-nums"
            icon={business ? undefined : <PhoneIncoming />}
            onClick={() => applyPreset(business ? "supplier" : "unknown")}
          >
            {business
              ? `СнабТехСервис · ${formatTenge(presets.supplier.amountTenge)}`
              : t("transferForm.nationalBank", { value: formatTenge(presets.unknown.amountTenge) })}
          </Button>
        </div>

        <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
          <label className="type-label text-ink-secondary">
            {t("common.recipient")}
            <input
              className={fieldClass}
              value={recipientName}
              maxLength={120}
              required
              readOnly={operation === "DEPOSIT_CLOSE"}
              onChange={e => setForm({ ...form, recipientName: e.target.value })}
            />
          </label>
          <label className="type-label text-ink-secondary">
            {t("transferForm.iban")}
            <input
              className={`${fieldClass} font-mono tabular-nums`}
              value={recipientAccount}
              maxLength={34}
              required
              readOnly={operation === "DEPOSIT_CLOSE"}
              onChange={e => setForm({ ...form, recipientAccount: e.target.value.toUpperCase().replace(/\s/g, "") })}
            />
          </label>
          <label className="type-label text-ink-secondary">
            {t("transferForm.amount")}
            <input
              className={`${fieldClass} font-mono tabular-nums`}
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label className="type-label text-ink-secondary">
            {t("common.purpose")}
            <input
              className={fieldClass}
              value={purpose}
              maxLength={140}
              onChange={e => setForm({ ...form, purpose: e.target.value })}
            />
          </label>
        </div>

        <div className="grid gap-3 py-1 sm:grid-cols-[1.45fr_1fr]">
          <Toggle label={t("transferForm.call")} checked={call} onChange={value => setForm({ ...form, call: value })} />
          <Toggle label={t("transferForm.night")} checked={night} onChange={value => setForm({ ...form, night: value })} />
        </div>

        <div aria-live="polite" className="min-h-24 rounded-xl border border-border-default bg-surface p-4">
          {current?.risk ? (
            <RiskMeter {...current.risk} />
          ) : current?.error ? (
            <ErrorCard error={current.error} />
          ) : valid ? (
            <RiskMeterSkeleton />
          ) : (
            <p className="text-sm text-ink-secondary">{t("transferForm.invalid")}</p>
          )}
        </div>

        {device ? (
          <Button
            type="submit"
            size="lg"
            className="w-full"
            icon={<Fingerprint />}
            loading={busy}
            disabled={cooling || !current?.risk || !recipientName.trim()}
          >
            <span>
              {t("transferForm.sign")}
              <span className="block font-mono text-xs font-normal opacity-70">Passkey + ML-DSA-65</span>
            </span>
          </Button>
        ) : (
          <Button size="lg" className="w-full" icon={<KeyRound />} disabled={deviceLoading} onClick={onRegister}>
            {t("common.enrollQuick")}
          </Button>
        )}

        {armed && (
          <p className="text-center text-xs text-danger-text">
            {t("transferForm.armed")}
          </p>
        )}

        {device?.deviceKind === "SOFTWARE_FALLBACK" && (
          <p className="text-center font-mono text-xs text-gold-text">
            {t("transferForm.fallback")}
          </p>
        )}
      </fieldset>
    </form>
  );
}
