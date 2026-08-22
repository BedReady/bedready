import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Browser extension — BedReady",
  description:
    "Convert MakerWorld, Bambu, Printables & Thingiverse .3mf downloads to print on the Snapmaker U1, right from the download page — in Chrome, Edge, Firefox, and Safari. Free, in your browser.",
  alternates: alternates("/extension"),
};

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
const primaryBtn = "btn-primary btn-md mt-3";
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

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-3 text-fg-muted">{t("intro")}</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {/* Chrome / Edge — one-click from the Web Store; manual/load-unpacked is a collapsed fallback. */}
        <section className="rounded-lg border border-line bg-surface-2 p-6">
          <h2 className="eyebrow">{t("chromeTitle")}</h2>
          {CHROME_WEBSTORE_URL ? (
            <a href={CHROME_WEBSTORE_URL} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
              {t("addChrome")}
            </a>
          ) : (
            <p className="mt-3 text-base text-fg-muted">{t("chromeStoreOnly")}</p>
          )}
          <details className="mt-4 text-sm text-fg-muted">
            <summary className={summaryCls}>
              <Caret />
              {t("installManually")}
            </summary>
            <a href="/bedready-extension.zip" download className={secondaryBtn}>{t("download")}</a>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-fg-muted">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        </section>

        {/* Firefox */}
        <section className="rounded-lg border border-line bg-surface-2 p-6">
          <h2 className="eyebrow">{t("firefoxTitle")}</h2>
          {FIREFOX_AMO_URL ? (
            <a href={FIREFOX_AMO_URL} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
              {t("getFirefox")}
            </a>
          ) : (
            <p className="mt-3 text-base text-fg-muted">{t("firefoxPending")}</p>
          )}
          <details className="mt-4 text-sm text-fg-muted">
            <summary className={summaryCls}>
              <Caret />
              {t("installManually")}
            </summary>
            <a href="/bedready-firefox.zip" download className={secondaryBtn}>{t("download")}</a>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-fg-muted">
              {firefoxSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        </section>

        {/* Safari (Mac) — Mac App Store only; end users can't load-unpacked, so no manual fallback. */}
        <section className="rounded-lg border border-line bg-surface-2 p-6">
          <h2 className="eyebrow">{t("safariTitle")}</h2>
          {SAFARI_APPSTORE_URL ? (
            <a href={SAFARI_APPSTORE_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block" aria-label={t("getSafari")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mac-app-store-badge.svg" alt={t("getSafari")} width={150} height={44} className="h-11 w-auto" />
            </a>
          ) : (
            <p className="mt-3 text-base text-fg-muted">{t("safariPending")}</p>
          )}
          <p className="mt-4 text-base text-fg-muted">{t("safariNote")}</p>
        </section>
      </div>

      <p className="mt-6 text-base text-fg-muted">
        {t.rich("prefer", {
          link: (c) => (
            <Link href="/convert" className="text-violet-300 hover:underline">
              {c}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
