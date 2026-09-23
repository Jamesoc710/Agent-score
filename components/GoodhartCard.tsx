import Link from "next/link";
import { agentLabel } from "@/lib/dataset";
import { formatRunWindow } from "@/lib/format";
import { goodhartFigures, outcomeGlyph, type GoodhartSide } from "@/lib/findings";
import { repoFileUrl } from "@/lib/site-config";

// The `goodhart` finding card (design S2-4 section 3): claim, figure, denominator, date, and the
// three-item dropdown. Every figure is read from lib/exhibit-data.ts, the committed fold that
// lib/exhibit.test.ts re-derives from the exhibit's lane artifacts. The exhibit is not a cohort
// batch, so the batch-mismatch guard never suppresses this card.

function GlyphRow({ side, label }: { side: GoodhartSide; label: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="w-full text-[13px] text-ink-body sm:w-56">{label}</span>
      {/* Filled, hollow, dash: distinguishable by shape alone, in ink and muted ink only. */}
      <span aria-hidden className="font-mono text-base tracking-[0.2em] text-ink">
        {side.outcomes.map(outcomeGlyph).join("")}
      </span>
      <span className="font-mono text-[13px] tabular-nums text-ink">
        {side.successes} of {side.measured}
        <span className="sr-only"> trials succeeded</span>
      </span>
    </div>
  );
}

export default function GoodhartCard({ standalone = false }: { standalone?: boolean }) {
  const figures = goodhartFigures();
  if (!figures) return null;
  const { control, gated, sharedMean } = figures;
  const date = formatRunWindow(figures.runWindow);
  const models = figures.agentIds.map(agentLabel).join(" and ");
  const Title = standalone ? "h1" : "h2";

  return (
    <section
      aria-labelledby="finding-goodhart"
      className={standalone ? "" : "mt-12 border-y border-line py-7"}
    >
      <p className="eyebrow">Finding · authored demonstration, not cohort data</p>
      <Title
        id="finding-goodhart"
        className={standalone ? "page-title mt-2 max-w-3xl" : "section-title mt-2 max-w-3xl"}
      >
        {figures.title}
      </Title>
      {/* Claims-table row 6, with every numeral read from the committed exhibit. */}
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-body">
        Two authored pages with byte-identical screenshots and identical Lighthouse output: one
        solved {control.successes}/{control.measured}
        {control.firstStep && " in one step"}, one {gated.successes}/{gated.measured}.
      </p>

      <div className="mt-5 max-w-3xl space-y-2">
        <GlyphRow side={control} label={control.name} />
        <GlyphRow side={gated} label={gated.name} />
        <p className="pt-1 text-[13px] text-ink-body">
          Lighthouse category mean, both pages:{" "}
          <span className="font-mono tabular-nums text-ink">{sharedMean ?? "not the same"}</span>
        </p>
      </div>

      <p className="card-note max-w-3xl">
        {figures.trialsPerPage} trials per page across {figures.agentIds.length} models ({models}),
        batch <code className="font-mono">{figures.batch}</code>
        {date && <>, measured {date} (UTC)</>}. ● succeeded, ○ did not. The pages are authored,
        are not among the cohort&apos;s sites, and enter no cohort figure.
      </p>

      <details className="mt-4 max-w-3xl text-[13px]">
        <summary className="cursor-pointer text-ink-muted transition-colors hover:text-ink">
          View data, computation or image
        </summary>
        <div className="mt-3 grid gap-4 border-t border-line-soft pt-3 text-ink-body sm:grid-cols-3">
          <div>
            <p className="eyebrow mb-1.5">View data</p>
            <ul className="space-y-1">
              {[
                "data/exhibit-goodhart.json",
                "data/agent-runs-goodhart.jsonl",
                "data/lighthouse-goodhart.json",
              ].map((path) => (
                <li key={path}>
                  <a href={repoFileUrl(path)} className="link-ink break-all font-mono text-xs">
                    {path}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-1.5">View computation</p>
            <ul className="space-y-1">
              {["lib/exhibit.ts", "lib/exhibit.test.ts", "scripts/tests/test_exhibit.py"].map((path) => (
                <li key={path}>
                  <a href={repoFileUrl(path)} className="link-ink break-all font-mono text-xs">
                    {path}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              No vector block: these figures are counts and a Lighthouse value, published as data.
              The vitest re-derives the fold (<code className="font-mono">deriveExhibit</code>) from
              the committed artifacts; the Python test checks the pair itself: byte-identical above
              the render block, one registered answer.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-1.5">View image</p>
            <a href="/finding/goodhart/opengraph-image" className="link-ink text-xs">
              This card as a share image
            </a>
          </div>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {!standalone && (
          <Link href="/finding/goodhart" className="link-ink font-medium text-ink">
            Permalink
          </Link>
        )}
        <Link href="/correlation/exhibit" className="link-ink font-medium text-ink">
          The full exhibit, with every transcript →
        </Link>
      </div>
    </section>
  );
}
