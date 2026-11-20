"use client";

import { useT } from "@/components/shell/LocaleProvider";
import { LoaderCircle } from "lucide-react";

export function Spinner({ label, className = "" }: { label?: string; className?: string }) {
  const { t } = useT();
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-sm text-ink-secondary ${className}`}>
      <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      {label ?? t("common.busy")}
    </span>
  );
}
