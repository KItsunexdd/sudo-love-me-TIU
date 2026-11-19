import { Timer } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatMs } from "@/lib/ui/format";

export function LatencyBadge({ ms, label, tone = "info" }: { ms: number; label?: string; tone?: BadgeTone }) {
  return (
    <Badge tone={tone} className="font-mono tabular-nums">
      <Timer aria-hidden="true" className="size-3.5" />
      {label && <span>{label}</span>}
      {formatMs(ms)}
    </Badge>
  );
}
