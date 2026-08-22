"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

// Localized error boundary for the locale segment. Catches render/runtime errors and offers a retry.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("error");

  useEffect(() => {
    console.error(error);
    // Report to our lightweight sink (Vercel logs + optional admin alert). Best-effort, never throws.
    try {
      navigator.sendBeacon?.(
        "/api/client-error",
        JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, url: location.href }),
      );
    } catch {
      /* ignore */
    }
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-2 text-fg-muted">{t("body")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="btn-primary btn-md"
        >
          {t("retry")}
        </button>
        <a
          href="/"
          className="rounded-lg border border-line bg-surface-2 px-5 py-2.5 font-semibold text-fg transition hover:bg-surface-3"
        >
          {t("home")}
        </a>
      </div>
    </main>
  );
}
