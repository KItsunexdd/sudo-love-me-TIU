import type { Metadata } from "next";
import { Suspense } from "react";
import { CosignCabinet, CosignPageSkeleton } from "./CosignCabinet";

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


export default function CosignPage() {
  return (
    <main className="mx-auto min-h-[calc(100dvh-56px)] w-full max-w-[460px] px-3.5 py-2.5 sm:py-4">
      <Suspense fallback={<CosignPageSkeleton />}>
        <CosignCabinet />
      </Suspense>
    </main>
  );
}
