import type { TamperDiff } from "@/lib/db/types";
import { formatIban, formatTenge } from "@/lib/ui/format";
import { Badge } from "./Badge";
import { HashChip } from "./HashChip";

const tokens = /("(?:[^"\\]|\\.)*")([ \t]*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b)/g;
const criticalFields = new Set(["origin", "challenge", "amountTenge", "recipientAccount", "nonce"]);

const fieldLabels: Record<string, string> = {
  amountTenge: "Сумма операции",
  recipientAccount: "Счёт получателя (IBAN)",
  recipientName: "Получатель",
  senderAccount: "Счёт отправителя (IBAN)",
  purpose: "Назначение платежа",
  operationType: "Тип операции",
  currency: "Валюта",
  rpId: "Домен (RP ID)",
  nonce: "Одноразовый Nonce",
};

function serialize(value: unknown, json?: string) {
  try {
    return JSON.stringify(json === undefined ? value : JSON.parse(json), null, 2) ?? "—";
  } catch {
    return json ?? "Данные недоступны";
  }
}

function renderDiffValue(field: string, raw: string) {
  if (field === "amountTenge") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <strong className="font-sans font-bold tabular-nums">{formatTenge(parsed)}</strong>
          <code className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-xs tabular-nums opacity-90">{raw}</code>
        </span>
      );
    }
  }
  if (field === "recipientAccount" || field === "senderAccount") {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        <code className="font-mono font-semibold" title={raw}>{formatIban(raw)}</code>
      </span>
    );
  }
  return <code className="font-mono">{raw}</code>;
}

function JsonSyntax({ text }: { text: string }) {
  const pieces = [];
  let from = 0;
  let lastKey: string | null = null;
  for (const match of text.matchAll(tokens)) {
    const [token, quoted, colon] = match;
    const start = match.index;
    const gap = text.slice(from, start);
    pieces.push(gap);
    if (gap.includes(",") || gap.includes("{") || gap.includes("}")) {
      lastKey = null;
    }
    if (colon) {
      const key = quoted.slice(1, -1);
      lastKey = key;
      const critical = criticalFields.has(key);
      pieces.push(
        <span key={start} className={critical ? "rounded bg-quantum/[.12] px-0.5 text-sky-300" : "text-ink-muted"}>{quoted}</span>,
        colon,
      );
    } else {
      const isAmountNumber = lastKey === "amountTenge" && !quoted && /^-?\d+(?:\.\d+)?$/.test(token);
      const parsedAmount = isAmountNumber ? Number(token) : Number.NaN;
      pieces.push(
        <span key={start} className={quoted ? "text-emerald-200" : "tabular-nums text-amber-300"}>
          {token}
        </span>,
      );
      if (isAmountNumber && Number.isFinite(parsedAmount)) {
        pieces.push(
          <span
            key={`${start}-fmt`}
            className="ml-2 inline-block rounded bg-bcc/[.12] px-1.5 py-0.5 font-sans text-xs font-semibold tabular-nums text-emerald-300"
          >
            {formatTenge(parsedAmount)}
          </span>,
        );
      }
      lastKey = null;
    }
    from = start + token.length;
  }
  pieces.push(text.slice(from));
  return <>{pieces}</>;
}

export function JsonDiffViewer({ value, json, tamperDiff = [], signedHash, receivedHash, className = "" }: {
  value?: unknown; json?: string; tamperDiff?: TamperDiff; signedHash?: string; receivedHash?: string; className?: string;
}) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-xl border border-border-default bg-terminal p-3.5 font-mono text-[13px] leading-relaxed ${className}`}>
      {(signedHash || receivedHash) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {signedHash && <HashChip value={signedHash} label="Подписанный SHA-256" />}
          {receivedHash && <HashChip value={receivedHash} label="Полученный SHA-256" tone={signedHash === receivedHash ? "success" : "danger"} />}
          {signedHash && receivedHash && signedHash !== receivedHash && <Badge tone="danger">Хэши различаются</Badge>}
        </div>
      )}
      {tamperDiff.length > 0 ? (
        <ul className="space-y-3">
          {tamperDiff.map(({ field, original, tampered }) => (
            <li key={field} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {fieldLabels[field] && <span className="font-sans font-semibold text-ink-secondary">{fieldLabels[field]}</span>}
                <code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono">{field}</code>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border-l-[3px] border-bcc bg-bcc/10 px-3 py-2 text-emerald-200 [overflow-wrap:anywhere]">
                <span className="font-sans text-xs font-semibold uppercase tracking-wide text-bcc">✓ Подписано:</span>
                {renderDiffValue(field, original)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-[3px] border-danger bg-danger/[.18] px-3 py-2 text-danger-text">
                <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
                  <span className="font-sans text-xs font-semibold uppercase tracking-wide">✕ Подмена MITM:</span>
                  {renderDiffValue(field, tampered)}
                </span>
                <Badge tone="danger">Подменено</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <pre tabIndex={0} className="max-w-full overflow-auto rounded-lg"><code><JsonSyntax text={serialize(value, json)} /></code></pre>
      )}
    </div>
  );
}
