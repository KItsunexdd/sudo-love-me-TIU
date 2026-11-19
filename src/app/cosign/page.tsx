import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui";
import { CosignCabinet } from "./CosignCabinet";

export const metadata: Metadata = {
  title: "Вторая рука (Co-Sign)",
  description:
    "Мобильный кабинет доверенного лица и директора для подтверждения или блокировки рискованных операций Smart Co-Sign 2-of-2.",
  openGraph: {
    title: "Вторая рука (Co-Sign) · BCC SafeSign",
    description:
      "Мгновенные уведомления SSE Live и вторая криптоподпись Passkey + ML-DSA-65 для защиты от социальной инженерии.",
  },
};

function CosignPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Открываем кабинет «Вторая рука»" className="space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-48" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Card className="space-y-3">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-[14px]" />
        <Skeleton className="h-12 w-full rounded-[14px]" />
      </Card>
    </div>
  );
}

export default function CosignPage() {
  return (
    <main className="mx-auto min-h-[calc(100dvh-56px)] w-full max-w-[460px] px-3.5 py-2.5 sm:py-4">
      <Suspense fallback={<CosignPageSkeleton />}>
        <CosignCabinet />
      </Suspense>
    </main>
  );
}
