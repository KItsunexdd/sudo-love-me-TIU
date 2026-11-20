"use client";

import type { Translate } from "@/lib/i18n";
import { useT } from "@/components/shell/LocaleProvider";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Cpu,
  Filter,
  Microscope,
  Monitor,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
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
import { formatMs, formatTenge } from "@/lib/ui/format";
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
  { label: string; tone: "neutral" | "success" | "warning" | "danger"; pulse: boolean }
> => ({
  connecting: { label: t("common.connecting"), tone: "neutral", pulse: true },
  live: { label: "SSE Live", tone: "success", pulse: true },
  polling: { label: t("common.polling"), tone: "warning", pulse: true },
  offline: { label: t("common.offline"), tone: "danger", pulse: false },
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

  // Отслеживание вновь прибывших строк для визуальной подсветки
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

  // Реактивное обновление по SSE / resync / DEMO_RESET
  useEffect(() => {
    const controller = new AbortController();
    const isReset = lastEvent?.type === "DEMO_RESET";
    if (isReset) setSelectedEvent(null);
    void loadReport(controller.signal, { reset: isReset });
    return () => controller.abort();
  }, [lastEvent, syncVersion, resyncVersion, loadReport]);

  // Мягкий polling fallback (подхватывает также события регистрации устройств и обрывы SSE)
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
  const mlDsaWithinTarget = mlDsa.count === 0 || mlDsa.averageMs < 25;

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

  const conn = connectionBadges[connectionStatus];
  const kpiNumberClass = projectorMode
    ? "font-mono text-4xl font-extrabold leading-none tabular-nums xl:text-5xl"
    : "display-kpi";

  return (
    <div className={projectorMode ? "space-y-6" : "space-y-5"}>
      {/* Заголовок и панель управления SOC */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bcc/40 bg-bcc/[.12] px-3 py-1 text-xs font-semibold text-emerald-300">
              <Activity aria-hidden="true" className="size-3.5" />
              {t("socDashboard.center")}
            </span>
            <Badge tone={conn.tone}>
              <span
                aria-hidden="true"
                className={`size-2 rounded-full bg-current ${conn.pulse ? "motion-safe:animate-pulse" : ""}`}
              />
              {conn.label}
            </Badge>
            {projectorMode && (
              <Badge tone="info">{t("socDashboard.projectorBadge")}</Badge>
            )}
          </div>
          <h1 className={projectorMode ? "mt-2 text-3xl font-extrabold tracking-tight" : "type-h1 mt-2"}>
            {t("socDashboard.heading")}
          </h1>
          <p className={`mt-1 text-ink-secondary ${projectorMode ? "text-base" : "text-sm"}`}>
            {t("socDashboard.intro")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={projectorMode ? "primary" : "secondary"}
            icon={<Monitor className="size-4" />}
            aria-pressed={projectorMode}
            onClick={() => setProjectorMode(value => !value)}
          >
            {projectorMode ? t("socDashboard.projectorOn") : t("socDashboard.projector")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            icon={<RefreshCw className="size-4" />}
            onClick={() => void loadReport(undefined, { manual: true })}
          >
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Zero-Crash ошибка загрузки */}
      {error && (
        <ErrorCard
          error={error}
          action={
            <Button size="sm" variant="secondary" onClick={() => void loadReport(undefined, { manual: true })}>
              {t("socDashboard.retry")}
            </Button>
          }
        />
      )}

      {/* 4 KPI-карточки в реальном времени */}
      <section aria-label={t("socDashboard.kpis")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Атак отражено */}
        <Card variant={(aggregates?.attacksBlocked ?? 0) > 0 ? "danger" : "default"}>
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              {t("socDashboard.attacks")}
            </span>
            <span className="grid size-9 place-items-center rounded-xl border border-danger/40 bg-danger/[.14] text-danger-text">
              <ShieldAlert aria-hidden="true" className="size-5" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-9 w-24" />
          ) : (
            <div data-testid="soc-attacks-blocked" className={`mt-3 text-ink-primary ${kpiNumberClass}`}>
              <SocAnimatedMetric
                value={aggregates?.attacksBlocked ?? 0}
                format={v => Math.round(v).toLocaleString("ru-KZ")}
              />
            </div>
          )}
          <p className={`mt-2 font-medium text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
            {t("socDashboard.attacked")} {formatTenge(aggregates?.attackedAmountTenge ?? 0)}
          </p>
          <p className={`mt-1 font-medium text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
            {t("socDashboard.tampering")} {formatTenge(aggregates?.preventedTamperAmountTenge ?? 0)}
          </p>
        </Card>

        {/* KPI 2: Спасено от мошенничества */}
        <Card variant={(aggregates?.savedAmountTenge ?? 0) > 0 ? "success" : "default"}>
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              {t("socDashboard.saved")}
            </span>
            <span className="grid size-9 place-items-center rounded-xl border border-bcc/40 bg-bcc/[.12] text-bcc">
              <Wallet aria-hidden="true" className="size-5" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-9 w-40" />
          ) : (
            <div className={`mt-3 text-bcc ${kpiNumberClass}`}>
              <SocAnimatedMetric
                value={aggregates?.savedAmountTenge ?? 0}
                format={v => formatTenge(Math.round(v))}
              />
            </div>
          )}
          <p className={`mt-2 font-medium text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
            {t("socDashboard.blocked")}
          </p>
        </Card>

        {/* KPI 3: Подписано без SMS */}
        <Card variant="default">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              {t("common.signed")}
            </span>
            <span className="grid size-9 place-items-center rounded-xl border border-bcc/40 bg-bcc/[.12] text-emerald-300">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-9 w-24" />
          ) : (
            <div className={`mt-3 text-ink-primary ${kpiNumberClass}`}>
              <SocAnimatedMetric
                value={aggregates?.signedWithoutSms ?? 0}
                format={v => Math.round(v).toLocaleString("ru-KZ")}
              />
            </div>
          )}
          <p className={`mt-2 font-medium text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
            {t("socDashboard.noSms")}
          </p>
        </Card>

        {/* KPI 4: Ср. время проверки ML-DSA (мс) + p95 */}
        <Card variant="elevated" className="border-quantum/35">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              {t("socDashboard.mean")}
            </span>
            <span className="grid size-9 place-items-center rounded-xl border border-quantum/40 bg-quantum/[.12] text-quantum">
              <Cpu aria-hidden="true" className="size-5" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-9 w-28" />
          ) : (
            <div className={`mt-3 text-sky-300 ${kpiNumberClass}`}>
              <SocAnimatedMetric
                value={mlDsa.averageMs}
                isEmpty={mlDsa.count === 0}
                format={v => formatMs(v)}
              />
            </div>
          )}
          <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 font-mono ${projectorMode ? "text-sm" : "text-xs"}`}>
            <span className="font-semibold text-ink-primary">
              p95: <span className="text-quantum">{mlDsa.count > 0 ? formatMs(mlDsa.p95Ms) : "—"}</span>
            </span>
            <Badge tone={mlDsaWithinTarget ? "success" : "warning"} className="font-mono">
              {t("socDashboard.target")}
            </Badge>
          </div>
        </Card>
      </section>

      {/* Средняя секция: SVG-разбивка атак + сравнение задержек SMS vs SafeSign */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {loading ? (
            <Card className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-6 w-52" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <div className="space-y-2.5 pt-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-6 w-full rounded-full" />
                ))}
              </div>
            </Card>
          ) : (
            <AttackBreakdownChart
              items={breakdown}
              totalAttacks={aggregates?.attacksBlocked ?? 0}
              activeFilter={typeFilter}
              onSelectCategory={setTypeFilter}
              projectorMode={projectorMode}
            />
          )}
        </div>

        <Card
          className="lg:col-span-5"
          heading={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-h2 flex items-center gap-2">
                <Zap aria-hidden="true" className="size-5 text-quantum" />
                {t("socDashboard.benchmark")}
              </h2>
              <Badge tone="info" className="font-mono tabular-nums">
                {mlDsa.count} {t("soc.samples.other", { count: mlDsa.count })}
              </Badge>
            </div>
          }
          divided
        >
          <div className="space-y-4">
            {/* Сравнительные полосы */}
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-ink-secondary">{t("socDashboard.otp")}</span>
                  <span className="font-mono font-bold tabular-nums text-danger-text">{t("socDashboard.duration")} {formatTenge(12)} {t("socDashboard.perOp")}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <div className="h-full w-full rounded-full bg-danger/70" />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {t("socDashboard.exposure")}
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-emerald-300">BCC SafeSign (Passkey + ML-DSA-65)</span>
                  <span className="font-mono font-bold tabular-nums text-bcc">
                    {mlDsa.count > 0 ? formatMs(hybridTotalAvgMs) : "< 5 мс"} · {formatTenge(0)} {t("socDashboard.perOp")}
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <div className="h-full w-[4%] min-w-[10px] rounded-full bg-bcc shadow-glow-bcc" />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {t("socDashboard.binding")}
                </p>
              </div>
            </div>

            {/* Детальная телеметрия проверок */}
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle bg-terminal p-3">
              <div>
                <dt className="text-xs text-ink-muted">{t("socDashboard.pqTiming")}</dt>
                <dd className="mono-data mt-1 font-bold text-sky-300">
                  {loading ? <Skeleton className="h-5 w-24" /> : mlDsa.count > 0 ? `${formatMs(mlDsa.averageMs)} / ${formatMs(mlDsa.p95Ms)}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{t("socDashboard.classicTiming")}</dt>
                <dd className="mono-data mt-1 font-bold text-emerald-300">
                  {loading ? <Skeleton className="h-5 w-24" /> : webAuthn.count > 0 ? `${formatMs(webAuthn.averageMs)} / ${formatMs(webAuthn.p95Ms)}` : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>

      {/* Живая таблица инцидентов */}
      <Card
        heading={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="type-h2">{t("socDashboard.journal")}</h2>
                <Badge tone="neutral" className="font-mono tabular-nums">
                  {filteredEvents.length} {t("socDashboard.of")} {events.length}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  label={t("socDashboard.severity")}
                  options={severityOptions}
                  value={severityFilter}
                  onChange={setSeverityFilter}
                />
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <label htmlFor="soc-search-input" className="sr-only">
                    {t("socDashboard.searchHint")}
                  </label>
                  <input
                    id="soc-search-input"
                    type="search"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder={t("socDashboard.search")}
                    className="h-10 w-56 rounded-xl border border-border-default bg-terminal pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted transition-colors hover:border-border-strong focus-visible:border-bcc/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bcc/55"
                  />
                </div>
              </div>
            </div>

            {/* Фильтр по типам событий */}
            <div role="group" aria-label={t("socDashboard.filterType")} className="flex flex-wrap items-center gap-1.5">
              {[
                ...typeFilterChips,
                ...(countsByFilter.OTHER_ATTACK > 0 || typeFilter === "OTHER_ATTACK"
                  ? [{ value: "OTHER_ATTACK" as const, label: t("common.other") }]
                  : []),
              ].map(chip => {
                const count = countsByFilter[chip.value];
                const active = typeFilter === chip.value;
                return (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTypeFilter(chip.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-bcc/55 bg-bcc/[.16] text-emerald-200"
                        : "border-border-default bg-terminal text-ink-secondary hover:border-border-strong hover:text-ink-primary"
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="font-mono tabular-nums text-ink-muted">{count}</span>
                  </button>
                );
              })}

              {hasActiveFilters && (
                <Button size="sm" variant="ghost" onClick={resetFilters}>
                  {t("socDashboard.reset")}
                </Button>
              )}
            </div>
          </div>
        }
        divided
      >
        {loading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={Radar}
            title={t("socDashboard.empty")}
            description={t("socDashboard.emptyHint")}
            action={
              <Link
                href={`/?mode=${mode}&lang=${locale}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bcc px-4 py-2 text-sm font-semibold text-ink-inverse shadow-glow-bcc transition hover:bg-bcc-hover"
              >
                {t("socDashboard.openDemo")}
              </Link>
            }
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            icon={Filter}
            title={t("socDashboard.noMatches")}
            description={t("socDashboard.clearHint")}
            action={
              <Button size="sm" variant="secondary" onClick={resetFilters}>
                {t("socDashboard.reset")}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border-default text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2.5 pl-3 pr-3">{t("socDashboard.time")}</th>
                  <th scope="col" className="px-3 py-2.5">{t("socDashboard.level")}</th>
                  <th scope="col" className="px-3 py-2.5">{t("socDashboard.type")}</th>
                  <th scope="col" className="px-3 py-2.5">{t("socDashboard.actor")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right">{t("common.amount")}</th>
                  <th scope="col" className="px-3 py-2.5">{t("socDashboard.description")}</th>
                  <th scope="col" className="py-2.5 pl-3 pr-3 text-right">{t("socDashboard.review")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredEvents.map(item => {
                  const meta = getEventMeta(item, t);
                  const failureCode = extractFailureCode(item);
                  const highlighted = highlightedIds.has(item.id);
                  const highlightStyle = highlighted
                    ? meta.isAttack
                      ? "bg-danger/[.20]"
                      : "bg-bcc/[.16]"
                    : "hover:bg-surface-hover/70";

                  return (
                    <motion.tr
                      key={item.id}
                      initial={reduce ? false : highlighted ? { opacity: 0, y: -8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      tabIndex={0}
                      onClick={() => setSelectedEvent(item)}
                      onKeyDown={event => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedEvent(item);
                        }
                      }}
                      className={`cursor-pointer transition-colors duration-500 focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bcc/80 ${highlightStyle}`}
                    >
                      <td className={`whitespace-nowrap py-3 pl-3 pr-3 font-mono tabular-nums text-ink-secondary ${projectorMode ? "text-sm" : "text-[13px]"}`}>
                        {formatEventTime(item.timestamp, locale)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge status={item.severity} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className={`px-3 py-3 font-medium text-ink-primary ${projectorMode ? "text-base" : "text-sm"}`}>
                        {item.actorName}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-mono font-semibold tabular-nums text-ink-primary ${projectorMode ? "text-base" : "text-sm"}`}>
                        {item.amountTenge !== undefined ? formatTenge(item.amountTenge) : "—"}
                      </td>
                      <td className={`max-w-[320px] px-3 py-3 text-ink-secondary ${projectorMode ? "text-sm" : "text-[13px]"}`}>
                        <div className="truncate font-medium text-ink-primary" title={eventSummary(item, locale)}>
                          {eventSummary(item, locale)}
                        </div>
                        {failureCode && (
                          <div className="mt-0.5 font-mono text-xs text-danger-text">{failureCode}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pl-3 pr-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Microscope className="size-3.5 text-bcc" />}
                          onClick={event => {
                            event.stopPropagation();
                            setSelectedEvent(item);
                          }}
                        >
                          {t("socDashboard.details")}
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Панель деталей события / Crypto Inspector */}
      <SocEventDetailDrawer
        event={selectedEvent}
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
