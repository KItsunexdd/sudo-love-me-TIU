"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button, ErrorCard, Modal, SegmentedControl } from "@/components/ui";
import type { ApiError } from "@/lib/client/api";
import { registerDevice, toClientError } from "@/lib/client/signer";

export function DeviceOnboarding({ userId, software, onClose }: { userId: string; software: boolean; onClose: () => void }) {
  const { t } = useT();
  const [choice, setChoice] = useState(software ? "software" : "passkey");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<ApiError>();
  async function register() {
    if (submitting.current) return;
    submitting.current = true;
    setError(undefined);
    setBusy(true);
    try {
      await registerDevice(userId, { preferSoftware: choice === "software" });
      onClose();
    } catch (cause) {
      setError(toClientError(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return <Modal open onClose={onClose} dismissible={!busy} title={t("common.enroll")} description={t("deviceOnboarding.choose")}
    footer={<Button loading={busy} icon={<Fingerprint />} onClick={() => void register()}>{t("common.enroll")}</Button>}>
    <div className="space-y-4">
      <SegmentedControl label={t("deviceOnboarding.deviceKey")} value={choice} onChange={setChoice} options={[
        { value: "passkey", label: "Passkey", disabled: busy }, { value: "software", label: "Software Key", disabled: busy },
      ]} />
      <p className="text-sm text-ink-secondary">{choice === "software" ? t("deviceOnboarding.software") :
        t("deviceOnboarding.passkey")} {t("deviceOnboarding.pq")}</p>
      {error && <ErrorCard error={error} />}
    </div>
  </Modal>;
}
