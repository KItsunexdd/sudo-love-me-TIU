export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`h-4 rounded-lg bg-elevated motion-safe:animate-pulse ${className}`} />;
}
