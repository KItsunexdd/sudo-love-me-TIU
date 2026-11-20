"use client";

import { russian, type Translate } from "@/lib/i18n";
import { LocaleSwitch, useT } from "@/components/shell/LocaleProvider";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fingerprint, Menu, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client/api";
import { removeRevokedLocalDevices, type LocalDevice } from "@/lib/client/client-keystore";
import { useEventStream, type ConnectionStatus } from "@/lib/client/useEventStream";
import { useLocalDevices } from "@/lib/client/useLocalDevices";
import type { Mode } from "@/lib/db/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl, type Segment } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useDemoMode } from "./DemoModeProvider";
import { cosignHref } from "@/components/cosign/cosignDetails";

const getModeOptions = (t: Translate): readonly Segment<Mode>[] => ([
  { value: "B2C", label: t("topbar.family") },
  { value: "B2B", label: t("topbar.business"), tone: "gold" },
]);

const getTabs = (t: Translate) => ([
  { href: "/", label: t("common.demo") },
  { href: "/cosign", label: t("common.secondHand") },
  { href: "/soc", label: t("common.soc") },
  { href: "/roi", label: "ROI" },
]);

const getSseMeta = (t: Translate): Record<ConnectionStatus, { tone: BadgeTone; label: string; pulse: boolean }> => ({
  connecting: { tone: "neutral", label: "SSE…", pulse: true },
  live: { tone: "success", label: "SSE Live", pulse: true },
  polling: { tone: "warning", label: t("topbar.polling"), pulse: true },
  offline: { tone: "danger", label: t("topbar.offline"), pulse: false },
});

function ResetDemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [keepDevices, setKeepDevices] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { toast } = useToast();

  function close() {
    setKeepDevices(true);
    setError(null);
    onClose();
  }

  async function reset() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.resetDemo(keepDevices);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!keepDevices) {
        try {
          await removeRevokedLocalDevices();
        } catch {
          setError({
            status: "ERROR", failureCode: "ERR_CLIENT_KEYSTORE",
            message: russian("topbar.resetFailed"),
          });
          return;
        }
      }
      close();
      toast({ titleKey: "topbar.resetDone", descriptionKey: "topbar.resetHint", tone: "success" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} dismissible={!busy} title={t("topbar.reset")}
      description={t("topbar.resetScope")}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="warning" loading={busy} onClick={() => void reset()}>{t("topbar.resetConfirm")}</Button>
      </div>}>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border-default bg-terminal p-3 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-bcc" disabled={busy} checked={keepDevices}
          onChange={event => setKeepDevices(event.target.checked)} />
        {t("topbar.keep")}
      </label>
      {error && <ErrorCard error={error} className="mt-3" />}
    </Modal>
  );
}

