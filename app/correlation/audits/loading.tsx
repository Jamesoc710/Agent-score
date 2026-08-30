import { SkeletonBar } from "@/components/Skeleton";

export default function SubAuditLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-36 mb-6" />
      <SkeletonBar className="h-8 w-full max-w-xs sm:max-w-sm" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-3" />

      <div className="card-notice mt-8 mb-8">
        <SkeletonBar className="h-4 w-full max-w-xs !bg-notice-line" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-3 !bg-notice-line" />
      </div>

      <div className="card card-pad mb-6">
        <SkeletonBar className="h-6 w-full max-w-sm sm:max-w-md" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-4" />
        <SkeletonBar className="h-28 w-full mt-4" />
      </div>

      <div className="card card-pad mb-6 space-y-3">
        <SkeletonBar className="h-5 w-full max-w-xs" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBar key={i} className="h-6 w-full" />
        ))}
      </div>

      <div className="card card-pad">
        <SkeletonBar className="h-5 w-full max-w-xs" />
        <SkeletonBar className="h-24 w-full mt-4" />
      </div>
      <p className="sr-only">Loading the sub-audit breakdown.</p>
    </div>
  );
}
