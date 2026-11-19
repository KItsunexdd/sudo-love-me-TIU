"use client";

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
  extractFailureCode,
  formatEventTime,
  getEventMeta,
  type SocSeverityFilter,
  type SocTypeFilter,
} from "./socHelpers";

type SocReportData = Awaited<ReturnType<typeof socReport>>;

const CONNECTION_BADGES: Record<
  ConnectionStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "danger"; pulse: boolean }
> = {
  connecting: { label: "Подключение…", tone: "neutral", pulse: true },
  live: { label: "SSE Live", tone: "success", pulse: true },
  polling: { label: "Опрос сервера", tone: "warning", pulse: true },
  offline: { label: "Нет соединения", tone: "danger", pulse: false },
};

const SEVERITY_OPTIONS: readonly Segment<SocSeverityFilter>[] = [
  { value: "ALL", label: "Все уровни" },
  { value: "CRITICAL", label: "АТАКА" },
  { value: "WARNING", label: "РИСК" },
  { value: "INFO", label: "ИНФО" },
];

const TYPE_FILTER_CHIPS: readonly { value: SocTypeFilter; label: string }[] = [
  { value: "ALL", label: "Все события" },
  { value: "MITM_AMOUNT", label: "MITM сумма" },
  { value: "MITM_RECIPIENT", label: "MITM IBAN" },
  { value: "REPLAY", label: "Replay" },
  { value: "PHISHING_ORIGIN", label: "Phishing / Origin" },
  { value: "SOCIAL_ENGINEERING", label: "Социнженерия" },
  { value: "PQ_SIGNATURE", label: "Квант" },
  { value: "OPERATIONS", label: "Операции без SMS" },
];

