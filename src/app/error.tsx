"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorCard } from "@/components/ui/ErrorCard";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="shell-container flex min-h-[calc(100dvh-var(--topbar-height))] items-center justify-center py-8">
      <div className="w-full max-w-xl">
        <ErrorCard
          title="Произошла ошибка при отображении раздела"
          error={{
            failureCode: "ERR_CLIENT_RENDER",
            message: "Данные счетов не пострадали. Попробуйте перезагрузить экран или вернуться на Демо-стенд.",
          }}
          action={
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={reset}>
                Попробовать снова
              </Button>
              <Link
                href="/"
                className="inline-flex min-h-9 items-center justify-center rounded-[10px] border border-border-strong bg-elevated px-3 py-1.5 text-[13px] font-semibold text-ink-primary transition duration-150 hover:border-bcc/50 hover:bg-surface-hover"
              >
                На Демо-стенд
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
