import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card card-pad max-w-2xl">
      <h1 className="text-xl font-semibold text-ink">Page not found.</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-body">
        There is no page at this address. The published pages are the leaderboard, the
        correlation study, and one detail page per cohort site.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="font-medium text-accent hover:underline">
          Leaderboard
        </Link>
        <Link href="/correlation" className="font-medium text-accent hover:underline">
          Correlation
        </Link>
      </div>
    </div>
  );
}
