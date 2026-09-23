// Where this site lives and who answers for it. One module, because these strings end up in
// the chrome, the citation block, the JSON-LD, the sitemap and the robots file, and a second
// copy of any of them is a second place for it to be wrong.
//
// No domain was bought (plan decision D5), so the Vercel URL is canonical everywhere.

export const SITE_URL = "https://agent-score-weld.vercel.app";
export const SITE_NAME = "AgentRank";
export const REPO_URL = "https://github.com/Jamesoc710/Agent-score";

/**
 * The contact address the footer and /methodology print, and that the kill review counts
 * inbound mail at. James's choice (design S2-4 section 12 q7), so it stays null until he makes
 * it. While null nothing renders a contact line, and `PRE_MERGE=1 npm run test:unit` fails.
 */
export const CONTACT_ADDRESS: string | null = null;

/**
 * The release tag the dataset's DOI is minted from (`dataset-v1`, cut the day after the
 * corrections PR merges). Null until the tag exists: a citation naming a tag that 404s is an
 * identifier asserted before it exists, the same error as a false measurement. Artifact links
 * point at `main` until then.
 */
export const RELEASE_TAG: string | null = null;

/**
 * The dataset's reuse licence (data/LICENSE.md): CC BY 4.0 for the measurements AgentRank
 * produces. Third-party content captured inside raw reports (a site's own screenshots and
 * page text) is not ours to license and stays with its owners. The code is MIT (LICENSE).
 */
export const LICENCE: { name: string; url: string } | null = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};

/** The creator the citation block and the JSON-LD name, as the repository's commits do. */
export const CREATOR = {
  name: "James O'Connor",
  citationName: "O'Connor, James",
  url: "https://github.com/Jamesoc710",
};

/**
 * The GitHub Issue Form for submitting a site (.github/ISSUE_TEMPLATE/submit-site.yml, design
 * S2-6 section 10). A prefilled link, so there is no route handler and no server-side write.
 */
export const SUBMIT_SITE_URL = `${REPO_URL}/issues/new?template=submit-site.yml&title=Site+submission%3A+`;

/** A file in the repository at the release tag once it exists, else on `main`. */
export function repoFileUrl(path: string): string {
  return `${REPO_URL}/blob/${RELEASE_TAG ?? "main"}/${path}`;
}

/** A directory in the repository, same ref rule as repoFileUrl. */
export function repoTreeUrl(path: string): string {
  return `${REPO_URL}/tree/${RELEASE_TAG ?? "main"}/${path}`;
}
