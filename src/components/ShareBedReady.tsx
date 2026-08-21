"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@vercel/analytics";
import { CONVERTER_ORIGIN } from "@/lib/origin";

// Lightweight post-conversion growth nudge. Shown after a successful conversion — the converter
// is the product's distribution loop, and U1 owners congregate on Reddit/forums.
//
// ── WHY IT NOW WAITS FOR THE SECOND CONVERSION ─────────────────────────────────────────────────
//
// The 2026-08-15 funnel read: 139 people converted successfully in one window and 2 clicked through
// to the library — 1.4%. ContributeToLibrary had been made deliberately the quietest of the three
// blocks on this screen precisely so all three would not be ignored; it was ignored instead.
//
// Three asks at one moment is zero asks, so one of them had to move, and this is the right one to
// move — not because it matters least, but because asking someone to evangelise a tool the FIRST
// time they use it is premature. They have known the product for about forty seconds. Someone on
// their second or third conversion has actually decided it works, which is the person worth asking.
//
// So a first-time converter now sees the library ask and, at most, the email capture. This returns
// on the next conversion, to a better audience for it.
const URL = `${CONVERTER_ORIGIN}/convert`;

/** Conversions by this browser. Local and approximate on purpose — it gates a nudge, not access. */
const COUNT_KEY = "bedready:convert-count";

export default function ShareBedReady() {
  const t = useTranslations("convert");
  const [copied, setCopied] = useState(false);
  // Default hidden, revealed after the client-side check — the same pattern ConvertCapture uses to
  // avoid a block flashing in and out on hydration.
  const [show, setShow] = useState(false);

  useEffect(() => {
    let n = 0;
    try {
      n = Number(localStorage.getItem(COUNT_KEY) || "0") || 0;
      localStorage.setItem(COUNT_KEY, String(n + 1));
    } catch {
      // Storage blocked (private mode). Showing it is the safe failure: the nudge is harmless and
      // suppressing it forever for these visitors would quietly retire the distribution loop.
      setShow(true);
      return;
    }
    setShow(n >= 1); // n is the count BEFORE this conversion, so this is the 2nd or later
  }, []);

  if (!show) return null;

  const shareTitle = t("shareText");
  const reddit = `https://www.reddit.com/submit?url=${encodeURIComponent(URL)}&title=${encodeURIComponent(shareTitle)}`;
  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(URL)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(URL);
      setCopied(true);
      track("share_click", { via: "copy" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-5 py-4 text-sm">
      <span className="text-fg-muted">{t("sharePrompt")}</span>
      <a
        href={reddit}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("share_click", { via: "reddit" })}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-3"
      >
        Reddit
      </a>
      <a
        href={x}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("share_click", { via: "x" })}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-3"
      >
        X
      </a>
      <button
        onClick={copy}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-3"
      >
        {copied ? t("copied") : t("copyLink")}
      </button>
    </div>
  );
}
