"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TWEEN_ENTER } from "@/lib/ui/motion";
import { Filter, Monitor, Radar, RefreshCw, Search } from "lucide-react";
import { useDemoMode } from "@/components/shell/DemoModeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { SegmentedControl, type Segment } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, type ApiError } from "@/lib/client/api";
import { useEventStream, type ConnectionStatus } from "@/lib/client/useEventStream";
import type { SecurityEvent } from "@/lib/db/types";
import type { socReport } from "@/lib/soc/service";
import { fingerprint, formatMs, formatTenge } from "@/lib/ui/format";
import { AttackBreakdownChart } from "./AttackBreakdownChart";
import { SocAnimatedMetric } from "./SocAnimatedMetric";
import { SocEventDetailDrawer } from "./SocEventDetailDrawer";
import {
  buildAttackBreakdown,
  classifyEventCategory,
  eventSummary,
  extractFailureCode,
  formatEventTime,
  getEventMeta,
  type SocSeverityFilter,
  type SocTypeFilter,
} from "./socHelpers";

type SocReportData = Awaited<ReturnType<typeof socReport>>;

const getConnectionBadges = (t: Translate): Record<
  ConnectionStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> => ({
  connecting: { label: t("common.connecting"), tone: "neutral" },
  live: { label: "SSE", tone: "success" },
  polling: { label: t("common.polling"), tone: "warning" },
  offline: { label: t("common.offline"), tone: "danger" },
});

const getSeverityOptions = (t: Translate): readonly Segment<SocSeverityFilter>[] => ([
  { value: "ALL", label: t("socDashboard.allLevels") },
  { value: "CRITICAL", label: t("common.attack") },
  { value: "WARNING", label: t("common.riskBadge") },
  { value: "INFO", label: t("common.info") },
]);

const getTypeFilterChips = (t: Translate): readonly { value: SocTypeFilter; label: string }[] => ([
  { value: "ALL", label: t("socDashboard.allEvents") },
  { value: "MITM_AMOUNT", label: t("common.mitmAmount") },
  { value: "MITM_RECIPIENT", label: "MITM IBAN" },
  { value: "REPLAY", label: "Replay" },
  { value: "PHISHING_ORIGIN", label: "Phishing / Origin" },
  { value: "SOCIAL_ENGINEERING", label: t("common.social") },
  { value: "PQ_SIGNATURE", label: t("socDashboard.quantum") },
  { value: "OPERATIONS", label: t("socDashboard.smsFree") },
]);

