import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ title, description, icon: Icon = Inbox, action, className = "", headingLevel = 3 }: {
  title: ReactNode; description?: ReactNode; icon?: LucideIcon; action?: ReactNode; className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={`grid justify-items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-terminal/50 p-6 text-center ${className}`}>
      <span className="grid size-11 place-items-center rounded-xl border border-border-default bg-elevated text-bcc">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <Heading className="type-h3">{title}</Heading>
        {description && <div className="mt-1 max-w-md text-sm text-ink-secondary">{description}</div>}
      </div>
      {action}
    </div>
  );
}
