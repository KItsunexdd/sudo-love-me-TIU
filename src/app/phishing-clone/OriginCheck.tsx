"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Gift, Globe, ShieldCheck } from "lucide-react";
import { Button, Card, ErrorCard } from "@/components/ui";

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
      const credential = await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)), rpId, timeout: 15000, userVerification: "required",
      } });
      setOutcome({ code: "BROWSER_RESULT", message: credential ? "Браузер разрешил получение тестового подтверждения на этом домене." : "Браузер завершил запрос без подтверждения." });
    } catch (cause) {
      const code = cause instanceof Error ? cause.name : "ERR_BROWSER";
      setOutcome({ code, message: code === "SecurityError" ? "Браузер отклонил запрос к ключу другого домена." :
        code === "NotAllowedError" ? "Подтверждение не получено. Браузер мог скрыть причину отказа, истекло время или запрос отменён." : "Браузер не смог завершить запрос WebAuthn." });
    } finally { setBusy(false); }
  }
  return <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-8">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger-text">
      <Globe size={16} /> Учебная страница на другом домене <code className="break-all">{origin}</code>
    </div>
    <section className="relative overflow-hidden rounded-3xl bg-[linear-gradient(130deg,#f9e4b8,#efbc74_54%,#e5a997)] p-6 text-[#312916] shadow-card sm:p-10">
      <Gift aria-hidden="true" className="absolute -bottom-8 -right-8 size-48 -rotate-12 opacity-10" strokeWidth={1} />
      <p className="text-lg font-bold">B+ Bonus</p><h1 className="mt-6 text-5xl font-extrabold tracking-tight">50 000 ₸</h1>
      <p className="mb-6 mt-2 max-w-sm">Учебный бонус за подтверждение с Passkey. Проверьте, как браузер защищает ключ банка.</p>
      <Button icon={<Fingerprint size={18} />} disabled={!origin || sameOrigin} loading={busy} onClick={() => void check()}>Получить бонус</Button>
    </section>
    {sameOrigin && <Card variant="warning">Сейчас открыт домен банка. <a className="underline" href={otherUrl}>Открыть учебную страницу на другом домене</a></Card>}
    <Card className="space-y-3"><h2 className="type-h2">{outcome ? "Что сейчас произошло" : "Домен ключа"}</h2>
      <dl className="grid gap-2 rounded-xl bg-terminal p-3 text-sm"><div>RP ID банка · <code>{rpId}</code></div><div>Origin страницы · <code className="break-all">{origin || "…"}</code></div></dl>
      {outcome && (outcome.code === "BROWSER_RESULT" ? <p role="status">{outcome.message}</p> :
        <ErrorCard title="Ответ браузера" error={{ failureCode: outcome.code, message: outcome.message }} />)}
      {outcome && <p className="flex items-start gap-2 text-sm text-ink-secondary"><ShieldCheck className="size-5 shrink-0 text-bcc" />Браузер сверяет домен страницы с RP ID ключа. localhost и 127.0.0.1 считаются разными именами хоста.</p>}
    </Card>
  </main>;
}
