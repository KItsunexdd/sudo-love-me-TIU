"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { Card, PhoneFrame, Skeleton } from "@/components/ui";

export default function Loading() {
  const { t } = useT();
  return (
    <main aria-busy="true" aria-label={t("loading.loading")} className="shell-container grid items-start gap-5 py-4 min-[1100px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] 2xl:gap-6 2xl:py-6">
      <PhoneFrame className="mx-auto max-w-[560px] min-[1100px]:max-w-none">
        <div className="space-y-3 p-1 md:px-4 md:pb-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-[10px]" />
        </div>
      </PhoneFrame>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-9 w-72 rounded-[10px]" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </Card>
          ))}
        </div>
        <Card className="space-y-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </Card>
      </div>
    </main>
  );
}
