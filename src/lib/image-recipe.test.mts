// Shareable /image settings links: round-trip, and nothing outside the page's own control ranges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImageRecipe, imageRecipeQuery } from "./image-recipe.ts";

test("a recipe round-trips through its link", () => {
  const q = imageRecipeQuery({ mode: "relief", size: 120, colors: 3, base: 2.4, depth: 1.6 });
  assert.equal(q, "?mode=relief&size=120&colors=3&base=2.4&depth=1.6");
  assert.deepEqual(parseImageRecipe(q), { mode: "relief", size: 120, colors: 3, base: 2.4, depth: 1.6 });
});

test("only the keys that apply to the mode are written", () => {
  assert.equal(imageRecipeQuery({ mode: "hueforge", size: 100, colors: 4, base: 2.4, depth: 2 }), "?mode=hueforge&size=100&base=2.4");
});

test("values are clamped to the controls' ranges and junk is dropped", () => {
  assert.deepEqual(parseImageRecipe("?mode=evil&size=9999&colors=12&base=0&depth=abc"), { size: 250, colors: 4, base: 1 });
  assert.deepEqual(parseImageRecipe("?size=-5&colors=1"), { size: 20, colors: 2 });
  assert.deepEqual(parseImageRecipe("?base=2.33"), { base: 2.4 });
  assert.deepEqual(parseImageRecipe(""), {});
});
