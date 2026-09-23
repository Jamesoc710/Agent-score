import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-2xl">
      <h1 className="page-title">Page not found.</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-body">
        There is no page at this address. The published pages are the leaderboard, the
        correlation study, one detail page per cohort site, the methodology and the data.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-5 text-sm">
        <Link href="/" className="link-ink font-medium text-ink">
          Leaderboard
        </Link>
        <Link href="/correlation" className="link-ink font-medium text-ink">
          Correlation
        </Link>
        <Link href="/methodology" className="link-ink font-medium text-ink">
          Methodology
        </Link>
        <Link href="/data" className="link-ink font-medium text-ink">
          Data
        </Link>
      </div>
    </div>
  );
}
