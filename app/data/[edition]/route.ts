import { EDITION } from "@/lib/edition-data";

// /data/v1.json: the edition snapshot, served as committed. Static by construction, so it
// cannot read the database; a copy under public/ would put the same bytes in git twice and let
// them drift (design S2-4 section 7). Shape: `schema_version` 1, additive changes only.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ edition: `${EDITION.batch_label}.json` }];
}

export function GET() {
  return new Response(JSON.stringify(EDITION, null, 2) + "\n", {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
