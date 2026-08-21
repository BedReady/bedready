"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <p className="text-6xl font-bold text-violet-400">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("body")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/convert" className="btn-primary btn-md">
          {t("convert")}
        </Link>
        <Link href="/" className="rounded-md border border-line bg-surface-2 px-5 py-2.5 font-semibold text-fg transition hover:bg-surface-3">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
