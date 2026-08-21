import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeMixedDefs, serializeMixedDef, type MixedDef } from "./mixed-filament.ts";

// The exact mixed_filament_definitions string from a real Snapmaker-Orca-saved Full-Spectrum .3mf
// (Pikatchu+AMSMix.3mf). Our serializer must reproduce it byte-for-byte.
const SAMPLE =
  "5,7,0,1,50,0,g,w,m2,z0,xa0,xb0,d1,o0,u1,cm0" +
  ";1,2,1,1,50,0,g,w,m2,z0,xa0,xb0,d0,o0,u2,cm0" +
  ";1,6,1,1,50,0,g,w,m2,z0,xa0,xb0,d0,o0,u3,cm0" +
  ";5,4,1,1,50,0,g,w,m2,z0,xa0,xb0,d0,o0,u4,cm0";

test("serializeMixedDefs reproduces a real Orca Full-Spectrum string byte-for-byte", () => {
  const defs: MixedDef[] = [
    { componentA: 5, componentB: 7, mixBPercent: 50, stableId: 1, enabled: false, custom: true, deleted: true },
    { componentA: 1, componentB: 2, mixBPercent: 50, stableId: 2 },
    { componentA: 1, componentB: 6, mixBPercent: 50, stableId: 3 },
    { componentA: 5, componentB: 4, mixBPercent: 50, stableId: 4 },
  ];
  assert.equal(serializeMixedDefs(defs), SAMPLE);
});

test("surface offsets format like the slicer (trailing zeros trimmed)", () => {
  // a non-zero offset should serialize as a trimmed fixed(4) value
  const s = serializeMixedDef({ componentA: 1, componentB: 2, mixBPercent: 30, stableId: 9, surfaceOffsetA: 0.5 });
  assert.match(s, /xa0\.5,/); // 0.5000 → "0.5"
  assert.match(s, /xb0,/); // 0 → "0"
  assert.match(s, /,u9,cm0$/);
});
