import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

export function PhoneFrame({ children, preset = "full", owner, time = "14:32", className = "" }: {
  children: ReactNode; preset?: "full" | "compact"; owner?: ReactNode; time?: string; className?: string;
}) {
  return (
    <div className={`w-full md:border md:border-border-strong md:bg-[linear-gradient(180deg,#1E3B32,#0B1915)] md:shadow-phone
      ${preset === "compact" ? "md:mx-auto md:max-w-[400px] md:rounded-[28px] md:p-2" : "md:rounded-phone md:p-2 2xl:p-2.5"} ${className}`}>
      <div className="md:overflow-hidden md:rounded-[24px] md:border md:border-border-subtle md:bg-canvas">
        <div aria-hidden="true" className="relative hidden h-7 items-center justify-between px-5 font-mono text-xs tabular-nums text-ink-secondary md:flex 2xl:h-8">
          <span>{time}</span>
          <span className="absolute left-1/2 grid h-[18px] w-24 -translate-x-1/2 place-items-center rounded-full bg-[#030706] text-bcc 2xl:h-5">
            <LockKeyhole className="size-3" />
          </span>
          <span>5G • SafeSign</span>
        </div>
        {owner && <div className="border-b border-border-subtle bg-surface/60 px-3.5 py-1.5 text-xs font-semibold text-ink-secondary">{owner}</div>}
        {children}
      </div>
    </div>
  );
}
