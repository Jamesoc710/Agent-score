import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { agentLabel } from "@/lib/dataset";
import { EDITION } from "@/lib/edition-data";
import { formatDate } from "@/lib/format";
import {
  findHeading,
  headingIndex,
  inlineSegments,
  leadingSentences,
  paragraphUnder,
  type DocHeading,
} from "@/lib/methodology-doc";
import { CONTACT_ADDRESS, REPO_URL, SITE_NAME, SUBMIT_SITE_URL, repoFileUrl } from "@/lib/site-config";
import { formatR } from "@/lib/stats";

// The methodology hub (design S2-4 section 7): a short authored page that links into the
// append-only record and quotes it, and never paraphrases it, since a paraphrase of a
// pre-registration is a second, unversioned one. Static: the record is read here at build time
// and every figure is the edition snapshot's.

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: `Methodology · ${SITE_NAME}`,
  description:
    "One frozen agent, one fixed task shape, answers registered before any run: where the protocol, the scoring contract, the freeze and the instrument control are registered.",
};

const METHODOLOGY = "docs/METHODOLOGY.md";
const DOCS = [
  { path: METHODOLOGY, what: "the pre-registration record: task, protocol, scoring contract, and every dated amendment" },
  { path: "docs/EXHIBIT.md", what: "the Goodhart exhibit's own registration" },
  { path: "docs/COHORT.md", what: "the cohort, one section per site" },
  { path: "docs/ARCHITECTURE.md", what: "the system: lanes, data contract, where each number is computed" },
];

function readDoc(path: string): string {
  try {
    return readFileSync(join(process.cwd(), path), "utf8");
  } catch {
    return "";
  }
}

