"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, Atom, ChevronRight, ExternalLink, GlobeLock, PhoneIncoming, Repeat2, ScanLine, Terminal, type LucideIcon } from "lucide-react";
import { Button, Card, EmptyState, ErrorCard, JsonDiffViewer, SegmentedControl, Toggle } from "@/components/ui";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import type { ApiError, ApiResult, ExecuteResponse, PrepareInput } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { armInterceptor, foreignOriginFor, MITM_AMOUNT_TENGE, replayLastPacket, submitFromForeignOrigin, useAttackState } from "./attacks";
import type { TransactionRecord } from "@/lib/db/types";
import { formatTenge, shortHash } from "@/lib/ui/format";
import { TamperDiffViewer } from "./TamperDiffViewer";

function Scenario({ icon: Icon, title, detail, tone, active = false, children }: {
  icon: LucideIcon; title: string; detail: ReactNode; tone: string; active?: boolean; children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-1.5 rounded-2xl border px-3.5 py-2.5 transition-colors 2xl:gap-2 2xl:px-4 2xl:py-3.5 ${
        active
          ? "border-danger/65 bg-danger/[.09] shadow-glow-danger"
          : "border-border-default bg-surface hover:border-border-strong"
      }`}
    >
      <h3 className="flex items-center gap-2 text-[14px] font-semibold leading-snug 2xl:text-[15px]">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg 2xl:size-8 ${tone}`}>
          <Icon aria-hidden="true" size={16} />
        </span>
        <span className="truncate">{title}</span>
      </h3>
      <p className="grow text-[13px] leading-snug text-ink-secondary">{detail}</p>
      <div className="pt-0.5">{children}</div>
    </section>
  );
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
  const mitmAmountLabel = formatTenge(MITM_AMOUNT_TENGE);

  return (
    <div className="space-y-2.5 2xl:space-y-3">
      {armed && (
        <p role="status" className="rounded-xl border border-danger/55 bg-danger/[.12] px-3.5 py-2 text-[13px] font-medium text-danger-text">
          ⚡ Перехватчик взведён — нажмите «Подписать без SMS» слева. Клиент подпишет исходные реквизиты, а на сервер уйдёт подменённый пакет.
        </p>
      )}
      <div className="grid gap-2.5 sm:grid-cols-2 2xl:gap-3">
        <Scenario
          icon={ArrowLeftRight}
          tone="bg-danger/15 text-danger-text"
          title="MITM · Подмена суммы"
          active={armed === "MITM_AMOUNT"}
          detail={<>После подписи меняет <code className="font-mono text-ink-primary">amountTenge</code> на <span className="font-mono tabular-nums text-ink-primary">{mitmAmountLabel}</span>.</>}
        >
          <Toggle variant="attack" checked={armed === "MITM_AMOUNT"} onChange={on => armInterceptor(on ? "MITM_AMOUNT" : null)} label={`Сумма → ${mitmAmountLabel}`} />
        </Scenario>
        <Scenario
          icon={ScanLine}
          tone="bg-danger/15 text-danger-text"
          title="MITM · Подмена IBAN"
          active={armed === "MITM_RECIPIENT"}
          detail={<>После подписи подменяет получателя на дроппера <code className="font-mono text-ink-primary">KZ99…DROP</code>.</>}
        >
          <Toggle variant="attack" checked={armed === "MITM_RECIPIENT"} onChange={on => armInterceptor(on ? "MITM_RECIPIENT" : null)} label="Получатель → дроппер" />
        </Scenario>
        <Scenario
          icon={Repeat2}
          tone="bg-gold/15 text-gold"
          title="Replay · Повтор пакета"
          detail={lastValid
            ? <>Перехвачен пакет <code className="font-mono text-ink-primary">{shortHash(lastValidTxId ?? "", 5)}</code> — повторная отправка байт-в-байт.</>
            : "Сначала выполните обычный перевод слева — перехватчик сохранит пакет."}
        >
          <Button size="sm" variant="secondary" loading={running === "replay"} disabled={!lastValid || running !== null} onClick={() => void run("replay")}>
            Повторить пакет
          </Button>
        </Scenario>
        <Scenario
          icon={GlobeLock}
          tone="bg-quantum/15 text-quantum"
          title="Фишинг · Чужой домен"
          detail={softwareKey
            ? "Откройте клон B+ Bonus или отправьте подпись от имени чужого домена."
            : "Откройте клон B+ Bonus. Для API-теста Origin привяжите Software Key."}
        >
          <div className="flex flex-wrap gap-2">
            {cloneUrl && (
              <a
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-border-strong bg-elevated px-3 py-1.5 text-[13px] font-semibold text-ink-primary transition duration-150 hover:border-bcc/50 hover:bg-surface-hover motion-safe:active:scale-[.985]"
                href={cloneUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Сайт-клон <ExternalLink aria-hidden="true" size={14} />
              </a>
            )}
            <Button size="sm" variant="secondary" loading={running === "origin"} disabled={!softwareKey || running !== null} onClick={() => void run("origin")}>
              Чужой Origin
            </Button>
          </div>
        </Scenario>
        <Scenario
          icon={PhoneIncoming}
          tone="bg-gold/15 text-gold"
          title={business ? "Двойной контроль" : "Социальная инженерия"}
          detail={business ? "Платёж поставщику от 500 000 ₸ потребует подписи директора." : "Звонок из «Нацбанка» и перевод на новый счёт дроппера."}
        >
          <Button size="sm" variant="secondary" onClick={onSocial}>
            {business ? "Подготовить счёт" : "Симулировать звонок"}
          </Button>
        </Scenario>
        <Scenario
          icon={Atom}
          tone="bg-quantum/15 text-quantum"
          title="Квантовая атака"
          detail="Проверка стойкости ML-DSA-65 (FIPS 204) при взломе ECDSA."
        >
          <Button size="sm" variant="secondary" onClick={onQuantum}>
            Сравнить криптослои
          </Button>
        </Scenario>
      </div>

      {localError && <ErrorCard error={localError} />}

      <Card className="space-y-2.5 p-3.5 2xl:space-y-3 2xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold 2xl:type-h2">
            <Terminal aria-hidden="true" size={18} className="text-bcc" />
            Проверка операции
          </h2>
          <div className="flex items-center gap-2">
            {tx && (
              <Button variant="ghost" size="sm" onClick={() => onInspect(tx.id)}>
                Inspector <ChevronRight aria-hidden="true" size={14} />
              </Button>
            )}
            <SegmentedControl
              label="Разбор операции"
              value={tab}
              onChange={setTab}
              className="[&_button]:px-2.5 [&_button]:py-1.5"
              options={[{ value: "steps", label: "7 шагов" }, { value: "json", label: "JSON / Diff" }]}
            />
          </div>
        </div>

        {!tx && !trace?.length ? (
          <EmptyState
            title="Ожидание криптопакета"
            icon={Terminal}
            className="py-4 2xl:py-6"
            description="Включите MITM-перехватчик выше или подпишите перевод слева, чтобы увидеть 7-шаговый разбор сервера."
          />
        ) : tab === "steps" ? (
          <VerificationStepsList compact trace={trace} failureCode={error?.failureCode ?? tx?.failureCode} />
        ) : tx ? (
          <TamperDiffViewer tx={tx} field={null} />
        ) : error?.tamperDiff?.length ? (
          <JsonDiffViewer tamperDiff={error.tamperDiff} />
        ) : (
          <EmptyState
            title="JSON-пакет недоступен"
            icon={Terminal}
            className="py-4"
            description="Откройте вкладку «7 шагов», чтобы посмотреть серверный лог проверки."
          />
        )}
      </Card>
    </div>
  );
}
