"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/SiteLink";
import Logo from "@/components/Logo";

/**
 * The 404 itself, without the chrome — so the three places that need a 404 can each supply the
 * chrome that belongs to them.
 *
 * ── WHY THERE ARE THREE ─────────────────────────────────────────────────────────────────────────
 *
 * `[locale]/not-found.tsx` sits ABOVE both route groups, so it rendered with neither shell: no
 * header, no footer, no navigation. The page was designed — 404, a heading, two buttons — and then
 * dropped a visitor into a room with no doors, on a site whose whole footer exists to point at the
 * other one.
 *
 * A copy inside each group fixes the common case (`notFound()` called by a real page, which is how
 * `/guides/nope` gets here) by inheriting that group's layout. The top-level file still has to exist
 * for URLs that match no route at all, and no layout applies there — so it carries the wordmark
 * itself, via `standalone`.
 */
export default function NotFoundBody({ standalone = false }: { standalone?: boolean }) {
  const t = useTranslations("notFound");
  return (
    <main className={`page-read flex flex-col items-center text-center ${standalone ? "py-16" : "py-24"}`}>
      {standalone && (
        <Link href="/convert" className="mb-12 inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
          <Logo size={26} />
          <span dir="ltr">
            Bed<span className="brand-text">Ready</span>
          </span>
        </Link>
      )}
      <p className="text-6xl font-bold text-violet-400">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-2 max-w-sm text-fg-muted">{t("body")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/convert" className="btn-primary btn-md">
          {t("convert")}
        </Link>
        <Link href="/verified" className="btn-secondary btn-md">
          {t("makerrun")}
          <span aria-hidden className="text-[0.85em] text-fg-subtle">↗</span>
        </Link>
      </div>
      {standalone && (
        <p className="mt-10 text-xs text-fg-subtle">{t("standaloneNote")}</p>
      )}
    </main>
  );
}
