import { SkeletonBar, SkeletonStat, SkeletonTableRows } from "@/components/Skeleton";

export default function LeaderboardLoading() {
  return (
    <div>
      <SkeletonBar className="h-10 w-full max-w-md" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-6" />
      <SkeletonBar className="h-4 w-2/3 max-w-xl mt-2" />

      <div className="mt-12 grid grid-cols-2 border-y border-line lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStat
            key={i}
            className={`${i % 2 === 1 ? "border-l border-line-soft" : ""} ${
              i >= 2 ? "border-t border-line-soft lg:border-t-0" : ""
            } ${i === 2 ? "lg:border-l lg:border-line-soft" : ""}`}
          />
        ))}
      </div>

      <div className="mt-12 border-y border-line">
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
