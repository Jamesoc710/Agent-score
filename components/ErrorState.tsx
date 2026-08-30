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
    <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Could not load {what}.</h1>
      <p className="text-sm text-slate-500 mt-2">
        The results database did not answer this request, so nothing is shown rather than an
        empty page — no numbers here would have been real.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Try again
        </button>
        <a
          href="/"
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Back to the leaderboard
        </a>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-slate-400 font-mono">Error digest: {error.digest}</p>
      )}
    </div>
  );
}
