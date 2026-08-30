import { SkeletonBar } from "@/components/Skeleton";

export default function SiteLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-28 mb-6" />
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="w-full max-w-md min-w-0">
          <SkeletonBar className="h-8 w-64" />
          <SkeletonBar className="h-4 w-48 mt-2" />
          <SkeletonBar className="h-4 w-32 mt-2" />
        </div>
        <div className="shrink-0 sm:text-right">
          <SkeletonBar className="h-12 w-28 sm:ml-auto" />
          <SkeletonBar className="h-3 w-24 mt-2 sm:ml-auto" />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6">
        <div className="card card-pad space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="card card-pad space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>

      {/* The trial log now carries a collapsed replay row per trial, so the block it stands in
          for is roughly twice as tall. Shapes only, never numbers. */}
      <div className="card card-pad">
        <SkeletonBar className="h-72 w-full" />
      </div>
      <p className="sr-only">Loading this site&apos;s results.</p>
    </div>
  );
}
