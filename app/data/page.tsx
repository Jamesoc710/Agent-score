import type { Metadata } from "next";
import Link from "next/link";
import { agentLabel } from "@/lib/dataset";
import { EDITION } from "@/lib/edition-data";
import { formatRunWindow } from "@/lib/format";
import {
  CONTACT_ADDRESS,
  CREATOR,
  LICENCE,
  RELEASE_TAG,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
  repoFileUrl,
  repoTreeUrl,
} from "@/lib/site-config";

// The artifacts, the endpoint, the licence, a datasheet and the citation block (design S2-4
// section 7). Every figure is the edition snapshot's; nothing here reads the database.

export const metadata: Metadata = {
  title: `Data · ${SITE_NAME}`,
  description: `The ${EDITION.edition.title} dataset: the edition snapshot at /data/${EDITION.batch_label}.json, every artifact behind it, a datasheet and a citation.`,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-4">
      <p className="eyebrow mb-1.5">{label}</p>
      <pre className="code-well select-all text-xs">{text}</pre>
    </div>
  );
}

export default function DataPage() {
  const endpoint = `/data/${EDITION.batch_label}.json`;
  const measured = formatRunWindow(EDITION.run_window);
  const year = EDITION.run_window?.first.slice(0, 4) ?? "";
  const recorded = EDITION.sites.reduce(
    (n, s) => n + Object.values(s.results).reduce((m, r) => m + r.outcomes.length, 0),
    0
  );
  const measuredTrials = EDITION.agents.reduce((n, a) => n + a.trials, 0);
  const title = `${SITE_NAME}: ${EDITION.edition.title}`;
  const doi = EDITION.edition.doi;
  const ref = RELEASE_TAG ?? "main";
  const lane1Date = formatRunWindow(EDITION.lane1.run_window);
  const sameDay =
    !!EDITION.lane1.run_window &&
    !!EDITION.run_window &&
    EDITION.lane1.run_window.first.slice(0, 10) === EDITION.run_window.first.slice(0, 10);

  const plain = [
    `${CREATOR.citationName}. ${title} (batch ${EDITION.batch_label}${measured ? `, measured ${measured}` : ""}) [dataset].`,
    `${SITE_URL}/data.`,
    `Source: ${REPO_URL}${RELEASE_TAG ? `, release ${RELEASE_TAG}` : ""}.`,
    doi ? `https://doi.org/${doi}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const bibtex = [
    `@misc{agentrank_${EDITION.batch_label},`,
    `  author       = {${CREATOR.citationName}},`,
    `  title        = {{${SITE_NAME}}: ${EDITION.edition.title}},`,
    `  year         = {${year}},`,
    `  howpublished = {\\url{${SITE_URL}/data}},`,
    `  note         = {Dataset, batch ${EDITION.batch_label}${measured ? `, measured ${measured}` : ""}. Source: \\url{${REPO_URL}}${RELEASE_TAG ? `, release ${RELEASE_TAG}` : ""}},`,
    ...(doi ? [`  doi          = {${doi}},`] : []),
    `}`,
  ].join("\n");

  return (
    <div>
      <header className="mb-10">
        <h1 className="page-title">Data</h1>
        <p className="page-lead max-w-3xl">
          Everything {EDITION.edition.title} prints, as files. One of them, the edition snapshot,
          is what every shared surface of this site reads; the rest are the records it is folded
          from.
        </p>
      </header>

      <section className="border-t border-line pt-8">
        <h2 className="section-title">The endpoint</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          <a href={endpoint} className="link-ink font-mono text-ink">
            {endpoint}
          </a>{" "}
          is the committed snapshot of batch <code className="font-mono">{EDITION.batch_label}</code>
          : every site&apos;s trial outcomes for both agents, its Lighthouse row and v1 audit
          flags, the registered exclusions and pending predictions, and each published statistic
          with the path of the vector block in{" "}
          <code className="font-mono">scripts/tests/stats-vectors.json</code> that pins it and the
          two implementations that compute it. It is served statically and never reads the
          database.
        </p>
        <p className="card-note max-w-3xl">
          Stability: <code className="font-mono">schema_version</code> {EDITION.schema_version}.
          Additive changes only within a schema version; a breaking change gets a new one.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="section-title">Artifacts</h2>
        <p className="card-note mb-5 max-w-3xl">
          At <code className="font-mono">{ref}</code> in the{" "}
          <a href={REPO_URL} className="link-ink">
            repository
          </a>
          . Sizes and SHA-256 digests are the snapshot&apos;s, so a file that changes shows up as a
          stale snapshot and a failing test before it shows up here.
        </p>
        <div className="overflow-x-auto border-y border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left">
                <th scope="col" className="col-head px-4 py-2.5">File</th>
                <th scope="col" className="col-head px-4 py-2.5">What it is</th>
                <th scope="col" className="col-head px-4 py-2.5 text-right">Size</th>
                <th scope="col" className="col-head px-4 py-2.5">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {EDITION.artifacts.map((a) => (
                <tr key={a.path} className="border-b border-line-soft align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <a
                      href={a.sha256 === null ? repoTreeUrl(a.path.replace(/\/$/, "")) : repoFileUrl(a.path)}
                      className="link-ink break-all font-mono text-xs text-ink"
                    >
                      {a.path}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-xs leading-relaxed text-ink-body">
                    {a.role}
                    {a.files !== undefined && <> ({a.files} files)</>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums text-ink-body">
                    {formatBytes(a.bytes)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-muted" title={a.sha256 ?? undefined}>
                    {a.sha256 ? a.sha256.slice(0, 12) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="licence" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">Licence</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
          {LICENCE ? (
            <>
              The dataset is published under{" "}
              <a href={LICENCE.url} className="link-ink">
                {LICENCE.name}
              </a>
              : the measurements, the transcripts&apos; recorded fields, the statistics and their
              vectors. Third-party content captured inside the raw Lighthouse reports and
              transcripts, such as a site&apos;s own screenshots and page text, is not covered and
              remains its owners&apos;. The code is MIT-licensed.
            </>
          ) : (
            <>
              No licence has been declared for this dataset yet. The repository will carry one when
              it is chosen, and this section will name it; until then this page states none rather
              than assume one.
            </>
          )}
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="section-title">Datasheet</h2>
        <dl className="mt-4 grid max-w-4xl gap-x-6 gap-y-4 text-sm leading-relaxed sm:grid-cols-[11rem,1fr]">
          <dt className="font-medium text-ink">Motivation</dt>
          <dd className="text-ink-body">
            To check agent-readiness rubrics against a behavioral rate with its denominator: a
            named, frozen agent, one fixed task shape, answers registered before any run.
          </dd>
          <dt className="font-medium text-ink">Composition</dt>
          <dd className="text-ink-body">
            {EDITION.sites.length} websites (
            <a href={repoFileUrl("data/cohort.csv")} className="link-ink font-mono text-xs">
              data/cohort.csv
            </a>
            , answer key <code className="font-mono text-xs">{EDITION.answer_key_tag ?? "untagged"}</code>
            ), {EDITION.agents.length} agents ({EDITION.agents.map((a) => a.label).join(", ")}),{" "}
            {recorded} recorded trials of which {measuredTrials} were measured; a trial that never
            reached its site is recorded and left out of the denominator. One Lighthouse row per
            site
            {sameDay && <> from the same day</>}
            {lane1Date && <> ({lane1Date})</>}
            {EDITION.remeasurement && <>, plus the dated re-measurement listed above</>}.
          </dd>
          <dt className="font-medium text-ink">Collection</dt>
          <dd className="text-ink-body">
            Batch <code className="font-mono text-xs">{EDITION.batch_label}</code>
            {measured && <>, {measured}</>}: {EDITION.protocol.trials_per_site} trials per site per
            agent, at most {EDITION.protocol.max_steps} steps and a {EDITION.protocol.clock_seconds}
            -second clock per trial, read from{" "}
            <code className="font-mono text-xs">{EDITION.protocol.source}</code>. The protocol,
            identity and vantage are registered in{" "}
            <a href={repoFileUrl("docs/METHODOLOGY.md")} className="link-ink">
              docs/METHODOLOGY.md
            </a>
            .
          </dd>
          <dt className="font-medium text-ink">Processing</dt>
          <dd className="text-ink-body">
            None after the run: scoring is the registered match rules applied by the harness, and
            every statistic is computed twice, in TypeScript and Python, and pinned by the vector
            file.
          </dd>
          <dt className="font-medium text-ink">Uses</dt>
          <dd className="text-ink-body">
            Supported: what this agent reached within its budget on these sites on this date, and
            whether a static rubric tracked it. Not supported: a ranking of sites, a verdict on any
            site, or a claim about agents in general.
          </dd>
          <dt className="font-medium text-ink">Maintenance</dt>
          <dd className="text-ink-body">
            Versioned by batch; nothing is edited in place, and corrections are dated amendments.
            Report a problem through the{" "}
            <a href={`${REPO_URL}/issues`} className="link-ink">
              issue tracker
            </a>
            {CONTACT_ADDRESS && <> or at {CONTACT_ADDRESS}</>}.
          </dd>
        </dl>
        <p className="card-note max-w-3xl">
          Agents: {EDITION.agents.map((a) => `${agentLabel(a.id)} (${a.id})`).join(", ")}.
        </p>
      </section>

      <section id="cite" className="mt-12 scroll-mt-6 border-t border-line pt-8">
        <h2 className="section-title">Cite this edition</h2>
        <CopyBlock label="Plain text" text={plain} />
        <CopyBlock label="BibTeX" text={bibtex} />
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-ink-body">
          Reusing a figure: carry its denominator (sites, trials) and its measurement date with it,
          as this site prints them, and the batch label{" "}
          <code className="font-mono">{EDITION.batch_label}</code>. Each statistic in the snapshot
          names the vector block that pins it. A single finding has a stable address of its own,
          for example{" "}
          <Link href="/finding/goodhart" className="link-ink">
            /finding/goodhart
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
