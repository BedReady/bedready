"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { CHROME_WEBSTORE_URL, FIREFOX_AMO_URL, installTargetFor, type InstallTarget } from "@/lib/extension-stores";

/**
 * "Convert every download automatically" — the extension, offered on the done screen.
 *
 * ── WHY HERE ─────────────────────────────────────────────────────────────────────────────────────
 * The Nov 7 review's top growth idea. Somebody on the done screen just downloaded a model, opened
 * this page, dropped the file in and downloaded it again. The extension does all of that on the
 * download itself, and it is the only part of BedReady that brings a person back without them
 * remembering to come. The done screen offered the library, sharing and email, and never this.
 *
 * ── WHEN IT STAYS QUIET ──────────────────────────────────────────────────────────────────────────
 *   · Not on phones, tablets or Safari (no store installs it there) — server and first client render
 *     are empty, so nothing shifts for them.
 *   · Not when the file came FROM the extension (`fromExtension`), and not when it is installed:
 *     Chrome exposes `chrome.runtime` to this page only when an installed extension lists bedready.io
 *     in `externally_connectable`, and a message to ours then fails with "port closed" (installed,
 *     no reply for this type) rather than "Receiving end does not exist" (not installed).
 *   · Not after "Not now", remembered in this browser (best-effort; storage may be unavailable).
 */
const DISMISS_KEY = "bedready.extCard.dismissed";
const EXTENSION_ID = "empadffogehgmbleajehbplobfajddnh";
const noSubscribe = () => () => {};

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Resolves true when the Chrome/Edge build of the extension is installed. Firefox: always false. */
function chromeExtensionInstalled(): Promise<boolean> {
  type Runtime = { sendMessage?: (id: string, msg: unknown, cb: () => void) => void; lastError?: { message?: string } };
  const rt = (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  const send = rt?.sendMessage;
  if (!rt || !send) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      send.call(rt, EXTENSION_ID, { type: "bedready-ping" }, () => {
        const msg = rt.lastError?.message ?? "";
        resolve(!/receiving end does not exist/i.test(msg));
      });
    } catch {
      resolve(false);
    }
  });
}

export default function ExtensionDoneCard({ fromExtension }: { fromExtension: boolean }) {
  const t = useTranslations("convert");
  const target = useSyncExternalStore(
    noSubscribe,
    () => installTargetFor(navigator.userAgent),
    (): InstallTarget => "other",
  );
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (fromExtension || readDismissed() || !(target === "chrome" || target === "edge" || target === "firefox")) return;
    let live = true;
    void (target === "firefox" ? Promise.resolve(false) : chromeExtensionInstalled()).then((installed) => {
      if (live && !installed) setShow(true);
    });
    return () => {
      live = false;
    };
  }, [fromExtension, target]);

  if (!show) return null;
  const href = target === "firefox" ? FIREFOX_AMO_URL : CHROME_WEBSTORE_URL;
  const browser = target === "firefox" ? "Firefox" : target === "edge" ? "Edge" : "Chrome";
  return (
    <aside className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-surface-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{t("extCardTitle")}</p>
        <p className="mt-0.5 text-sm text-fg-muted">{t("extCardBody")}</p>
      </div>
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm shrink-0">
        {t("extCardCta", { browser })}
      </a>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* storage unavailable: hidden for this visit only */
          }
          setShow(false);
        }}
        className="text-sm text-fg-subtle hover:text-fg"
      >
        {t("extCardDismiss")}
      </button>
    </aside>
  );
}
