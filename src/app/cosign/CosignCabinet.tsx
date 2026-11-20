"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import { useRouter, useSearchParams } from "next/navigation";
import { CosignFeed } from "@/components/cosign/CosignFeed";
import { cosignHref, cosignMode, selectCosigner } from "@/components/cosign/cosignDetails";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { Card, SegmentedControl, Skeleton } from "@/components/ui";
import type { Segment } from "@/components/ui/SegmentedControl";
import type { Mode } from "@/lib/db/types";

const getProfiles = (t: Translate) => ([
  { value: "B2C", label: t("common.trusted") },
  { value: "B2B", label: t("common.director") },
] as const satisfies readonly Segment<Mode>[]);

export function CosignCabinet() {
  const { locale, t } = useT();
  const profiles = getProfiles(t);
  const search = useSearchParams();
  const router = useRouter();
  const { mode: demoMode, setMode } = useDemoMode();
  const requestedId = search.get("userId")?.trim() || null;
  const mode = cosignMode(demoMode, requestedId);
  const userId = selectCosigner(mode, requestedId);

  return (
    <CosignFeed
      key={`${mode}:${userId}`}
      userId={userId}
      mode={mode}
      hideConnectionBadge
      profileSwitch={
        <SegmentedControl
          label={t("cosignCabinet.profile")}
          value={mode}
          options={profiles}
          className="w-full"
          onChange={next => {
            setMode(next);
            router.replace(cosignHref(next, null, locale));
          }}
        />
      }
    />
  );
}

export function CosignPageSkeleton() {
  const { t } = useT();
  return (
    <div aria-busy="true" aria-label={t("cosign.opening")} className="space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-48" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-[10px]" />
      <Card className="space-y-3">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-[10px]" />
        <Skeleton className="h-11 w-full rounded-[10px]" />
      </Card>
    </div>
  );
}
