import { SkeletonBar } from "@/components/Skeleton";

export default function SubAuditLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-36 mb-6" />
      <SkeletonBar className="h-8 w-80" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-3" />

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mt-8 mb-8">
        <SkeletonBar className="h-4 w-64 bg-amber-200" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-3 bg-amber-200" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <SkeletonBar className="h-6 w-96" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-4" />
        <SkeletonBar className="h-28 w-full mt-4" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 space-y-3">
        <SkeletonBar className="h-5 w-72" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBar key={i} className="h-6 w-full" />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <SkeletonBar className="h-5 w-64" />
        <SkeletonBar className="h-24 w-full mt-4" />
      </div>
      <p className="sr-only">Loading the sub-audit breakdown.</p>
    </div>
  );
}
