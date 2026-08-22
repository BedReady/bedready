"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import Link from "@/components/SiteLink";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Icon from "@/components/Icon";
import { SOURCE_REPO_URL } from "@/lib/links";

/**
 * Hamburger menu for small screens (the inline nav is hidden < sm).
 *
 * ── ONE LIST FOR TWO PRODUCTS WAS THE BUG ───────────────────────────────────────────────────────
 *
 * The headers were split — `ConverterHeader` and `SiteHeader` — and this was not, so on
 * `bedready.io` the menu offered **Your profile**, **Notifications** and **Share a file**: three
 * routes that require an account the converter deliberately does not have, and one of which
 * (`/upload`) `SPLIT-DECISION-2026-08.md` records as permanently unreachable from the converter once
 * the origins diverge. It also reordered and renamed the desktop nav rather than mirroring it, and
 * pointed **Help & FAQ** at `/help` while the desktop header pointed the same label at `/guides` —
 * one label, two destinations, decided by viewport width.
 *
 * `variant` is what stops that from being a coincidence of two lists staying in step: the converter
 * gets the converter's items, in the converter header's order.
 */
export default function MobileNav({ variant = "library" }: { variant?: "converter" | "library" }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("nav");
  const navRef = useRef<HTMLElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on route change.
  useEffect(() => setOpen(false), [pathname]);

  // On open, move focus into the menu (keyboard/AT users start inside it, not stranded on the page).
  useEffect(() => {
    if (open) navRef.current?.querySelector<HTMLElement>("a, button, [tabindex]")?.focus();
  }, [open]);

  const closeToTrigger = () => { setOpen(false); btnRef.current?.focus(); };

  // While open: Escape closes (focus back to the trigger), and Tab is trapped inside the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeToTrigger(); return; }
      if (e.key === "Tab" && navRef.current) {
        const f = Array.from(navRef.current.querySelectorAll<HTMLElement>('a, button, [tabindex]:not([tabindex="-1"])'))
          .filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  type Item = { href: string; label: string; external?: boolean; sister?: boolean };
  // Same items as the inline nav directly above it, in the same order — a menu that reshuffles the
  // page's own navigation makes the small screen a different site.
  const converterLinks: Item[] = [
    { href: "/convert", label: t("converter") },
    { href: "/orca-filaments", label: t("filaments") },
    { href: "/guides", label: t("guides") },
    { href: "/app", label: t("app") },
    { href: "/mixer", label: t("mixer") },
    { href: "/calibrate", label: t("calibrate") },
    { href: "/extension", label: t("extension") },
    { href: "/verified", label: t("makerrun"), sister: true },
  ];
  const libraryLinks: Item[] = [
    { href: "/verified", label: t("library") },
    { href: "/convert", label: t("converter") },
    { href: "/orca-filaments", label: t("filaments") },
    { href: "/app", label: t("app") },
    { href: "/extension", label: t("extension") },
    { href: "/help", label: t("help") },
    { href: "/account", label: t("profile") },
    { href: "/notifications", label: t("notifications") },
    { href: "/upload", label: t("share"), sister: false },
  ];
  const links = variant === "converter" ? converterLinks : libraryLinks;

  return (
    <div className="sm:hidden">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        className="icon-btn text-fg"
      >
        {open ? <span aria-hidden>&times;</span> : <Icon name="menu" size={18} />}
      </button>
      {open && (
        <>
          {/* The overlay had no background, so the panel floated over live text — the H1 read
              through it, cut mid-word. A scrim is what tells a reader the page behind is inert. */}
          <div
            className="fixed inset-0 z-40 bg-app/60 backdrop-blur-[1px]"
            onClick={closeToTrigger}
            aria-hidden
          />
          <nav ref={navRef} className="absolute right-4 top-14 z-50 w-52 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-3 ${
                    active ? "bg-surface-2 font-medium text-fg" : "text-fg"
                  } ${l.sister ? "border-t border-line font-medium" : ""}`}
                >
                  <span dir={l.sister ? "ltr" : undefined}>{l.label}</span>
                  {l.sister && <span aria-hidden className="text-xs text-fg-subtle">↗</span>}
                </Link>
              );
            })}
            {variant === "converter" && (
              <a
                href={SOURCE_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-fg hover:bg-surface-3"
              >
                <span>{t("source")}</span>
                <span aria-hidden className="text-xs text-fg-subtle">↗</span>
              </a>
            )}
            <div className="border-t border-line px-4 py-3">
              <LanguageSwitcher />
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
