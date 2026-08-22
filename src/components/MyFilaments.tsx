"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { type Filament, loadFilaments, saveFilaments, newId, normHex, assignFilaments } from "@/lib/my-filaments";

// A compact inventory of the spools you own, shown inside the Full Spectrum picker. "Load onto the heads"
// sets each physical head to the closest filament you actually have — so Full Spectrum mixes from real
// colours, not the model's. Inventory persists in localStorage (no account needed). Self-contained: it
// only reads the current head targets and reports back the picked hexes via onApply.

const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PLA-CF", "Other"];
// A sane ceiling on a hand-maintained list — also stops a runaway loop filling localStorage.
const MAX_FILAMENTS = 60;

export default function MyFilaments({
  targets,
  onApply,
}: {
  targets: { index: number; hex: string }[]; // the palette indices currently loaded on the 4 heads + their hex
  onApply: (picks: Record<number, string>) => void; // paletteIndex -> chosen filament hex
}) {
  const t = useTranslations("convert");
  const [list, setList] = useState<Filament[]>([]);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState("#22C55E");
  const [name, setName] = useState("");
  const [material, setMaterial] = useState("PLA");
  const [applied, setApplied] = useState<{ count: number; reused: number } | null>(null);
  const [addErr, setAddErr] = useState("");

  useEffect(() => setList(loadFilaments()), []);

  function persist(next: Filament[]) {
    setList(next);
    saveFilaments(next);
    setApplied(null);
  }
  function add() {
    setAddErr("");
    const h = normHex(hex);
    if (!h) return;
    // Two entries with the same colour are indistinguishable to the matcher and would just waste a
    // head, so reject rather than silently accept a spool that can never be picked second.
    if (list.some((f) => f.hex === h)) return setAddErr(t("mfDuplicate"));
    if (list.length >= MAX_FILAMENTS) return setAddErr(t("mfFull", { max: MAX_FILAMENTS }));
    persist([...list, { id: newId(list), name: name.trim() || h, hex: h, material }]);
    setName("");
  }
  function remove(id: string) {
    persist(list.filter((f) => f.id !== id));
  }
  function apply() {
    // assignFilaments gives each head a DISTINCT spool where the inventory allows — matching each
    // head independently would hand the same physical spool to two heads.
    const assignments = assignFilaments(targets, list);
    if (!assignments.length) return;
    const picks: Record<number, string> = {};
    for (const a of assignments) picks[a.index] = a.filament.hex;
    onApply(picks);
    setApplied({ count: assignments.length, reused: assignments.filter((a) => a.reused).length });
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-fg-muted hover:text-fg"
      >
        <span className="font-medium">
          {t("mfTitle")}{list.length ? ` (${list.length})` : ""}
        </span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-2.5">
          <p className="text-fg-subtle">{t("mfSub")}</p>

          {list.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {list.map((f) => (
                <li key={f.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-1">
                  <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: f.hex }} />
                  <span className="text-fg">{f.name}</span>
                  {f.material ? <span className="text-fg-subtle">{f.material}</span> : null}
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    aria-label={`${t("mfRemove")} ${f.name}`}
                    title={t("mfRemove")}
                    className="text-fg-subtle hover:text-red-300"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-fg-subtle">{t("mfEmpty")}</p>
          )}

          {/* Add a spool */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <input
              type="color"
              value={normHex(hex) || "#22C55E"}
              onChange={(e) => setHex(e.target.value.toUpperCase())}
              aria-label={t("mfColor")}
              title={t("mfColor")}
              className="h-8 w-9 cursor-pointer rounded border border-line bg-surface-2 p-0.5"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder={t("mfNamePlaceholder")}
              aria-label={t("mfNamePlaceholder")}
              className="min-w-[10rem] flex-1 rounded border border-line bg-surface px-2 py-1.5 text-fg placeholder:text-fg-subtle"
            />
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              aria-label={t("mfMaterial")}
              className="rounded border border-line bg-surface px-2 py-1.5 text-fg"
            >
              {MATERIALS.map((m) => (
                <option key={m} value={m} className="bg-surface">{m}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={add}
              className="rounded border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 font-medium text-violet-100 transition hover:bg-violet-500/25"
            >
              {t("mfAdd")}
            </button>
          </div>
          {addErr && <p className="mt-1.5 text-amber-200">{addErr}</p>}

          {/* Load onto the 4 heads */}
          {targets.length > 0 && list.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={apply}
                className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 font-medium text-violet-100 transition hover:bg-violet-500/25"
              >
                {t("mfApply")}
              </button>
              {applied && (
                <span className={applied.reused ? "text-amber-200" : "text-green-300"}>
                  {applied.reused
                    ? t("mfAppliedReused", { count: applied.count, reused: applied.reused })
                    : "✓ " + t("mfApplied", { count: applied.count })}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
