import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ title, description, icon: Icon = Inbox, action, className = "" }: {
  title: ReactNode; description?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string;
}) {
  return (
    <div className={`grid justify-items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-terminal/50 p-6 text-center ${className}`}>
      <span className="grid size-11 place-items-center rounded-xl border border-border-default bg-elevated text-bcc">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <h3 className="type-h3">{title}</h3>
        {description && <div className="mt-1 max-w-md text-sm text-ink-secondary">{description}</div>}
      </div>
      {action}
    </div>
  );
}
