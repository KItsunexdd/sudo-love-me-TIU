"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, Atom, ChevronRight, ExternalLink, GlobeLock, PhoneIncoming, Repeat2, ScanLine, Terminal, type LucideIcon } from "lucide-react";
import { Button, Card, EmptyState, ErrorCard, SegmentedControl, Toggle } from "@/components/ui";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import type { ApiError, ApiResult, ExecuteResponse, PrepareInput } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { armInterceptor, foreignOriginFor, replayLastPacket, submitFromForeignOrigin, useAttackState } from "./attacks";
import type { TransactionRecord } from "@/lib/db/types";
import { shortHash } from "@/lib/ui/format";
import { TamperDiffViewer } from "./TamperDiffViewer";

function Scenario({ icon: Icon, title, detail, tone, children }: {
  icon: LucideIcon; title: string; detail: string; tone: string; children: ReactNode;
}) {
  return <section className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border-default bg-surface px-4 py-3.5">
    <h3 className="flex items-center gap-2.5 type-h3"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon size={17} /></span>{title}</h3>
    <p className="grow text-sm leading-snug text-ink-secondary">{detail}</p>
    <div>{children}</div>
  </section>;
}

export function AttackSimulatorPanel({ tx, error, device, sample, onResult, onSocial, onQuantum, onInspect, business }: {
  tx?: TransactionRecord; error?: ApiError; device?: LocalDevice; sample: PrepareInput;
  onResult: (txId: string, result: ApiResult<ExecuteResponse>) => void;
  onSocial: () => void; onQuantum: () => void; onInspect: (id: string) => void; business: boolean;
}) {
  const [tab, setTab] = useState<"steps" | "json">("steps");
  const [cloneUrl, setCloneUrl] = useState("");
  const [foreignOrigin, setForeignOrigin] = useState("");
  const [running, setRunning] = useState<"replay" | "origin" | null>(null);
  const [localError, setLocalError] = useState<ApiError>();
  const busy = useRef(false);
  const { armed, lastValid, lastValidTxId } = useAttackState();
  useEffect(() => {
    const origin = foreignOriginFor(window.location);
    setForeignOrigin(origin);
    setCloneUrl(`${origin}/phishing-clone`);
  }, []);
  useEffect(() => { if (tx?.tamperDiff?.length) setTab("json"); }, [tx?.id, tx?.tamperDiff?.length]);

  async function run(kind: "replay" | "origin") {
    if (busy.current) return;
    busy.current = true;
    setRunning(kind);
    setLocalError(undefined);
    try {
      const outcome = kind === "replay" ? await replayLastPacket() :
        device ? await submitFromForeignOrigin(sample, device.id, foreignOrigin) : null;
      if (!outcome) return;
      if (outcome.txId) onResult(outcome.txId, outcome.result);
      else if (!outcome.result.ok) setLocalError(outcome.result.error);
    } finally {
      busy.current = false;
      setRunning(null);
    }
  }
  const trace = error?.verificationTrace ?? tx?.verificationTrace;
  const softwareKey = device?.deviceKind === "SOFTWARE_FALLBACK";
  return <div className="space-y-3">
    {armed && <p role="status" className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger-text">
      ⚡ Перехватчик взведён — подпишите операцию слева. Клиент подпишет исходные реквизиты, а на сервер уйдёт изменённый пакет.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Scenario icon={ArrowLeftRight} tone="bg-danger/10 text-danger-text" title="MITM · Подмена суммы" detail="После подписи меняет amountTenge на 500 000 ₸ и отправляет на сервер с оригинальными подписями.">
        <Toggle variant="attack" checked={armed === "MITM_AMOUNT"} onChange={on => armInterceptor(on ? "MITM_AMOUNT" : null)} label="Перехват: сумма → 500 000 ₸" />
      </Scenario>
      <Scenario icon={ScanLine} tone="bg-danger/10 text-danger-text" title="MITM · Подмена IBAN" detail="После подписи подменяет получателя на счёт дроппера KZ99…DROP.">
        <Toggle variant="attack" checked={armed === "MITM_RECIPIENT"} onChange={on => armInterceptor(on ? "MITM_RECIPIENT" : null)} label="Перехват: получатель → дроппер" />
      </Scenario>
      <Scenario icon={Repeat2} tone="bg-gold/10 text-gold" title="Replay · Повтор пакета" detail={lastValid
        ? `Перехвачен валидный пакет ${shortHash(lastValidTxId ?? "", 5)} — отправим его повторно байт-в-байт.`
        : "Сначала выполните обычный перевод слева — перехватчик сохранит валидный пакет."}>
        <Button size="sm" variant="secondary" loading={running === "replay"} disabled={!lastValid || running !== null} onClick={() => void run("replay")}>Повторить перехваченный пакет</Button>
      </Scenario>
      <Scenario icon={GlobeLock} tone="bg-quantum/10 text-quantum" title="Фишинг · Чужой домен" detail={softwareKey
        ? "Откройте клон B+ Bonus или подпишите операцию от имени клона и отправьте подпись серверу."
        : "Откройте клон B+ Bonus. Для отправки подписи от имени клона привяжите Software Key."}>
        <div className="flex flex-wrap gap-2">
          {cloneUrl && <a className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-strong bg-elevated px-3 text-[13px] font-semibold hover:bg-surface-hover"
            href={cloneUrl} target="_blank" rel="noopener noreferrer">Открыть сайт-клон <ExternalLink size={14} /></a>}
          <Button size="sm" variant="secondary" loading={running === "origin"} disabled={!softwareKey || running !== null} onClick={() => void run("origin")}>Подсунуть чужой Origin</Button>
        </div>
      </Scenario>
      <Scenario icon={PhoneIncoming} tone="bg-gold/10 text-gold" title={business ? "Двойной контроль" : "Социальная инженерия"}
        detail={business ? "Платёж поставщику потребует подписи директора." : "Звонок из «Нацбанка» и перевод на новый счёт."}>
        <Button size="sm" variant="secondary" onClick={onSocial}>{business ? "Подготовить счёт" : "Симулировать звонок"}</Button>
      </Scenario>
      <Scenario icon={Atom} tone="bg-quantum/10 text-quantum" title="Квантовая атака" detail="Проверьте второй замок при компрометации ECDSA.">
        <Button size="sm" variant="secondary" onClick={onQuantum}>Сравнить криптослои</Button>
      </Scenario>
    </div>
    {localError && <ErrorCard error={localError} />}
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 type-h2"><Terminal size={18} className="text-bcc" /> Проверка операции</h2>
        <SegmentedControl label="Разбор операции" value={tab} onChange={setTab}
          options={[{ value: "steps", label: "7 шагов" }, { value: "json", label: "JSON / Diff" }]} />
      </div>
      {!tx && !trace?.length ? <EmptyState title="Ожидание криптопакета" icon={Terminal} description="Подпишите операцию слева, чтобы увидеть результат серверной проверки." /> :
        tab === "steps" ? <VerificationStepsList trace={trace} failureCode={error?.failureCode ?? tx?.failureCode} /> :
          tx && <TamperDiffViewer tx={tx} field={null} />}
      {tx && <Button variant="ghost" size="sm" onClick={() => onInspect(tx.id)}>Открыть Crypto Inspector <ChevronRight size={14} className="inline" /></Button>}
    </Card>
  </div>;
}