export function SocDashboard() {
  const { t, locale } = useT();
  const typeFilterChips = getTypeFilterChips(t);
  const severityOptions = getSeverityOptions(t);
  const connectionBadges = getConnectionBadges(t);
  const { mode } = useDemoMode();
  const { lastEvent, status: connectionStatus, syncVersion, resyncVersion } = useEventStream({ channel: "soc" });
  const reduce = useReducedMotion();

  const [report, setReport] = useState<SocReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [typeFilter, setTypeFilter] = useState<SocTypeFilter>("ALL");
  const [severityFilter, setSeverityFilter] = useState<SocSeverityFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectorMode, setProjectorMode] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Highlight only events received after the first snapshot.
  const knownIdsRef = useRef<Set<string> | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(() => new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const markNewEvents = useCallback((events: SecurityEvent[], reset: boolean) => {
    if (reset || knownIdsRef.current === null) {
      knownIdsRef.current = new Set(events.map(e => e.id));
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
      setHighlightedIds(new Set());
      return;
    }

    const incoming: string[] = [];
    for (const item of events) {
      if (!knownIdsRef.current.has(item.id)) {
        knownIdsRef.current.add(item.id);
        incoming.push(item.id);
      }
    }

    if (!incoming.length) return;

    setHighlightedIds(previous => {
      const next = new Set(previous);
      for (const id of incoming) next.add(id);
      return next;
    });

    for (const id of incoming) {
      const existingTimer = timersRef.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setHighlightedIds(previous => {
          if (!previous.has(id)) return previous;
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }, 2_200);
      timersRef.current.set(id, timer);
    }
  }, []);

  const loadReport = useCallback(
    async (signal?: AbortSignal, options: { manual?: boolean; reset?: boolean } = {}) => {
      if (options.manual) setRefreshing(true);
      const result = await api.socEvents(signal);
      if (signal?.aborted) return;

      if (result.ok) {
        setReport(result.data);
        setError(null);
        markNewEvents(result.data.events, Boolean(options.reset || result.data.events.length === 0));
      } else {
        setError(result.error);
      }
      setLoading(false);
      if (options.manual) setRefreshing(false);
    },
    [markNewEvents],
  );

  useEffect(() => {
    const controller = new AbortController();
    const isReset = lastEvent?.type === "DEMO_RESET";
    if (isReset) {
      setSelectedEvent(null);
      setDrawerOpen(false);
    }
    void loadReport(controller.signal, { reset: isReset });
    return () => controller.abort();
  }, [lastEvent, syncVersion, resyncVersion, loadReport]);

  useEffect(() => {
    const intervalMs = connectionStatus === "live" ? 6_000 : 2_500;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadReport();
    }, intervalMs);
    return () => clearInterval(interval);
  }, [connectionStatus, loadReport]);

  const events = useMemo(() => report?.events ?? [], [report]);
  const aggregates = report?.aggregates;
  const mlDsa = aggregates?.verification.mlDsa ?? { count: 0, averageMs: 0, p95Ms: 0 };
  const webAuthn = aggregates?.verification.webAuthn ?? { count: 0, averageMs: 0, p95Ms: 0 };
  const hybridTotalAvgMs = mlDsa.averageMs + webAuthn.averageMs;
  const hasHybridTiming = mlDsa.count > 0 && webAuthn.count > 0;
  // Compare measured verification with the lower end of the SMS reference range.
  const smsReferenceMs = 12_000;
  const benchmarkMaxMs = Math.max(smsReferenceMs, hasHybridTiming ? hybridTotalAvgMs : 0);

  const breakdown = useMemo(
    () => buildAttackBreakdown(aggregates?.blockedByType ?? {}, t),
    [aggregates?.blockedByType, t],
  );

  const countsByFilter = useMemo(() => {
    const map: Record<SocTypeFilter, number> = {
      ALL: events.length,
      MITM_AMOUNT: 0,
      MITM_RECIPIENT: 0,
      REPLAY: 0,
      PHISHING_ORIGIN: 0,
      SOCIAL_ENGINEERING: 0,
      PQ_SIGNATURE: 0,
      OTHER_ATTACK: 0,
      OPERATIONS: 0,
    };
    for (const item of events) {
      const cat = classifyEventCategory(item);
      map[cat] += 1;
    }
    return map;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return events.filter(item => {
      if (severityFilter !== "ALL" && item.severity !== severityFilter) return false;
      if (typeFilter !== "ALL" && classifyEventCategory(item) !== typeFilter) return false;
      if (needle) {
        const failureCode = extractFailureCode(item) ?? "";
        const haystack = `${item.txId ?? ""} ${item.actorName} ${eventSummary(item, locale)} ${failureCode} ${getEventMeta(item, t).label}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [events, severityFilter, typeFilter, searchQuery, t, locale]);

  const hasActiveFilters = typeFilter !== "ALL" || severityFilter !== "ALL" || searchQuery.trim().length > 0;

  function resetFilters() {
    setTypeFilter("ALL");
    setSeverityFilter("ALL");
    setSearchQuery("");
  }

  function inspectEvent(item: SecurityEvent) {
    setSelectedEvent(item);
    setDrawerOpen(true);
  }

  const conn = connectionBadges[connectionStatus];
  const sectionTitle = projectorMode ? "text-xl font-medium" : "type-h2";
  const metrics = [
    {
      label: t("socDashboard.attacks"),
      value: aggregates?.attacksBlocked ?? 0,
      format: formatCount,
      comparison: `${t("socDashboard.attacked")} ${formatTenge(aggregates?.attackedAmountTenge ?? 0)}`,
      testId: "soc-attacks-blocked",
      accent: (aggregates?.attacksBlocked ?? 0) > 0,
    },
    {
      label: t("socDashboard.saved"),
      value: aggregates?.savedAmountTenge ?? 0,
      format: formatTenge,
      comparison: t("socDashboard.blocked"),
    },
    {
      label: t("common.signed"),
      value: aggregates?.signedWithoutSms ?? 0,
      format: formatCount,
      comparison: t("socDashboard.noSms"),
    },
    {
      label: t("socDashboard.mean"),
      value: mlDsa.averageMs,
      format: formatMs,
      isEmpty: mlDsa.count === 0,
      comparison: (
        <>
          p95 {mlDsa.count ? formatMs(mlDsa.p95Ms) : "—"} ·{" "}
          <span className={mlDsa.count > 0 && mlDsa.averageMs >= 25 ? "font-medium text-ink-primary" : undefined}>
            {t("socDashboard.target")}
          </span>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 className={projectorMode ? "text-3xl font-medium" : "type-h1"}>{t("socDashboard.heading")}</h1>
            <Badge tone={conn.tone} dot className="font-mono">{conn.label}</Badge>
          </div>
          <p className={`mt-1 text-ink-secondary ${projectorMode ? "text-base" : "type-body"}`}>{t("socDashboard.intro")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant={projectorMode ? "secondary" : "ghost"} icon={<Monitor />}
            aria-pressed={projectorMode} onClick={() => setProjectorMode(value => !value)}>
            {projectorMode ? t("socDashboard.projectorOn") : t("socDashboard.projector")}
          </Button>
          <Button size="sm" variant="secondary" loading={refreshing} icon={<RefreshCw />}
            onClick={() => void loadReport(undefined, { manual: true })}>
            {t("common.refresh")}
          </Button>
        </div>
      </header>

      {error && (
        <ErrorCard error={error} action={
          <Button size="sm" variant="secondary" onClick={() => void loadReport(undefined, { manual: true })}>
            {t("socDashboard.retry")}
          </Button>
        } />
      )}

      <section aria-label={t("socDashboard.kpis")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => (
          <Card key={metric.label} className="flex flex-col items-start">
            <span className={projectorMode ? "text-base text-ink-secondary" : "type-label"}>{metric.label}</span>
            {loading ? <Skeleton className="my-3 h-8 w-24" /> : (
              <div data-testid={metric.testId} className={`display-kpi my-3 max-w-full break-words ${projectorMode ? "text-4xl" : ""} ${metric.accent ? "text-bcc" : "text-ink-primary"}`}>
                <SocAnimatedMetric value={metric.value} format={metric.format} isEmpty={metric.isEmpty} />
              </div>
            )}
            <p className={`mt-auto font-mono tabular-nums text-ink-muted ${projectorMode ? "text-sm" : "type-micro"}`}>
              {metric.comparison}
            </p>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {loading ? (
          <Card className="space-y-4">
            <Skeleton className="h-6 w-52" />
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-4 w-full" />)}
          </Card>
        ) : (
          <AttackBreakdownChart items={breakdown} totalAttacks={aggregates?.attacksBlocked ?? 0}
            preventedTamperAmountTenge={aggregates?.preventedTamperAmountTenge}
            activeFilter={typeFilter} onSelectCategory={setTypeFilter} projectorMode={projectorMode} />
        )}

        <Card heading={
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className={sectionTitle}>{t("socDashboard.benchmark")}</h2>
            <span className="mono-data text-ink-muted">{formatCount(mlDsa.count)} {t("soc.samples.other", { count: mlDsa.count })}</span>
          </div>
        }>
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className={projectorMode ? "text-base" : "type-label"}>{t("socDashboard.otp")}</span>
                <span className="mono-data text-ink-secondary">{t("socDashboard.duration")} {formatTenge(12)} {t("socDashboard.perOp")}</span>
              </div>
              <div aria-hidden="true" className="h-1 bg-border-default">
                <motion.div initial={false} animate={{ scaleX: smsReferenceMs / benchmarkMaxMs }}
                  transition={reduce ? { duration: 0 } : TWEEN_ENTER} style={{ originX: 0 }} className="h-full bg-ink-muted" />
              </div>
              <p className="mt-2 text-xs leading-4 text-ink-muted">{t("socDashboard.exposure")}</p>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className={projectorMode ? "text-base" : "type-label"}>BCC SafeSign (Passkey + ML-DSA-65)</span>
                <span className="mono-data text-ink-secondary">{hasHybridTiming ? formatMs(hybridTotalAvgMs) : "—"} · {formatTenge(0)} {t("socDashboard.perOp")}</span>
              </div>
              <div aria-hidden="true" className={`h-1 bg-border-default ${hasHybridTiming && hybridTotalAvgMs > 0 ? "border-l border-bcc" : ""}`}>
                {hasHybridTiming && (
                  <motion.div initial={false} animate={{ scaleX: hybridTotalAvgMs / benchmarkMaxMs }}
                    transition={reduce ? { duration: 0 } : TWEEN_ENTER} style={{ originX: 0 }} className="h-full bg-bcc" />
                )}
              </div>
              <p className="mt-2 text-xs leading-4 text-ink-muted">{t("socDashboard.binding")}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 border-t border-border-subtle pt-3">
              {[
                { label: t("socDashboard.pqTiming"), timing: mlDsa },
                { label: t("socDashboard.classicTiming"), timing: webAuthn },
              ].map(({ label, timing }) => (
                <div key={label}>
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className="mono-data mt-1 text-ink-primary">
                    {loading ? <Skeleton className="h-5 w-20" /> : timing.count > 0 ? `${formatMs(timing.averageMs)} / ${formatMs(timing.p95Ms)}` : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>

      <Card heading={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h2 className={sectionTitle}>{t("socDashboard.journal")}</h2>
              <span className="mono-data whitespace-nowrap text-ink-muted">
                {formatCount(filteredEvents.length)} {t("socDashboard.of")} {formatCount(events.length)}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SegmentedControl label={t("socDashboard.severity")} options={severityOptions} value={severityFilter}
                onChange={setSeverityFilter} className="max-w-full overflow-x-auto" />
              <div className="relative min-w-0">
                <Search aria-hidden="true" strokeWidth={1.75}
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <label htmlFor="soc-search-input" className="sr-only">{t("socDashboard.searchHint")}</label>
                <input id="soc-search-input" type="search" value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)} placeholder={t("socDashboard.search")}
                  className="h-9 w-56 max-w-full rounded-lg border border-border-default bg-terminal pl-9 pr-3 text-sm text-ink-primary transition-colors placeholder:text-ink-muted hover:border-border-strong" />
              </div>
            </div>
          </div>

          <div role="group" aria-label={t("socDashboard.filterType")}
            className="flex items-center gap-1 overflow-x-auto border-b border-border-default p-1">
            {[
              ...typeFilterChips,
              ...(countsByFilter.OTHER_ATTACK > 0 || typeFilter === "OTHER_ATTACK"
                ? [{ value: "OTHER_ATTACK" as const, label: t("common.other") }] : []),
            ].map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={typeFilter === value} onClick={() => setTypeFilter(value)}
                className={`flex min-h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-[0.8125rem] transition-colors hover:bg-surface-hover hover:text-ink-primary ${typeFilter === value ? "bg-elevated font-medium text-ink-primary shadow-highlight" : "text-ink-secondary"}`}>
                {label}<span className="font-mono text-xs tabular-nums text-ink-muted">{formatCount(countsByFilter[value])}</span>
              </button>
            ))}
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" className="shrink-0" onClick={resetFilters}>{t("socDashboard.reset")}</Button>
            )}
          </div>
        </div>
      }>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
          </div>
        ) : events.length === 0 ? (
          <EmptyState icon={Radar} title={t("socDashboard.empty")} description={t("socDashboard.emptyHint")}
            action={<Link href={`/?mode=${mode}&lang=${locale}`}
              className="inline-flex min-h-10 items-center rounded-lg border border-border-strong bg-elevated px-4 text-sm font-medium text-ink-primary transition-colors hover:bg-surface-hover">
              {t("socDashboard.openDemo")}
            </Link>} />
        ) : filteredEvents.length === 0 ? (
          <EmptyState icon={Filter} title={t("socDashboard.noMatches")} description={t("socDashboard.clearHint")}
            action={<Button size="sm" variant="secondary" onClick={resetFilters}>{t("socDashboard.reset")}</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full min-w-[840px] border-collapse text-left ${projectorMode ? "text-base" : "text-sm"}`}>
              <thead>
                <tr className="h-8 border-b border-border-default text-xs text-ink-muted [&>th]:px-3 [&>th]:font-normal">
                  <th scope="col">{t("socDashboard.time")}</th>
                  <th scope="col">{t("socDashboard.level")}</th>
                  <th scope="col">{t("socDashboard.type")}</th>
                  <th scope="col">{t("socDashboard.actor")}</th>
                  <th scope="col" className="text-right">{t("common.amount")}</th>
                  <th scope="col">{t("socDashboard.description")}</th>
                  <th scope="col" className="text-right">{t("socDashboard.review")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredEvents.map(item => {
                  const meta = getEventMeta(item, t);
                  const failureCode = extractFailureCode(item);
                  const summary = eventSummary(item, locale);
                  const selected = selectedEvent?.id === item.id;
                  return (
                    <tr key={item.id} tabIndex={0} aria-current={selected || undefined} onClick={() => inspectEvent(item)}
                      onKeyDown={event => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          inspectEvent(item);
                        }
                      }}
                      className={`cursor-pointer transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-offset-[-2px] [&>td]:px-3 ${projectorMode ? "h-14" : "h-11"} ${selected ? "bg-elevated shadow-[inset_1px_0_var(--text-secondary)]" : highlightedIds.has(item.id) ? "bg-elevated" : ""}`}>
                      <td className="whitespace-nowrap font-mono tabular-nums text-ink-secondary">{formatEventTime(item.timestamp, locale)}</td>
                      <td className="whitespace-nowrap"><Badge status={item.severity} /></td>
                      <td className="whitespace-nowrap text-ink-secondary">{meta.label}</td>
                      <td className="whitespace-nowrap">
                        {item.actorName}
                        {item.txId && <code className="fingerprint block text-xs text-ink-muted" title={item.txId}>{fingerprint(item.txId, 1)}</code>}
                      </td>
                      <td className="whitespace-nowrap text-right font-mono tabular-nums">
                        {item.amountTenge !== undefined ? formatTenge(item.amountTenge) : "—"}
                      </td>
                      <td className="max-w-[320px]">
                        <div className="truncate" title={summary}>{summary}</div>
                        {failureCode && <div className="truncate font-mono text-xs text-ink-muted" title={failureCode}>{failureCode}</div>}
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={event => {
                          event.stopPropagation();
                          inspectEvent(item);
                        }}>{t("socDashboard.details")}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SocEventDetailDrawer event={selectedEvent} open={drawerOpen} projectorMode={projectorMode}
        onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ru-KZ");
}
