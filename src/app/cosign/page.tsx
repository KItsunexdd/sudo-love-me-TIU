"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CosignFeed } from "@/components/cosign/CosignFeed";
import { cosignHref, cosignMode, selectCosigner } from "@/components/cosign/cosignDetails";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { SegmentedControl, Spinner } from "@/components/ui";
import type { Segment } from "@/components/ui/SegmentedControl";
import type { Mode } from "@/lib/db/types";

const profiles = [
  { value: "B2C", label: "Доверенное лицо" },
  { value: "B2B", label: "Директор", tone: "gold" },
] as const satisfies readonly Segment<Mode>[];

function CosignCabinet() {
  const search = useSearchParams();
  const router = useRouter();
  const { mode: demoMode, setMode } = useDemoMode();
  const requestedId = search.get("userId")?.trim() || null;
  const mode = cosignMode(demoMode, requestedId);
  const userId = selectCosigner(mode, requestedId);

  return (
    <CosignFeed key={`${mode}:${userId}`} userId={userId} mode={mode} profileSwitch={
      <SegmentedControl label="Профиль второй подписи" value={mode} options={profiles} className="w-full" onChange={next => {
        setMode(next);
        router.replace(cosignHref(next));
      }} />
    } />
  );
}

export default function CosignPage() {
  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--topbar-height))] w-full max-w-[460px] px-4 py-5">
      <Suspense fallback={<Spinner label="Открываем кабинет «Вторая рука»" />}>
        <CosignCabinet />
      </Suspense>
    </main>
  );
}
