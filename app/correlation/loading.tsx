import { SkeletonBar } from "@/components/Skeleton";

export default function CorrelationLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-28 mb-6" />
      <SkeletonBar className="h-8 w-96" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-3" />

      <div className="bg-white rounded-xl border border-slate-200 p-6 mt-8 mb-6">
        <SkeletonBar className="h-10 w-40" />
        <SkeletonBar className="h-3 w-56 mt-3" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
        <SkeletonBar className="h-[420px] w-full" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBar key={i} className="h-6 w-full" />
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <SkeletonBar className="h-24 w-full" />
        </div>
      </div>
      <p className="sr-only">Loading the correlation study.</p>
    </div>
  );
}
