import { EDITION } from "@/lib/edition-data";
import { CREATOR, LICENCE, REPO_URL, SITE_NAME, SITE_URL, repoFileUrl } from "@/lib/site-config";

// One schema.org/Dataset block for the front page, built from the edition snapshot only
// (design S2-4 section 7). Nothing in it is a number the page does not print; `identifier`
// appears only once a DOI exists and `license` only once one is declared.

export function datasetJsonLd() {
  const title = `${SITE_NAME}: ${EDITION.edition.title}`;
  const runWindow = EDITION.run_window;
  const modified = [runWindow?.last, EDITION.remeasurement?.date].filter((d): d is string => !!d).sort().pop();

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title,
    description:
      "A behavioral agent-readiness measurement of real websites: a named, frozen browser agent runs one fixed task shape on every site, and success is scored against answers registered before any run. Published beside the Lighthouse Agentic Browsing category mean for the same sites.",
    url: SITE_URL,
    sameAs: REPO_URL,
    creator: { "@type": "Person", name: CREATOR.name, url: CREATOR.url },
    version: EDITION.batch_label,
    isAccessibleForFree: true,
    ...(runWindow && { temporalCoverage: `${runWindow.first}/${runWindow.last}` }),
    ...(modified && { dateModified: modified.slice(0, 10) }),
    ...(EDITION.edition.doi && { identifier: `https://doi.org/${EDITION.edition.doi}` }),
    ...(LICENCE && { license: LICENCE.url }),
    variableMeasured: [
      {
        "@type": "PropertyValue",
        name: "Behavioral success rate",
        description:
          "Per site and agent: successes over measured trials. A trial that never reached the site leaves the denominator; a site with no measured trial is not measured, never 0%.",
      },
      {
        "@type": "PropertyValue",
        name: "Lighthouse category mean",
        description:
          "Lighthouse's arithmetic mean over the Agentic Browsing category's applicable audits, 0 to 100, read from its JSON. Chrome displays the category as a fraction of checks passed, not as this mean.",
      },
    ],
    distribution: [
      {
        "@type": "DataDownload",
        name: `Edition snapshot, batch ${EDITION.batch_label}`,
        encodingFormat: "application/json",
        contentUrl: `${SITE_URL}/data/${EDITION.batch_label}.json`,
      },
      ...EDITION.artifacts
        .filter((a) => a.sha256 !== null && !a.path.includes("goodhart") && !a.path.includes("exhibit"))
        .map((a) => ({
          "@type": "DataDownload",
          name: a.path,
          description: a.role,
          contentUrl: repoFileUrl(a.path),
        })),
    ],
  };
}

export default function DatasetJsonLd() {
  // JSON.stringify escapes nothing HTML-significant by default; "<" is the one character that
  // could end the script element early, so it is escaped explicitly.
  const json = JSON.stringify(datasetJsonLd()).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