function DeviceModal({ open, onClose, userId, device }: {
  open: boolean; onClose: () => void; userId: string; device?: LocalDevice;
}) {
  const { t } = useT();
  const [preferSoftware, setPreferSoftware] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { toast } = useToast();

  function close() {
    setError(null);
    setPreferSoftware(false);
    onClose();
  }

  async function register() {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setBusy(true);
    try {
      const signer = await import("@/lib/client/signer");
      try {
        const registered = await signer.registerDevice(userId, { preferSoftware });
        toast({
          titleKey: "topbar.deviceBound",
          descriptionKey: registered.deviceKind === "SOFTWARE_FALLBACK" ? "topbar.fallback" : "topbar.ready",
          tone: "success",
        });
        close();
      } catch (cause) {
        setError(signer.toClientError(cause));
      }
    } catch {
      setError({ status: "ERROR", failureCode: "ERR_CLIENT", message: russian("common.moduleUnavailable") });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} dismissible={!busy} title={device ? t("topbar.device") : t("common.enroll")}
      description={device ? undefined : t("topbar.hybrid")}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>{t("common.close")}</Button>
        <Button loading={busy} icon={<Fingerprint className="size-4" />} onClick={() => void register()}>
          {device ? t("topbar.enrollNew") : t("common.enroll")}
        </Button>
      </div>}>
      {device && (
        <dl className="mb-4 space-y-2 rounded-xl border border-border-default bg-terminal p-3.5 text-sm">
          <div className="flex flex-wrap items-center gap-2"><dt className="text-ink-muted">{t("topbar.deviceLabel")}</dt><dd className="font-semibold">{device.deviceName}</dd><Badge status={device.deviceKind} className="!whitespace-normal" /></div>
          <div className="flex flex-wrap items-center gap-2 text-ink-secondary"><dt className="text-ink-muted">{t("common.fingerprint")}</dt><dd className="mono-data text-quantum">{device.pqKeyFingerprint}</dd></div>
        </dl>
      )}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={preferSoftware} disabled={busy} onChange={event => setPreferSoftware(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-bcc" />
        <span>{t("topbar.noScanner")}</span>
      </label>
      {preferSoftware && <p className="mt-2 text-sm text-ink-secondary">{t("topbar.fallback")}</p>}
      {error && <ErrorCard error={error} className="mt-3" />}
    </Modal>
  );
}

function usePendingCount(cosignerId: string, lastEventId: number | undefined, syncVersion: number, resyncVersion: number) {
  const [pending, setPending] = useState<{ owner: string; count: number }>();

  useEffect(() => {
    const controller = new AbortController();
    void api.listTransactions({ status: "PENDING_COSIGN", userId: cosignerId }, controller.signal).then(result => {
      if (!controller.signal.aborted && result.ok) setPending({ owner: cosignerId, count: result.data.transactions.length });
    });
    return () => controller.abort();
  }, [cosignerId, lastEventId, syncVersion, resyncVersion]);

  return pending?.owner === cosignerId ? pending.count : 0;
}

function CosignTopbar({ pathname }: { pathname: string }) {
  const { locale, t } = useT();
  const sseMeta = getSseMeta(t);
  const tabs = getTabs(t);
  const modeOptions = getModeOptions(t);
  const router = useRouter();
  const { mode, setMode, cosignerId: defaultCosigner } = useDemoMode();
  const cosignerId = useSearchParams().get("userId")?.trim() || defaultCosigner;
  const { status, lastEvent, syncVersion, resyncVersion } = useEventStream({ channel: "cosign", userId: cosignerId });
  const pendingCount = usePendingCount(cosignerId, lastEvent?.id, syncVersion, resyncVersion);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const sse = sseMeta[status];

  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[460px] items-center justify-between gap-2 px-3.5 sm:max-w-[var(--content-width)] sm:px-4 xl:px-6">
        <Link href={`/?mode=${mode}&lang=${locale}`} className="inline-flex shrink-0 items-center gap-2 rounded-xl py-1 font-extrabold tracking-tight text-ink-primary transition-colors hover:text-bcc">
          <span className="grid size-8 place-items-center rounded-xl border border-bcc/40 bg-bcc/10 text-bcc">
            <ShieldCheck aria-hidden="true" className="size-[18px]" />
          </span>
          <span className="text-[15px]">BCC SafeSign</span>
        </Link>

        <div className="flex items-center gap-2">
          <span role="status">
            <Badge tone={sse.tone} className="px-2.5 py-1 text-xs">
              <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${sse.pulse ? "motion-safe:animate-pulse" : ""}`} />
              {sse.label}
            </Badge>
          </span>
          <button
            type="button"
            aria-label={t("topbar.openMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="relative grid size-10 place-items-center rounded-xl border border-border-strong bg-elevated text-ink-primary transition duration-150 hover:border-bcc/50 hover:bg-surface-hover"
          >
            <Menu aria-hidden="true" className="size-5" />
            {pendingCount > 0 && (
              <span
                aria-label={t("topbar.pending", { pendingCount })}
                className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-danger-solid px-1 font-mono text-xs font-bold tabular-nums text-white motion-safe:animate-pulse"
              >
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("topbar.menu")}
        description={t("topbar.menuHint")}
        className="max-w-[360px]"
        footer={
          <Button
            variant="warning"
            className="w-full"
            icon={<RotateCcw className="size-4" />}
            onClick={() => {
              setMenuOpen(false);
              setResetOpen(true);
            }}
          >
            {t("topbar.reset")}
          </Button>
        }
      >
        <div className="space-y-5">
          <LocaleSwitch />
          <section className="space-y-2">
            <p className="type-label text-ink-muted">{t("topbar.bankMode")}</p>
            <SegmentedControl
              label={t("topbar.mode")}
              options={modeOptions}
              value={mode}
              onChange={next => {
                setMode(next);
                router.replace(cosignHref(next, null, locale));
              }}
              className="w-full"
            />
          </section>

          <nav aria-label={t("topbar.sections")} className="space-y-1.5">
            <p className="type-label text-ink-muted">{t("topbar.sectionsLabel")}</p>
            {tabs.map(tab => {
              const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
              const count = tab.href === "/cosign" ? pendingCount : 0;
              return (
                <Link
                  key={tab.href}
                  href={`${tab.href}?mode=${mode}&lang=${locale}`}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                    active
                      ? "border-bcc/45 bg-elevated text-bcc"
                      : "border-border-default bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-hover hover:text-ink-primary"
                  }`}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-danger-solid px-2 py-0.5 font-mono text-xs tabular-nums text-white motion-safe:animate-pulse">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </Drawer>

      <ResetDemoModal open={resetOpen} onClose={() => setResetOpen(false)} />
    </header>
  );
}

export function Topbar() {
  const pathname = usePathname();
  if (pathname === "/phishing-clone") return null;
  if (pathname === "/cosign" || pathname.startsWith("/cosign/")) return <CosignTopbar pathname={pathname} />;
  return <BankTopbar pathname={pathname} />;
}

