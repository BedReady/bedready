#!/usr/bin/env node
// Every user-visible pull request adds a line to src/lib/whats-new.ts (the /changes page).
//
// Turki, 2026-11-26: "make sure the website keeps track of changes for users". A changelog nobody is
// made to update stops being true within a week, so CI asks. The check is deliberately blunt:
//
//   - A PR that touches what users run (pages, components, the converter engine, the extension,
//     the translations) must also change src/lib/whats-new.ts.
//   - A PR whose change users would not notice (a refactor, a test, a CI tweak that happens to touch
//     src/) says so with a line "What's new: none" in its description, and passes.
//   - Bots (Dependabot) are skipped. Their PRs have no description to write.
//
// Run in CI on pull_request:  node scripts/check-whats-new.mjs
// It reads GITHUB_BASE_REF and GITHUB_EVENT_PATH; locally pass a base: node scripts/check-whats-new.mjs main
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const DATA_FILE = "src/lib/whats-new.ts";

/** Paths whose changes users can see or feel. Tests, scripts, docs and CI are not in it. */
export function isUserVisible(path) {
  if (/\.test\.m?[jt]sx?$/.test(path) || path.includes("/__tests__/")) return false;
  if (path === DATA_FILE) return false;
  return (
    /^src\/(app|components|lib|i18n)\//.test(path) ||
    /^extension\/(src\/|_locales\/|manifest(\.firefox)?\.json$|popup\.html$)/.test(path) ||
    /^messages\/[^/]+\.json$/.test(path)
  );
}

/** "What's new: none" (any case, straight or curly apostrophe) on a line of its own. */
export function optedOut(body) {
  return /^\s*what[’']s new:\s*none\b/im.test(body ?? "");
}

/**
 * The verdict for a PR: ok, or a message saying what to do.
 * @param {{ files: string[], body?: string, author?: string }} pr
 */
export function verdict({ files, body, author }) {
  if (author && /\[bot\]$|^dependabot/i.test(author)) return { ok: true, why: "bot" };
  const visible = files.filter(isUserVisible);
  if (visible.length === 0) return { ok: true, why: "nothing user-visible" };
  if (files.includes(DATA_FILE)) return { ok: true, why: "entry added" };
  if (optedOut(body)) return { ok: true, why: "opted out" };
  return {
    ok: false,
    why:
      `This PR changes ${visible.length} user-visible file(s) (${visible.slice(0, 5).join(", ")}${visible.length > 5 ? ", …" : ""}) ` +
      `but adds nothing to ${DATA_FILE}.\n` +
      `Add a line at the top of WHATS_NEW saying what changed for users (see the rules at the top of that file),\n` +
      `or, if users will not notice this change, put a line "What's new: none" in the PR description.`,
  };
}

function main() {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const pr = event.pull_request;
  const base = process.argv[2] || process.env.GITHUB_BASE_REF || "main";
  const ref = `origin/${base}`;
  try {
    execFileSync("git", ["fetch", "--no-tags", "--depth=200", "origin", base], { stdio: "ignore" });
  } catch {
    /* a local run may already have it */
  }
  const files = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  const v = verdict({ files, body: pr?.body ?? process.env.PR_BODY ?? "", author: pr?.user?.login });
  if (v.ok) {
    console.log(`What's new: ok (${v.why})`);
    return;
  }
  console.error(`::error title=What's new entry missing::${v.why.replace(/\n/g, "%0A")}`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
