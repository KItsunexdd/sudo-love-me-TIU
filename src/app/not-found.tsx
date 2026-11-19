import Link from "next/link";
import { Calculator, Home, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Badge, Card } from "@/components/ui";

const quickLinks = [
  { href: "/", label: "Демо-стенд", note: "Переводы, Passkey + ML-DSA-65 и 6 атак", icon: Home },
  { href: "/cosign", label: "Вторая рука", note: "Мобильный кабинет Co-Sign 2-of-2", icon: Users },
  { href: "/soc", label: "SOC-центр", note: "Журнал отражённых атак и метрики", icon: ShieldCheck },
  { href: "/roi", label: "ROI-калькулятор", note: "Экономия БЦК на отказе от SMS", icon: Calculator },
];

export default function NotFound() {
  return (
    <main className="shell-container flex min-h-[calc(100dvh-var(--topbar-height))] items-center justify-center py-10">
      <Card variant="elevated" className="w-full max-w-2xl space-y-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-danger/45 bg-danger/[.14] text-danger-text shadow-glow-danger">
            <ShieldAlert aria-hidden="true" className="size-7" />
          </span>
          <div className="min-w-0 space-y-1">
            <Badge tone="danger" className="font-mono tabular-nums">HTTP 404 • ERR_ROUTE_NOT_FOUND</Badge>
            <h1 className="type-h1">Страница не найдена</h1>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-ink-secondary">
          Запрошенный адрес отсутствует в BCC SafeSign или устарел. Выберите нужный раздел стенда ниже, чтобы продолжить демонстрацию.
        </p>

        <nav aria-label="Быстрый переход по разделам" className="grid gap-3 sm:grid-cols-2">
          {quickLinks.map(({ href, label, note, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-3 rounded-xl border border-border-default bg-surface p-3.5 transition duration-150 hover:border-bcc/50 hover:bg-surface-hover"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border-strong bg-elevated text-bcc transition-colors group-hover:border-bcc/50">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-primary">{label}</span>
                <span className="mt-0.5 block text-xs text-ink-secondary">{note}</span>
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <span className="mono-data text-ink-muted">BCC SafeSign · Zero-Crash Shell</span>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bcc px-5 py-2 text-sm font-semibold text-ink-inverse shadow-glow-bcc transition duration-150 hover:bg-bcc-hover active:bg-bcc-active"
          >
            Вернуться на Демо-стенд
          </Link>
        </div>
      </Card>
    </main>
  );
}
