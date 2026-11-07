import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelSource, requestProfileUrl, designsLookupQuery } from "./model-source.ts";

test("model pages on the three supported sites are accepted and reduced to what names the model", () => {
  assert.deepEqual(parseModelSource("https://makerworld.com/de/models/1234567-cute-cat?from=search#profileId-998877"), { site: "makerworld", url: "https://makerworld.com/en/models/1234567#profileId-998877" });
  assert.deepEqual(parseModelSource("https://makerworld.com/models/42"), { site: "makerworld", url: "https://makerworld.com/en/models/42" });
  assert.deepEqual(parseModelSource("https://www.printables.com/model/555-thing/files"), { site: "printables", url: "https://www.printables.com/model/555" });
  assert.deepEqual(parseModelSource("https://www.thingiverse.com/thing:9001/files"), { site: "thingiverse", url: "https://www.thingiverse.com/thing:9001" });
});

test("anything else is refused", () => {
  for (const bad of [null, "", "not a url", "http://makerworld.com/en/models/1", "https://evil.com/en/models/1", "https://makerworld.com.evil.com/en/models/1", "https://makerworld.com/en/collections/1", "javascript:alert(1)", "https://cults3d.com/en/3d-model/x"]) {
    assert.equal(parseModelSource(bad as string), null, String(bad));
  }
  // A non-profile hash is dropped, not passed through.
  assert.equal(parseModelSource("https://makerworld.com/en/models/1#comments")?.url, "https://makerworld.com/en/models/1");
});

test("the request and lookup links carry the model URL encoded", () => {
  const s = parseModelSource("https://makerworld.com/en/models/7#profileId-1")!;
  assert.equal(requestProfileUrl("https://makerrun.com/", s, "Snapmaker"), "https://makerrun.com/requests/new?source=https%3A%2F%2Fmakerworld.com%2Fen%2Fmodels%2F7%23profileId-1&brand=Snapmaker");
  assert.equal(designsLookupQuery(s), "?source=https%3A%2F%2Fmakerworld.com%2Fen%2Fmodels%2F7%23profileId-1&verified=true");
});
