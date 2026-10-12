"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@vercel/analytics";
import { acquisitionProps } from "@/lib/acquisition";
import { convertApi } from "@/lib/convert-api";
import { LIBRARY_ORIGIN } from "@/lib/origin";
import { pickVerifiedFor, printerLabel, thumbnail, VERIFIED_QUERY, withAttribution, type VerifiedDesign } from "@/lib/verified-for-printer";

/**
 * "Files already verified for your <printer>" — up to three MakerRun listings on the done screen.
 *
 * Renders NOTHING until it has something to show, and nothing at all when the request fails or no
 * verified file names this machine (today: any target but the U1). The converter has finished its
 * job by the time this mounts; a strip that can only add is the only kind allowed here. See
 * verified-for-printer.ts for why it exists.
 *
 * Links open a new tab so the converter (and its in-memory file) survives the click.
 */
export default function VerifiedForYourPrinter({ printerModel, printerName }: { printerModel?: string; printerName?: string }) {
  const t = useTranslations("convert");
  const [picks, setPicks] = useState<VerifiedDesign[]>([]);

  useEffect(() => {
    if (!printerModel) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${convertApi("/api/v1/designs")}${VERIFIED_QUERY}`);
        if (!res.ok) return;
        const body = (await res.json()) as { designs?: VerifiedDesign[] };
        if (live) setPicks(pickVerifiedFor(body.designs ?? [], printerModel));
      } catch {
        // No strip. The conversion already succeeded; this is only ever an extra.
      }
    })();
    return () => {
      live = false;
    };
  }, [printerModel]);

  if (!picks.length) return null;

  const onClick = (via: string) => () => track("convert_to_library", { ...acquisitionProps(), via });

  return (
    <div className="mt-3 rounded-lg border border-line px-5 py-4">
      <p className="text-sm font-medium text-fg">{t("verifiedForTitle", { printer: printerLabel(printerName ?? printerModel ?? "") })}</p>
      <p className="mt-1 text-xs text-fg-muted">{t("verifiedForBody")}</p>
      <ul className="mt-3 grid grid-cols-3 gap-3">
        {picks.map((d) => (
          <li key={d.slug}>
            <a
              href={withAttribution(d.url)}
              target="_blank"
              rel="noopener"
              onClick={onClick("verified-card")}
              className="group block"
            >
              {d.cover?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnail(d.cover.url, LIBRARY_ORIGIN)}
                  width={320}
                  height={320}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-lg border border-line object-cover"
                />
              ) : (
                <div className="aspect-square w-full rounded-lg border border-line bg-surface" />
              )}
              <span className="mt-1.5 line-clamp-2 text-xs text-fg group-hover:underline">{d.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <a
        href={withAttribution(`${LIBRARY_ORIGIN}/verified`)}
        target="_blank"
        rel="noopener"
        onClick={onClick("verified-all")}
        className="mt-3 inline-block text-xs font-medium text-violet-300 hover:underline"
      >
        {t("verifiedForAll")}
      </a>
    </div>
  );
}
