"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { PhoneFrame } from "@/components/ui";
import { CosignFeed } from "./CosignFeed";
import { cosignMode, selectCosigner } from "./cosignDetails";

export default function CosignLiveEmbed({ cosignerUserId }: { cosignerUserId?: string } = {}) {
  const { t } = useT();
  const demo = useDemoMode();
  const userId = selectCosigner(demo.mode, cosignerUserId);
  const mode = cosignMode(demo.mode, userId);
  const owner = mode === "B2B" ? t("cosignLiveEmbed.directorPhone") : t("cosignLiveEmbed.familyPhone");

  return (
    <PhoneFrame preset="compact" owner={owner}>
      <CosignFeed key={`${mode}:${userId}`} userId={userId} mode={mode} compact />
    </PhoneFrame>
  );
}
