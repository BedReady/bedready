"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Icon from "@/components/Icon";

/** Hamburger menu for small screens (the inline nav is hidden < sm). */
export default function MobileNav() {
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

  const links = [
    { href: "/verified", label: t("library") },
    { href: "/convert", label: t("converter") },
    { href: "/orca-filaments", label: t("filaments") },
    { href: "/app", label: t("app") },
    { href: "/extension", label: t("extension") },
    { href: "/help", label: t("help") },
    { href: "/account", label: t("profile") },
    { href: "/notifications", label: t("notifications") },
    { href: "/upload", label: t("share"), highlight: true },
  ];

  return (
    <div className="sm:hidden">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        className="rounded-lg p-1.5 text-fg hover:bg-surface-3"
      >
        {open ? <span aria-hidden>&times;</span> : <Icon name="menu" size={18} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeToTrigger} aria-hidden />
          <nav ref={navRef} className="absolute right-4 top-14 z-50 w-52 overflow-hidden rounded-md border border-line bg-surface shadow-xl">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`block px-4 py-2.5 text-sm hover:bg-surface-3 ${
                    l.highlight ? "font-semibold text-violet-300" : active ? "bg-surface-2 font-medium text-fg" : "text-fg"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <div className="border-t border-line px-4 py-2.5">
              <LanguageSwitcher />
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
