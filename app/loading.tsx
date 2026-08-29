import { SkeletonBar, SkeletonCard, SkeletonTableRows } from "@/components/Skeleton";

export default function LeaderboardLoading() {
  return (
    <div>
      <div className="mb-8">
        <SkeletonBar className="h-8 w-80" />
        <SkeletonBar className="h-4 w-full max-w-2xl mt-3" />
        <SkeletonBar className="h-4 w-2/3 max-w-xl mt-2" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <SkeletonTableRows rows={10} cols={6} />
          </tbody>
        </table>
      </div>
      <p className="sr-only">Loading the leaderboard.</p>
    </div>
  );
}
