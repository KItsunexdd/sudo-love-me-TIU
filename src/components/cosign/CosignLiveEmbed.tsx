"use client";

import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { PhoneFrame } from "@/components/ui";
import { CosignFeed } from "./CosignFeed";
import { cosignMode, selectCosigner } from "./cosignDetails";

export default function CosignLiveEmbed({ cosignerUserId }: { cosignerUserId?: string } = {}) {
  const demo = useDemoMode();
  const userId = selectCosigner(demo.mode, cosignerUserId);
  const mode = cosignMode(demo.mode, userId);

  return (
    <PhoneFrame preset="compact">
      <CosignFeed key={`${mode}:${userId}`} userId={userId} mode={mode} compact />
    </PhoneFrame>
  );
}
