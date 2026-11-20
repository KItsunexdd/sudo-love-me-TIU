"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
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
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const reduce = useReducedMotion();
  const right = placement === "right";

  const restoreFocus = useCallback(() => {
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previous && previous.isConnected && typeof previous.focus === "function") {
      requestAnimationFrame(() => {
        if (previous.isConnected) previous.focus();
      });
    }
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        const active = document.activeElement;
        previousFocusRef.current = active instanceof HTMLElement ? active : null;
        dialog.showModal();
      }
      return;
    }

    if (reduce && dialog.open) {
      dialog.close();
      restoreFocus();
    }
  }, [open, reduce, restoreFocus]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      restoreFocus();
    };
  }, [restoreFocus]);

  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={event => {
        event.preventDefault();
        if (open && dismissible) onClose();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (open && dismissible) onClose();
        }
      }}
      onClick={event => {
        if (event.target === event.currentTarget && open && dismissible) onClose();
      }}
      className={`fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink-primary open:flex backdrop:bg-black/60
        ${right ? "justify-end" : "items-center justify-center p-4"}`}
    >
      <AnimatePresence
        onExitComplete={() => {
          if (!open) {
            if (ref.current?.open) ref.current.close();
            restoreFocus();
          }
        }}
      >
        {open && (
          <motion.section
            key="panel"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={reduce ? reducedMotionVariants : right ? drawerRightVariants : modalVariants}
            className={`flex w-full flex-col overflow-hidden border-border-default bg-surface shadow-modal
              ${right ? "h-full max-w-[640px] border-l" :
                `max-h-full rounded-2xl border ${wide ? "max-w-[760px]" : "max-w-[540px]"}`} ${className}`}
          >
            <header className={`flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-6 py-4 ${right ? "min-h-16" : ""}`}>
              <div className="min-w-0 pt-1">
                <h2 id={`${id}-title`} className="type-h2 break-words">{title}</h2>
                {description && <div id={`${id}-description`} className="mt-1 text-sm text-ink-secondary">{description}</div>}
              </div>
              {dismissible && (
                <button
                  type="button"
                  aria-label={t("common.close")}
                  onClick={onClose}
                  className="-mr-2 shrink-0 rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-primary"
                >
                  <X aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
                </button>
              )}
            </header>
            {/* Focusable so keyboard users can scroll long content such as a full verification trace. */}
            <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
            {footer && <footer className="shrink-0 border-t border-border-subtle px-6 py-4">{footer}</footer>}
          </motion.section>
        )}
      </AnimatePresence>
    </dialog>
  );
}
