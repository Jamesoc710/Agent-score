import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GoodhartCard from "@/components/GoodhartCard";
import { FINDING_IDS, goodhartFigures } from "@/lib/findings";
import { repoFileUrl } from "@/lib/site-config";

// One finding card, full page (design S2-4 section 3). A permalink gives each figure a stable
// URL to cite and its own share image, which an anchor on the front page cannot have. Static:
// the card reads a committed artifact, never the database.

export const dynamicParams = false;

export function generateStaticParams() {
  return FINDING_IDS.map((id) => ({ id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const figures = params.id === "goodhart" ? goodhartFigures() : null;
  if (!figures) return {};
  return {
    title: `${figures.title} · AgentRank`,
    description: `Two authored pages with byte-identical screenshots and identical Lighthouse output: one solved ${figures.control.successes}/${figures.control.measured}, one ${figures.gated.successes}/${figures.gated.measured}.`,
  };
}

export default function FindingPage({ params }: { params: { id: string } }) {
  if (params.id !== "goodhart") notFound();

  return (
    <div>
      <div className="mb-8">
        <Link href="/" className="back-link">
          ← Leaderboard
        </Link>
      </div>
      <GoodhartCard standalone />
      <p className="mt-10 max-w-3xl text-xs leading-relaxed text-ink-muted">
        A finding card is a figure with its claim, its denominator and its date. Its figures are
        read from a committed artifact that a test re-derives from the run&apos;s own records, so
        this page cannot show a number the run did not produce. The exhibit&apos;s registration is{" "}
        <a href={repoFileUrl("docs/EXHIBIT.md")} className="link-ink">
          docs/EXHIBIT.md
        </a>
        .
      </p>
    </div>
  );
}
