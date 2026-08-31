import { SkeletonBar } from "@/components/Skeleton";

export default function SubAuditLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-36 mb-8" />
      <SkeletonBar className="h-10 w-full max-w-md" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-5" />

      <div className="card-notice mt-8">
        <SkeletonBar className="h-4 w-full max-w-xs !bg-notice-line" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-3 !bg-notice-line" />
      </div>

      <div className="mt-8 border-y border-line py-3">
        <SkeletonBar className="h-4 w-full max-w-lg" />
      </div>

      <div className="mt-12">
        <SkeletonBar className="h-7 w-full max-w-md" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-4" />
        <SkeletonBar className="h-40 w-full mt-5 rounded-lg" />
      </div>

      <div className="mt-14 space-y-3 border-t border-line pt-8">
        <SkeletonBar className="h-6 w-full max-w-sm" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBar key={i} className="h-6 w-full" />
        ))}
      </div>
      <p className="sr-only">Loading the sub-audit breakdown.</p>
    </div>
  );
}
