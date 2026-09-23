import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-config";

// Everything is public and meant to be found. No llms.txt is shipped beside this: v1 found that
// signal's effect indistinguishable from noise, and publishing one as a gesture would endorse
// what this site's own data declines to (design S2-4 section 7).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
