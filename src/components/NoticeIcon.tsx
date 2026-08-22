/**
 * The glyph that opens a `.notice`, and the reason the three notice styles are distinguishable
 * without colour.
 *
 * Colour alone is not a signal — a reader with a colour-vision deficiency, or one glancing at a
 * stack of notices, gets the same box three times. The shape is what carries the meaning; the tint
 * only reinforces it. WCAG 1.4.1 says the same thing in fewer words.
 *
 * Three, and only three: something to know, something to be careful of, something that came out
 * fine. The converter had been writing all of them as one blue box.
 */
export default function NoticeIcon({ level }: { level: "info" | "warn" | "ok" }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (level === "warn") {
    return (
      <svg {...common}>
        <path d="M8 2.6 14.4 13.4H1.6L8 2.6Z" />
        <path d="M8 6.6v3" />
        <path d="M8 11.6h.01" />
      </svg>
    );
  }
  if (level === "ok") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" />
        <path d="m5.4 8.2 1.9 1.9 3.4-3.9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v3.6" />
      <path d="M8 5.1h.01" />
    </svg>
  );
}
