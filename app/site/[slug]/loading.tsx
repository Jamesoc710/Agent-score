import { SkeletonBar } from "@/components/Skeleton";

export default function SiteLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-28 mb-6" />
      <div className="flex items-start justify-between mb-8">
        <div className="w-full max-w-md">
          <SkeletonBar className="h-8 w-64" />
          <SkeletonBar className="h-4 w-48 mt-2" />
          <SkeletonBar className="h-4 w-32 mt-2" />
        </div>
        <div className="text-right">
          <SkeletonBar className="h-12 w-28 ml-auto" />
          <SkeletonBar className="h-3 w-24 mt-2 ml-auto" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>

      {/* The trial log now carries a collapsed replay row per trial, so the block it stands in
          for is roughly twice as tall. Shapes only, never numbers. */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <SkeletonBar className="h-72 w-full" />
      </div>
      <p className="sr-only">Loading this site&apos;s results.</p>
    </div>
  );
}
