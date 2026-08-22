"use client";

// Generate a TD calibration card for one spool.
//
// Relief mode predicts colour from one constant per filament — TD, how far light gets into the
// plastic before it is blocked. Ours are generic estimates, which is why a photographic relief lands
// around ΔE 17. TD cannot be looked up: it depends on pigment load, so it differs between brands and
// between colours within a brand. It has to be measured, and this page hands you the thing that
// measures it. See src/lib/swatch-card.ts for the physics and the solver.
//
// ONE SPOOL PER CARD. The U1 changes filament by height, not by area, so every pad above the base is
// the same colour. Four spools means four prints — that is the machine, not a shortcut.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { buildSwatchCard, contrastOf, MIN_CONTRAST, type SwatchCard } from "@/lib/swatch-card";
import { download } from "@/lib/convert";

const HEX = /^#[0-9a-f]{6}$/i;

export default function CalibratePage() {
  const t = useTranslations("calibrate");
  const [backing, setBacking] = useState("#101010");
  const [test, setTest] = useState("#C21807");
  const [steps, setSteps] = useState(14);
  const [layerH, setLayerH] = useState(0.08);
  const [card, setCard] = useState<SwatchCard | null>(null);
  const [error, setError] = useState("");

  const valid = HEX.test(backing) && HEX.test(test);
  // Same backing and test colour measures nothing: with no contrast there is no signal to fit.
  const noContrast = valid && backing.toUpperCase() === test.toUpperCase();
  // Identical colours were already refused; NEAR colours were not, and near is nearly as useless —
  // a red backing under red filament produced a TD with a ±42% spread on the first real print.
  const lowContrast = valid && !noContrast && contrastOf(backing, test) < MIN_CONTRAST;

  function make() {
    setError("");
    const built = buildSwatchCard({
      steps,
      layerH,
      backingHex: backing.toUpperCase(),
      testHex: test.toUpperCase(),
      name: `td-${test.replace("#", "").toLowerCase()}`,
    });
    if (!built) {
      setError(t("errBuild"));
      return;
    }
    setCard(built);
    download(new Blob([built.bytes as BlobPart], { type: "model/3mf" }), `td-card-${test.replace("#", "").toLowerCase()}.u1.3mf`);
  }

  const swatch = (hex: string) => (HEX.test(hex) ? hex : "transparent");

  // No `id="main-content"` on the <main> below: the group layout already renders one for the skip
  // link, and two elements sharing an id is invalid HTML — the skip link then lands on whichever the
  // browser picks first, which is not a thing to leave to chance on the one control a keyboard user
  // reaches before anything else.
  return (
    <main className="page-read py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t("title")}</h1>
      <p className="mt-3 text-fg-muted">{t("intro")}</p>
      <p className="mt-2 text-sm text-fg-subtle">{t("oneSpool")}</p>

      <div className="mt-6 grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-2">
        <label className="text-xs text-fg-muted">
          {t("labelBacking")}
          <span className="mt-1 flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 rounded border border-line" style={{ background: swatch(backing) }} aria-hidden />
            <input
              value={backing}
              onChange={(e) => setBacking(e.target.value)}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-fg"
            />
          </span>
          <span className="mt-1 block text-xs text-fg-subtle">{t("backingHelp")}</span>
        </label>

        <label className="text-xs text-fg-muted">
          {t("labelTest")}
          <span className="mt-1 flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 rounded border border-line" style={{ background: swatch(test) }} aria-hidden />
            <input
              value={test}
              onChange={(e) => setTest(e.target.value)}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-fg"
            />
          </span>
          <span className="mt-1 block text-xs text-fg-subtle">{t("testHelp")}</span>
        </label>

        <label className="text-xs text-fg-muted">
          {t("labelSteps", { count: steps })}
          <input
            type="range" min={6} max={24} step={1} value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            className="mt-1 w-full accent-violet-500"
          />
        </label>

        <label className="text-xs text-fg-muted">
          {t("labelLayerH")}
          <select
            value={layerH}
            onChange={(e) => setLayerH(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          >
            {[0.06, 0.08, 0.1, 0.12, 0.16, 0.2].map((h) => (
              <option key={h} value={h} className="bg-surface">{h} mm</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-fg-subtle">{t("layerHelp")}</span>
        </label>
      </div>

      {/* A card whose two colours match cannot measure anything, so say so before the print, not after. */}
      {noContrast && <p className="mt-3 text-sm text-amber-300">{t("warnNoContrast")}</p>}
      {lowContrast && <p className="mt-3 text-sm text-amber-300">{t("warnLowContrast")}</p>}
      {!valid && <p className="mt-3 text-sm text-amber-300">{t("warnHex")}</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <button
        onClick={make}
        disabled={!valid || noContrast || lowContrast}
        className="btn-primary btn-lg mt-5"
      >
        {t("download")}
      </button>

      {card && (
        <div className="mt-5 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          <p>{t("built", {
            x: card.sizeMm.x, y: card.sizeMm.y,
            pads: card.steps.length,
            thin: (card.layerH).toFixed(2),
            thick: (card.steps[card.steps.length - 1].layers * card.layerH).toFixed(2),
          })}</p>
          <p className="mt-2 text-xs text-fg-subtle">{t("loadOrder")}</p>
        </div>
      )}

      <h2 className="mt-10 text-xl font-semibold text-fg">{t("howTitle")}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-fg-muted">
        <li>{t("how1")}</li>
        <li>{t("how2")}</li>
        <li>{t("how3")}</li>
        <li>{t("how4")}</li>
      </ol>
      <p className="mt-4 text-xs text-fg-subtle">{t("beta")}</p>
    </main>
  );
}
