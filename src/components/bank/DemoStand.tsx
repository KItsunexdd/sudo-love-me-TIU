"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useEffect, useRef, useState } from "react";
import { Landmark, ShieldCheck, Snowflake } from "lucide-react";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { CosignEmbedSlot } from "@/components/cosign/CosignEmbedSlot";
import { CryptoInspectorDrawer } from "@/components/crypto/CryptoInspectorDrawer";
import { useTransaction } from "@/components/crypto/useTransaction";
import { AttackSimulatorPanel } from "@/components/hacker/AttackSimulatorPanel";
import { QuantumCompareModal } from "@/components/hacker/QuantumCompareModal";
import { Badge, Button, Card, ErrorCard, PhoneFrame, SegmentedControl, Skeleton } from "@/components/ui";
import { api, type ApiError, type ApiResult, type DemoUsersResponse, type ExecuteResponse, type PrepareInput, type PrepareResponse } from "@/lib/client/api";
import { useDemoState } from "@/lib/client/useDemoState";
import { useEventStream } from "@/lib/client/useEventStream";
import { useLocalDevices } from "@/lib/client/useLocalDevices";
import type { Mode, TransactionRecord, User } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { BiometricSignModal } from "./BiometricSignModal";
import { DeviceOnboarding } from "./DeviceOnboarding";
import { TransactionResult } from "./TransactionResult";
import { TransferForm, type PresetName } from "./TransferForm";

type Attempt = { id: string; record?: TransactionRecord; error?: ApiError; http: number };
type StandProps = {
  sender: DemoUsersResponse["users"][number]; cosigner: User; mode: Mode; presets: DemoUsersResponse["recipientPresets"];
  refresh: () => void;
};

function AccountCard({ sender, cosigner, mode }: Pick<StandProps, "sender" | "cosigner" | "mode">) {
  const { t } = useT();
  const business = mode === "B2B";
  return (
    <section className="rounded-xl border border-border-default bg-[linear-gradient(180deg,#1D1E21,#18191B)] px-4 py-3 shadow-highlight 2xl:px-5 2xl:py-4">
      <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
        <div className="flex min-w-0 items-center gap-2">
          <Landmark aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" />
          <span className="shrink-0 text-ink-secondary">{business ? "BCC Business" : "bcc.kz"}</span>
          <span aria-hidden="true" className="text-ink-disabled">·</span>
          <h1 className="truncate text-[0.8125rem] font-medium text-ink-primary">{business ? "ТОО «Алатау Логистик»" : sender.fullName}</h1>
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-muted">KZT</span>
      </div>
      {business && <p className="mt-1 text-xs text-ink-secondary">{t("demoStand.accountant")} {sender.fullName}</p>}
      <p className="mt-3 font-mono text-[clamp(1.75rem,2.4vw,2.25rem)] font-medium leading-none tracking-[-0.01em] tabular-nums">
        {formatTenge(sender.balanceTenge)}
      </p>
      <p className="mt-2 break-words font-mono text-xs tabular-nums text-ink-muted">
        {formatIban(sender.accountIban)}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-xs text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.75} className="text-bcc" />
          {business ? t("common.director") : t("common.secondHand")} · {cosigner.fullName}
        </span>
        {!business && <span className="tabular-nums">{t("demoStand.deposit")} <span className="font-mono text-ink-primary">{formatTenge(sender.depositBalanceTenge)}</span></span>}
      </div>
    </section>
  );
}

function DemoStandSkeleton() {
  const { t } = useT();
  return (
    <main aria-busy="true" aria-label={t("demoStand.loading")} className="shell-container grid items-start gap-5 py-4 min-[1100px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] 2xl:gap-6 2xl:py-6">
      <PhoneFrame className="mx-auto max-w-[560px] min-[1100px]:max-w-none">
        <div className="space-y-3 p-1 md:px-4 md:pb-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-[10px]" />
        </div>
      </PhoneFrame>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-9 w-72 rounded-[10px]" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </Card>
          ))}
        </div>
        <Card className="space-y-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </Card>
      </div>
    </main>
  );
}

