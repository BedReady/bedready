// The "Send to Khayt" link must match the Mac's agreed shape exactly. Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { khaytJobLink, khaytJobTitle, sha256Hex, isMacDesktop } from "./khayt-link.ts";

const HASH = "a".repeat(64);

test("the link carries name, file and sha256 and nothing else", () => {
  const link = khaytJobLink("Benchy.u1.3mf", HASH)!;
  const u = new URL(link);
  assert.equal(u.protocol, "khayt:");
  assert.equal(link.startsWith("khayt://job/new?"), true);
  assert.deepEqual([...u.searchParams.keys()], ["name", "file", "sha256"]);
  assert.equal(u.searchParams.get("name"), "Benchy");
  assert.equal(u.searchParams.get("file"), "Benchy.u1.3mf");
  assert.equal(u.searchParams.get("sha256"), HASH);
});

test("names with spaces, ampersands and Arabic survive encoding", () => {
  const u = new URL(khaytJobLink("رأس & tail #2.generic.3mf", HASH)!);
  assert.equal(u.searchParams.get("file"), "رأس & tail #2.generic.3mf");
  assert.equal(u.searchParams.get("name"), "رأس & tail #2");
});

test("refuses what the Mac would not accept", () => {
  assert.equal(khaytJobLink("a/b.3mf", HASH), null);
  assert.equal(khaytJobLink("model.zip", HASH), null);
  assert.equal(khaytJobLink("model.3mf", "ABC"), null);
  assert.equal(khaytJobLink("model.3mf", "A".repeat(64)), null); // lower-case hex only
});

test("title keeps a retarget suffix it does not know, and never comes out empty", () => {
  assert.equal(khaytJobTitle("x.prusa-mk4.3mf"), "x.prusa-mk4");
  assert.equal(khaytJobTitle(".u1.3mf"), ".u1.3mf");
});

test("sha256Hex matches node's hash", async () => {
  const bytes = new TextEncoder().encode("bedready");
  assert.equal(await sha256Hex(bytes.buffer as ArrayBuffer), createHash("sha256").update("bedready").digest("hex"));
});

test("Mac desktop only", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  assert.equal(isMacDesktop(mac, 0), true);
  assert.equal(isMacDesktop(mac, 5), false); // iPad in desktop mode
  assert.equal(isMacDesktop("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)", 5), false);
  assert.equal(isMacDesktop("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0), false);
});
