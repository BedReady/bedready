"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { isMacDesktop, khaytJobLink, sha256Hex } from "@/lib/khayt-link";

const noSubscribe = () => () => {};

/**
 * "Send to Khayt" beside Download again: opens a new job in Khayt for Mac from the converted file.
 *
 * Download first, then the link — that order is the Mac's. The done screen has already downloaded
 * the file by the time this renders (`deliver()` in the convert page), so the click only opens the
 * link; downloading again would leave an "x (1).3mf" beside the first for nothing, and the Mac finds
 * the file by hash, not by name. If the visitor cancelled that download, the Mac says the file is
 * missing and asks for it.
 *
 * A plain <a href>: the click is the user gesture the browser wants before handing a custom scheme
 * to an app. The hash is computed ahead of the click, so the link is ready when the button shows.
 * Shown on a Mac only — Khayt has no other desktop app with this link.
 */
export default function SendToKhaytButton({ blob, fileName }: { blob: Blob; fileName: string }) {
  const t = useTranslations("convert");
  const onMac = useSyncExternalStore(
    noSubscribe,
    () => isMacDesktop(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    () => false,
  );
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!onMac) return;
    let live = true;
    void blob
      .arrayBuffer()
      .then(sha256Hex)
      .then((hash) => {
        if (live) setLink(khaytJobLink(fileName, hash));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [blob, fileName, onMac]);

  if (!onMac || !link) return null;
  return (
    <a href={link} className="btn-secondary btn-sm" title={t("khaytSendHint")}>
      {t("khaytSend")}
    </a>
  );
}
