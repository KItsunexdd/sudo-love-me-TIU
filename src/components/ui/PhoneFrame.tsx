import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

// The client's phone: a plain device with a hairline bezel. Outer radius 28 − padding 8 = inner 20.
export function PhoneFrame({ children, preset = "full", owner, time = "14:32", className = "" }: {
  children: ReactNode; preset?: "full" | "compact"; owner?: ReactNode; time?: string; className?: string;
}) {
  return (
    <div className={`w-full md:rounded-phone md:border md:border-border-strong md:bg-terminal md:p-2 md:shadow-phone
      ${preset === "compact" ? "md:mx-auto md:max-w-[400px]" : ""} ${className}`}>
      <div className="md:overflow-hidden md:rounded-[20px] md:border md:border-border-subtle md:bg-canvas">
        <div aria-hidden="true" className="relative hidden h-8 items-center justify-between px-5 font-mono text-xs tabular-nums text-ink-muted md:flex">
          <span>{time}</span>
          <span className="absolute left-1/2 grid h-5 w-20 -translate-x-1/2 place-items-center rounded-full bg-terminal text-ink-muted">
            <LockKeyhole className="size-3" strokeWidth={1.75} />
          </span>
          <span>5G</span>
        </div>
        {owner && <div className="border-b border-border-subtle px-4 py-2 text-xs text-ink-secondary">{owner}</div>}
        {children}
      </div>
    </div>
  );
}
