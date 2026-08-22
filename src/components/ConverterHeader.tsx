import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import NavLink from "@/components/NavLink";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { SOURCE_REPO_URL } from "@/lib/links";

/**
 * The converter's header. `SiteHeader` is the library's.
 *
 * ── WHY THERE ARE TWO ────────────────────────────────────────────────────────────────────────────
 *
 * `SiteHeader` mounts `SavesLink`, `NotifBell` and `AccountMenu`, all of which read `ViewerContext`,
 * which holds a Supabase client. That is correct for the library and wrong for the converter twice
 * over: converting requires no account by decision (`docs/SPLIT-DECISION-2026-08.md`), so those
 * three controls have nothing to show — and the converter is being carved into a public repo that
 * ships no credentials, so it cannot mount a provider that creates a Supabase client at all.
 *
 * This header therefore uses only the components that hold no viewer state: logo, nav links, theme
 * and language. It is not a stripped copy kept in sync with `SiteHeader` — the two headers are
 * diverging on purpose, and after the split they belong to different products.
 *
 * ── THE LOGO LINKS TO /convert, NOT / ───────────────────────────────────────────────────────────
 *
 * `/` is the library's homepage and moves to MakerRun. On the converter, "home" is the converter.
 * This is the one deliberate behaviour change in the layout split: clicking the wordmark from a
 * converter page used to land on the library.
 *
 * ── AND IT STILL LINKS TO THE LIBRARY, ON PURPOSE — BY ITS NAME ─────────────────────────────────
 *
 * ROADMAP §0 makes the converter the funnel, and the funnel has to point somewhere. The link is
 * same-origin today and becomes a cross-domain link to MakerRun after the carve.
 *
 * It used to say "Library". That was the whole problem: the word "MakerRun" appeared **nowhere in
 * any user-visible string on either site** — only in code comments — while the two products were
 * being separated onto two domains. A visitor could not learn the sister site's name from the site,
 * so the 301 to `makerrun.com` looked like being handed to a stranger. It is named here, marked as
 * another site with `↗`, and explained in the footer.
 *
 * ── AND THE SOURCE LINK IS NOT DECORATION ───────────────────────────────────────────────────────
 *
 * `COMPETITIVE-2026-08.md` §3.1 — *"say 'nothing is uploaded' louder; free, and your best remaining
 * edge"* — is the highest-ratio item in that document, and `SPLIT-DECISION-2026-08.md` calls open
 * source *"the loudest available version of that, because it is the only one a sceptic can verify"*.
 * The repository went public and the site never mentioned it, while `/compare-u1-converters` linked
 * four competitors' repositories. This is the claim's evidence, so it sits in the chrome.
 */
export default function ConverterHeader() {
  const t = useTranslations("nav");
  return (
    <header className="relative border-b border-line">
      <div className="shell flex items-center justify-between py-4">
        <Link
          href="/convert"
          className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-fg"
        >
          <Logo size={26} />
          {/* One flex item, pinned LTR — same reasoning as SiteHeader: the wordmark must not be
              split by the link's `gap-2`, and a Latin brand name keeps Latin order in the RTL
              locale. */}
          <span dir="ltr">
            Bed<span className="brand-text">Ready</span>
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-fg-muted sm:gap-5">
          <NavLink href="/orca-filaments" className="hidden hover:text-fg sm:block">
            {t("filaments")}
          </NavLink>
          {/* Labelled "Guides", because that is where it goes. It said "Help & FAQ" while the footer
              used that same label for `/help` — one name, two destinations, decided by viewport. */}
          <NavLink href="/guides" className="hidden hover:text-fg sm:block">
            {t("guides")}
          </NavLink>
          <Link href="/app" className="hidden items-center gap-1.5 hover:text-fg sm:inline-flex">
            {t("app")}
          </Link>
          {/* The bridge to the library, by name. `/verified` rather than `/designs` for the same
              reason SiteHeader picks it: proof is the part an in-slicer library cannot copy. */}
          <NavLink
            href="/verified"
            className="hidden items-center gap-1 font-medium hover:text-fg sm:inline-flex"
            title={t("makerrunHint")}
          >
            {t("makerrun")}
            <span aria-hidden className="text-[0.75em] text-fg-subtle">↗</span>
          </NavLink>
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("sourceHint")}
            aria-label={t("sourceHint")}
            className="hidden text-fg-subtle transition hover:text-fg sm:block"
          >
            <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
          <ThemeToggle />
          {/* Wrapper carries the responsive display, not the button — `.btn-primary` is unlayered
              CSS and beats a layered `hidden` outright. Same shape as SiteHeader. */}
          <span className="hidden sm:block">
            <LanguageSwitcher />
          </span>
          <MobileNav variant="converter" />
        </nav>
      </div>
    </header>
  );
}
