import Link from "next/link";

export default function SiteNotFound() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">No such site in the cohort.</h1>
      <p className="text-sm text-slate-500 mt-2">
        This benchmark measures a fixed, pre-registered cohort — a site that is not in it has no
        results, rather than empty ones. The cohort is listed on the leaderboard.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-sky-600 hover:underline font-medium">
        ← Back to the leaderboard
      </Link>
    </div>
  );
}
