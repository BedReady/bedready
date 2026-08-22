"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { track } from "@vercel/analytics";
import { acquisitionProps } from "@/lib/acquisition";

/**
 * The one ask on the done screen, and the only one that leads anywhere.
 *
 * ── WHAT THE FUNNEL SAID, 2026-08-15 ────────────────────────────────────────────────────────────
 *
 * Read for the first time, over one window:
 *
 *     convert_success ........ 139 visitors
 *     convert_to_library ....... 2 visitors      ← 1.4%
 *     upload_view .............. 6
 *     upload_signin_required ... 1
 *     upload_complete .......... 0
 *
 * 139 people finished a conversion and 137 left. Everything downstream — the sign-in wall, the form,
 * the print photo — is starving, not broken: `upload_signin_required` fired ONCE in the whole window.
 * That reading is what stopped two larger features being built (the magic-link handoff and
 * draft-first upload); neither addresses a step almost nobody reaches.
 *
 * ── WHY IT WAS 1.4%, AND WHAT CHANGED HERE ──────────────────────────────────────────────────────
 *
 * Three things, and this file predicted the first one. Its previous header read:
 *
 *     "Deliberately quieter than the two nudges that already live on this screen… A third loud block
 *     would just make all three easier to ignore."
 *
 * It was made the quietest of three competing asks on purpose, and it worked: three asks at one
 * moment is zero asks. ShareBedReady now waits for a repeat conversion, so a first-time converter
 * sees this and at most one other thing.
 *
 * Second: **the moment was already spent.** `download()` fires before this screen renders. The
 * visitor has their file and their goal is complete; every block below is a favour asked of someone
 * already leaving.
 *
 * Third, and this is the change that matters: **the ask was for altruism when it did not have to
 * be.** "Contribute to the library" is a benefit to strangers. But the cloud library sync already
 * ships — `/api/library` is live and the desktop app pulls "my library" after sign-in — so the same
 * click can be offered as *keeping* the file: on any machine, without the downloads folder. That is
 * a true statement about a working feature, not a promise, and it is worth something to the person
 * being asked.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * It is not a claim that this fixes it. The funnel says WHERE the loss is, never why. This is the
 * cheapest change that could plausibly move it — copy and hierarchy, no new mechanism — and
 * `convert_done_view` was added alongside so the next reading has a denominator that did not shift.
 * At 139 conversions a window there is no A/B test to run: ship, then compare the same window.
 *
 * ── IT MOVED. READ 2026-08-21, SAME WINDOW LENGTH ───────────────────────────────────────────────
 *
 * Vercel Analytics → Events, last 7 days (2026-08-14 → 08-21), visitors:
 *
 *     convert_success .......... 137      (278 events)
 *     convert_done_view ......... 79      (148)          ← the denominator that does not shift
 *     convert_to_library ......... 7      (8)   share 6, browse 1
 *     upload_view ................ 7      (9)   sawGate true 7/7, fromConvert true 1
 *     upload_signin_required ..... 0
 *     upload_complete ............ 0
 *
 * **1.4% → 5.1% against `convert_success`, and 8.9% against `convert_done_view`.** Seven clicks
 * instead of two, on a near-identical conversion count (139 → 137). The change this file argued for
 * — quieter competition, and asking for *keeping* the file rather than for altruism — is the only
 * thing that changed between the two readings. Treat it as moved, not as proven: 2 → 7 is seven
 * events, and seven events do not have a confidence interval.
 *
 * **It is still the bottleneck.** 5.1% of a converter audience is not a working bridge, and the
 * three builds §1.1 was choosing between all live downstream of it. Nothing downstream can be
 * chosen while the thing feeding it delivers seven people a week.
 *
 * ── AND THE SAME READ RETIRED `sawGate` AS A DISCRIMINATOR ──────────────────────────────────────
 *
 * `sawGate` is `!user` (upload/page.tsx). It was named when /upload showed a sign-in wall INSTEAD of
 * the form, so "sawGate: true" then meant "never reached the form" and `docs/THE-19TH.md` §1.1 keys
 * its whole decision table on it. **#112 removed that wall**: a signed-out visitor now gets the full
 * form and is only redirected at submit, with a draft saved. So `sawGate: true` now means "arrived
 * signed out" and nothing else, `sawGate: false` is unobservable for the population §1.1 cares
 * about, and the table's first two bullets can no longer be told apart by it.
 *
 * **The event that actually separates the two walls is `upload_signin_required`**, which fires at
 * submit — and it was 0. Seven signed-out people reached the form and not one pressed submit. That
 * is neither "blocked by the sign-in wall" nor "abandoned at the print photo": they left before the
 * form asked them for anything.
 */

export default function ContributeToLibrary() {
  const t = useTranslations("convert");

  return (
    <div className="mt-3 rounded-lg border border-violet-400/40 bg-violet-400/[0.07] px-5 py-4">
      <p className="text-sm text-fg">{t("contributePrompt")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/upload"
          onClick={() => track("convert_to_library", { ...acquisitionProps(), via: "share" })}
          className="btn-primary btn-md"
        >
          {t("contributeShare")}
        </Link>
        <Link
          href="/designs"
          onClick={() => track("convert_to_library", { ...acquisitionProps(), via: "browse" })}
          className="text-xs font-medium text-violet-300 hover:underline"
        >
          {t("contributeBrowse")}
        </Link>
      </div>
    </div>
  );
}
