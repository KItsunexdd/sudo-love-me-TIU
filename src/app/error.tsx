"use client";

import { useT } from "@/components/shell/LocaleProvider";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorCard } from "@/components/ui/ErrorCard";

export default function AppError({ reset }: { reset: () => void }) {
  const { t } = useT();
  return (
    <main className="shell-container flex min-h-[calc(100dvh-var(--topbar-height))] items-center justify-center py-8">
      <div className="w-full max-w-xl">
        <ErrorCard
          title={t("error.renderError")}
          error={{
            failureCode: "ERR_CLIENT_RENDER",
            message: t("error.recovery"),
          }}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={<RotateCcw />} onClick={reset}>
                {t("error.retry")}
              </Button>
              <Link
                href="/"
                className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border-strong bg-elevated px-3 py-1 text-[0.8125rem] font-medium text-ink-primary shadow-highlight transition-colors hover:bg-surface-hover"
              >
                {t("error.home")}
              </Link>
            </div>
          }
        />
      </div>
    </main>
  );
}
