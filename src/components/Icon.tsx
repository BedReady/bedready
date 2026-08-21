/**
 * The site's icon set — one file, named paths, no dependency.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────────
 * The UI used emoji as its icon set: 🔔 for notifications, ❤ for likes, 🖨 for makers, 🔒 for the
 * privacy claim, 📷 for a confirmed print. Emoji-presentation codepoints render as full-colour
 * system glyphs — a different drawing on macOS, Windows and Android, at a size and weight the
 * surrounding type does not control. On a site that now has a chosen typeface they were the loudest
 * thing on most pages, and they were the single clearest "made by one person, quickly" signal left.
 *
 * These are 24×24 stroked paths inheriting `currentColor`, so an icon always takes the colour of the
 * text it sits with — which matters because several of them carry meaning through colour (rose for
 * likes, emerald for a confirmed print, amber for a warning).
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────────────────────────
 * `✓ ✗ × → ← ↑ ↓ ☆ ★` stay as characters. They are text-presentation codepoints: they render
 * monochrome, in the page font, at the text size, on every platform — which is the whole property
 * emoji lack. Replacing them with SVG would add markup and change nothing a reader can see.
 *
 * And the emote picker keeps its emoji, obviously: there the emoji IS the content.
 */

export type IconName =
  | "download"
  | "heart"
  | "heartFilled"
  | "printer"
  | "camera"
  | "bell"
  | "bookmark"
  | "lock"
  | "palette"
  | "user"
  | "image"
  | "chart"
  | "comment"
  | "edit"
  | "link"
  | "quote"
  | "settings"
  | "sparkle"
  | "spool"
  | "thermometer"
  | "warning"
  | "check"
  | "pin"
  | "paperclip"
  | "menu";

/** Stroked outlines unless the name says otherwise; `heartFilled` is the only filled path. */
const PATHS: Record<IconName, string> = {
  download: "M12 3v11m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  heart: "M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z",
  heartFilled: "M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z",
  printer: "M7 9V4h10v5M7 19H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 15h10v6H7z",
  camera: "M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  bell: "M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6M13.7 21a2 2 0 01-3.4 0",
  bookmark: "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z",
  lock: "M6 11V8a6 6 0 1112 0v3M5 11h14a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1z",
  palette: "M12 21a9 9 0 110-18c4.97 0 9 3.58 9 8 0 2.21-1.79 4-4 4h-2a2 2 0 00-1.5 3.3A2 2 0 0112 21zM7.5 10.5h.01M10.5 7h.01M14.5 7h.01M17 10.5h.01",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  image: "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM3 16l5-5 4 4 3-3 6 6M9 9h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  comment: "M21 12a8 8 0 01-8 8H8l-5 3 1.5-4.5A8 8 0 1121 12z",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z",
  link: "M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7",
  quote: "M9 11H5a1 1 0 01-1-1V7a3 3 0 013-3h1M19 11h-4a1 1 0 01-1-1V7a3 3 0 013-3h1M4 11c0 5 2 8 5 9M14 11c0 5 2 8 5 9",
  settings: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 006 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H2a2 2 0 110-4h.1A1.7 1.7 0 003.3 6l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V2a2 2 0 114 0v.1A1.7 1.7 0 0018 3.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z",
  spool: "M7 4h10v16H7zM7 8h10M7 16h10M10 4v16M14 4v16",
  thermometer: "M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z",
  warning: "M12 4l9 16H3l9-16zM12 10v4M12 17h.01",
  check: "M20 6L9 17l-5-5",
  pin: "M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z",
  paperclip: "M21 11.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3",
  menu: "M4 7h16M4 12h16M4 17h16",
};

/**
 * `size` is in px and defaults to 14 — the size that sits correctly beside 12–14px text, which is
 * where nearly every one of these appears. `title` gives the icon an accessible name; without it the
 * icon is hidden from assistive tech, which is right whenever a visible label sits next to it.
 */
export default function Icon({
  name,
  size = 14,
  className = "",
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  const filled = name === "heartFilled";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
