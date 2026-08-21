"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@vercel/analytics";

// ── CLOUD PRESETS REMOVED 2026-08-21 ────────────────────────────────────────────────────────────
//
// This component used to sync presets to a `user_presets` table for signed-in users. It was the ONLY
// thing on the whole converter surface that required an account, and the converter is now free and
// anonymous by decision (`docs/SPLIT-DECISION-2026-08.md`) — so it is gone, and with it the last
// reason for the converter to hold a Supabase client.
//
// The localStorage path below is not new code written to replace it: it is the path anonymous
// visitors have always taken, now the only one. Removing the cloud branch deleted code rather than
// adding any.
//
// **Presets already in the cloud are not migrated and are not readable from here any more.** Reading
// them would need the Supabase client this change exists to remove. The cost was measured before
// deciding: `preset_saved` fired for ONE visitor in the 2026-08-14 → 08-21 window, and its `cloud`
// property is why we could tell. That property is removed below — it now has one possible value.
//
// A converter "preset" is the reusable *settings* — target printer, profile mode and the Full Spectrum /
// swap toggles — NOT anything file-specific (palette, slot assignment). Saved to localStorage so repeat
// converters (designers exporting to several printers, makers tuning colors) don't re-pick every time.
export type ConvertSettings = {
  targetId: string;
  profileMode: "preserve" | "stamp";
  fullSpectrum: boolean;
  customFS: boolean;
  customBases: string[];
  subdivide: boolean;
  swapPauses: boolean;
  bandSwap: boolean;
  keepVlhTower: boolean;
  mixedLayerHeight: number;
  // Optional: presets saved before the >4 pass-through existed have no such key, and must keep loading.
  keepAllColours?: boolean;
  // Likewise — an older preset has no brand and loads as "source", which is what it did at the time.
  filamentBrand?: "source" | "generic" | "snapmaker";
};

type Preset = { name: string; settings: ConvertSettings };

const KEY = "bedready.convert.presets.v1";

function load(): Preset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.name === "string" && p.settings) : [];
  } catch {
    return [];
  }
}

export default function ConvertPresets({
  current,
  onApply,
}: {
  current: ConvertSettings;
  onApply: (s: ConvertSettings) => void;
}) {
  const t = useTranslations("convert");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ready, setReady] = useState(false); // avoid a hydration mismatch — localStorage is client-only
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    setPresets(load());
    setReady(true);
  }, []);

  const persist = (next: Preset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — presets just won't persist */
    }
  };

  const save = () => {
    const name = window.prompt(t("presetsPrompt"))?.trim();
    if (!name) return;
    // Replace a same-named preset rather than duplicating.
    persist([...presets.filter((p) => p.name !== name), { name, settings: current }]);
    setApplied(name);
    track("preset_saved", { target: current.targetId, fullSpectrum: current.fullSpectrum });
  };

  const apply = (p: Preset) => {
    onApply(p.settings);
    setApplied(p.name);
    track("preset_applied", { target: p.settings.targetId });
  };

  const remove = (name: string) => {
    persist(presets.filter((p) => p.name !== name));
    if (applied === name) setApplied(null);
  };

  if (!ready) return null;

  return (
    <div className="mt-6 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{t("presetsLabel")}</span>
        {presets.length === 0 && (
          <span className="text-xs text-fg-subtle">{t("presetsEmpty")}</span>
        )}
        {presets.map((p) => (
          <span
            key={p.name}
            className={`inline-flex items-center gap-1 rounded-full border px-1 py-0.5 text-xs transition ${
              applied === p.name
                ? "border-violet-400/50 bg-violet-400/15 text-fg"
                : "border-line bg-surface text-fg-muted hover:bg-surface-3"
            }`}
          >
            <button onClick={() => apply(p)} className="rounded-full px-2 py-0.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40" title={t("presetsApply", { name: p.name })}>
              {p.name}
            </button>
            <button
              onClick={() => remove(p.name)}
              aria-label={t("presetsDelete", { name: p.name })}
              className="rounded-full px-1 text-fg-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
            >
              &times;
            </button>
          </span>
        ))}
        <button
          onClick={save}
          className="ms-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
        >
          {t("presetsSave")}
        </button>
      </div>
    </div>
  );
}
