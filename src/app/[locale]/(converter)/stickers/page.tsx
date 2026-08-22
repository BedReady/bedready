import { use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { alternates } from "@/lib/seo";

export const metadata = {
  title: "Free 3D-printing stickers — BedReady",
  description: "Free 3D-printing-themed sticker designs (SVG) — filament spool, build plate, nozzle, Full Spectrum and more. Download and print or cut your own.",
  alternates: alternates("/stickers"),
};

const STICKERS = [
  { file: "u1-ready", label: "U1 Ready" },
  { file: "spool", label: "Filament spool" },
  { file: "bed-ready", label: "Bed Ready" },
  { file: "nozzle", label: "Hot nozzle" },
  { file: "full-spectrum", label: "Full Spectrum" },
  { file: "layers", label: "0.2 mm layers" },
];

export default function StickersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("stickers");

  return (
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-fg-muted">{t("intro")}</p>

      <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3">
        {STICKERS.map((s) => (
          <div key={s.file} className="flex flex-col items-center rounded-lg border border-line bg-surface-2 p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/stickers/${s.file}.svg`} alt={s.label} width={140} height={140} className="h-32 w-32" />
            <p className="mt-3 text-base font-medium text-fg">{s.label}</p>
            <a
              href={`/stickers/${s.file}.svg`}
              download
              className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg transition hover:bg-surface-3"
            >
              {t("download")}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-line bg-surface-2 p-4 text-xs text-fg-muted">{t("note")}</p>
    </main>
  );
}