function BankTopbar({ pathname }: { pathname: string }) {
  const { locale, t } = useT();
  const tabs = getTabs(t);
  const modeOptions = getModeOptions(t);
  const { mode, setMode, senderId, cosignerId } = useDemoMode();
  const { events, lastEvent, syncVersion, resyncVersion } = useEventStream({ userId: senderId });
  const { devices, loading: devicesLoading } = useLocalDevices();
  const resetEvent = events.findLast(event => event.type === "DEMO_RESET")?.id;
  const [activeIds, setActiveIds] = useState<string[] | null>(null);
  const pendingCount = usePendingCount(cosignerId, lastEvent?.id, syncVersion, resyncVersion);
  const [open, setOpen] = useState<"device" | "reset" | null>(null);
  const device = devices.filter(item => item.userId === senderId && activeIds?.includes(item.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  useEffect(() => {
    const controller = new AbortController();
    if (devices.some(item => item.userId === senderId)) {
      void api.listDevices(senderId, controller.signal).then(result => {
        if (!controller.signal.aborted) setActiveIds(result.ok ? result.data.devices.map(item => item.id) : null);
      });
    }
    return () => controller.abort();
  }, [devices, senderId, resetEvent, syncVersion, resyncVersion]);

  // Kazakh labels run longer: switch to the full captions only on very wide screens.
  const shortLabel = locale === "kk" ? "whitespace-nowrap min-[1800px]:hidden" : "whitespace-nowrap min-[1400px]:hidden";
  const longLabel = locale === "kk" ? "hidden whitespace-nowrap min-[1800px]:inline" : "hidden whitespace-nowrap min-[1400px]:inline";
  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-surface/90 backdrop-blur-md">
      <div className="shell-container flex min-h-[var(--topbar-height)] flex-wrap items-center gap-x-2.5 gap-y-2 py-2 xl:h-16 xl:flex-nowrap xl:justify-between xl:py-0 min-[1400px]:gap-x-4">
        <Link href={`/?mode=${mode}&lang=${locale}`} className="inline-flex shrink-0 items-center gap-2 rounded-xl py-1 font-extrabold tracking-tight text-ink-primary transition-colors hover:text-bcc">
          <span className="grid size-9 place-items-center rounded-xl border border-bcc/40 bg-bcc/10 text-bcc">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <span className="whitespace-nowrap">BCC SafeSign</span>
        </Link>

        <SegmentedControl
          label={t("topbar.mode")}
          options={modeOptions}
          value={mode}
          onChange={setMode}
          className="order-3 w-full sm:order-none sm:w-auto [&_button]:px-2.5 [&_button]:py-1.5 min-[1400px]:[&_button]:px-3.5"
        />

        <nav aria-label={t("topbar.sections")} className="order-4 flex w-full flex-wrap items-center gap-1 xl:order-none xl:w-auto xl:flex-nowrap">
          {tabs.map(tab => {
            const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
            const count = tab.href === "/cosign" ? pendingCount : 0;
            return (
              <Link key={tab.href} href={`${tab.href}?mode=${mode}&lang=${locale}`} prefetch={false} aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-colors
                  ${active ? "bg-elevated text-bcc" : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"}`}>
                {tab.label}
                {count > 0 && <span aria-label={t("topbar.pendingCount", { count })}
                  className="rounded-full bg-danger-solid px-1.5 font-mono text-xs tabular-nums text-white motion-safe:animate-pulse">{count}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2 xl:ml-0 xl:flex-nowrap">
          <LocaleSwitch />
          {device ? (
            <button
              type="button"
              onClick={() => setOpen("device")}
              aria-label={t("topbar.deviceSettings", { deviceName: device.deviceName })}
              title={device.deviceName}
              className="rounded-full transition duration-150 hover:brightness-110 motion-safe:active:scale-[0.98]"
            >
              <Badge status={device.deviceKind}>
                {device.deviceKind === "SOFTWARE_FALLBACK" ? "ECDSA + ML-DSA (Fallback)" : "Passkey + ML-DSA-65"}
              </Badge>
            </button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t("common.enrollQuick")}
              icon={<Zap className="size-4 text-gold motion-safe:animate-pulse" />}
              onClick={() => setOpen("device")}
              disabled={devicesLoading}
            >
              <span className={shortLabel}>{t("common.enroll")}</span>
              <span className={longLabel}>{t("common.enrollQuick")}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("topbar.reset")}
            icon={<RotateCcw className="size-4" />}
            onClick={() => setOpen("reset")}
          >
            <span className={shortLabel}>{t("common.reset")}</span>
            <span className={longLabel}>{t("topbar.reset")}</span>
          </Button>
        </div>
      </div>
      <DeviceModal open={open === "device"} onClose={() => setOpen(null)} userId={senderId} device={device} />
      <ResetDemoModal open={open === "reset"} onClose={() => setOpen(null)} />
    </header>
  );
}
