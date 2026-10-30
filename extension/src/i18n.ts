// The extension's words, in the browser's language — the same seven bedready.io speaks.
//
// ── ONE SOURCE, NOT A SECOND COPY ────────────────────────────────────────────────────────────────
// Until 0.6.0 every string was English in the code, on a product whose site renders seven locales.
// The text now lives in the site's own `messages/<locale>.json` under `ext`, so the site's
// i18n-parity test holds the extension to the same rule as every page: a key missing from one
// locale fails CI by name. Converter advisories reuse the site's `convert.warn*` sentences rather
// than `warningTextEn`, so a warning reads the same in the extension and on /convert.
//
// The JSON imports below are cut down at build time (extension/messages-plugin.mjs) to `ext` and
// those warnings — whole files would put ~650 KB of website copy into each of three bundles.
//
// The language is the BROWSER's (i18n.getUILanguage), not the page's: the toast and the in-page
// button appear on MakerWorld, whose language says nothing about the reader's.
import { IntlMessageFormat } from "intl-messageformat";
import type { ConvertWarning } from "../../src/lib/convert";
import { warningTextEn } from "../../src/lib/convert";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import de from "../../messages/de.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import zh from "../../messages/zh.json";

declare const browser: any;
declare const chrome: any;
const api: any = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : undefined;

type Bundle = { ext: Record<string, string>; convert?: Record<string, string> };
const BUNDLES: Record<string, Bundle> = { en, ar, de, es, fr, ja, zh } as unknown as Record<string, Bundle>;
export type Locale = "en" | "ar" | "de" | "es" | "fr" | "ja" | "zh";

/** "zh-TW" → zh, "pt-BR" → en: the first subtag, if we speak it. */
export function pickLocale(tag: string | undefined): Locale {
  const base = (tag || "").toLowerCase().split(/[-_]/)[0];
  return (base in BUNDLES ? base : "en") as Locale;
}

function uiLanguage(): string | undefined {
  try {
    return api?.i18n?.getUILanguage?.() || (typeof navigator !== "undefined" ? navigator.language : undefined);
  } catch {
    return typeof navigator !== "undefined" ? navigator.language : undefined;
  }
}

export const locale: Locale = pickLocale(uiLanguage());
export const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";

const cache = new Map<string, IntlMessageFormat>();
function format(loc: Locale, src: string, values?: Record<string, string | number>): string {
  const id = loc + "\u0000" + src;
  let f = cache.get(id);
  if (!f) cache.set(id, (f = new IntlMessageFormat(src, loc)));
  return String(f.format(values));
}

/** An `ext.*` string, in the browser's language, falling back to English and then to the key. */
export function t(key: string, values?: Record<string, string | number>, loc: Locale = locale): string {
  const src = BUNDLES[loc]?.ext?.[key] ?? BUNDLES.en.ext[key];
  if (src == null) return key;
  try {
    return format(loc, src, values);
  } catch {
    return src; // a malformed translation shows its raw text rather than nothing
  }
}

/** A converter advisory, worded as /convert words it in this language. */
export function warningText(w: ConvertWarning, loc: Locale = locale): string {
  const src = BUNDLES[loc]?.convert?.[w.key];
  if (src == null) return warningTextEn(w);
  try {
    return format(loc, src, w.params);
  } catch {
    return warningTextEn(w);
  }
}

/** Fill every `[data-i18n]` element's text, and set the document's language and direction. */
export function localizeDocument(doc: Document = document): void {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = dir;
  doc.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    // Only the element's own text node, so a <select> or <input> inside a <label> survives.
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    const text = t(el.dataset.i18n!);
    if (node) node.textContent = text + " ";
    else el.prepend(text);
  });
}
