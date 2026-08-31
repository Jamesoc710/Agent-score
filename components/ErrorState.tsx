"use client";

// A failed read renders this, never an empty dataset. The whole result rests on the rule that
// the site does not display a measurement it does not have, and "0 sites, 0% success" is
// exactly what an unhandled read failure would otherwise look like.

export default function ErrorState({
  what,
  error,
  reset,
}: {
  what: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card card-pad max-w-2xl">
      <h1 className="font-serif text-2xl font-medium text-ink">Could not load {what}.</h1>
      <p className="mt-2 text-sm text-ink-body">
        The results database did not answer this request, so nothing is shown rather than an
        empty page; no numbers here would have been real.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={reset}
          className="rounded bg-ink px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-strong"
        >
          Try again
        </button>
        <a
          href="/"
          className="link-ink px-1 py-2 text-sm text-ink-muted"
        >
          Back to the leaderboard
        </a>
      </div>
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-ink-muted">Error digest: {error.digest}</p>
      )}
    </div>
  );
}
