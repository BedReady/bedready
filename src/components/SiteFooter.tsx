import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function SiteFooter() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-fg-subtle">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <p className="eyebrow">{t("groupTools")}</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link href="/convert" className="hover:text-fg">{t("converter")}</Link></li>
              <li><Link href="/orca-filaments" className="hover:text-fg">{t("orcaFilaments")}</Link></li>
              <li><Link href="/mixer" className="hover:text-fg">{t("mixer")}</Link></li>
              <li><Link href="/calibrate" className="hover:text-fg">{t("calibrate")}</Link></li>
              <li><Link href="/stickers" className="hover:text-fg">{t("stickers")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t("groupLibrary")}</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link href="/verified" className="hover:text-fg">{t("verified")}</Link></li>
              <li><Link href="/designs" className="hover:text-fg">{t("library")}</Link></li>
              <li><Link href="/app" className="hover:text-fg">{t("desktopApp")}</Link></li>
              <li><Link href="/extension" className="hover:text-fg">{t("extension")}</Link></li>
              <li><Link href="/features" className="hover:text-fg">{t("features")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t("groupResources")}</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link href="/guides" className="hover:text-fg">{t("guides")}</Link></li>
              <li><Link href="/compare-u1-converters" className="hover:text-fg">{t("compareConverters")}</Link></li>
              <li><Link href="/changelog" className="hover:text-fg">{t("changelog")}</Link></li>
              <li><Link href="/help" className="hover:text-fg">{t("help")}</Link></li>
              <li><Link href="/feedback" className="hover:text-fg">{t("feedback")}</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">{t("groupCommunity")}</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <a href="https://www.reddit.com/r/BedReady/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="#FF4500" aria-hidden="true" className="shrink-0">
                    <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                  </svg>
                  Reddit
                </a>
              </li>
              <li><a href="https://khaytapp.com/?utm_source=bedready&utm_medium=referral" target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200">{t("khayt")}</a></li>
              <li><a href="https://github.com/sponsors/Alballaa" target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200">{t("sponsor")}</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center gap-2 border-t border-line pt-6 text-center">
          <p><span dir="ltr">Bed<span className="text-violet-400">Ready</span></span> — {t("tagline")}</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
            <Link href="/licenses" className="hover:text-fg">{t("licenses")}</Link>
            <Link href="/terms" className="hover:text-fg">{t("terms")}</Link>
            <Link href="/privacy" className="hover:text-fg">{t("privacy")}</Link>
          </div>
          <p className="text-xs">{t("copyright")}</p>
          <p className="max-w-md text-[11px] text-fg-muted">{t("independent")}</p>
        </div>
      </div>
    </footer>
  );
}
