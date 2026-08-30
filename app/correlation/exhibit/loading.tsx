import { SkeletonBar } from "@/components/Skeleton";

export default function ExhibitLoading() {
  return (
    <div>
      <SkeletonBar className="h-4 w-36 mb-6" />
      <SkeletonBar className="h-8 w-full max-w-lg" />
      <SkeletonBar className="h-4 w-full max-w-2xl mt-3" />

      <div className="card card-pad mb-8 mt-8">
        <SkeletonBar className="h-20 w-full" />
      </div>

      <div className="card card-pad mb-6">
        <SkeletonBar className="h-7 w-full max-w-xl" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <SkeletonBar className="h-28 w-full" />
          <SkeletonBar className="h-28 w-full" />
        </div>
      </div>

      <div className="card card-pad mb-8">
        <SkeletonBar className="h-[340px] w-full sm:h-[420px]" />
      </div>
      <p className="sr-only">Loading the Goodhart exhibit.</p>
    </div>
  );
}
