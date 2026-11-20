"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { regions, russian, t as translate, type Locale, type MessageKey, type Translate } from "@/lib/i18n";

const storageKey = "safesign:locale";
const LocaleContext = createContext<{
  locale: Locale;
  region: string;
  t: Translate;
  setLocale: (locale: Locale) => void;
}>({ locale: "ru", region: regions.ru, t: russian, setLocale: () => {} });

function valid(value: string | null): value is Locale {
  return value === "ru" || value === "kk";
}

function readLocale(fallback: Locale): Locale {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (valid(query)) return query;
  try {
    const stored = localStorage.getItem(storageKey);
    if (valid(stored)) return stored;
  } catch { /* The URL also persists the choice. */ }
  return fallback;
}

const titles: Record<string, MessageKey> = {
  "/": "common.demo", "/soc": "common.soc", "/roi": "common.roi", "/cosign": "cosign.heading",
  "/dev/kit": "page.kit", "/phishing-clone": "page.clone",
};

function SyncLocale() {
  const path = usePathname();
  const query = useSearchParams().toString();
  const { locale, setLocale } = useT();
  useEffect(() => {
    const selected = readLocale(locale);
    setLocale(selected);
    const title = translate(selected, titles[path] ?? "not-found.missing");
    document.title = path === "/phishing-clone" ? title : title + " · BCC SafeSign";
  }, [locale, path, query, setLocale]);
  return null;
}

export function LocaleProvider({ children, initialLocale = "ru", standalone = false }: PropsWithChildren<{
  initialLocale?: Locale; standalone?: boolean;
}>) {
  const [locale, update] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("lang") !== next) {
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    }
    try { localStorage.setItem(storageKey, next); } catch { /* The URL carries the choice. */ }
    document.documentElement.lang = next;
    update(next);
  }, []);
  useEffect(() => {
    if (standalone) setLocale(readLocale("ru"));
  }, [standalone, setLocale]);
  const value = useMemo(() => ({
    locale, region: regions[locale], setLocale,
    t: (key: MessageKey, params?: Parameters<Translate>[1]) => translate(locale, key, params),
  }), [locale, setLocale]);
  return (
    <LocaleContext.Provider value={value}>
      {!standalone && <Suspense fallback={null}><SyncLocale /></Suspense>}
      {children}
    </LocaleContext.Provider>
  );
}

export function useT() {
  return useContext(LocaleContext);
}

export function LocaleSwitch() {
  const { locale, setLocale } = useT();
  return (
    <div role="group" aria-label="Язык / Тіл" className="inline-flex shrink-0 rounded-xl border border-border-strong p-0.5">
      {(["ru", "kk"] as const).map(option => (
        <button type="button" key={option} lang={option} aria-pressed={locale === option}
          aria-label={option === "ru" ? "РУС · Русский / Орыс тілі" : "ҚАЗ · Қазақ тілі / Казахский"}
          onClick={() => setLocale(option)}
          className={`min-h-8 rounded-lg px-2 text-xs font-semibold ${locale === option ? "bg-elevated text-bcc" : "text-ink-secondary"}`}>
          {option === "ru" ? "РУС" : "ҚАЗ"}
        </button>
      ))}
    </div>
  );
}
