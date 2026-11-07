"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@vercel/analytics";
import { acquisitionProps } from "@/lib/acquisition";
import { convertApi } from "@/lib/convert-api";
import { LIBRARY_ORIGIN } from "@/lib/origin";
import { designsLookupQuery, parseModelSource, requestProfileUrl, type ModelSource } from "@/lib/model-source";
import { printerLabel, withAttribution, type VerifiedDesign } from "@/lib/verified-for-printer";
import ContributeToLibrary from "@/components/ContributeToLibrary";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; designs: VerifiedDesign[]; source: ModelSource }
  | { kind: "none"; source: ModelSource }
  | { kind: "invalid" }
  | { kind: "unavailable" };

/**
 * "Find a verified profile" — the done screen's library ask since Nov 7 2026, replacing "Save to my
 * library" (agreed with MakerRun).
 *
 * Most files converted here are somebody else's MakerWorld model. Asking every visitor to re-upload
 * one into a library is asking them to redistribute a design that isn't theirs. The useful question
 * is the other way round: has anyone already checked a profile for THIS model? MakerRun answers it
 * (GET /api/v1/designs?source=<model URL>&verified=true): a listing → link to it; none → "Request
 * one" (/requests/new). Uploading stays, behind "I designed this model", for the one person who may.
 *
 * The model link arrives from the extension (`?src=`, its model page) or is pasted. Only model pages
 * on MakerWorld, Printables and Thingiverse are accepted (model-source.ts), and the lookup goes
 * through convertApi() like every other request this site makes. A 503 means the lookup itself is
 * down, which is NOT "no listing", so it says so instead of offering a request.
 */
export default function VerifiedProfileFinder({ initialSource, printerName, printerBrand }: { initialSource: string | null; printerName: string; printerBrand?: string }) {
  const t = useTranslations("convert");
  const [input, setInput] = useState(initialSource ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [designer, setDesigner] = useState(false);

  async function lookup(raw: string) {
    const source = parseModelSource(raw);
    if (!source) return setState({ kind: "invalid" });
    setState({ kind: "loading" });
    try {
      const res = await fetch(`${convertApi("/api/v1/designs")}${designsLookupQuery(source)}`);
      if (res.status === 400) return setState({ kind: "invalid" });
      if (!res.ok) return setState({ kind: "unavailable" });
      const body = (await res.json()) as { designs?: VerifiedDesign[] };
      const designs = (body.designs ?? []).filter((d) => !d.nsfw).slice(0, 3);
      setState(designs.length ? { kind: "found", designs, source } : { kind: "none", source });
      track("verified_lookup", { ...acquisitionProps(), site: source.site, found: designs.length > 0 });
    } catch {
      setState({ kind: "unavailable" });
    }
  }

  // Arrived with the model page from the extension: look it up straight away.
  useEffect(() => {
    if (initialSource && parseModelSource(initialSource)) void lookup(initialSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the source we arrived with
  }, [initialSource]);

  return (
    <div className="mt-3 rounded-lg border border-line px-5 py-4">
      <p className="text-sm font-medium text-fg">{t("vpTitle")}</p>
      <p className="mt-1 text-xs text-fg-muted">{t("vpBody", { printer: printerLabel(printerName) })}</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(input);
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://makerworld.com/en/models/…"
          aria-label={t("vpInputLabel")}
          dir="ltr"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
        />
        <button type="submit" disabled={state.kind === "loading"} className="btn-secondary btn-sm">
          {state.kind === "loading" ? t("vpLooking") : t("vpFind")}
        </button>
      </form>

      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === "found" && (
          <>
            <p className="text-xs text-fg-muted">{t("vpFound")}</p>
            <ul className="mt-1 space-y-1">
              {state.designs.map((d) => (
                <li key={d.slug}>
                  <a href={withAttribution(d.url)} target="_blank" rel="noopener" className="font-medium text-violet-300 hover:underline">
                    {d.title}
                  </a>
                  {d.verification?.printer?.model && <span className="text-xs text-fg-subtle"> · {d.verification.printer.model}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {state.kind === "none" && (
          <p className="text-fg-muted">
            {t("vpNone")}{" "}
            <a
              href={requestProfileUrl(LIBRARY_ORIGIN, state.source, printerBrand)}
              target="_blank"
              rel="noopener"
              onClick={() => track("verified_request", { ...acquisitionProps(), site: state.source.site })}
              className="font-medium text-violet-300 hover:underline"
            >
              {t("vpRequest")}
            </a>
          </p>
        )}
        {state.kind === "invalid" && <p className="text-amber-200">{t("vpInvalid")}</p>}
        {state.kind === "unavailable" && <p className="text-fg-muted">{t("vpUnavailable")}</p>}
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
        <input type="checkbox" checked={designer} onChange={(e) => setDesigner(e.target.checked)} className="h-4 w-4 rounded border-line" />
        {t("vpDesigner")}
      </label>
      {designer && <ContributeToLibrary />}
    </div>
  );
}
