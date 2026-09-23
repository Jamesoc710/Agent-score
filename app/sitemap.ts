import type { MetadataRoute } from "next";
import { EDITION } from "@/lib/edition-data";
import { FINDING_IDS } from "@/lib/findings";
import { SITE_URL } from "@/lib/site-config";

// Built from the edition snapshot, never from a database read: a sitemap that fails when the
// database pauses is worse than none (design S2-4 section 7). The site pages are the deepest,
// most citable content, and before this they were reachable only by parsing the table.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "/",
    ...FINDING_IDS.map((id) => `/finding/${id}`),
    "/correlation",
    "/correlation/audits",
    "/correlation/exhibit",
    "/methodology",
    "/data",
    `/data/${EDITION.batch_label}.json`,
    ...EDITION.sites.map((s) => `/site/${s.site_id}`),
  ];
  return routes.map((route) => ({ url: `${SITE_URL}${route === "/" ? "" : route}` }));
}
