"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { Fingerprint, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorCard, SegmentedControl } from "@/components/ui";
import type { Segment } from "@/components/ui/SegmentedControl";
import { api, type ApiError } from "@/lib/client/api";
import { registerDevice, toClientError } from "@/lib/client/signer";
import { useLocalDevices } from "@/lib/client/useLocalDevices";

const keyOptions = [
  { value: "passkey", label: "Passkey" },
  { value: "software", label: "Software Key" },
] as const satisfies readonly Segment<"passkey" | "software">[];

export function useCosignDevice(userId: string, syncVersion: number, resyncVersion: number, resetId?: number) {
  const { t } = useT();
  const local = useLocalDevices();
  const [server, setServer] = useState<{ ids: Set<string>; resetId?: number }>();
  const [error, setError] = useState<ApiError | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const hasLocal = local.devices.some(device => device.userId === userId);
  const serverIds = server?.resetId === resetId ? server?.ids : undefined;

  useEffect(() => {
    if (!hasLocal) return;
    const controller = new AbortController();
    void api.listDevices(userId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setError(result.error);
      if (result.ok) setServer({ ids: new Set(result.data.devices.map(device => device.id)), resetId });
    });
    return () => controller.abort();
  }, [hasLocal, local.devices, userId, syncVersion, resyncVersion, resetId, retryVersion]);

  const devices = local.devices.filter(device => device.userId === userId && serverIds?.has(device.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    devices,
    loading: local.loading || (hasLocal && !serverIds && !error),
    error: local.unavailable ? {
      status: "ERROR", failureCode: "ERR_CLIENT_KEYSTORE", message: t("cosignDevicePanel.keystore"),
    } : error,
    retry: () => setRetryVersion(version => version + 1),
  };
}

export function CosignDevicePanel({ userId }: { userId: string }) {
  const { t } = useT();
  const [choice, setChoice] = useState<"passkey" | "software">("passkey");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function register() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await registerDevice(userId, { preferSoftware: choice === "software", deviceName: "Вторая рука" });
    } catch (cause) {
      setError(toClientError(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Card variant="elevated" className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden="true" className="size-4 text-bcc" />
        <h3 className="type-h3">{t("cosignDevicePanel.secondDevice")}</h3>
      </div>
      <p className="text-sm text-ink-secondary">{t("cosignDevicePanel.choose")}</p>
      <SegmentedControl label={t("cosignDevicePanel.method")} className="w-full" value={choice} options={keyOptions} onChange={setChoice} />
      {choice === "software" && <p className="text-xs text-ink-secondary">{t("cosignDevicePanel.https")}</p>}
      <Button className="w-full" variant="secondary" loading={busy} icon={<Fingerprint className="size-4" />} onClick={() => void register()}>
        {t("common.enroll")}
      </Button>
      {error && <ErrorCard error={error} />}
    </Card>
  );
}
