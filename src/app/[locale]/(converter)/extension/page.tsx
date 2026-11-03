import AppJsonLd from "@/components/AppJsonLd";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";
import { PlateCorners } from "@/components/PlateHeads";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "extension" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternates("/extension", locale),
  };
}

// Set these to the live store listing URLs to switch each browser's card to a one-click install button.
// When empty, the card shows only the manual/load-unpacked fallback (collapsed).
const CHROME_WEBSTORE_URL = "https://chromewebstore.google.com/detail/bedready-%E2%80%94-3mf-%E2%86%92-snapmake/empadffogehgmbleajehbplobfajddnh";
const FIREFOX_AMO_URL = "https://addons.mozilla.org/firefox/addon/bedready-3mf-snapmaker-u1/"; // live on AMO
const SAFARI_APPSTORE_URL = ""; // set once approved on the Mac App Store

// ── WHY THESE STOPPED BEING THE GRADIENT ────────────────────────────────────────────────────────
//
// Both install buttons carried `brand-gradient`, and on the rendered page they were different
// colours: "Add to Chrome" read violet and "Add to Firefox" read green. Not two decisions — ONE
// class, whose `linear-gradient(100deg, …)` is sized to each element, so two buttons of different
// widths sample different parts of the sweep. Two identical actions at identical priority, drawn in
// two different colours by a rule that looked like consistency.
//
// `globals.css` had already written down why: "the spectrum sweep is the brand's identity and stays
// on the wordmark and the rule motif; it is not what a call to action should be, because the page's
// one saturated accent has to mean 'this is the action'." These two were the leftovers that sentence
// was about.
const primaryBtn = "btn-primary btn-md";
const secondaryBtn = "btn-secondary btn-sm mt-3";
// A `<details>` marker is a browser default in the middle of a hand-built interface, and it points
// the wrong way in RTL. The arrow is drawn, and rotates on open.
const summaryCls =
  "flex cursor-pointer list-none items-center gap-1.5 text-fg-muted transition hover:text-fg [&::-webkit-details-marker]:hidden";

/** The disclosure arrow, drawn rather than inherited from the browser. */
function Caret() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 transition-transform duration-150 group-open:rotate-90 rtl:-scale-x-100 [details[open]_&]:rotate-90">
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

export default async function ExtensionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("extension");
  const steps = t.raw("steps") as string[];
  const firefoxSteps = t.raw("firefoxSteps") as string[];

  // The page's grid (Figma: Extension page — Desktop · Light). The hero sets the copy beside the
  // popup on a build plate, as /convert sets its headline beside the drop zone. The three browsers
  // were cards in a 2+1 grid; they are ruled rows now, one per browser, like /convert's batch and
  // photo rows: the browser on the start edge, how to get it in the middle, the install at the end.
  return (
    <main className="page-read py-12">
      <AppJsonLd locale={locale} namespace="extension" path="/extension" kind="extension" />

      <div className="measure-full lg:flex lg:items-center lg:gap-20">
        <div className="lg:max-w-[35rem] lg:flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-5xl">{t("title")}</h1>
          <p className="mt-5 text-lg text-fg-muted">{t("intro")}</p>
        </div>

        {/* A capture of the real `extension/popup.html` with the extension INSTALLED
            (`extension/capture-popup.mjs`), one per theme because the popup follows
            prefers-color-scheme. Not a mock-up: the printer picker and the "On download" switches
            only fill in with real chrome.* APIs. Still missing: the injected `→ U1` button on a
            real download page — those hosts serve a Cloudflare challenge to an automated browser,
            and a drawn approximation would be a picture of software rather than of this one.
            It stands on the plate because that is the site's stage for the thing that does the work. */}
        <figure className="mt-10 lg:mt-0 lg:w-[30rem] lg:shrink-0">
          <div className="plate flex justify-center px-6 py-10 sm:px-12">
            <PlateCorners />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/extension/popup-light.png"
              alt={t("popupCaption")}
              width={704}
              height={854}
              className="relative w-full max-w-[22rem] rounded-lg shadow-2xl shadow-black/50 dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/extension/popup-dark.png"
              alt={t("popupCaption")}
              width={704}
              height={854}
              className="relative hidden w-full max-w-[22rem] rounded-lg shadow-2xl shadow-black/50 dark:block"
            />
          </div>
          <figcaption className="mt-3 text-sm text-fg-subtle">{t("popupCaption")}</figcaption>
        </figure>
      </div>

      <div className="measure-full mt-16">
        <div className="brand-rule" aria-hidden="true" />

        <InstallRow title={t("chromeTitle")} action={
          CHROME_WEBSTORE_URL
            ? <a href={CHROME_WEBSTORE_URL} target="_blank" rel="noopener noreferrer" className={primaryBtn}>{t("addChrome")}</a>
            : null
        }>
          {!CHROME_WEBSTORE_URL && <p className="text-base text-fg-muted">{t("chromeStoreOnly")}</p>}
          <Manual label={t("installManually")} href="/bedready-extension.zip" download={t("download")} steps={steps} />
        </InstallRow>

        <InstallRow title={t("firefoxTitle")} action={
          FIREFOX_AMO_URL
            ? <a href={FIREFOX_AMO_URL} target="_blank" rel="noopener noreferrer" className={primaryBtn}>{t("getFirefox")}</a>
            : null
        }>
          {!FIREFOX_AMO_URL && <p className="text-base text-fg-muted">{t("firefoxPending")}</p>}
          <Manual label={t("installManually")} href="/bedready-firefox.zip" download={t("download")} steps={firefoxSteps} />
        </InstallRow>

        {/* Safari: Mac App Store only. End users can't load an unpacked extension there, so there is
            no manual fallback to offer. */}
        <InstallRow title={t("safariTitle")} action={
          SAFARI_APPSTORE_URL
            ? (
              <a href={SAFARI_APPSTORE_URL} target="_blank" rel="noopener noreferrer" className="inline-block" aria-label={t("getSafari")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mac-app-store-badge.svg" alt={t("getSafari")} width={150} height={44} className="h-11 w-auto" />
              </a>
            )
            : null
        }>
          <p className="text-base text-fg-muted">{t("safariNote")}</p>
          {!SAFARI_APPSTORE_URL && <p className="mt-1.5 text-sm text-fg-subtle">{t("safariPending")}</p>}
        </InstallRow>

        <p className="mt-8 text-base text-fg-muted">
          {t.rich("prefer", {
            link: (c) => (
              <Link href="/convert" className="text-violet-300 hover:underline">
                {c}
              </Link>
            ),
          })}
        </p>
      </div>
    </main>
  );
}

/** One browser: its name on the start edge, how to get it in the middle, the install at the end. */
function InstallRow({ title, action, children }: { title: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-12 gap-y-3 border-b border-line py-7 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-center">
      <h2 className="text-lg font-semibold text-fg" style={{ fontStretch: "112%" }}>{title}</h2>
      <div className="min-w-0">{children}</div>
      {action && <div className="sm:justify-self-end">{action}</div>}
    </section>
  );
}

/** The load-unpacked fallback, collapsed: for people who can't or won't use the store. */
function Manual({ label, href, download, steps }: { label: string; href: string; download: string; steps: string[] }) {
  return (
    <details className="text-sm text-fg-subtle">
      <summary className={summaryCls}>
        <Caret />
        {label}
      </summary>
      <a href={href} download className={secondaryBtn}>{download}</a>
      <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-fg-muted">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </details>
  );
}
