"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Button, Card, EmptyState, ErrorCard, JsonDiffViewer, SegmentedControl, Toggle } from "@/components/ui";
import { VerificationStepsList } from "@/components/crypto/VerificationStepsList";
import type { ApiError, ApiResult, ExecuteResponse, PrepareInput } from "@/lib/client/api";
import type { LocalDevice } from "@/lib/client/client-keystore";
import { armInterceptor, foreignOriginFor, MITM_AMOUNT_TENGE, replayLastPacket, submitFromForeignOrigin, useAttackState } from "./attacks";
import type { TransactionRecord } from "@/lib/db/types";
import { fingerprint, formatTenge } from "@/lib/ui/format";
import { TamperDiffViewer } from "./TamperDiffViewer";

// One console panel with six numbered attacks; the armed one is the only cell tinted red.
function Scenario({ index, title, detail, active = false, children }: {
  index: number; title: string; detail: ReactNode; active?: boolean; children: ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-2 px-4 py-3 transition-colors 2xl:py-4 ${active ? "bg-[#211819]" : "bg-surface"}`}>
      <h3 className={`flex items-baseline gap-2.5 text-sm font-medium leading-5 ${active ? "text-danger-text" : "text-ink-primary"}`}>
        <span aria-hidden="true" className="font-mono text-xs text-ink-muted">{String(index).padStart(2, "0")}</span>
        <span className="truncate">{title}</span>
      </h3>
      <p className="grow text-[0.8125rem] leading-5 text-ink-secondary">{detail}</p>
      <div className="pt-1">{children}</div>
    </section>
  );
}

export function AttackSimulatorPanel({ tx, error, device, sample, onResult, onSocial, onQuantum, onInspect, business }: {
  tx?: TransactionRecord; error?: ApiError; device?: LocalDevice; sample: PrepareInput;
  onResult: (txId: string, result: ApiResult<ExecuteResponse>) => void;
  onSocial: () => void; onQuantum: () => void; onInspect: (id: string) => void; business: boolean;
}) {
  const { locale, t } = useT();
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
    <div className="space-y-3">
      <h2 className="sr-only">{t("demoStand.hacker")}</h2>
      {armed && (
        <p role="status" className="rounded-lg border border-danger/45 bg-danger/[.08] px-4 py-2.5 text-[0.8125rem] text-danger-text">
          {t("attackSimulatorPanel.armed")}
        </p>
      )}
      <div className="grid gap-px overflow-hidden rounded-xl border border-border-default bg-border-default sm:grid-cols-2">
        <Scenario
          index={1}
          title={t("attackSimulatorPanel.amount")}
          active={armed === "MITM_AMOUNT"}
          detail={<>{t("attackSimulatorPanel.after")} <code className="font-mono text-ink-primary">amountTenge</code> {t("attackSimulatorPanel.replace")} <span className="font-mono tabular-nums text-ink-primary">{mitmAmountLabel}</span></>}
        >
          <Toggle variant="attack" checked={armed === "MITM_AMOUNT"} onChange={on => armInterceptor(on ? "MITM_AMOUNT" : null)} label={t("attackSimulatorPanel.amountToggle", { mitmAmountLabel })} />
        </Scenario>
        <Scenario
          index={2}
          title={t("attackSimulatorPanel.iban")}
          active={armed === "MITM_RECIPIENT"}
          detail={<>{t("attackSimulatorPanel.redirect")} <code className="font-mono text-ink-primary">KZ99…DROP</code></>}
        >
          <Toggle variant="attack" checked={armed === "MITM_RECIPIENT"} onChange={on => armInterceptor(on ? "MITM_RECIPIENT" : null)} label={t("attackSimulatorPanel.recipient")} />
        </Scenario>
        <Scenario
          index={3}
          title={t("attackSimulatorPanel.replay")}
          detail={lastValid
            ? <>{t("attackSimulatorPanel.captured")} <code className="fingerprint text-ink-primary">{fingerprint(lastValidTxId ?? "", 1)}</code> {t("attackSimulatorPanel.resend")}</>
            : t("attackSimulatorPanel.firstTransfer")}
        >
          <Button size="sm" variant="secondary" loading={running === "replay"} disabled={!lastValid || running !== null} onClick={() => void run("replay")}>
            {t("attackSimulatorPanel.repeat")}
          </Button>
        </Scenario>
        <Scenario
          index={4}
          title={t("attackSimulatorPanel.phishing")}
          detail={softwareKey
            ? t("attackSimulatorPanel.originHint")
            : t("attackSimulatorPanel.softwareHint")}
        >
          <div className="flex flex-wrap gap-2">
            {cloneUrl && (
              <a
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-elevated px-3 py-1 text-[0.8125rem] font-medium text-ink-primary shadow-highlight transition-[background-color,transform] hover:bg-surface-hover motion-safe:active:scale-[.98]"
                href={`${cloneUrl}?lang=${locale}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("attackSimulatorPanel.clone")} <ExternalLink aria-hidden="true" size={14} strokeWidth={1.75} />
              </a>
            )}
            <Button size="sm" variant="secondary" loading={running === "origin"} disabled={!softwareKey || running !== null} onClick={() => void run("origin")}>
              {t("attackSimulatorPanel.origin")}
            </Button>
          </div>
        </Scenario>
        <Scenario
          index={5}
          title={business ? t("attackSimulatorPanel.dual") : t("attackSimulatorPanel.social")}
          detail={business ? t("attackSimulatorPanel.director") : t("attackSimulatorPanel.call")}
        >
          <Button size="sm" variant="secondary" onClick={onSocial}>
            {business ? t("attackSimulatorPanel.invoice") : t("attackSimulatorPanel.simulateCall")}
          </Button>
        </Scenario>
        <Scenario
          index={6}
          title={t("attackSimulatorPanel.quantum")}
          detail={t("attackSimulatorPanel.resilience")}
        >
          <Button size="sm" variant="secondary" onClick={onQuantum}>
            {t("attackSimulatorPanel.compare")}
          </Button>
        </Scenario>
      </div>

      {localError && <ErrorCard error={localError} />}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-h2">{t("attackSimulatorPanel.verify")}</h2>
          <div className="flex items-center gap-2">
            {tx && (
              <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => onInspect(tx.id)}>
                <span className="inline-flex items-center gap-1">Inspector <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} /></span>
              </Button>
            )}
            <SegmentedControl
              label={t("attackSimulatorPanel.analysis")}
              value={tab}
              onChange={setTab}
              className="[&_button]:px-2.5"
              options={[{ value: "steps", label: t("attackSimulatorPanel.steps") }, { value: "json", label: "JSON / Diff" }]}
            />
          </div>
        </div>

        {!tx && !trace?.length ? (
          <EmptyState
            title={t("attackSimulatorPanel.waiting")}
            className="py-5 2xl:py-6"
            description={t("attackSimulatorPanel.waitingHint")}
          />
        ) : tab === "steps" ? (
          <VerificationStepsList compact trace={trace} failureCode={error?.failureCode ?? tx?.failureCode} />
        ) : tx ? (
          <TamperDiffViewer tx={tx} field={null} />
        ) : error?.tamperDiff?.length ? (
          <JsonDiffViewer tamperDiff={error.tamperDiff} />
        ) : (
          <EmptyState
            title={t("attackSimulatorPanel.missing")}
            className="py-5"
            description={t("attackSimulatorPanel.log")}
          />
        )}
      </Card>
    </div>
  );
}
