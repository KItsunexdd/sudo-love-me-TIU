"use client";

import { useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button, ErrorCard, Modal, SegmentedControl } from "@/components/ui";
import type { ApiError } from "@/lib/client/api";
import { registerDevice, toClientError } from "@/lib/client/signer";

export function DeviceOnboarding({ userId, software, onClose }: { userId: string; software: boolean; onClose: () => void }) {
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
  return <Modal open onClose={onClose} dismissible={!busy} title="Привязать устройство" description="Выберите ключ для подтверждения операций."
    footer={<Button loading={busy} icon={<Fingerprint size={18} />} onClick={() => void register()}>Привязать устройство</Button>}>
    <div className="space-y-3">
      <SegmentedControl label="Ключ устройства" value={choice} onChange={setChoice} options={[
        { value: "passkey", label: "Passkey", disabled: busy }, { value: "software", label: "Software Key", disabled: busy },
      ]} />
      <p className="text-sm text-ink-secondary">{choice === "software" ? "Браузер создаст ключ ECDSA P-256 для устройств без сканера." :
        "Подтвердите привязку в системном окне Passkey."} Ключ ML-DSA-65 будет создан на этом устройстве.</p>
      {error && <ErrorCard error={error} />}
    </div>
  </Modal>;
}
