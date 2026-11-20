"use client";

import type { MessageKey } from "@/lib/i18n";
import { LocaleSwitch, useT } from "@/components/shell/LocaleProvider";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Fingerprint, Gift, Globe, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, ErrorCard } from "@/components/ui";
import { formatTenge } from "@/lib/ui/format";

export function OriginCheck({ rpId, bankOrigin: configuredOrigin }: { rpId: string; bankOrigin?: string }) {
  const { locale, t } = useT();
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ code: string; message: MessageKey }>();

  useEffect(() => { setOrigin(location.origin); }, []);

  const local = origin ? new URL(origin) : undefined;
  if (local) local.hostname = "localhost";
  const bankOrigin = configuredOrigin ?? local?.origin;
  const sameOrigin = origin === bankOrigin;
  if (local) local.hostname = "127.0.0.1";
  const otherUrl = local && new URL("/phishing-clone", local).href;

  async function check() {
    setBusy(true);
    setOutcome(undefined);
    try {
      if (!window.isSecureContext || !navigator.credentials?.get) {
        setOutcome({ code: "ERR_WEBAUTHN_UNSUPPORTED", message: "originCheck.unsupported" });
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
          ? "originCheck.allowed"
          : "originCheck.noAssertion",
      });
    } catch (cause) {
      const code = cause instanceof Error ? cause.name : "ERR_BROWSER";
      setOutcome({
        code,
        message: code === "SecurityError"
          ? "originCheck.blocked"
          : code === "NotAllowedError"
            ? "originCheck.noConfirmation"
            : "originCheck.failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/45 bg-danger/[.08] px-4 py-3 text-sm text-danger-text">
        <div className="flex flex-wrap items-center gap-2">
          <Globe aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0" />
          <span>{t("originCheck.domain")}</span>
          <code className="break-all font-mono text-xs text-ink-primary">{origin || "…"}</code>
        </div>
        <LocaleSwitch />
        <a
          href={bankOrigin && `${bankOrigin.replace(/\/$/, "")}/?lang=${locale}`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-elevated px-3 py-1 text-xs font-medium text-ink-primary shadow-highlight transition-colors hover:bg-surface-hover"
        >
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.75} /> {t("originCheck.back")}
        </a>
      </div>

      <section className="relative overflow-hidden rounded-[24px] border border-gold/40 bg-[linear-gradient(130deg,#f9e4b8,#efbc74_54%,#e5a997)] p-6 text-[#312916] shadow-card sm:p-10">
        <Gift aria-hidden="true" className="absolute -bottom-8 -right-8 size-48 -rotate-12 opacity-10" strokeWidth={1} />
        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-[#312916] font-mono text-sm font-bold text-[#f9e4b8]">B+</span>
            {t("originCheck.promotion")}
          </p>
          <span className="rounded-full bg-[#312916]/15 px-3 py-1 text-xs font-bold">{t("originCheck.clone")}</span>
        </div>
        <h1 className="relative mt-6 font-mono text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
          {formatTenge(50_000)}
        </h1>
        <p className="relative mb-6 mt-2 max-w-md text-sm font-medium leading-relaxed sm:text-base">
          {t("originCheck.bonus")}
        </p>
        <div className="relative flex flex-wrap items-center gap-3">
          <Button size="lg" icon={<Fingerprint size={18} />} disabled={!origin || sameOrigin} loading={busy} onClick={() => void check()}>
            {t("originCheck.claim", { amount: formatTenge(50_000) })}
          </Button>
        </div>
      </section>

      {sameOrigin && (
        <Card variant="warning" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-primary">
            {t("originCheck.official")}
          </p>
          <a
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gold px-3 py-1 text-[0.8125rem] font-medium text-ink-inverse shadow-highlight transition-colors hover:bg-gold-hover"
            href={otherUrl && `${otherUrl}?lang=${locale}`}
          >
            {t("originCheck.alternate")} <ExternalLink aria-hidden="true" size={14} />
          </a>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-h2">{outcome ? t("originCheck.explanation") : t("originCheck.lock")}</h2>
          {origin && (
            <Badge tone={sameOrigin ? "warning" : "danger"} className="font-mono">
              {sameOrigin ? "SAME ORIGIN" : "ORIGIN MISMATCH"}
            </Badge>
          )}
        </div>

        <dl className="grid gap-3 rounded-lg border border-border-default bg-terminal p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-ink-muted">{t("originCheck.rpId")}</dt>
            <dd className="mono-data mt-1 text-ink-primary">{rpId}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t("originCheck.origin")}</dt>
            <dd className={`mono-data mt-1 break-all ${sameOrigin ? "text-gold-text" : "text-danger-text"}`}>{origin || "…"}</dd>
          </div>
        </dl>

        {outcome && (outcome.code === "BROWSER_RESULT" ? (
          <p role="status" className="rounded-lg border border-border-default bg-elevated p-4 text-sm text-ink-primary">{t(outcome.message)}</p>
        ) : (
          <ErrorCard title={t("originCheck.heading")} error={{ failureCode: outcome.code, message: t(outcome.message) }} />
        ))}

        {outcome && (
          <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-secondary">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-bcc" strokeWidth={1.75} />
            <span>
              {t("originCheck.domainCheck")} <code className="font-mono text-ink-primary">localhost</code> {t("originCheck.and")}{" "}
              <code className="font-mono text-ink-primary">127.0.0.1</code> {t("originCheck.distinct")}
            </span>
          </p>
        )}
      </Card>
    </main>
  );
}
