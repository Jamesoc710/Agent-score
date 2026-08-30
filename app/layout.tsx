import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute base for OG/twitter image URLs (app/opengraph-image.tsx); crawlers
  // require absolute URLs and Next warns without this.
  metadataBase: new URL("https://agent-score-weld.vercel.app"),
  title: "AgentRank — Is the web ready for agents?",
  description:
    "A behavioral leaderboard ranking websites by how often a Gemini agent can complete a real task on them, correlated against Google's Lighthouse Agentic Browsing score.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        {/* The leaderboard is a 28-row table; a keyboard reader should be able to step over
            the chrome rather than through it. */}
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-10 focus-visible:rounded-lg focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink focus-visible:shadow"
        >
          Skip to content
        </a>

        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link
              href="/"
              className="-mx-1 rounded px-1 text-lg font-bold tracking-tight text-ink"
            >
              <span className="text-accent">Agent</span>Rank
            </Link>
            <nav className="flex items-center gap-1 text-sm font-medium">
              <Link
                href="/"
                className="rounded-md px-2 py-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Leaderboard
              </Link>
              <Link
                href="/correlation"
                className="rounded-md px-2 py-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Correlation
              </Link>
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>

        <footer className="mt-16 border-t border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <span>AgentRank · behavioral agent-readiness scoring</span>
            <span>
              Static scores via{" "}
              <a
                href="https://developer.chrome.com/docs/lighthouse"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
              >
                Google Lighthouse 13.3
              </a>{" "}
              · Behavioral results via Gemini
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
