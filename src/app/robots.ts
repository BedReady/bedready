import type { MetadataRoute } from "next";
import { LIBRARY_ORIGIN } from "@/lib/origin";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep auth + personal flows out of the index. Cover the localized (prefixed) paths too, since
      // non-en locales serve at /<locale>/… — a bare "/admin" wouldn't block "/de/admin".
      disallow: [
        "/login", "/admin", "/auth/", "/upload", "/account", "/saves", "/following", "/notifications",
        "/*/login", "/*/admin", "/*/auth/", "/*/upload", "/*/account", "/*/saves", "/*/following", "/*/notifications",
      ],
    },
    sitemap: `${LIBRARY_ORIGIN}/sitemap.xml`,
    host: LIBRARY_ORIGIN,
  };
}
