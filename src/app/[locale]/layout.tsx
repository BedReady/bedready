/**
 * The document shell, shared by both route groups.
 *
 * ── THIS FILE USED TO BE THE WHOLE SHELL ────────────────────────────────────────────────────────
 *
 * Until 2026-08-21 it also mounted `ViewerProvider`, `SiteHeader` and `SiteFooter`, so every page
 * on the site — the converter included — created a Supabase client and made an auth round-trip on
 * load. That is right for the library and wrong for a converter that requires no account and is
 * being carved into a public repo with no credentials in it
 * (`docs/SPLIT-DECISION-2026-08.md`).
 *
 * So the shell moved down into two route-group layouts, `(library)` and `(converter)`, and what is
 * left here is only what both actually share: the `<html>`/`<body>` document, IBM Plex, the
 * no-flash theme script, the locale guard, translations, brand structured data and analytics.
 *
 * Route groups change no URLs — `(library)/designs` still serves `/designs` — and they double as
 * the shape of the eventual repo split.
 *
 * ── METADATA MOVED DOWN TOO, FOR THE SAME REASON ────────────────────────────────────────────────
 *
 * `generateMetadata` and the brand JSON-LD used to live here and named `https://bedready.io` for
 * every page on the site. A layout's `generateMetadata` is never given the pathname, so this file
 * cannot pick an origin per request — but each group layout IS an origin, so both now call
 * `siteMetadata()`/`brandJsonLd()` from `@/lib/site-metadata` with their own.
 *
 * `metadataBase` is the one that mattered: it resolves relative OpenGraph image paths, so a library
 * page on `makerrun.com` with a `bedready.io` base would publish social cards pointing at the other
 * domain — well-formed, and wrong only where a crawler or a pasted link would show it.
 *
 * What stays here is `generateStaticParams`, which is about locales and belongs to neither site.
 */
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import AcquisitionCapture from "@/components/AcquisitionCapture";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, dirOf } from "@/i18n/routing";
import "../globals.css";

/* ── Type ──────────────────────────────────────────────────────────────────────────────────────
   The site had no typeface at all — it rendered in whatever `ui-sans-serif` resolves to per OS,
   which is the single loudest "nobody chose this" signal a page can send, and it changed identity
   between a Mac, a PC and an Android phone.

   IBM Plex, in two roles. Plex was drawn for IBM's technical documentation, which is exactly this
   product's register: a tool that opens your file and reports what is actually in it. Plex Mono is
   the load-bearing half — every measured value on this site (nozzle Ø, layer height, slot counts,
   hex codes, ΔE) is set in it, so numbers line up in columns and read as instrument output rather
   than prose. Plex Sans carries the prose.

   Latin subset only, with the stack falling through to system faces: Plex has no Arabic or CJK
   coverage, and `ar` / `ja` / `zh` are 3 of the 7 locales — per-glyph fallback handles them. */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Pre-render the static locales at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme: set the .dark class BEFORE paint. Defaults to LIGHT (the whole site is themed);
            an explicit saved choice wins, otherwise fall back to the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',!!d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider>
          {/* Skip link: first focusable element, jumps a keyboard/AT user past the header nav to content. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-violet-600 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            Skip to content
          </a>
          {/* The shell — header, footer, and for the library its ViewerProvider — lives in the
              ROUTE GROUP layouts, not here. `(library)/layout.tsx` mounts the signed-in shell;
              `(converter)/layout.tsx` mounts one with no viewer and no Supabase client. Everything
              in this file is what both genuinely share: the document, the typeface, the theme
              script, translations and analytics.

              The skip link above targets `#main-content`, which each group shell renders. */}
          {children}
          <Analytics />
          <AcquisitionCapture />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
