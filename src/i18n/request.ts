import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Deep-merge locale messages over the English base so any key not yet translated falls back to
// English instead of showing the raw key. Objects merge recursively; arrays/strings are taken whole
// from the locale when present, else from English.
type Dict = Record<string, unknown>;
function deepMerge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (v && b && typeof v === "object" && typeof b === "object" && !Array.isArray(v) && !Array.isArray(b)) {
      out[k] = deepMerge(b as Dict, v as Dict);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const en = (await import("../../messages/en.json")).default as Dict;
  const messages =
    locale === routing.defaultLocale
      ? en
      : deepMerge(en, (await import(`../../messages/${locale}.json`)).default as Dict);
  return { locale, messages };
});
