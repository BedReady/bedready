"use client";

/**
 * "What left this page" — the converter's privacy claim, made checkable on the page itself.
 *
 * The recorder (`@/lib/egress`) starts the moment this module is evaluated in the browser, which on
 * /convert is before the page hydrates: the page imports this file, so its chunk runs first. That is
 * as early as is safe — earlier would mean an inline script on every route, and the log is only
 * meant for this one. `EgressRecorder` (mounted by the /convert layout) stops it when the visitor
 * navigates away and restarts it when they come back, so other pages run on the untouched globals.
 *
 * The panel is a native `<details>`: closed by default, keyboard-operable for free, and its text is
 * still found by the browser's find-in-page. The summary carries the one figure that matters —
 * file bytes sent — so a sceptic reads the answer without opening anything. No live region: a
 * request list that updates on every analytics ping would be noise to a screen reader, and the
 * figure is read whenever focus reaches the summary.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  installEgressLog,
  uninstallEgressLog,
  getEntries,
  getServerEntries,
  subscribe,
  summarize,
  CHOSEN_UPLOAD_KINDS,
  FILE_BYTES_THRESHOLD,
  type EgressEntry,
  type EgressKind,
} from "@/lib/egress";
import NoticeIcon from "@/components/NoticeIcon";

installEgressLog();

/** Keeps the recorder running while /convert is mounted, and only then. Renders nothing. */
export function EgressRecorder() {
  useEffect(() => {
    installEgressLog();
    return () => uninstallEgressLog();
  }, []);
  return null;
}

/** Kinds shown as one row with a count, because each is many small downloads of the same sort. */
const GROUPED: readonly EgressKind[] = ["pageCode", "image"];

type Row = { key: string; kind: EgressKind; method: string; label: string; count: number; bytes: number | null; via: string; paths: string[] };

function rowsOf(entries: readonly EgressEntry[], here: string): Row[] {
  const rows = new Map<string, Row>();
  for (const e of entries) {
    const shown = e.origin === here ? e.path : e.url;
    const key = GROUPED.includes(e.kind) ? e.kind : `${e.kind} ${e.method} ${e.url}`;
    const r = rows.get(key);
    if (!r) {
      rows.set(key, { key, kind: e.kind, method: e.method, label: shown, count: 1, bytes: e.bodyBytes, via: e.via, paths: [shown] });
      continue;
    }
    r.count++;
    r.bytes = r.bytes === null || e.bodyBytes === null ? null : r.bytes + e.bodyBytes;
    if (!r.paths.includes(shown)) r.paths.push(shown);
    if (!r.via.split(", ").includes(e.via)) r.via += `, ${e.via}`;
  }
  return [...rows.values()];
}

export default function EgressPanel({ className = "" }: { className?: string }) {
  const t = useTranslations("egress");
  const format = useFormatter();
  const entries = useSyncExternalStore(subscribe, getEntries, getServerEntries);
  const here = typeof location === "undefined" ? "" : location.origin;
  const sum = useMemo(() => summarize(entries), [entries]);
  const rows = useMemo(() => rowsOf(entries, here), [entries, here]);

  const size = (n: number | null): string => {
    if (n === null) return t("sizeUnknown");
    // Bytes get their own message: Intl's short "byte" reads "0 byte" in English, and "0 B" is the
    // figure this panel exists to show. Larger sizes use 1024, as the file card on the done screen does.
    if (n < 1024) return t("bytes", { n: format.number(n) });
    const [v, unit] = n >= 1024 * 1024 ? [n / (1024 * 1024), "megabyte"] : [n / 1024, "kilobyte"];
    return format.number(v, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: v < 10 ? 1 : 0 });
  };

  return (
    <details className={`rounded-lg border border-line bg-surface-2 p-5 ${className}`} data-egress-panel>
      <summary className="cursor-pointer text-sm font-semibold text-fg">
        {t("title")}{" "}
        <span className="font-normal text-fg-muted" data-egress-file-bytes={sum.fileBytes}>
          {t("fileBytes", { size: size(sum.fileBytes) })}
        </span>
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {t("intro", { threshold: size(FILE_BYTES_THRESHOLD) })}
      </p>

      {sum.chosen.length > 0 && (
        <p className="notice notice-info mt-3">
          <NoticeIcon level="info" />
          <span>
            {t("chosenUpload", {
              size: size(sum.chosen.reduce((n, e) => n + (e.bodyBytes ?? 0), 0)),
              what: [...new Set(sum.chosen.map((e) => t(`kind.${e.kind}.label`)))].join(", "),
            })}
          </span>
        </p>
      )}
      {sum.unexpected.length > 0 && (
        <p className="notice notice-warn mt-3">
          <NoticeIcon level="warn" />
          <span>{t("unexpectedUpload", { size: size(sum.unexpected.reduce((n, e) => n + (e.bodyBytes ?? 0), 0)) })}</span>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-fg-subtle">{t("empty")}</p>
      ) : (
        <ul className="mt-3">
          {rows.map((r) => {
            const upload = (r.bytes ?? 0) > FILE_BYTES_THRESHOLD;
            const chosen = CHOSEN_UPLOAD_KINDS.includes(r.kind);
            const grouped = GROUPED.includes(r.kind);
            return (
              <li key={r.key} className="border-t border-line py-2.5" data-egress-kind={r.kind} data-egress-bytes={r.bytes ?? ""}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-all font-mono text-xs text-fg" dir="ltr">
                    {grouped ? t("groupedRow", { count: r.count }) : <>{r.method} {r.label}</>}
                    {!grouped && r.count > 1 && <span className="text-fg-subtle"> ×{r.count}</span>}
                  </span>
                  <span className={`shrink-0 text-xs tabular-nums ${upload ? "font-semibold text-fg" : "text-fg-subtle"}`}>
                    {t("sent", { size: size(r.bytes) })}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  <span className="font-medium text-fg">{t(`kind.${r.kind}.label`)}</span>
                  {upload && <> · <span className="font-semibold text-fg">{chosen ? t("chosenTag") : t("unexpectedTag")}</span></>}
                  {" — "}
                  {t(`kind.${r.kind}.why`)}{" "}
                  <span className="font-mono text-fg-subtle" dir="ltr">({r.via})</span>
                </p>
                {grouped && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-fg-subtle">{t("showAddresses")}</summary>
                    <ul className="mt-1 space-y-0.5 font-mono text-xs text-fg-subtle" dir="ltr">
                      {r.paths.map((p) => (
                        <li key={p} className="break-all">{p}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sum.unknownBodies > 0 && <p className="mt-2 text-xs text-fg-subtle">{t("unknownNote")}</p>}
      <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{t("howFootnote")}</p>
    </details>
  );
}
