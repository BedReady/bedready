import { getTranslations } from "next-intl/server";
import { ldJson } from "@/lib/json-ld";
import { alternates } from "@/lib/seo";
import { SAFARI_LIVE } from "@/lib/extension-stores";

/**
 * schema.org markup for one of the site's tools, in the page's language: its name and description
 * are the page's own translated meta title and description, its URL the locale's canonical. /convert
 * carried a WebApplication block; the other tools and the browser extension carried none.
 *
 * No rating, review or download count: none exists that could be stated truthfully, and Google
 * treats invented ones as spam. HowTo is not used either; Google stopped showing it in 2023.
 *
 * Not in json-ld.ts on purpose: that file is shared with makerrun and drift-checked.
 */
export default async function AppJsonLd({
  locale,
  namespace,
  path,
  kind = "web",
  values,
}: {
  locale: string;
  namespace: string;
  path: string;
  kind?: "web" | "extension";
  /** ICU arguments the namespace's metaDescription takes (the extension's takes `safari`). */
  values?: Record<string, string>;
}) {
  const t = await getTranslations({ locale, namespace });
  const common = {
    "@context": "https://schema.org",
    // The meta title's " — BedReady" suffix is for the browser tab, not the application's name.
    name: t("metaTitle").replace(/\s+—\s+BedReady$/, ""),
    description: t("metaDescription", values),
    url: alternates(path, locale).canonical,
    inLanguage: locale,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "BedReady", url: alternates("/", "en").canonical },
  };
  const data =
    kind === "extension"
      ? {
          ...common,
          "@type": "SoftwareApplication",
          applicationCategory: "BrowserApplication",
          operatingSystem: SAFARI_LIVE ? "Chrome, Edge, Firefox, Safari" : "Chrome, Edge, Firefox",
        }
      : {
          ...common,
          "@type": "WebApplication",
          applicationCategory: "UtilitiesApplication",
          operatingSystem: "Web browser",
          browserRequirements: "Requires JavaScript",
        };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}