function DemoSession({ sender, cosigner, mode, presets, refresh }: StandProps) {
  const { t, region } = useT();
  const business = mode === "B2B";
  const [tab, setTab] = useState<"panel" | "cosign">("panel");
  const [form, setForm] = useState<{ key: number; preset: PresetName }>({ key: 0, preset: business ? "supplier" : "son" });
  const [deviceDialog, setDeviceDialog] = useState<"choose" | "software" | null>(null);
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);
  const [signerId, setSignerId] = useState("");
  const [prepareError, setPrepareError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const [receipt, setReceipt] = useState(false);
  const [inspector, setInspector] = useState<{ id: string; attemptError?: ApiError } | null>(null);
  const [quantum, setQuantum] = useState(false);
  const { devices, unavailable, loading } = useLocalDevices();
  const { status, syncVersion, resyncVersion } = useEventStream({ userId: sender.id });
  const [activeIds, setActiveIds] = useState<string[]>();
  const [deviceError, setDeviceError] = useState<ApiError>();
  const [deviceRevision, setDeviceRevision] = useState(0);
  const [time, setTime] = useState(Date.now);
  const live = useTransaction(attempt?.id ?? null, sender.id);
  const record = live.record ?? attempt?.record;
  const mounted = useRef(false);
  const preparing = useRef(false);
  const interacted = useRef(false);
  const lastInput = useRef<PrepareInput | null>(null);
  const device = devices.filter(item => item.userId === sender.id && activeIds?.includes(item.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const signingDevice = devices.find(item => item.id === signerId);
  const coolingUntil = Date.parse(sender.coolingOffUntil ?? "");
  const cooling = coolingUntil > time;

  useEffect(() => {
    mounted.current = true;
    const readInspector = () => {
      const id = new URL(window.location.href).searchParams.get("txId");
      setInspector(id ? { id } : null);
    };
    readInspector();
    window.addEventListener("popstate", readInspector);
    return () => { mounted.current = false; window.removeEventListener("popstate", readInspector); };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(coolingUntil) || coolingUntil <= Date.now()) return;
    const timer = setTimeout(() => setTime(Date.now()), coolingUntil - Date.now() + 100);
    return () => clearTimeout(timer);
  }, [coolingUntil]);

  useEffect(() => {
    const controller = new AbortController();
    void api.listDevices(sender.id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setDeviceError(result.error ?? undefined);
      setActiveIds(result.ok ? result.data.devices.map(item => item.id) : []);
    });
    return () => controller.abort();
  }, [sender.id, devices, syncVersion, resyncVersion, deviceRevision]);

  useEffect(() => {
    if (interacted.current) return;
    const controller = new AbortController();
    void api.listTransactions({ status: "PENDING_COSIGN", userId: sender.id }, controller.signal).then(result => {
      if (controller.signal.aborted || interacted.current) return;
      if (!result.ok) { setPrepareError(result.error); return; }
      const pending = result.data.transactions.filter(tx => tx.payload.senderId === sender.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (pending) {
        setAttempt({ id: pending.id, record: pending, http: 202 });
        setReceipt(true);
        setTab("cosign");
        interacted.current = true;
      }
    });
    return () => controller.abort();
  }, [sender.id, syncVersion, resyncVersion]);

  function newForm(preset: PresetName) {
    interacted.current = true;
    setReceipt(false);
    setPrepareError(undefined);
    setForm(previous => ({ key: previous.key + 1, preset }));
  }

  async function prepare(input: PrepareInput) {
    if (preparing.current || !device) return;
    preparing.current = true;
    interacted.current = true;
    lastInput.current = input;
    setBusy(true);
    setPrepareError(undefined);
    try {
      const result = await api.prepare(input);
      if (!mounted.current) return;
      if (result.ok) {
        setSignerId(device.id);
        setPrepared(result.data);
      } else setPrepareError(result.error);
    } finally {
      preparing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function complete(id: string, result: ApiResult<ExecuteResponse>) {
    interacted.current = true;
    setAttempt(result.ok ? { id, http: result.status, record: result.data.transaction } :
      { id, http: result.status, error: result.error });
    setPrepared(null);
    setReceipt(true);
    if (result.ok && result.data.status === "PENDING_COSIGN") setTab("cosign");
    refresh();
  }

  function inspect(id: string | null, attemptError?: ApiError) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("txId", id);
    else url.searchParams.delete("txId");
    window.history.replaceState(null, "", url);
    setQuantum(false);
    setInspector(id ? { id, attemptError } : null);
  }

  const openQuantum = () => { inspect(null); setQuantum(true); };
  const sample: PrepareInput = {
    ...(business ? presets.supplier : presets.son),
    amountTenge: 1,
    senderId: sender.id,
    mode,
    operationType: business ? "B2B_INVOICE" : "P2P_TRANSFER",
    purpose: "Диагностика ML-DSA-65",
  };
  const phishingSample: PrepareInput = {
    ...(business ? presets.supplier : presets.son),
    amountTenge: 15000,
    senderId: sender.id,
    mode,
    operationType: business ? "B2B_INVOICE" : "P2P_TRANSFER",
    purpose: "Бонус B+ (сайт-клон)",
  };
  const connection = { connecting: t("common.connecting"), live: "SSE Live", polling: t("common.polling"), offline: t("common.offline") };
  const connectionTone = { connecting: "neutral", live: "success", polling: "warning", offline: "danger" } as const;

  return (
    <main className="shell-container grid items-start gap-5 py-4 min-[1100px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] 2xl:gap-6 2xl:py-6">
      <PhoneFrame className="mx-auto min-w-0 max-w-[560px] min-[1100px]:max-w-none">
        <div className="space-y-3 p-1 md:px-4 md:pb-4">
          <AccountCard sender={sender} cosigner={cosigner} mode={mode} />
          {cooling && (
            <Card variant="warning" className="space-y-1">
              <h2 className="flex items-center gap-2 type-h3"><Snowflake aria-hidden="true" size={16} strokeWidth={1.75} className="text-gold-text" /> {t("demoStand.cooling")}</h2>
              <p className="text-[0.8125rem] text-ink-secondary">
                {t("demoStand.suspended")} <span className="font-mono tabular-nums">{new Date(coolingUntil).toLocaleString(region)}</span>
              </p>
            </Card>
          )}
          {deviceError && <ErrorCard error={deviceError} action={<Button size="sm" onClick={() => setDeviceRevision(n => n + 1)}>{t("demoStand.refreshDevices")}</Button>} />}
          {unavailable && <ErrorCard error={{ failureCode: "ERR_CLIENT_KEYSTORE", message: t("demoStand.keystore") }} />}
          {live.error && <ErrorCard error={live.error} action={<Button size="sm" onClick={live.retry}>{t("demoStand.refreshStatus")}</Button>} />}
          {receipt && attempt ? (
            <TransactionResult
              attemptId={attempt.id}
              record={record}
              error={attempt.error}
              http={attempt.http}
              cosigner={cosigner.fullName}
              onInspect={error => inspect(attempt.id, error)}
              onCosign={() => setTab("cosign")}
              onNew={() => newForm(business ? "supplier" : "son")}
            />
          ) : (
            <TransferForm
              key={form.key}
              mode={mode}
              sender={sender}
              presets={presets}
              initialPreset={form.preset}
              device={device}
              busy={busy}
              deviceLoading={loading || !activeIds}
              cooling={cooling}
              onRegister={() => setDeviceDialog("choose")}
              onPrepare={input => void prepare(input)}
            />
          )}
          {prepareError && <ErrorCard error={prepareError} />}
        </div>
      </PhoneFrame>

      <aside className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            label={t("demoStand.panels")}
            value={tab}
            onChange={setTab}
            className="min-w-0 max-w-full [&_button]:whitespace-normal sm:[&_button]:whitespace-nowrap"
            options={[
              { value: "panel", label: t("demoStand.hacker") },
              {
                value: "cosign",
                label: t("demoStand.cosign"),
                badgeCount: record?.status === "PENDING_COSIGN" ? 1 : 0,
              },
            ]}
          />
          <span role="status">
            <Badge tone={connectionTone[status]} className="font-mono font-normal">{connection[status]}</Badge>
          </span>
        </div>

        {tab === "cosign" ? (
          <CosignEmbedSlot userId={cosigner.id} />
        ) : (
          <AttackSimulatorPanel
            tx={record}
            error={attempt?.error}
            device={device}
            sample={phishingSample}
            onResult={complete}
            business={business}
            onSocial={() => newForm(business ? "supplier" : "unknown")}
            onQuantum={openQuantum}
            onInspect={inspect}
          />
        )}
      </aside>

      {deviceDialog && <DeviceOnboarding userId={sender.id} software={deviceDialog === "software"} onClose={() => setDeviceDialog(null)} />}
      {prepared && signingDevice && (
        <BiometricSignModal
          key={prepared.txId}
          onRenew={() => {
            setPrepared(null);
            if (lastInput.current) void prepare(lastInput.current);
          }}
          prepared={prepared}
          device={signingDevice}
          onClose={() => setPrepared(null)}
          onComplete={result => complete(prepared.txId, result)}
          onFallback={() => { setPrepared(null); setDeviceDialog("software"); }}
        />
      )}
      {inspector && <CryptoInspectorDrawer userId={sender.id} txId={inspector.id} attemptError={inspector.attemptError} onClose={() => inspect(null)} onQuantum={openQuantum} />}
      {quantum && <QuantumCompareModal sample={sample} deviceId={device?.id} onClose={() => setQuantum(false)} onInspect={inspect} onResult={complete} />}
    </main>
  );
}

export function DemoStand() {
  const { t } = useT();
  const { mode, senderId, cosignerId } = useDemoMode();
  const { users, loading, recipientPresets, error, refresh } = useDemoState(senderId);
  const { events } = useEventStream({ userId: senderId });
  const latestReset = events.findLast(event => event.type === "DEMO_RESET")?.id;
  const [reset, setReset] = useState(0);
  useEffect(() => { if (latestReset) setReset(latestReset); }, [latestReset]);
  const sender = users.find(user => user.id === senderId);
  const cosigner = users.find(user => user.id === cosignerId);

  if (!recipientPresets || !sender || !cosigner) {
    if (loading) return <DemoStandSkeleton />;
    return (
      <main className="shell-container py-6">
        <ErrorCard
          error={error ?? { failureCode: "ERR_USER_NOT_FOUND", message: t("demoStand.participants") }}
          action={<Button size="sm" onClick={refresh}>{t("common.refresh")}</Button>}
        />
      </main>
    );
  }

  return (
    <>
      {error && (
        <div className="shell-container pt-3">
          <ErrorCard error={error} action={<Button size="sm" onClick={refresh}>{t("common.refresh")}</Button>} />
        </div>
      )}
      <DemoSession key={`${senderId}-${reset}`} sender={sender} cosigner={cosigner} mode={mode} presets={recipientPresets} refresh={refresh} />
    </>
  );
}
