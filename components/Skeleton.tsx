// Loading placeholders. Deliberately shapes, never numbers: a skeleton that renders "0%"
// while data is in flight states a measurement that has not been read yet.

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} aria-hidden />;
}

export function SkeletonCard() {
  return (
    <div className="card px-5 py-4">
      <SkeletonBar className="h-7 w-20" />
      <SkeletonBar className="mt-2 h-3 w-28" />
      <SkeletonBar className="mt-2 h-3 w-24" />
    </div>
  );
}

export function SkeletonTableRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line-soft last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <SkeletonBar className={`h-4 ${c === 0 ? "w-6" : c === 1 ? "w-40" : "w-16"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
