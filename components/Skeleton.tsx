// Loading placeholders. Deliberately shapes, never numbers: a skeleton that renders "0%"
// while data is in flight states a measurement that has not been read yet.

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <SkeletonBar className="h-7 w-20" />
      <SkeletonBar className="h-3 w-28 mt-2" />
      <SkeletonBar className="h-3 w-24 mt-2" />
    </div>
  );
}

export function SkeletonTableRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-slate-100 last:border-0">
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
