"use client";

import { useMemo, useState } from "react";
import { mixRgb } from "@/lib/filament-mixer";

// "What can my 4 filaments mix?" — a Full Spectrum gamut preview. Enter your 4 loaded filaments
// (defaults to CMYK) and see every 2-filament blend, with the recipe on hover. Uses the same pigment
// mixer the converter uses, so the swatches match what the U1 actually prints.

type Base = { label: string; hex: string };
const DEFAULT_CMYK: Base[] = [
  { label: "Cyan", hex: "#29ABE2" },
  { label: "Magenta", hex: "#ED1E79" },
  { label: "Yellow", hex: "#FCEE21" },
  { label: "Black", hex: "#111111" },
];

const RATIOS = [15, 30, 45, 60, 75, 90]; // % of the second filament
const toRgb = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
};
const toHex = (r: [number, number, number]) => "#" + r.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");

function Swatch({ hex, recipe }: { hex: string; recipe: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(hex); setCopied(true); setTimeout(() => setCopied(false), 900); } catch {}
      }}
      title={`${recipe} · ${hex} (click to copy)`}
      className="group relative h-12 w-full rounded-md ring-1 ring-inset ring-line"
      style={{ background: hex }}
    >
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-md bg-black/50 px-1 text-[9px] leading-4 text-white opacity-0 transition group-hover:opacity-100">
        {copied ? "copied!" : hex}
      </span>
    </button>
  );
}

export default function MixerPage() {
  const [bases, setBases] = useState<Base[]>(DEFAULT_CMYK);

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
          return { hex, recipe: `${100 - pct}% ${a.label} + ${pct}% ${b.label}` };
        });
        out.push({ a, b, steps });
      }
    return out;
  }, [bases]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">Full Spectrum color mixer</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">
        See what colors your 4 loaded filaments can make on the Snapmaker U1. Set your filaments below
        (defaults to CMYK) — every blend is computed with the same pigment mixer the converter uses.
        Hover a swatch for its recipe; click to copy the hex.
      </p>

      {/* Base filaments */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {bases.map((b, i) => (
          <div key={i} className="rounded-md border border-line bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={b.hex}
                onChange={(e) => setBase(i, { hex: e.target.value.toUpperCase() })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-line bg-transparent"
              />
              <input
                value={b.label}
                onChange={(e) => setBase(i, { label: e.target.value })}
                className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
            </div>
            <p className="mt-1 text-center text-[11px] text-fg-subtle">{b.hex}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => setBases(DEFAULT_CMYK)} className="rounded-lg border border-line px-3 py-1 text-xs text-fg-muted hover:bg-surface-3">Reset to CMYK</button>
      </div>

      {/* Blends */}
      <div className="mt-8 space-y-4">
        {rows.map((r, i) => (
          <div key={i}>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">
              {r.a.label} <span className="text-fg-subtle">↔</span> {r.b.label}
            </p>
            <div className="grid grid-cols-8 gap-1.5">
              <Swatch hex={r.a.hex} recipe={`100% ${r.a.label}`} />
              {r.steps.map((s, k) => <Swatch key={k} hex={s.hex} recipe={s.recipe} />)}
              <Swatch hex={r.b.hex} recipe={`100% ${r.b.label}`} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-fg-subtle">
        These are 2-filament blends (the U1 dithers two colors per mixed region). Real prints vary a
        little with filament brand and lighting — treat this as a close guide, not an exact match.
      </p>
    </main>
  );
}
