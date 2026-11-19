"use client";

import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { PhoneFrame } from "@/components/ui";
import { CosignFeed } from "./CosignFeed";
import { cosignMode, selectCosigner } from "./cosignDetails";

export default function CosignLiveEmbed({ cosignerUserId }: { cosignerUserId?: string } = {}) {
  const demo = useDemoMode();
  const userId = selectCosigner(demo.mode, cosignerUserId);
  const mode = cosignMode(demo.mode, userId);
  const owner = mode === "B2B" ? "Телефон Тимура · Директор (Passkey #2)" : "Телефон Армана · Вторая рука (Passkey #2)";

  return (
    <PhoneFrame preset="compact" owner={owner}>
      <CosignFeed key={`${mode}:${userId}`} userId={userId} mode={mode} compact />
    </PhoneFrame>
  );
}
