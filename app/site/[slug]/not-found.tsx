import Link from "next/link";

export default function SiteNotFound() {
  return (
    <div className="max-w-2xl">
      <h1 className="page-title">No such site in the cohort.</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-body">
        This benchmark measures a fixed, pre-registered cohort; a site that is not in it has no
        results, rather than empty ones. The cohort is listed on the leaderboard.
      </p>
      <Link href="/" className="link-ink mt-6 inline-block text-sm font-medium text-ink">
        ← Back to the leaderboard
      </Link>
    </div>
  );
}
