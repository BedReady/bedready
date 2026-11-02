"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { mixRgb } from "@/lib/filament-mixer";

// "What can my 4 filaments mix?" — a Full Spectrum gamut preview. Enter your 4 loaded filaments
// (defaults to CMYK) and see every 2-filament blend, with the recipe on hover. Uses the same pigment
// mixer the converter uses, so the swatches match what the U1 actually prints.

type Base = { label: string; hex: string };
const CMYK = [
  { key: "cyan", hex: "#29ABE2" },
  { key: "magenta", hex: "#ED1E79" },
  { key: "yellow", hex: "#FCEE21" },
  { key: "black", hex: "#111111" },
] as const;

const RATIOS = [15, 30, 45, 60, 75, 90]; // % of the second filament
const toRgb = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
};
const toHex = (r: [number, number, number]) => "#" + r.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");

function Swatch({ hex, recipe }: { hex: string; recipe: string }) {
  const t = useTranslations("mixer");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(hex); setCopied(true); setTimeout(() => setCopied(false), 900); } catch {}
      }}
      title={t("swatchTitle", { recipe, hex })}
      aria-label={t("swatchTitle", { recipe, hex })}
      className="group relative h-12 w-full rounded-lg ring-1 ring-inset ring-line"
      style={{ background: hex }}
    >
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-md bg-black/50 px-1 text-xs leading-5 text-white opacity-0 transition group-hover:opacity-100">
        {copied ? t("copied") : hex}
      </span>
    </button>
  );
}

export default function MixerPage() {
  const t = useTranslations("mixer");
  const defaults = (): Base[] => CMYK.map((c) => ({ label: t(c.key), hex: c.hex }));
  const [bases, setBases] = useState<Base[]>(defaults);

  const setBase = (i: number, patch: Partial<Base>) =>
    setBases((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Every unordered pair of the 4 filaments, blended across the ratio steps.
  const rows = useMemo(() => {
    const out: { a: Base; b: Base; steps: { hex: string; recipe: string }[] }[] = [];
    for (let i = 0; i < bases.length; i++)
      for (let j = i + 1; j < bases.length; j++) {
        const a = bases[i], b = bases[j];
        const steps = RATIOS.map((pct) => {
          const hex = toHex(mixRgb(toRgb(a.hex), toRgb(b.hex), pct / 100));
          return { hex, recipe: t("blend", { pa: 100 - pct, a: a.label, pb: pct, b: b.label }) };
        });
        out.push({ a, b, steps });
      }
    return out;
  }, [bases, t]);

  return (
    <main className="page-read py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">{t("intro")}</p>

      {/* Base filaments */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {bases.map((b, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t("colorLabel", { n: i + 1 })}
                value={b.hex}
                onChange={(e) => setBase(i, { hex: e.target.value.toUpperCase() })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-line bg-transparent"
              />
              <input
                aria-label={t("nameLabel", { n: i + 1 })}
                value={b.label}
                onChange={(e) => setBase(i, { label: e.target.value })}
                className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
            </div>
            <p className="mt-1 text-center text-xs text-fg-subtle">{b.hex}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => setBases(defaults())} className="rounded-lg border border-line px-3 py-1 text-xs text-fg-muted hover:bg-surface-3">{t("reset")}</button>
      </div>

      {/* Blends */}
      {/* The swatch ramps are the page; they get the wider canvas, the copy above keeps the measure. */}
      <div className="page-breakout mt-8 space-y-4">
        {rows.map((r, i) => (
          <div key={i}>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">
              {r.a.label} <span className="text-fg-subtle">↔</span> {r.b.label}
            </p>
            <div className="grid grid-cols-8 gap-1.5">
              <Swatch hex={r.a.hex} recipe={t("pure", { name: r.a.label })} />
              {r.steps.map((s, k) => <Swatch key={k} hex={s.hex} recipe={s.recipe} />)}
              <Swatch hex={r.b.hex} recipe={t("pure", { name: r.b.label })} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-fg-subtle">{t("note")}</p>
    </main>
  );
}
