"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { drawerRightVariants, modalVariants, reducedMotionVariants } from "@/lib/ui/motion";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  dismissible?: boolean;
  className?: string;
}

export function DialogSurface({
  open, onClose, title, description, footer, children, dismissible = true, className = "", placement, wide,
}: DialogProps & { placement: "center" | "right"; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const reduce = useReducedMotion();
  const right = placement === "right";

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  return (
    <dialog ref={ref} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      onCancel={event => { event.preventDefault(); if (open && dismissible) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && open && dismissible) onClose(); }}
      className={`fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink-primary open:flex
        ${right ? "justify-end backdrop:bg-black/65 backdrop:backdrop-blur-sm" : "items-center justify-center p-4 backdrop:bg-[#030806]/80 backdrop:backdrop-blur-md"}`}>
      <AnimatePresence onExitComplete={() => { if (!open) ref.current?.close(); }}>
        {open && (
          <motion.section key="panel" initial="hidden" animate="visible" exit="exit"
            variants={reduce ? reducedMotionVariants : right ? drawerRightVariants : modalVariants}
            className={`flex w-full flex-col overflow-hidden border-border-strong shadow-modal
              ${right ? "h-full max-w-[640px] border-l bg-[#0A1612]" :
                `max-h-full rounded-[20px] border bg-surface ${wide ? "max-w-[760px]" : "max-w-[540px]"}`} ${className}`}>
            <header className={`flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 ${right ? "min-h-[72px]" : ""}`}>
              <div className="min-w-0">
                <h2 id={`${id}-title`} className="type-h1 break-words">{title}</h2>
                {description && <div id={`${id}-description`} className="mt-1 text-sm text-ink-secondary">{description}</div>}
              </div>
              {dismissible && (
                <button type="button" aria-label="Закрыть" onClick={onClose}
                  className="shrink-0 rounded-lg p-2 text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">
                  <X aria-hidden="true" className="size-5" />
                </button>
              )}
            </header>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-5">{children}</div>
            {footer && <footer className="shrink-0 border-t border-border-subtle p-5">{footer}</footer>}
          </motion.section>
        )}
      </AnimatePresence>
    </dialog>
  );
}
