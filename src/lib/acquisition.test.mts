// First-touch attribution. The assertions that matter are the ones that stop a channel being
// misattributed, because a wrong label is worse than no label: it makes a working channel look dead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAcquisition, referrerHost } from "./acquisition.ts";

const derive = (qs: string, ref: string, path = "/convert") =>
  deriveAcquisition(new URLSearchParams(qs), ref, "bedready.io", path, 1000);

test("an internal referrer is not a channel", () => {
  // Without this the second page of every visit overwrites the real source with bedready.io, and
  // every arrival on earth looks direct.
  assert.equal(referrerHost("https://bedready.io/convert", "bedready.io"), null);
  assert.equal(referrerHost("https://www.bedready.io/x", "bedready.io"), null);
  assert.equal(derive("", "https://bedready.io/designs").src, "direct");
});

test("the referring host is kept and the path is not", () => {
  // A path can be private — a closed Discord, a company wiki, a password-protected thread. The host
  // is the whole of what "which channel" means.
  assert.equal(referrerHost("https://www.reddit.com/r/snapmaker/comments/abc/secret", "bedready.io"), "reddit.com");
  assert.equal(derive("", "https://forum.snapmaker.com/t/thread/9").src, "forum.snapmaker.com");
});

test("utm_source beats the referrer, because it was chosen deliberately", () => {
  const a = derive("utm_source=newsletter&utm_medium=email&utm_campaign=launch", "https://mail.google.com/x");
  assert.equal(a.src, "newsletter");
  assert.equal(a.medium, "email");
  assert.equal(a.campaign, "launch");
});

test("a missing or junk referrer resolves to direct rather than throwing", () => {
  assert.equal(derive("", "").src, "direct");
  assert.equal(derive("", "not a url").src, "direct");
  assert.equal(referrerHost("", "bedready.io"), null);
});

test("utm values are bounded, so a long query cannot wreck the reports", () => {
  const a = derive(`utm_source=${"x".repeat(200)}`, "");
  assert.equal(a.src.length, 40);
});

test("the landing path is recorded, since it says which page does the work", () => {
  assert.equal(derive("", "https://reddit.com/x", "/makerworld-to-snapmaker-u1").landing, "/makerworld-to-snapmaker-u1");
});

test("www is normalised so one channel is not reported as two", () => {
  assert.equal(referrerHost("https://www.reddit.com/x", "bedready.io"), "reddit.com");
  assert.equal(referrerHost("https://reddit.com/x", "bedready.io"), "reddit.com");
});

test("an empty utm_source falls through to the referrer instead of blanking it", () => {
  // `?utm_source=` is what a badly built link produces, and treating "" as a deliberate choice would
  // throw away the one signal actually present.
  assert.equal(derive("utm_source=", "https://reddit.com/x").src, "reddit.com");
});
