export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`h-4 rounded-md bg-elevated ${className}`} />;
}
