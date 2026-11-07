// Every namespace a client component reads is in the list the layout sends to the browser, and the
// list holds nothing else. Run: `npm test`.
//
// "Client component" means the whole client import graph: a "use client" file AND every module it
// imports, directive or not, because those run in the browser too and their useTranslations() calls
// read the same client-side messages. A namespace missing from CLIENT_NAMESPACES does not fail the
// build; next-intl renders the raw key ("convert.dropTitle") in production. This test is the only
// thing that would notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { CLIENT_NAMESPACES, pickClientMessages } from "./client-messages.ts";

const SRC = "src";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(e) && !/\.test\./.test(e)) out.push(full);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package: not ours to scan
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every module that runs in the browser: the "use client" files and their import closure. */
function clientGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = walk(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  assert.ok(queue.length > 10, "found the client components");
  while (queue.length) {
    const f = queue.pop()!;
    const key = resolve(f);
    if (seen.has(key)) continue;
    seen.add(key);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolveImport(f, m[1] ?? m[2]);
      if (r) queue.push(r);
    }
  }
  return seen;
}

test("every namespace a client component uses is sent to the client, and nothing more", () => {
  const used = new Set<string>();
  const unreadable: string[] = [];
  for (const f of clientGraph()) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\buseTranslations\(([^)]*)\)/g)) {
      const lit = m[1].trim().match(/^["']([^"']+)["']$/);
      if (!lit) unreadable.push(`${f}: useTranslations(${m[1]})`);
      else used.add(lit[1].split(".")[0]);
    }
    if (/\buseMessages\(/.test(src)) unreadable.push(`${f}: useMessages()`);
  }
  // A non-literal namespace (or none, or useMessages) cannot be checked against the list.
  assert.deepEqual(unreadable, [], "use a literal namespace so this test can see it");
  const listed = new Set<string>(CLIENT_NAMESPACES);
  assert.deepEqual([...used].filter((n) => !listed.has(n)).sort(), [], "add these to CLIENT_NAMESPACES");
  assert.deepEqual([...listed].filter((n) => !used.has(n)).sort(), [], "no client component uses these any more");
});

test("every listed namespace exists in the catalogue", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  for (const ns of CLIENT_NAMESPACES) assert.ok(ns in en, ns);
  const picked = pickClientMessages(en);
  assert.deepEqual(Object.keys(picked).sort(), [...CLIENT_NAMESPACES].sort());
  // The point of the exercise: a fraction of the catalogue, not all of it.
  assert.ok(JSON.stringify(picked).length < JSON.stringify(en).length * 0.6);
});

test("the locale layout passes the picked messages to the provider", () => {
  const src = readFileSync("src/app/[locale]/layout.tsx", "utf8");
  assert.match(src, /pickClientMessages\(await getMessages\(\)\)/);
  assert.match(src, /<NextIntlClientProvider messages=\{messages\}>/);
});
