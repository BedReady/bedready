import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVerifiedFor, printerLabel, thumbnail, withAttribution, type VerifiedDesign } from "./verified-for-printer.ts";

const d = (slug: string, model: string | null, over: Partial<VerifiedDesign> = {}): VerifiedDesign => ({
  slug,
  title: slug,
  url: `https://makerrun.com/designs/${slug}`,
  nsfw: false,
  colorCount: 4,
  cover: { url: `https://img/${slug}.png` },
  verification: { badge: true, printer: model ? { brand: "Snapmaker", model } : null },
  ...over,
});

test("only files verified for the target machine are picked", () => {
  const got = pickVerifiedFor([d("a", "Snapmaker U1"), d("b", "MK4S"), d("c", "snapmaker u1 ")], "Snapmaker U1");
  assert.deepEqual(got.map((x) => x.slug), ["a", "c"]);
});

test("no machine, or no match, picks nothing — the strip must not render empty", () => {
  assert.deepEqual(pickVerifiedFor([d("a", "Snapmaker U1")], undefined), []);
  assert.deepEqual(pickVerifiedFor([d("a", "Snapmaker U1")], "Bambu Lab X1 Carbon"), []);
  assert.deepEqual(pickVerifiedFor([], "Snapmaker U1"), []);
});

test("unbadged, unidentified-printer and NSFW listings are never shown", () => {
  const got = pickVerifiedFor(
    [
      d("nobadge", "Snapmaker U1", { verification: { badge: false, printer: { brand: null, model: "Snapmaker U1" } } }),
      d("noprinter", null),
      d("nsfw", "Snapmaker U1", { nsfw: true }),
      d("ok", "Snapmaker U1"),
    ],
    "Snapmaker U1",
  );
  assert.deepEqual(got.map((x) => x.slug), ["ok"]);
});

test("covers first, and at most `max`", () => {
  const got = pickVerifiedFor(
    [d("bare", "Snapmaker U1", { cover: null }), d("x", "Snapmaker U1"), d("y", "Snapmaker U1"), d("z", "Snapmaker U1")],
    "Snapmaker U1",
  );
  assert.deepEqual(got.map((x) => x.slug), ["x", "y", "z"]);
});

test("links carry the attribution makerrun.com counts, and a bad URL passes through", () => {
  const u = new URL(withAttribution("https://makerrun.com/designs/a?x=1"));
  assert.equal(u.searchParams.get("utm_source"), "bedready");
  assert.equal(u.searchParams.get("utm_medium"), "converter-done");
  assert.equal(u.searchParams.get("x"), "1");
  assert.equal(withAttribution("not a url"), "not a url");
});

test("the printer is named without its nozzle, and covers are asked for at thumbnail size", () => {
  assert.equal(printerLabel("Snapmaker U1 (0.4 nozzle)"), "Snapmaker U1");
  assert.equal(printerLabel("Prusa MK4 + MMU3"), "Prusa MK4 + MMU3");
  const u = new URL(thumbnail("https://x.supabase.co/a b.png", "https://makerrun.com"));
  assert.equal(u.origin + u.pathname, "https://makerrun.com/_next/image");
  assert.equal(u.searchParams.get("url"), "https://x.supabase.co/a b.png");
  assert.equal(u.searchParams.get("w"), "320");
});
