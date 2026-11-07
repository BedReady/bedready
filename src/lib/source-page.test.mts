// The `src=` the extension hands bedready.io/convert: a model page on the three sites, nothing else.
// Run: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourcePage } from "./source-page.ts";
import { editorUrl } from "../../extension/src/handoff.ts";

test("model pages pass, with the query and hash stripped", () => {
  assert.equal(sourcePage("https://makerworld.com/en/models/1092486-benchy?from=search#comments"), "https://makerworld.com/en/models/1092486-benchy");
  assert.equal(sourcePage("https://makerworld.com/models/123456"), "https://makerworld.com/models/123456");
  assert.equal(sourcePage("https://makerworld.com.cn/zh/models/77-x"), "https://makerworld.com.cn/zh/models/77-x");
  assert.equal(sourcePage("https://www.printables.com/model/123456-benchy/files?lang=de"), "https://www.printables.com/model/123456-benchy/files");
  assert.equal(sourcePage("https://www.printables.com/de/model/9-x"), "https://www.printables.com/de/model/9-x");
  assert.equal(sourcePage("https://www.thingiverse.com/thing:763622/files#x"), "https://www.thingiverse.com/thing:763622/files");
});

test("MakerWorld keeps #profileId-<id>, and only that hash", () => {
  assert.equal(sourcePage("https://makerworld.com/en/models/1-a?x=1#profileId-42"), "https://makerworld.com/en/models/1-a#profileId-42");
  assert.equal(sourcePage("https://makerworld.com/en/models/1-a#profileId-42x"), "https://makerworld.com/en/models/1-a");
  assert.equal(sourcePage("https://www.printables.com/model/5-a#profileId-42"), "https://www.printables.com/model/5-a");
});

test("anything else is refused", () => {
  for (const u of [
    undefined, null, "", "not a url", "javascript:alert(1)",
    "http://makerworld.com/en/models/1", // not https
    "https://makerworld.com/", // the site, not a model (a MakerWorld download's usual referrer)
    "https://makerworld.com/en/search/models?keyword=benchy",
    "https://makerworld.com/en/@someone",
    "https://public-cdn.bblmw.com/makerworld/model/Benchy.3mf?sig=x",
    "https://makerworld.com.evil.com/en/models/1",
    "https://evilmakerworld.com/en/models/1",
    "https://user:pw@makerworld.com/en/models/1",
    "https://makerworld.com:8443/en/models/1",
    "https://www.printables.com/search/models?q=x",
    "https://files.printables.com/media/prints/1/x.3mf",
    "https://www.thingiverse.com/search?q=x",
    "https://cdn.thingiverse.com/assets/x.3mf",
    "https://bedready.io/convert",
    "https://makerworld.com/en/models/1" + "a".repeat(3000),
  ]) assert.equal(sourcePage(u as string), null, String(u));
});

test("the editor link carries src only through that filter", () => {
  const api = { runtime: { id: "abc", getManifest: () => ({ externally_connectable: {} }) } };
  const withSrc = new URL(editorUrl(api, "u1", true, "https://makerworld.com/en/models/1-a?x=1#profileId-42"));
  assert.equal(withSrc.searchParams.get("src"), "https://makerworld.com/en/models/1-a#profileId-42");
  assert.equal(withSrc.searchParams.get("ext"), "abc");
  assert.equal(new URL(editorUrl(api, "u1", true, "https://example.com/x")).searchParams.has("src"), false);
  assert.equal(new URL(editorUrl(api, "u1", false)).searchParams.has("src"), false);
});