function DocLink({ heading, children }: { heading: DocHeading | null; children: React.ReactNode }) {
  const href = heading ? `${repoFileUrl(METHODOLOGY)}#${heading.slug}` : repoFileUrl(METHODOLOGY);
  return (
    <a href={href} className="link-ink">
      {children}
    </a>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <>
      {inlineSegments(text).map((seg, i) =>
        seg.code ? (
          <code key={i} className="font-mono text-[0.9em]">
            {seg.text}
          </code>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

function siteName(siteId: string): string {
  return EDITION.sites.find((s) => s.site_id === siteId)?.name ?? siteId;
}

export default function MethodologyPage() {
  const record = readDoc(METHODOLOGY);
  const headings = headingIndex(record);
  const find = (pattern: RegExp) => findHeading(headings, pattern);

  const rateHeading = find(/what the behavioral rate measures/i);
  const rateParagraph = paragraphUnder(record, /what the behavioral rate measures/i);
  const instrumentHeading = find(/instrument control|instrument-v1/i);
  const freezeHeading = find(/freeze/i);
  const exclusionHeading = find(/exclusion rule/i);
  const staticHeading = find(/static axis/i);
  const amendmentsStart = headings.findIndex((h) => /^amendments/i.test(h.text));
  const amendments = amendmentsStart === -1 ? [] : headings.slice(amendmentsStart + 1).filter((h) => h.level <= 3);

  const registered = EDITION.pending.find((p) => p.registered_on)?.registered_on ?? null;
  const sens = EDITION.stats.sensitivity;
  const published = Object.values(EDITION.stats.rho)[0];
  const decomposition = EDITION.stats.layout_shift;
  const remeasurement = EDITION.remeasurement;
  const auditCounts = remeasurement
    ? [
        ...new Map(
          remeasurement.batches
            .filter((b) => b.form_factor === "mobile" && b.lighthouse_version)
            .map((b) => [b.lighthouse_version!, b.audit_ids.length])
        ).entries(),
      ]
    : [];
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

  return (
    <div>
      <header className="mb-10">
        <h1 className="page-title">Methodology</h1>
        <p className="page-lead max-w-3xl">
          One frozen agent, one fixed task shape, {EDITION.sites.length} sites, answers registered
          before any run. Anyone can group a benchmark&apos;s results by URL; only a benchmark with
          one task shape can interpret the result.
        </p>
        <p className="card-note max-w-3xl">
          This page links into the record and quotes it. It does not restate it: the record is
          append-only, and a paraphrase would be a second, unversioned copy.
        </p>
      </header>

      <section className="border-t border-line pt-8">
        <h2 className="section-title">The record</h2>
        <ul className="mt-4 max-w-3xl space-y-2 text-sm leading-relaxed text-ink-body">
          {DOCS.map((doc) => (
            <li key={doc.path}>
              <a href={repoFileUrl(doc.path)} className="link-ink font-mono text-ink">
                {doc.path}
              </a>{" "}
              · {doc.what}
            </li>
          ))}
        </ul>
      </section>

      <section id="rate" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">What the rate measures</h2>
        {rateParagraph ? (
          <blockquote className="mt-4 max-w-3xl border-l-2 border-line pl-4 font-serif text-[1.0625rem] leading-relaxed text-ink">
            <Quote text={leadingSentences(rateParagraph, 2)} />
          </blockquote>
        ) : null}
        <p className="card-note max-w-3xl">
          <DocLink heading={rateHeading}>
            Registered{rateHeading?.date ? <> on {formatDate(rateHeading.date)}</> : null} in {METHODOLOGY}
          </DocLink>
          . The frozen loop&apos;s own constants, read from{" "}
          <code className="font-mono">{EDITION.protocol.source}</code>:{" "}
          <code className="font-mono">MAX_STEPS = {EDITION.protocol.max_steps}</code>,{" "}
          <code className="font-mono">TIMEOUT_SECONDS = {EDITION.protocol.clock_seconds}</code>;{" "}
          {EDITION.protocol.trials_per_site} trials per site per agent in batch{" "}
          <code className="font-mono">{EDITION.batch_label}</code>.
        </p>
      </section>

      <section id="protocol" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">The task, the trials and the scoring contract</h2>
        <ul className="mt-4 max-w-3xl space-y-1.5 text-sm text-ink-body">
          {[
            { pattern: /^the fixed task/i, label: "The fixed task" },
            { pattern: /^trial protocol/i, label: "Trial protocol" },
            { pattern: /^the scoring contract/i, label: "The scoring contract" },
            { pattern: /^cohort design/i, label: "Cohort design" },
          ].map(({ pattern, label }) => (
            <li key={label}>
              <DocLink heading={find(pattern)}>{label}</DocLink>
            </li>
          ))}
          <li>
            <DocLink heading={freezeHeading}>What the freeze covers</DocLink>
            {freezeHeading?.date && <span className="text-ink-muted"> · registered {formatDate(freezeHeading.date)}</span>}
          </li>
        </ul>
      </section>

      <section id="instrument-v1" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">
          The instrument control, <code className="font-mono text-[0.85em]">instrument-v1</code>
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          <span className="font-semibold text-ink">
            {registered ? <>Registered on {formatDate(registered)}; </> : <>Registration pending; </>}
            not yet run; no result exists.
          </span>{" "}
          <DocLink heading={instrumentHeading}>The registration</DocLink> names the gates a harness
          build must pass before a paid batch, and the rule by which its first complete run may name
          a site&apos;s trials as the harness&apos;s failure rather than the site&apos;s.
        </p>
        {EDITION.pending.map((p) => (
          <div key={p.site_id} className="card-notice mt-5 max-w-3xl">
            <p className="text-sm font-semibold text-notice-ink">
              Pending the instrument control: {siteName(p.site_id)}.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-notice-body">
              {p.timeouts === p.recorded ? "Every" : `${p.timeouts} of ${p.recorded}`} recorded trial
              {p.timeouts === p.recorded ? "" : "s"} on this site ({p.recorded} across both agents)
              ended at the {EDITION.protocol.clock_seconds}-second clock. A click on a matched,
              visible link that never lands is a suspected harness cause, which the instrument
              control{p.registered_on && <> registered on {formatDate(p.registered_on)}</>} tests; it
              has not run. Until it does, the rate stands as measured and no sensitivity excludes
              this site.{" "}
              <Link href={`/site/${p.site_id}`} className="underline underline-offset-2">
                The site page
              </Link>
              .
            </p>
          </div>
        ))}
      </section>

      <section id="sensitivity" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">The registered sensitivity</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          The published correlation keeps batch {EDITION.batch_label}&apos;s pre-registered
          denominator{published && <>, n = {published.n}</>}. One{" "}
          <DocLink heading={exclusionHeading}>registered rule</DocLink> removes harness-artifact
          sites for a sensitivity printed beside it, never in its place: (b) every recorded trial
          the harness&apos;s own error, which names{" "}
          {sens.excluded.map(siteName).join(", ") || "no site"} from the batch&apos;s own record;
          and (d) sites the first complete <code className="font-mono">instrument-v1</code> names,
          pending until it runs.
        </p>
        <div className="mt-4 max-w-3xl overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="col-head py-2 pr-4">Agent</th>
                <th scope="col" className="col-head py-2 pr-4 text-right">Published</th>
                <th scope="col" className="col-head py-2 pr-4 text-right">Rule (b)</th>
                <th scope="col" className="col-head py-2">Rule (d)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(sens.by_agent).map(([agentId, s]) => {
                const rho = EDITION.stats.rho[agentId];
                return (
                  <tr key={agentId} className="border-b border-line-soft last:border-0">
                    <td className="py-2 pr-4 text-ink">{agentLabel(agentId)}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-ink-body">
                      ρ = {formatR(rho.point)}, n = {rho.n}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-ink-body">
                      ρ = {formatR(s.point)}, n = {s.n}
                    </td>
                    <td className="py-2 text-xs text-ink-muted">pending, not run</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="card-note max-w-3xl">
          Spearman ρ at the precision the correlation page prints. Each figure is pinned in{" "}
          <code className="font-mono">scripts/tests/stats-vectors.json</code> (
          {Object.values(sens.by_agent)
            .map((s) => s.vector)
            .join(", ")}
          ) and computed in both <code className="font-mono">lib/study.ts</code> and{" "}
          <code className="font-mono">scripts/stats_reference.py</code>. The verdict is the same
          under every rule.
        </p>
      </section>

      <section id="static-axis" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">The static axis</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          The x-axis is the Lighthouse Agentic Browsing category mean, which Chrome computes and
          does not display;{" "}
          <Link href="/#fraction-not-score" className="link-ink">
            the leaderboard footer
          </Link>{" "}
          says what it is, once. Batch {EDITION.batch_label} ran Lighthouse{" "}
          {EDITION.lane1.lighthouse_version ?? "(version not recorded)"} ({EDITION.lane1.version_source}).{" "}
          {EDITION.lane1.form_factor === "mobile" && (
            <>Its layout-shift audit was measured on an emulated phone ({EDITION.lane1.form_factor_source}).</>
          )}
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          {decomposition.identical_input.count} of the {EDITION.sites.length} sites are identical on
          every agent-specific input the category records and span {decomposition.identical_input.min}{" "}
          to {decomposition.identical_input.max} on the category mean; the mean&apos;s rank order
          follows layout shift (ρ {signed(decomposition.rho.median)}, {signed(decomposition.rho.min)}{" "}
          to {signed(decomposition.rho.max)} over the {decomposition.assignments} assignments the v1
          rows leave open, n = {decomposition.rho.n}).
        </p>
        {remeasurement && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
            Re-measured on {formatDate(remeasurement.date)} with every report retained, in{" "}
            {remeasurement.batches.length} dated batches:{" "}
            {remeasurement.batches
              .map((b) => `${b.label} (${b.lighthouse_version ?? "?"}, ${b.form_factor ?? "?"})`)
              .join("; ")}
            .{" "}
            {auditCounts.length > 0 && (
              <>
                The category has{" "}
                {auditCounts.map(([version, count]) => `${count} audits at ${version}`).join(", ")}.
              </>
            )}{" "}
            <Link href="/data" className="link-ink">
              The files
            </Link>
            .
          </p>
        )}
        <p className="card-note max-w-3xl">
          <DocLink heading={staticHeading}>
            The static axis, registered{staticHeading?.date ? <> on {formatDate(staticHeading.date)}</> : null}
          </DocLink>
          . Decomposition pinned in <code className="font-mono">{decomposition.vector}</code>,
          computed in <code className="font-mono">lib/x-axis.ts</code> and{" "}
          <code className="font-mono">scripts/stats_reference.py</code>.
        </p>
      </section>

      {amendments.length > 0 && (
        <section id="amendments" className="mt-12 scroll-mt-6 border-t border-line pt-8">
          <h2 className="section-title">The record, as amended</h2>
          <p className="card-note mb-4 max-w-3xl">
            Every dated block appended to {METHODOLOGY}, in the order it was appended. Nothing above
            them is edited; each says the day it was registered.
          </p>
          <ul className="max-w-3xl space-y-1.5 text-sm text-ink-body">
            {amendments.map((h) => (
              <li key={h.slug} className={h.level > 3 ? "pl-4" : ""}>
                <DocLink heading={h}>
                  <Quote text={h.text} />
                </DocLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="contact" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">Contact</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          {CONTACT_ADDRESS ? (
            <>
              Write to <span className="font-mono text-ink">{CONTACT_ADDRESS}</span>{" "}
              <a href={`mailto:${CONTACT_ADDRESS}`} className="link-ink">
                (email)
              </a>
              , or open an issue in the{" "}
            </>
          ) : (
            <>Questions and corrections go to the </>
          )}
          <a href={`${REPO_URL}/issues`} className="link-ink">
            repository&apos;s issue tracker
          </a>
          . To propose a site,{" "}
          <a href={SUBMIT_SITE_URL} className="link-ink">
            submit it through the issue form
          </a>
          ; a submission is answered and counted, and adding it to the cohort would be a cohort
          change, which is out of scope for this edition.
        </p>
      </section>
    </div>
  );
}
