"use client";

import { useT } from "@/components/shell/LocaleProvider";
import type { MessageKey } from "@/lib/i18n";
import Link from "next/link";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const accents = {
  success: "border-l-bcc",
  warning: "border-l-gold",
  danger: "border-l-danger",
  info: "border-l-quantum",
};

type ToastCopy = { title: string; description?: string } | { titleKey: MessageKey; descriptionKey?: MessageKey };

export type ToastInput = ToastCopy & {
  tone?: keyof typeof accents;
  durationMs?: number;
  kind?: "COSIGN_REQUESTED";
  action?: { label: string } & ({ href: string } | { onClick: () => void });
};

type ToastMessage = ToastInput & { id: number };
type ToastContextValue = { toast: (input: ToastInput) => number; dismiss: (id: number) => void };
const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 0;

function ToastItem({ item, dismiss }: { item: ToastMessage; dismiss: (id: number) => void }) {
  const { t } = useT();
  const reduce = useReducedMotion();
  const { id, tone, kind, durationMs, action } = item;
  const title = "titleKey" in item ? t(item.titleKey) : item.title;
  const description = "titleKey" in item ? item.descriptionKey && t(item.descriptionKey) : item.description;
  const cosign = kind === "COSIGN_REQUESTED";
  const resolvedTone = tone ?? (cosign ? "warning" : "info");
  const link = action ?? (cosign ? { href: "/cosign", label: t("toast.cosign") } : undefined);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), durationMs ?? (cosign ? 8_000 : 4_500));
    return () => clearTimeout(timer);
  }, [cosign, dismiss, durationMs, id]);

  return (
    <motion.div layout={!reduce} initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }}
      className={`pointer-events-auto flex justify-between gap-3 rounded-xl border border-l-4 border-border-strong bg-elevated p-3.5 shadow-card ${accents[resolvedTone]}`}>
      <div role={resolvedTone === "danger" ? "alert" : "status"} className="min-w-0 space-y-1">
        <p className="type-h3">{title}</p>
        {description && <p className="text-sm text-ink-secondary">{description}</p>}
        {link && ("href" in link ? (
          <Link href={link.href} onClick={() => dismiss(id)} className="inline-block rounded text-sm font-semibold text-bcc underline">{link.label}</Link>
        ) : (
          <button type="button" className="rounded text-sm font-semibold text-bcc underline"
            onClick={() => { dismiss(id); link.onClick(); }}>{link.label}</button>
        ))}
      </div>
      <button type="button" aria-label={t("toast.dismiss")} onClick={() => dismiss(id)}
        className="self-start rounded p-1 text-ink-secondary hover:bg-surface-hover">
        <X className="size-4" aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: number) => setItems(current => current.filter(item => item.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = ++nextId;
    setItems(current => [...current.slice(-2), { ...input, id }]);
    return id;
  }, []);
  const context = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={context}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2.5 sm:bottom-5 sm:right-5">
        <AnimatePresence>
          {items.map(item => <ToastItem key={item.id} item={item} dismiss={dismiss} />)}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast требует ToastProvider.");
  return context;
}
