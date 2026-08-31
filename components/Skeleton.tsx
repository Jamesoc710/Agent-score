// Loading placeholders. Deliberately shapes, never numbers: a skeleton that renders "0%"
// while data is in flight states a measurement that has not been read yet.

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} aria-hidden />;
}

/** One cell of the hairline stat strip: a value, a label and its denominator line. */
export function SkeletonStat({ className = "" }: { className?: string }) {
  return (
    <div className={`px-4 py-5 sm:px-5 ${className}`}>
      <SkeletonBar className="h-8 w-24" />
      <SkeletonBar className="mt-3 h-3 w-32" />
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
            <td key={c} className="px-4 py-4">
              <SkeletonBar className={`h-4 ${c === 0 ? "w-6" : c === 1 ? "w-40" : "w-16"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