export function SocDashboard() {
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
    () => buildAttackBreakdown(aggregates?.blockedByType ?? {}),
    [aggregates?.blockedByType],
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
        const haystack = `${item.txId ?? ""} ${item.actorName} ${item.summary} ${failureCode} ${getEventMeta(item).label}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [events, severityFilter, typeFilter, searchQuery]);

  const hasActiveFilters = typeFilter !== "ALL" || severityFilter !== "ALL" || searchQuery.trim().length > 0;

  function resetFilters() {
    setTypeFilter("ALL");
    setSeverityFilter("ALL");
    setSearchQuery("");
  }

  const conn = CONNECTION_BADGES[connectionStatus];
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
              Security Operations Center
            </span>
            <Badge tone={conn.tone}>
              <span
                aria-hidden="true"
                className={`size-2 rounded-full bg-current ${conn.pulse ? "animate-pulse" : ""}`}
              />
              {conn.label}
            </Badge>
            {projectorMode && (
              <Badge tone="info">Проектор · 5 м</Badge>
            )}
          </div>
          <h1 className={projectorMode ? "mt-2 text-3xl font-extrabold tracking-tight" : "type-h1 mt-2"}>
            SOC-центр БЦК
          </h1>
          <p className={`mt-1 text-ink-secondary ${projectorMode ? "text-base" : "text-sm"}`}>
            Мониторинг отражённых атак, спасённых средств и производительности гибридной криптоподписи в реальном времени.
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
            {projectorMode ? "Режим проектора: ВКЛ" : "Режим проектора"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            icon={<RefreshCw className="size-4" />}
            onClick={() => void loadReport(undefined, { manual: true })}
          >
            Обновить
          </Button>
        </div>
      </div>

      {/* Zero-Crash ошибка загрузки */}
      {error && (
        <ErrorCard
          error={error}
          action={
            <Button size="sm" variant="secondary" onClick={() => void loadReport(undefined, { manual: true })}>
              Повторить загрузку
            </Button>
          }
        />
      )}

      {/* 4 KPI-карточки в реальном времени */}
      <section aria-label="Ключевые показатели SOC" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Отражено атак */}
        <Card variant={(aggregates?.attacksBlocked ?? 0) > 0 ? "danger" : "default"}>
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              Отражено атак
            </span>
            <span className="grid size-9 place-items-center rounded-xl border border-danger/40 bg-danger/[.14] text-danger-text">
              <ShieldAlert aria-hidden="true" className="size-5" />
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-9 w-24" />
          ) : (
            <div className={`mt-3 text-ink-primary ${kpiNumberClass}`}>
              <SocAnimatedMetric
                value={aggregates?.attacksBlocked ?? 0}
                format={v => Math.round(v).toLocaleString("ru-KZ")}
              />
            </div>
          )}
          <p className={`mt-2 font-medium text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
            {(aggregates?.attacksBlocked ?? 0) > 0
              ? "100% заблокировано криптографически и Co-Sign"
              : "Ожидание атак из Панели хакера"}
          </p>
        </Card>

        {/* KPI 2: Спасено средств (₸) */}
        <Card variant={(aggregates?.savedAmountTenge ?? 0) > 0 ? "success" : "default"}>
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              Спасено средств (₸)
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
            MITM + Фишинг + Replay + Социнженерия
          </p>
        </Card>

        {/* KPI 3: Подписано без SMS */}
        <Card variant="default">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              Подписано без SMS
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
            0 SMS отправлено · 0 ₸ операторам связи
          </p>
        </Card>

        {/* KPI 4: Ср. время проверки ML-DSA (мс) + p95 */}
        <Card variant="elevated" className="border-quantum/35">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold uppercase tracking-wider text-ink-secondary ${projectorMode ? "text-sm" : "text-xs"}`}>
              Ср. время проверки ML-DSA (мс)
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
              ТЗ &lt; 25 мс
            </Badge>
          </div>
        </Card>
      </section>

      {/* Средняя секция: SVG-разбивка атак + сравнение задержек SMS vs SafeSign */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <AttackBreakdownChart
            items={breakdown}
            totalAttacks={aggregates?.attacksBlocked ?? 0}
            activeFilter={typeFilter}
            onSelectCategory={setTypeFilter}
            projectorMode={projectorMode}
          />
        </div>

        <Card
          className="lg:col-span-5"
          heading={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-h2 flex items-center gap-2">
                <Zap aria-hidden="true" className="size-5 text-quantum" />
                Бенчмарк: SMS vs SafeSign
              </h2>
              <Badge tone="info" className="font-mono">
                {mlDsa.count} замеров
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
                  <span className="font-semibold text-ink-secondary">SMS-код (OTP)</span>
                  <span className="font-mono font-bold text-danger-text">12–45 сек · 12 ₸ / оп</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <div className="h-full w-full rounded-full bg-danger/70" />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Уязвим к фишингу, MITM-троянам, SIM-swap и социнженерии
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-emerald-300">BCC SafeSign (Passkey + ML-DSA-65)</span>
                  <span className="font-mono font-bold text-bcc">
                    {mlDsa.count > 0 ? formatMs(hybridTotalAvgMs) : "< 5 мс"} · 0 ₸ / оп
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-terminal p-0.5">
                  <div className="h-full w-[4%] min-w-[10px] rounded-full bg-bcc shadow-glow-bcc" />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Аппаратная привязка Origin + WYSIWYS SHA-256 + NIST FIPS 204
                </p>
              </div>
            </div>

            {/* Детальная телеметрия проверок */}
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle bg-terminal p-3">
              <div>
                <dt className="text-xs text-ink-muted">ML-DSA-65 (ср. / p95)</dt>
                <dd className="mono-data mt-1 font-bold text-sky-300">
                  {mlDsa.count > 0 ? `${formatMs(mlDsa.averageMs)} / ${formatMs(mlDsa.p95Ms)}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">WebAuthn (ср. / p95)</dt>
                <dd className="mono-data mt-1 font-bold text-emerald-300">
                  {webAuthn.count > 0 ? `${formatMs(webAuthn.averageMs)} / ${formatMs(webAuthn.p95Ms)}` : "—"}
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
                <h2 className="type-h2">Журнал событий и атак</h2>
                <Badge tone="neutral" className="font-mono">
                  {filteredEvents.length} из {events.length}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  label="Фильтр по уровню угрозы"
                  options={SEVERITY_OPTIONS}
                  value={severityFilter}
                  onChange={setSeverityFilter}
                />
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <label htmlFor="soc-search-input" className="sr-only">
                    Поиск по txId, участнику или описанию
                  </label>
                  <input
                    id="soc-search-input"
                    type="search"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Поиск txId, актора…"
                    className="h-10 w-56 rounded-xl border border-border-default bg-terminal pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus:border-bcc/60 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Фильтр по типам событий */}
            <div role="group" aria-label="Фильтр по типу события" className="flex flex-wrap items-center gap-1.5">
              {[
                ...TYPE_FILTER_CHIPS,
                ...(countsByFilter.OTHER_ATTACK > 0 || typeFilter === "OTHER_ATTACK"
                  ? [{ value: "OTHER_ATTACK" as const, label: "Прочие крипто" }]
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
                  Сбросить фильтры
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
            title="Пока тихо. Запустите атаку в Панели хакера"
            description="Выполните перевод или активируйте любой из 6 сценариев атак на Демо-стенде — инциденты, криптотрассы и метрики ML-DSA-65 появятся здесь в реальном времени."
            action={
              <Link
                href={`/?mode=${mode}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bcc px-4 py-2 text-sm font-semibold text-ink-inverse shadow-glow-bcc transition hover:bg-bcc-hover"
              >
                Открыть Демо-стенд
              </Link>
            }
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            icon={Filter}
            title="Событий по этому фильтру нет"
            description="Попробуйте сбросить фильтры по типу, уровню угрозы или поисковый запрос."
            action={
              <Button size="sm" variant="secondary" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border-default text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="py-2.5 pl-3 pr-3">Время</th>
                  <th scope="col" className="px-3 py-2.5">Уровень</th>
                  <th scope="col" className="px-3 py-2.5">Тип</th>
                  <th scope="col" className="px-3 py-2.5">Актор</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Сумма</th>
                  <th scope="col" className="px-3 py-2.5">Описание</th>
                  <th scope="col" className="py-2.5 pl-3 pr-3 text-right">Разбор</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredEvents.map(item => {
                  const meta = getEventMeta(item);
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
                      className={`cursor-pointer transition-colors duration-500 focus-visible:bg-elevated focus-visible:outline-none ${highlightStyle}`}
                    >
                      <td className={`whitespace-nowrap py-3 pl-3 pr-3 font-mono tabular-nums text-ink-secondary ${projectorMode ? "text-sm" : "text-[13px]"}`}>
                        {formatEventTime(item.timestamp)}
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
                        <div className="truncate font-medium text-ink-primary" title={item.summary}>
                          {item.summary}
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
                          Детали
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
