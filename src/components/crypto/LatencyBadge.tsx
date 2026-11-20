import type { BadgeTone } from "@/components/ui/Badge";
import { formatMs } from "@/lib/ui/format";

// Latency is meta: quiet mono text, the figure in the colour of its verdict.
const figure: Record<BadgeTone, string> = {
  success: "text-ink-primary",
  warning: "text-gold-text",
  danger: "text-danger-text",
  info: "text-ink-primary",
  neutral: "text-ink-secondary",
};

export function LatencyBadge({ ms, label, tone = "info" }: { ms: number; label?: string; tone?: BadgeTone }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono text-xs tabular-nums text-ink-muted">
      {label && <span>{label}</span>}
      <span className={figure[tone]}>{formatMs(ms)}</span>
    </span>
  );
}
