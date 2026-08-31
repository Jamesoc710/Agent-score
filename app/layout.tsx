import type { Metadata } from "next";
import { Literata } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// The one webfont: a text serif for headings, over the platform sans for UI and the platform
// mono for figures.
//
// `next/font` self-hosts the woff2, preloads it, and generates a size-adjusted local fallback
// from the face's own metrics, so headings do not reflow when it swaps in and nothing is
// fetched from a font CDN at runtime. That fallback is why the face is Literata and not
// Newsreader: Next's metrics table keys Newsreader as "Newsreader 16pt", the override lookup
// misses, and the build drops the size-adjust silently — a swap that visibly moves every h1.
// Literata is the same genre (a contemporary reading serif), is variable so all three weights
// plus italic arrive in one 79 KB pair of files, and its metrics resolve.
const serif = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  // Absolute base for OG/twitter image URLs (app/opengraph-image.tsx); crawlers
  // require absolute URLs and Next warns without this.
  metadataBase: new URL("https://agent-score-weld.vercel.app"),
  title: "AgentRank: Is the web ready for agents?",
  description:
    "A behavioral leaderboard ranking websites by how often a Gemini agent can complete a real task on them, correlated against Google's Lighthouse Agentic Browsing score.",
};

/** The brand mark: three bars, the same shape as the favicon and the OG card. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0" aria-hidden focusable="false">
      <rect x="2" y="17" width="7" height="11" rx="1.5" className="fill-good-bar" opacity="0.5" />
      <rect x="12.5" y="11" width="7" height="17" rx="1.5" className="fill-good-bar" opacity="0.75" />
      <rect x="23" y="4" width="7" height="24" rx="1.5" className="fill-good-bar" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body className="flex min-h-screen flex-col">
        {/* The leaderboard is a 28-row table; a keyboard reader should be able to step over
            the chrome rather than through it. */}
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-10 focus-visible:rounded focus-visible:border focus-visible:border-line focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink focus-visible:shadow"
        >
          Skip to content
        </a>

        <header className="border-b border-line bg-canvas">
          {/* Wraps rather than overflows: three nav labels plus the wordmark do not fit one
              375px line, and a header that scrolls sideways is a broken header. */}
          <div className="mx-auto flex min-h-[4rem] max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="-mx-1 inline-flex items-center gap-2 rounded px-1 font-serif text-lg font-medium text-ink sm:text-xl"
            >
              <Mark />
              AgentRank
            </Link>
            <nav className="flex items-center gap-3.5 text-[13px] font-medium sm:gap-6 sm:text-sm">
              <Link
                href="/"
                className="rounded py-1 text-ink-muted transition-colors hover:text-ink"
              >
                Leaderboard
              </Link>
              <Link
                href="/correlation"
                className="rounded py-1 text-ink-muted transition-colors hover:text-ink"
              >
                Correlation
              </Link>
              <Link
                href="/correlation/audits"
                className="rounded py-1 text-ink-muted transition-colors hover:text-ink"
              >
                Sub-audits
              </Link>
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
          {children}
        </main>

        <footer className="mt-16 border-t border-line bg-canvas">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <span>AgentRank · behavioral agent-readiness scoring</span>
            <span>
              Static scores via{" "}
              <a
                href="https://developer.chrome.com/docs/lighthouse"
                target="_blank"
                rel="noreferrer"
                className="link-ink"
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
