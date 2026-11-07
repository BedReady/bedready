"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loadSheetHtml, loadSheetRows, type LoadSheetRow } from "@/lib/load-sheet";

/**
 * "Print load sheet" on the done screen: which filament goes in which head, and the spool-swap
 * pauses, on one page to keep beside the printer. The rows are read from the converted file ahead
 * of the click, so the click can open the print window synchronously (a window opened after an
 * await loses the user's gesture and is blocked as a popup).
 */
export default function LoadSheetButton({ blob, fileName, printerName, swaps }: { blob: Blob; fileName: string; printerName: string; swaps: string[] }) {
  const t = useTranslations("convert");
  const locale = useLocale();
  const [rows, setRows] = useState<LoadSheetRow[] | null>(null);

  useEffect(() => {
    let live = true;
    void blob.arrayBuffer().then((b) => {
      if (live) setRows(loadSheetRows(new Uint8Array(b)));
    });
    return () => {
      live = false;
    };
  }, [blob]);

  if (!rows || rows.length === 0) return null;

  const open = () => {
    const html = loadSheetHtml({
      fileName,
      printerName,
      rows,
      swaps,
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date()),
      copy: {
        lang: locale,
        dir: locale === "ar" ? "rtl" : "ltr",
        title: t("loadSheetTitle"),
        printer: t("loadSheetPrinter"),
        head: t("loadSheetHead"),
        color: t("loadSheetColor"),
        material: t("loadSheetMaterial"),
        preset: t("loadSheetPreset"),
        swapsTitle: t("loadSheetSwaps"),
        footer: t("loadSheetFooter"),
      },
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (w) w.addEventListener("load", () => w.print(), { once: true });
    // Revoke after the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <button type="button" onClick={open} className="btn-secondary btn-sm">
      {t("loadSheetButton")}
    </button>
  );
}
