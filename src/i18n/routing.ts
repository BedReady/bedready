import { defineRouting } from "next-intl/routing";

// Supported locales. English is the default and is served WITHOUT a prefix ("as-needed");
// the rest are prefixed (/de, /es, /fr, /zh, /ja, /ar). zh = Chinese (Simplified), ar = Arabic (RTL).
export const routing = defineRouting({
  locales: ["en", "de", "es", "fr", "zh", "ja", "ar"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

// Human-readable names for the language switcher (in their own language).
export const localeNames: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  zh: "中文",
  ja: "日本語",
  ar: "العربية",
};

// Right-to-left locales → drive the <html dir> attribute.
export const rtlLocales = new Set(["ar"]);
export const dirOf = (locale: string) => (rtlLocales.has(locale) ? "rtl" : "ltr");
