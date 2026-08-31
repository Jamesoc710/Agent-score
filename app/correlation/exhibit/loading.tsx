import { SkeletonBar } from "@/components/Skeleton";

export default function ExhibitLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-36 mb-8" />
      <SkeletonBar className="h-10 w-full max-w-xl" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-5" />

      <div className="card-notice mt-8">
        <SkeletonBar className="h-4 w-full max-w-sm !bg-notice-line" />
        <SkeletonBar className="h-3 w-full max-w-3xl mt-3 !bg-notice-line" />
      </div>

      <div className="mt-12">
        <SkeletonBar className="h-7 w-full max-w-xl" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <SkeletonBar className="h-28 w-full rounded-lg" />
          <SkeletonBar className="h-28 w-full rounded-lg" />
        </div>
      </div>

      <div className="mt-10 border-y border-line py-4 sm:py-6">
        <SkeletonBar className="h-[340px] w-full sm:h-[420px]" />
      </div>
      <p className="sr-only">Loading the Goodhart exhibit.</p>
    </div>
  );
}
