"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Fingerprint, Gift, Globe, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, ErrorCard } from "@/components/ui";
import { formatTenge } from "@/lib/ui/format";

export function OriginCheck({ rpId, bankOrigin }: { rpId: string; bankOrigin: string }) {
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ code: string; message: string }>();

  useEffect(() => { setOrigin(location.origin); }, []);

  const sameOrigin = origin === bankOrigin;
  const otherUrl = origin && `http://127.0.0.1${new URL(origin).port ? ":" + new URL(origin).port : ""}/phishing-clone`;

  async function check() {
    setBusy(true);
    setOutcome(undefined);
    try {
      if (!window.isSecureContext || !navigator.credentials?.get) {
        setOutcome({ code: "ERR_WEBAUTHN_UNSUPPORTED", message: "WebAuthn недоступен в этом браузере или контексте." });
        return;
      }
      // A fresh local challenge never enters a banking authentication ceremony.
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId,
          timeout: 15000,
          userVerification: "required",
        },
      });
      setOutcome({
        code: "BROWSER_RESULT",
        message: credential
          ? "Браузер разрешил получение тестового подтверждения на этом домене."
          : "Браузер завершил запрос без подтверждения.",
      });
    } catch (cause) {
      const code = cause instanceof Error ? cause.name : "ERR_BROWSER";
      setOutcome({
        code,
        message: code === "SecurityError"
          ? "Браузер отклонил запрос к ключу другого домена (WebAuthn Origin Lock)."
          : code === "NotAllowedError"
            ? "Подтверждение не получено. Браузер мог скрыть причину отказа, истекло время или запрос отменён."
            : "Браузер не смог завершить запрос WebAuthn.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/50 bg-danger/[.12] px-4 py-3 text-sm text-danger-text">
        <div className="flex flex-wrap items-center gap-2">
          <Globe aria-hidden="true" size={16} className="shrink-0" />
          <span className="font-semibold">Демо фишинга · чужой домен:</span>
          <code className="break-all rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs text-ink-primary">{origin || "…"}</code>
        </div>
        <a
          href={bankOrigin}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-border-strong bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:border-bcc/50 hover:bg-surface-hover"
        >
          <ArrowLeft aria-hidden="true" size={14} /> На демо-стенд
        </a>
      </div>

      <section className="relative overflow-hidden rounded-[24px] border border-gold/40 bg-[linear-gradient(130deg,#f9e4b8,#efbc74_54%,#e5a997)] p-6 text-[#312916] shadow-card sm:p-10">
        <Gift aria-hidden="true" className="absolute -bottom-8 -right-8 size-48 -rotate-12 opacity-10" strokeWidth={1} />
        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-[#312916] font-mono text-sm font-bold text-[#f9e4b8]">B+</span>
            B+ Bonus · Акция 2026
          </p>
          <span className="rounded-full bg-[#312916]/15 px-3 py-1 text-xs font-bold">Учебный сайт-клон</span>
        </div>
        <h1 className="relative mt-6 font-mono text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
          {formatTenge(50_000)}
        </h1>
        <p className="relative mb-6 mt-2 max-w-md text-sm font-medium leading-relaxed sm:text-base">
          Учебный бонус за подтверждение с Passkey. Проверьте вживую, как браузер аппаратно защищает ключ банка от сайта-клона.
        </p>
        <div className="relative flex flex-wrap items-center gap-3">
          <Button size="lg" icon={<Fingerprint size={18} />} disabled={!origin || sameOrigin} loading={busy} onClick={() => void check()}>
            Получить {formatTenge(50_000)} (Passkey)
          </Button>
        </div>
      </section>

      {sameOrigin && (
        <Card variant="warning" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-primary">
            Сейчас открыт настоящий домен банка. Для наглядного отказа браузера перейдите на альтернативный Origin.
          </p>
          <a
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-gold px-3.5 py-1.5 text-[13px] font-semibold text-ink-inverse shadow-glow-gold transition hover:bg-gold-hover"
            href={otherUrl}
          >
            Открыть на 127.0.0.1 <ExternalLink aria-hidden="true" size={14} />
          </a>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-h2">{outcome ? "Что сейчас произошло" : "Привязка домена ключа (Origin Lock)"}</h2>
          {origin && (
            <Badge tone={sameOrigin ? "warning" : "danger"} className="font-mono">
              {sameOrigin ? "SAME ORIGIN" : "ORIGIN MISMATCH"}
            </Badge>
          )}
        </div>

        <dl className="grid gap-2 rounded-xl border border-border-default bg-terminal p-3.5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-muted">Настоящий RP ID банка</dt>
            <dd className="mono-data mt-0.5 text-bcc">{rpId}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Текущий Origin страницы</dt>
            <dd className={`mono-data mt-0.5 break-all ${sameOrigin ? "text-amber-300" : "text-danger-text"}`}>{origin || "…"}</dd>
          </div>
        </dl>

        {outcome && (outcome.code === "BROWSER_RESULT" ? (
          <p role="status" className="rounded-xl border border-border-default bg-elevated p-3 text-sm text-ink-primary">{outcome.message}</p>
        ) : (
          <ErrorCard title="Фишинг заблокирован браузером" error={{ failureCode: outcome.code, message: outcome.message }} />
        ))}

        {outcome && (
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-secondary">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-bcc" />
            <span>
              Браузер аппаратно сверяет домен страницы с RP ID ключа. <code className="font-mono text-ink-primary">localhost</code> и{" "}
              <code className="font-mono text-ink-primary">127.0.0.1</code> считаются разными доменами — украсть Passkey на клоне невозможно.
            </span>
          </p>
        )}
      </Card>
    </main>
  );
}
