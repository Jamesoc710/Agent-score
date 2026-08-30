import Link from "next/link";

export default function NotFound() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Page not found.</h1>
      <p className="text-sm text-slate-500 mt-2">
        There is no page at this address. The published pages are the leaderboard, the
        correlation study, and one detail page per cohort site.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="text-sky-600 hover:underline font-medium">
          Leaderboard
        </Link>
        <Link href="/correlation" className="text-sky-600 hover:underline font-medium">
          Correlation
        </Link>
      </div>
    </div>
  );
}
