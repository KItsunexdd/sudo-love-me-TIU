"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fingerprint, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ApiError } from "@/lib/client/api";
import { clearLocalDevices, type LocalDevice } from "@/lib/client/client-keystore";
import { useEventStream } from "@/lib/client/useEventStream";
import { useLocalDevices } from "@/lib/client/useLocalDevices";
import type { Mode } from "@/lib/db/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl, type Segment } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useDemoMode } from "./DemoModeProvider";

const modeOptions: readonly Segment<Mode>[] = [
  { value: "B2C", label: "bcc.kz (Семья)" },
  { value: "B2B", label: "BCC Business (МСБ)", tone: "gold" },
];

const tabs = [
  { href: "/", label: "Демо-стенд" },
  { href: "/cosign", label: "Вторая рука" },
  { href: "/soc", label: "SOC-центр" },
  { href: "/roi", label: "ROI" },
];

function ResetDemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keepDevices, setKeepDevices] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { toast } = useToast();

  function close() {
    setKeepDevices(true);
    setError(null);
    onClose();
  }

  async function reset() {
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
          await clearLocalDevices();
        } catch {
          setError({
            status: "ERROR", failureCode: "ERR_CLIENT_KEYSTORE",
            message: "Демо сброшено на сервере, но браузер не смог удалить локальные ключи.",
          });
          return;
        }
      }
      close();
      toast({ title: "Демо сброшено", description: "Балансы и журнал возвращены к исходному состоянию.", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} dismissible={!busy} title="Сбросить демо"
      description="Балансы и журнал событий будут сброшены для всех участников демо."
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>Отмена</Button>
        <Button variant="warning" loading={busy} onClick={() => void reset()}>Сбросить балансы и атаки</Button>
      </div>}>
      <label className="flex items-center gap-3 rounded-xl border border-border-default bg-terminal p-3 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-bcc" disabled={busy} checked={keepDevices}
          onChange={event => setKeepDevices(event.target.checked)} />
        Сохранить мои Passkeys
      </label>
      {error && <ErrorCard error={error} className="mt-3" />}
    </Modal>
  );
}

