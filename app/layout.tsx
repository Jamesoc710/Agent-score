import type { Metadata } from "next";
import { Literata } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { EDITION } from "@/lib/edition-data";
import { CONTACT_ADDRESS, LICENCE, REPO_URL, SITE_NAME, SITE_URL, SUBMIT_SITE_URL } from "@/lib/site-config";
import "./globals.css";

// The one webfont: a text serif for headings, over the platform sans for UI and the platform
// mono for figures.
//
// `next/font` self-hosts the woff2, preloads it, and generates a size-adjusted local fallback
// from the face's own metrics, so headings do not reflow when it swaps in and nothing is
// fetched from a font CDN at runtime. That fallback is why the face is Literata and not
// Newsreader: Next's metrics table keys Newsreader as "Newsreader 16pt", the override lookup
// misses, and the build drops the size-adjust silently: a swap that visibly moves every h1.
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
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME}: ${EDITION.edition.title}`,
  description: `One frozen agent, one fixed task shape, ${EDITION.sites.length} websites, answers registered before any run: a behavioral rate per site, published beside the Lighthouse Agentic Browsing category mean.`,
};

const NAV = [
  { href: "/#leaderboard", label: "Leaderboard" },
  { href: "/correlation", label: "Correlation" },
  { href: "/methodology", label: "Methodology" },
  { href: "/data", label: "Data" },
];

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
          {/* Wraps rather than overflows: the nav labels plus the wordmark do not fit one 375px
              line, and a header that scrolls sideways is a broken header. */}
          <div className="mx-auto flex min-h-[4rem] max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="-mx-1 inline-flex items-center gap-2 rounded px-1 font-serif text-lg font-medium text-ink sm:text-xl"
            >
              <Mark />
              AgentRank
            </Link>
            {/* Sub-audits is reached from /correlation, where the family is explained. */}
            <nav className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] font-medium sm:gap-x-6 sm:text-sm">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded py-1 text-ink-muted transition-colors hover:text-ink"
                >
                  {label}
                </Link>
              ))}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded py-1 text-ink-muted transition-colors hover:text-ink"
              >
                GitHub ↗
              </a>
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
          {children}
        </main>

        <footer className="mt-16 border-t border-line bg-canvas">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-ink-muted sm:px-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <span>
                {SITE_NAME} · {EDITION.edition.title}
              </span>
              <span>
                Static axis via{" "}
                <a
                  href="https://developer.chrome.com/docs/lighthouse"
                  target="_blank"
                  rel="noreferrer"
                  className="link-ink"
                >
                  Google Lighthouse{EDITION.lane1.lighthouse_version && ` ${EDITION.lane1.lighthouse_version}`}
                </a>{" "}
                (<Link href="/#fraction-not-score" className="link-ink">the category mean</Link>) ·
                Behavioral results via Gemini
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/data#cite" className="link-ink">
                Cite this edition
              </Link>
              <a href={SUBMIT_SITE_URL} target="_blank" rel="noreferrer" className="link-ink">
                Submit a site
              </a>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="link-ink">
                Repository
              </a>
              {LICENCE ? (
                <a href={LICENCE.url} className="link-ink">
                  {LICENCE.name}
                </a>
              ) : (
                <Link href="/data#licence" className="link-ink">
                  Licence: none declared yet
                </Link>
              )}
              {/* Printed as text, with the link beside it, so it survives being copied. */}
              {CONTACT_ADDRESS && (
                <span>
                  Contact: {CONTACT_ADDRESS}{" "}
                  <a href={`mailto:${CONTACT_ADDRESS}`} className="link-ink">
                    (email)
                  </a>
                </span>
              )}
            </div>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
