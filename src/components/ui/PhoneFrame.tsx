import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

export function PhoneFrame({ children, preset = "full", owner, time = "14:32", className = "" }: {
  children: ReactNode; preset?: "full" | "compact"; owner?: ReactNode; time?: string; className?: string;
}) {
  return (
    <div className={`w-full md:border md:border-border-strong md:bg-[linear-gradient(180deg,#1E3B32,#0B1915)] md:shadow-phone
      ${preset === "compact" ? "md:mx-auto md:max-w-[380px] md:rounded-[28px] md:p-2" : "md:rounded-phone md:p-2.5"} ${className}`}>
      <div className="md:overflow-hidden md:rounded-[24px] md:border md:border-border-subtle md:bg-canvas">
        <div aria-hidden="true" className="relative hidden h-8 items-center justify-between px-5 font-mono text-xs tabular-nums text-ink-secondary md:flex">
          <span>{time}</span>
          <span className="absolute left-1/2 grid h-5 w-24 -translate-x-1/2 place-items-center rounded-full bg-[#030706] text-bcc">
            <LockKeyhole className="size-3" />
          </span>
          <span>5G • SafeSign</span>
        </div>
        {owner && <div className="border-b border-border-subtle px-4 py-2 text-sm font-medium text-ink-secondary">{owner}</div>}
        {children}
      </div>
    </div>
  );
}
