"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import Link from "next/link";
import { Calculator, Home, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Card } from "@/components/ui";

const getQuickLinks = (t: Translate) => ([
  { href: "/", label: t("common.demo"), note: t("not-found.demoNote"), icon: Home },
  { href: "/cosign", label: t("common.secondHand"), note: t("not-found.cosignNote"), icon: Users },
  { href: "/soc", label: t("common.soc"), note: t("not-found.socNote"), icon: ShieldCheck },
  { href: "/roi", label: t("common.roi"), note: t("not-found.roiNote"), icon: Calculator },
]);

export default function NotFound() {
  const { t } = useT();
  const quickLinks = getQuickLinks(t);
  return (
    <main className="shell-container flex min-h-[calc(100dvh-var(--topbar-height))] items-center justify-center py-10">
      <Card className="w-full max-w-2xl space-y-6 rounded-2xl p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldAlert aria-hidden="true" className="mt-1 size-5 shrink-0 text-danger-text" strokeWidth={1.75} />
          <div className="min-w-0 space-y-1">
            <p className="font-mono text-[0.8125rem] tabular-nums text-danger-text">HTTP 404 · ERR_ROUTE_NOT_FOUND</p>
            <h1 className="type-h1">{t("not-found.missing")}</h1>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-ink-secondary">
          {t("not-found.hint")}
        </p>

        <nav aria-label={t("not-found.quickLinks")} className="grid gap-3 sm:grid-cols-2">
          {quickLinks.map(({ href, label, note, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-lg border border-border-default bg-surface p-4 transition-colors hover:bg-surface-hover"
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-primary">{label}</span>
                <span className="mt-0.5 block text-xs text-ink-secondary">{note}</span>
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <span className="mono-data text-ink-muted">BCC SafeSign · Zero-Crash Shell</span>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-bcc px-4 py-2 text-sm font-medium text-ink-inverse shadow-highlight transition-colors hover:bg-bcc-hover active:bg-bcc-active"
          >
            {t("not-found.back")}
          </Link>
        </div>
      </Card>
    </main>
  );
}
