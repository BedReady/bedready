import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SOURCE_REPO_URL, REDDIT_URL, SPONSOR_URL, KHAYT_URL } from "@/lib/links";

/**
 * The footer, shared by both shells.
 *
 * ── THE SISTER-SITE BAND IS THE POINT OF THIS FILE ──────────────────────────────────────────────
 *
 * Before it, "MakerRun" appeared in **no user-visible string anywhere on either site** — only in
 * code comments — while `middleware.ts` was already 301ing half the paths to `makerrun.com`. A
 * visitor could be moved between two domains without ever being told the second one had a name, or
 * that it was the same project. The column that pointed there was called "Library & app", which
 * names a category, not a destination.
 *
 * So the two products are introduced to each other here, in one sentence, above the link columns
 * rather than inside them: BedReady converts, MakerRun holds the files, same maker. That sentence is
 * the only thing on the page that explains why a link leaves the domain.
 *
 * ── AND THE SOURCE LINK IS EVIDENCE, NOT COMMUNITY ──────────────────────────────────────────────
 *
 * `SPLIT-DECISION-2026-08.md`: open source is *"the loudest available version"* of the no-upload
 * claim, *"because it is the only one a sceptic can verify"*. It sits with the privacy line rather
 * than beside Reddit and the sponsor link, because those are places to go and this is a thing to
 * check.
 *
 * ── WHAT WAS REMOVED ────────────────────────────────────────────────────────────────────────────
 *
 * `text-sky-300` on Khayt and `text-violet-300` on Sponsor: two arbitrary link colours among
 * eighteen neutral ones, carrying no meaning — not status, not priority, not destination type. And
 * the `♥` in front of "Sponsor", which arrived through a translation string, so the emoji was
 * effectively part of the word in all seven locales.
 */
export default function SiteFooter() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-line">
      <div className="shell py-10 text-sm text-fg-subtle">
        {/* The two sites, named and related, before any link that leaves this one. */}
        <div className="flex flex-col gap-3 border-b border-line pb-8 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
          <p className="max-w-md text-fg-muted">
            {t.rich("sisterIntro", {
              bedready: (c) => <span dir="ltr" className="font-semibold text-fg">{c}</span>,
              makerrun: (c) => <span dir="ltr" className="font-semibold text-fg">{c}</span>,
            })}
          </p>
          <Link
            href="/verified"
            className="btn-secondary btn-sm shrink-0 self-start whitespace-nowrap"
          >
            {t("sisterCta")}
            <span aria-hidden className="text-[0.85em] text-fg-subtle">↗</span>
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <p className="eyebrow">{t("groupTools")}</p>
            <ul className="mt-2 space-y-0.5">
              <li><Link href="/convert" className="block py-1 hover:text-fg">{t("converter")}</Link></li>
              <li><Link href="/orca-filaments" className="block py-1 hover:text-fg">{t("orcaFilaments")}</Link></li>
              <li><Link href="/mixer" className="block py-1 hover:text-fg">{t("mixer")}</Link></li>
              <li><Link href="/calibrate" className="block py-1 hover:text-fg">{t("calibrate")}</Link></li>
              <li><Link href="/stickers" className="block py-1 hover:text-fg">{t("stickers")}</Link></li>
            </ul>
          </div>
          <div>
            {/* Named for the site it goes to, not for the category of thing it holds. */}
            <p className="eyebrow" dir="ltr">{t("groupMakerRun")}</p>
            <ul className="mt-2 space-y-0.5">
              <li><Link href="/verified" className="block py-1 hover:text-fg">{t("verified")}</Link></li>
              <li><Link href="/designs" className="block py-1 hover:text-fg">{t("library")}</Link></li>
              <li><Link href="/app" className="block py-1 hover:text-fg">{t("desktopApp")}</Link></li>
              <li><Link href="/extension" className="block py-1 hover:text-fg">{t("extension")}</Link></li>
              <li><Link href="/features" className="block py-1 hover:text-fg">{t("features")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t("groupResources")}</p>
            <ul className="mt-2 space-y-0.5">
              <li><Link href="/guides" className="block py-1 hover:text-fg">{t("guides")}</Link></li>
              <li><Link href="/compare-u1-converters" className="block py-1 hover:text-fg">{t("compareConverters")}</Link></li>
              <li><Link href="/changelog" className="block py-1 hover:text-fg">{t("changelog")}</Link></li>
              <li><Link href="/help" className="block py-1 hover:text-fg">{t("help")}</Link></li>
              <li><Link href="/feedback" className="block py-1 hover:text-fg">{t("feedback")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t("groupCommunity")}</p>
            <ul className="mt-2 space-y-0.5">
              <li>
                <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 py-1 hover:text-fg">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" className="shrink-0">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                  {t("source")}
                </a>
              </li>
              <li>
                <a href={REDDIT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 py-1 hover:text-fg">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="#FF4500" aria-hidden="true" className="shrink-0">
                    <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                  </svg>
                  Reddit
                </a>
              </li>
              <li><a href={KHAYT_URL} target="_blank" rel="noopener noreferrer" className="block py-1 hover:text-fg">{t("khayt")}</a></li>
              <li><a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className="block py-1 hover:text-fg">{t("sponsor")}</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2 border-t border-line pt-6 text-center">
          <p><span dir="ltr">Bed<span className="brand-text">Ready</span></span> — {t("tagline")}</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
            <Link href="/licenses" className="py-1 hover:text-fg">{t("licenses")}</Link>
            <Link href="/terms" className="py-1 hover:text-fg">{t("terms")}</Link>
            <Link href="/privacy" className="py-1 hover:text-fg">{t("privacy")}</Link>
          </div>
          <p className="text-xs">{t("copyright")}</p>
          <p className="max-w-md text-xs text-fg-muted">{t("independent")}</p>
        </div>
      </div>
    </footer>
  );
}
