import { SkeletonBar } from "@/components/Skeleton";

export default function SiteLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-28 mb-8" />
      <div className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="w-full max-w-md min-w-0">
          <SkeletonBar className="h-10 w-64" />
          <SkeletonBar className="h-4 w-48 mt-3" />
          <SkeletonBar className="h-4 w-32 mt-3" />
        </div>
        <div className="shrink-0 sm:text-right">
          <SkeletonBar className="h-11 w-28 sm:ml-auto" />
          <SkeletonBar className="h-3 w-24 mt-3 sm:ml-auto" />
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="space-y-3 md:border-r md:border-line md:pr-12">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>

      {/* The trial log carries a collapsed replay row per trial, so the block it stands in
          for is roughly twice as tall. Shapes only, never numbers. */}
      <div className="mt-12 border-t border-line pt-8">
        <SkeletonBar className="h-72 w-full" />
      </div>
      <p className="sr-only">Loading this site&apos;s results.</p>
    </div>
  );
}