function DeviceModal({ open, onClose, userId, device }: {
  open: boolean; onClose: () => void; userId: string; device?: LocalDevice;
}) {
  const [preferSoftware, setPreferSoftware] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const { toast } = useToast();

  function close() {
    setError(null);
    setPreferSoftware(false);
    onClose();
  }

  async function register() {
    setError(null);
    setBusy(true);
    try {
      const signer = await import("@/lib/client/signer");
      try {
        const registered = await signer.registerDevice(userId, { preferSoftware });
        toast({
          title: "Устройство привязано",
          description: registered.deviceKind === "SOFTWARE_FALLBACK" ? "Режим WebCrypto ECDSA + ML-DSA-65 (Software Fallback)." : "Passkey + ML-DSA-65 готовы к подписи.",
          tone: "success",
        });
        close();
      } catch (cause) {
        setError(signer.toClientError(cause));
      }
    } catch {
      setError({ status: "ERROR", failureCode: "ERR_CLIENT", message: "Не удалось загрузить модуль подписи." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} dismissible={!busy} title={device ? "Устройство SafeSign" : "Привязать устройство"}
      description={device ? undefined : "Гибридная подпись банковских операций без SMS."}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>Закрыть</Button>
        <Button loading={busy} icon={<Fingerprint className="size-4" />} onClick={() => void register()}>
          {device ? "Привязать новое устройство" : "Привязать устройство"}
        </Button>
      </div>}>
      {device && (
        <dl className="mb-4 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2"><dt>Устройство</dt><dd>{device.deviceName}</dd><Badge status={device.deviceKind} className="!whitespace-normal" /></div>
          <div className="flex flex-wrap gap-2 text-ink-secondary"><dt>Отпечаток ML-DSA-65</dt><dd className="mono-data">{device.pqKeyFingerprint}</dd></div>
        </dl>
      )}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={preferSoftware} disabled={busy} onChange={event => setPreferSoftware(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-bcc" />
        <span>Нет сканера отпечатка (Software Key)</span>
      </label>
      {preferSoftware && <p className="mt-2 text-sm text-ink-secondary">Режим WebCrypto ECDSA + ML-DSA-65 (Software Fallback).</p>}
      {error && <ErrorCard error={error} className="mt-3" />}
    </Modal>
  );
}

export function Topbar() {
  const pathname = usePathname();
  return pathname === "/phishing-clone" ? null : <BankTopbar pathname={pathname} />;
}

function BankTopbar({ pathname }: { pathname: string }) {
  const { mode, setMode, senderId, cosignerId } = useDemoMode();
  const { lastEvent, syncVersion, resyncVersion } = useEventStream();
  const { devices, loading: devicesLoading } = useLocalDevices();
  const resetEvent = lastEvent?.type === "DEMO_RESET" ? lastEvent.id : undefined;
  const [activeIds, setActiveIds] = useState<string[] | null>(null);
  const [pending, setPending] = useState<{ owner: string; count: number }>();
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

  useEffect(() => {
    const controller = new AbortController();
    void api.listTransactions({ status: "PENDING_COSIGN", userId: cosignerId }, controller.signal).then(result => {
      if (!controller.signal.aborted && result.ok) setPending({ owner: cosignerId, count: result.data.transactions.length });
    });
    return () => controller.abort();
  }, [cosignerId, lastEvent, syncVersion, resyncVersion]);

  return (
    <header className="sticky top-0 z-40 border-b border-border-default bg-surface/90 backdrop-blur-md">
      <div className="shell-container flex min-h-[var(--topbar-height)] flex-wrap items-center gap-x-4 gap-y-2 py-2.5 xl:flex-nowrap xl:justify-between">
        <Link href={`/?mode=${mode}`} className="inline-flex shrink-0 items-center gap-2 rounded-lg py-1.5 font-extrabold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl border border-bcc/40 bg-bcc/10 text-bcc">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          BCC SafeSign
        </Link>
        <SegmentedControl label="Режим демо" options={modeOptions} value={mode} onChange={setMode} className="order-3 w-full sm:order-none sm:w-auto" />
        <nav aria-label="Разделы SafeSign" className="order-4 flex w-full flex-wrap items-center gap-1 xl:order-none xl:w-auto xl:flex-nowrap">
          {tabs.map(tab => {
            const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
            const count = tab.href === "/cosign" && pending?.owner === cosignerId ? pending.count : 0;
            return (
              <Link key={tab.href} href={`${tab.href}?mode=${mode}`} prefetch={false} aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold
                  ${active ? "bg-elevated text-bcc" : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"}`}>
                {tab.label}
                {count > 0 && <span aria-label={`Ожидают подписи: ${count}`}
                  className="animate-pulse rounded-full bg-danger-solid px-1.5 font-mono text-xs text-white">{count}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2 xl:ml-0 xl:flex-nowrap">
          {device ? (
            <button type="button" onClick={() => setOpen("device")} className="rounded-full" title={device.deviceName}>
              <Badge status={device.deviceKind}>{device.deviceKind === "SOFTWARE_FALLBACK" ? "ECDSA + ML-DSA (Fallback)" : "Passkey + ML-DSA-65"}</Badge>
            </button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Zap className="size-4 text-gold motion-safe:animate-pulse" />}
              onClick={() => setOpen("device")} disabled={devicesLoading}>
              Привязать устройство за 5 сек
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setOpen("reset")}>Сбросить демо</Button>
        </div>
      </div>
      <DeviceModal open={open === "device"} onClose={() => setOpen(null)} userId={senderId} device={device} />
      <ResetDemoModal open={open === "reset"} onClose={() => setOpen(null)} />
    </header>
  );
}
