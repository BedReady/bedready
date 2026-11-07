"use client";

import { useSyncExternalStore } from "react";
import { installTargetFor, type InstallTarget } from "@/lib/extension-stores";

export type HeroInstallOption = { label: string; href: string };

const noSubscribe = () => () => {};

/**
 * The /extension hero's primary install button, aimed at the visitor's browser.
 *
 * The server cannot know the browser, so it renders the Chrome Web Store button (the most common
 * case). After hydration only the label and href change, to AMO on Firefox or "every browser" on a
 * phone or Safari. The button sits on a line of its own, so a longer or shorter label moves nothing
 * else. `useSyncExternalStore` with a server snapshot is React's way to read a client-only value
 * without a hydration mismatch.
 *
 * The labels arrive translated from the server page, so this component needs no messages of its
 * own on the client.
 */
export default function ExtensionHeroInstall({
  options,
  desktopNote,
}: {
  options: Record<InstallTarget, HeroInstallOption>;
  desktopNote: string;
}) {
  const target = useSyncExternalStore(
    noSubscribe,
    () => installTargetFor(navigator.userAgent),
    (): InstallTarget => "chrome",
  );
  const o = options[target];
  const external = /^https?:/.test(o.href);
  return (
    <div className="mt-8">
      <a
        href={o.href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="btn-primary btn-lg"
      >
        {o.label}
      </a>
      {/* Phones and tablets only, by pointer rather than by width: a narrow desktop window can
          still install the extension. CSS, so it is right in the first paint. */}
      <p className="mt-3 hidden text-sm text-fg-subtle pointer-coarse:block">{desktopNote}</p>
    </div>
  );
}
