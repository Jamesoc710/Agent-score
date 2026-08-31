import { SkeletonBar } from "@/components/Skeleton";

export default function CorrelationLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-28 mb-8" />
      <SkeletonBar className="h-10 w-full max-w-lg" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-5" />

      <div className="mt-10 border-y border-line py-7">
        <SkeletonBar className="h-9 w-40" />
        <SkeletonBar className="h-3 w-64 mt-5" />
        <SkeletonBar className="h-3 w-40 mt-3" />
      </div>

      <div className="border-b border-line py-4 sm:py-6">
        <SkeletonBar className="h-[340px] w-full sm:h-[420px]" />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="space-y-5 md:border-r md:border-line md:pr-12">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBar key={i} className="h-12 w-full" />
          ))}
        </div>
        <div>
          <SkeletonBar className="h-6 w-56" />
          <SkeletonBar className="h-28 w-full mt-5" />
        </div>
      </div>
      <p className="sr-only">Loading the correlation study.</p>
    </div>
  );
}
