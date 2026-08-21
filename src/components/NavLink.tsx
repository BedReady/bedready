"use client";

import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";

// Header nav link that marks the current page (server SiteHeader can't read the pathname). Active =
// text-fg + aria-current; inactive keeps the header's muted default.
export default function NavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${className ?? ""}${active ? " text-fg" : ""}`}>
      {children}
    </Link>
  );
}
