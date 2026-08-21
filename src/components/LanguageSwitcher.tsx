"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, localeNames } from "@/i18n/routing";

// Switches locale while staying on the current page (next-intl's usePathname is locale-agnostic and
// router.replace re-applies the chosen prefix). Also persists the choice via the NEXT_LOCALE cookie.
export default function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("lang");

  return (
    <select
      value={locale}
      aria-label={t("label")}
      onChange={(e) => router.replace(pathname, { locale: e.target.value })}
      className="cursor-pointer rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
    >
      {routing.locales.map((l) => (
        <option key={l} value={l} className="bg-surface">
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}
