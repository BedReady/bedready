import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMixerQuery, mixerQuery } from "./mixer-link.ts";

test("mixer link: four colours and names round-trip", () => {
  const bases = [
    { hex: "#29ABE2", label: "Cyan" }, { hex: "#ED1E79", label: "Magenta" },
    { hex: "#FCEE21", label: "Yellow" }, { hex: "#111111", label: "Black" },
  ];
  assert.deepEqual(parseMixerQuery(mixerQuery(bases)), bases);
});

test("mixer link: names are optional and a missing one keeps the page's own", () => {
  assert.deepEqual(parseMixerQuery("?c=ffffff,000000,ff0000,00ff00&n=White,,Red"), [
    { hex: "#FFFFFF", label: "White" }, { hex: "#000000" }, { hex: "#FF0000", label: "Red" }, { hex: "#00FF00" },
  ]);
  assert.equal(mixerQuery([{ hex: "#ffffff" }, { hex: "#000000" }, { hex: "#ff0000" }, { hex: "#00ff00" }]), "?c=FFFFFF%2C000000%2CFF0000%2C00FF00");
});

test("mixer link: anything but exactly four valid colours is ignored, not half-applied", () => {
  assert.equal(parseMixerQuery(""), null);
  assert.equal(parseMixerQuery("?c=ffffff,000000,ff0000"), null);
  assert.equal(parseMixerQuery("?c=ffffff,000000,ff0000,00ff00,0000ff"), null);
  assert.equal(parseMixerQuery("?c=ffffff,000000,ff0000,zzzzzz"), null);
  assert.equal(parseMixerQuery("?c=fff,000,f00,0f0"), null);
});

test("mixer link: a name cannot smuggle in a separator or run long", () => {
  const q = mixerQuery([{ hex: "#FFFFFF", label: "a, b" }, { hex: "#000000", label: "x".repeat(40) }, { hex: "#FF0000" }, { hex: "#00FF00" }]);
  const back = parseMixerQuery(q)!;
  assert.equal(back[0].label, "a  b");
  assert.equal(back[1].label!.length, 24);
});

test("mixer link: the converter's link carries its four colours, or none while one is half-typed", async () => {
  const { mixerHref } = await import("./mixer-link.ts");
  assert.equal(mixerHref(["#29ABE2", "#ED1E79", "#FCEE21", "#111111"]), "/mixer?c=29ABE2%2CED1E79%2CFCEE21%2C111111");
  assert.equal(mixerHref(["#29ABE2", "#ED1", "#FCEE21", "#111111"]), "/mixer");
});

test("mixer link: a name that is only the colour code is left out of the link", () => {
  assert.equal(mixerQuery([{ hex: "#FFFFFF", label: "#FFFFFF" }, { hex: "#000000", label: "#000000" }, { hex: "#FF0000" }, { hex: "#00FF00" }]), "?c=FFFFFF%2C000000%2CFF0000%2C00FF00");
});
