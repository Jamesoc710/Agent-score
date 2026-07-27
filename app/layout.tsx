import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentRank — Is the web ready for agents?",
  description:
    "A behavioral leaderboard ranking websites by how often a Gemini agent can complete a real task on them, correlated against Google's Lighthouse Agentic Browsing score.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-bold text-slate-900 text-lg tracking-tight">
              <span className="text-sky-600">Agent</span>Rank
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-slate-900 transition-colors">
                Leaderboard
              </Link>
              <Link href="/correlation" className="hover:text-slate-900 transition-colors">
                Correlation
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white mt-16">
          <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between text-xs text-slate-400">
            <span>AgentRank · behavioral agent-readiness scoring</span>
            <span>
              Static scores via{" "}
              <a href="https://developer.chrome.com/docs/lighthouse" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">
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
