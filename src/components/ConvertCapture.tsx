"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Turnstile, { turnstileActive } from "@/components/Turnstile";
import { convertApi } from "@/lib/convert-api";

// Shown only after a successful conversion (the highest-intent moment): a dismissible, opt-in offer to
// get notified when we verify new U1-ready multicolor files. It NEVER blocks the download — by the time
// this renders the file has already saved. Reuses /api/waitlist (Turnstile + rate-limit) with a
// distinct source so convert-driven signups are measurable. Remembers a dismiss/subscribe in
// localStorage so repeat converters aren't nagged every time.

type Status = "idle" | "loading" | "success" | "error";

const SEEN_KEY = "bedready:convert-capture-done"; // set once the user subscribes or dismisses

export default function ConvertCapture() {
  const t = useTranslations("convert");
  const [hidden, setHidden] = useState(true); // default hidden to avoid a flash before the localStorage check
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [captcha, setCaptcha] = useState("");

  // Only reveal after confirming the user hasn't already subscribed/dismissed (client-only; SSR-safe).
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) !== "1") setHidden(false);
    } catch {
      setHidden(false); // storage blocked (private mode) — showing once is fine
    }
  }, []);

  function remember() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function dismiss() {
    remember();
    setHidden(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (turnstileActive() && !captcha) {
      setStatus("error");
      setMessage(t("captureCaptcha"));
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch(convertApi("/api/waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: captcha, source: "convert-success" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(data?.error ?? t("captureError"));
        return;
      }
      setStatus("success");
      setMessage(t("captureSuccess"));
      setEmail("");
      remember(); // subscribed — don't ask again on later conversions
    } catch {
      setStatus("error");
      setMessage(t("captureError"));
    }
  }

  if (hidden) return null;

  if (status === "success") {
    return (
      <p role="status" aria-live="polite" className="mt-3 rounded-lg border border-violet-400/30 bg-violet-400/10 px-5 py-4 text-sm text-violet-100">
        {message}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-violet-400/30 bg-violet-400/[0.06] px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">{t("captureTitle")}</p>
          <p className="mt-1 text-xs text-fg-muted">{t("captureBody")}</p>
        </div>
        <button
          onClick={dismiss}
          aria-label={t("captureDismiss")}
          title={t("captureDismiss")}
          className="shrink-0 rounded-lg px-2 py-1 text-fg-subtle transition hover:text-fg"
        >
          &times;
        </button>
      </div>
      <form onSubmit={onSubmit} className="mt-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("capturePlaceholder")}
            aria-label={t("capturePlaceholder")}
            className="w-full flex-1 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/30"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="btn-primary btn-md"
          >
            {status === "loading" ? t("captureLoading") : t("captureButton")}
          </button>
        </div>
        <Turnstile onToken={setCaptcha} />
        {status === "error" && <p className="mt-2 text-xs text-red-300">{message}</p>}
        <p className="mt-2 text-xs text-fg-subtle">{t("captureNote")}</p>
      </form>
    </div>
  );
}
