import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Logo from "@/components/Logo";
import MobileNav from "@/components/MobileNav";
import NavLink from "@/components/NavLink";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";

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
 * ── AND IT STILL LINKS TO THE LIBRARY, ON PURPOSE ───────────────────────────────────────────────
 *
 * ROADMAP §0 makes the converter the funnel, and the funnel has to point somewhere. The link is
 * same-origin today and becomes a cross-domain link to MakerRun after the carve; the funnel read on
 * 2026-08-21 is what it exists to move. Removing it because the two are "separate now" would delete
 * the only bridge the library has ever had, which is the opposite of the point.
 */
export default function ConverterHeader() {
  const t = useTranslations("nav");
  return (
    <header className="relative border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
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
          <NavLink href="/guides" className="hidden hover:text-fg sm:block">
            {t("help")}
          </NavLink>
          <Link href="/app" className="hidden items-center gap-1.5 hover:text-fg sm:inline-flex">
            {t("app")}
          </Link>
          {/* The bridge to the library. `/verified` rather than `/designs` for the same reason
              SiteHeader picks it: proof is the part an in-slicer library cannot copy. */}
          <NavLink href="/verified" className="hidden hover:text-fg sm:block">
            {t("library")}
          </NavLink>
          <ThemeToggle />
          {/* Wrapper carries the responsive display, not the button — `.btn-primary` is unlayered
              CSS and beats a layered `hidden` outright. Same shape as SiteHeader. */}
          <span className="hidden sm:block">
            <LanguageSwitcher />
          </span>
          <MobileNav />
        </nav>
      </div>
    </header>
  );
}
