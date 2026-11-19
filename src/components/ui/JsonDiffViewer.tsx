import type { TamperDiff } from "@/lib/db/types";
import { Badge } from "./Badge";
import { HashChip } from "./HashChip";

const tokens = /("(?:[^"\\]|\\.)*")([ \t]*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b)/g;
const criticalFields = new Set(["origin", "challenge", "amountTenge", "recipientAccount", "nonce"]);

function serialize(value: unknown, json?: string) {
  try {
    return JSON.stringify(json === undefined ? value : JSON.parse(json), null, 2) ?? "—";
  } catch {
    return json ?? "Данные недоступны";
  }
}

function JsonSyntax({ text }: { text: string }) {
  const pieces = [];
  let from = 0;
  for (const match of text.matchAll(tokens)) {
    const [token, quoted, colon] = match;
    const start = match.index;
    pieces.push(text.slice(from, start));
    if (colon) {
      const critical = criticalFields.has(quoted.slice(1, -1));
      pieces.push(
        <span key={start} className={critical ? "rounded bg-quantum/[.12] text-sky-300" : "text-ink-muted"}>{quoted}</span>,
        colon,
      );
    } else {
      pieces.push(<span key={start} className={quoted ? "text-emerald-200" : "text-amber-300"}>{token}</span>);
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
            <li key={field} className="space-y-1">
              <div className="break-all text-ink-muted">{field}</div>
              <div className="rounded border-l-[3px] border-bcc bg-bcc/10 px-3 py-2 text-emerald-200 [overflow-wrap:anywhere]">
                ✓ Подписано <code>{original}</code>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border-l-[3px] border-danger bg-danger/[.18] px-3 py-2 text-danger-text">
                <span className="[overflow-wrap:anywhere]">✕ Подмена MITM <code>{tampered}</code></span>
                <Badge tone="danger">Подменено</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <pre tabIndex={0} className="max-w-full overflow-auto rounded"><code><JsonSyntax text={serialize(value, json)} /></code></pre>
      )}
    </div>
  );
}
