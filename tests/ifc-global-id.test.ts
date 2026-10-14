import assert from "node:assert/strict";
import test from "node:test";
import { nativeIfcGlobalId, nativeIfcGlobalIds } from "../lib/reviter/ifc-global-id.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import type { NativeElementIdentity } from "../lib/reviter/native-identity.ts";

const EPISODE = "50f92000-82f8-4258-b6a8-bb42c01b00a0";
function identity(elementId: number, originalElementId = elementId): NativeElementIdentity {
  return {
    elementId, originalElementId, episodeGuid: EPISODE,
    creationEpisodeId: 0, lastModificationEpisodeId: 0,
    lastUserModificationEpisodeId: null, byteOffset: 34,
    uniqueId: `${EPISODE}-${originalElementId.toString(16).padStart(8, "0")}`,
    provenance: "Global/ElemTable.ElementHistory+Global/History.Episode",
  };
}

test("matches the measured Snowdon Revit IFC GlobalIds in upstream RE-48", () => {
  assert.equal(nativeIfcGlobalId(identity(619340)), "1G_I00WlX2MBQekqB04dFi");
  assert.equal(nativeIfcGlobalId(identity(619404)), "1G_I00WlX2MBQekqB04dCi");
  assert.equal(nativeIfcGlobalId(identity(999999, 619340)), "1G_I00WlX2MBQekqB04dFi",
    "Revit retains the creation id after a current-id change");
});

test("retains all safe 64-bit creation-id bits instead of truncating to u32", () => {
  assert.notEqual(nativeIfcGlobalId(identity(10, 0x1_0000_000a)), nativeIfcGlobalId(identity(10)));
  assert.match(nativeIfcGlobalId(identity(10, Number.MAX_SAFE_INTEGER))!, /^[0-3][0-9A-Za-z_$]{21}$/);
});

test("requires consistent proven native history instead of guessing from a UniqueId", () => {
  const valid = identity(10);
  for (const invalid of [
    { ...valid, originalElementId: 0 },
    { ...valid, originalElementId: 1.5 },
    { ...valid, originalElementId: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, episodeGuid: "50f92000-82f8-4258-b6a8-bb42c01b00aZ" },
    { ...valid, uniqueId: `${EPISODE}-0000000b` },
    { ...valid, provenance: "unverified" } as unknown as NativeElementIdentity,
  ]) assert.equal(nativeIfcGlobalId(invalid), null);
  const uppercase = { ...valid, episodeGuid: valid.episodeGuid.toUpperCase(), uniqueId: valid.uniqueId.toUpperCase() };
  assert.equal(nativeIfcGlobalId(uppercase), nativeIfcGlobalId(valid));
});

test("rejects duplicate element joins and colliding creation identities", () => {
  assert.equal(nativeIfcGlobalIds([identity(10), identity(10, 11)]).size, 0);
  assert.equal(nativeIfcGlobalIds([identity(10), identity(11, 10)]).size, 0);
  assert.equal(nativeIfcGlobalIds([identity(10), identity(11)]).size, 2);
});

test("uses creation identity for products and remains stable across unrelated model edits", () => {
  const first = ifcExportFixture();
  first.nativeIdentity!.identities = [identity(10, 619340), identity(11, 619404)];
  const second = structuredClone(first);
  second.fileName = "a later renamed copy.rvt";
  second.nativeIdentity!.identities = [identity(555), ...second.nativeIdentity!.identities.toReversed()];
  for (const result of [first, second]) {
    assert.match(makeIfc(result), /IFCWALL\('1G_I00WlX2MBQekqB04dFi'/);
    assert.match(makeIfc(result), /IFCDOOR\('1G_I00WlX2MBQekqB04dCi'/);
  }
});

test("native levels and ordinary system types have their own ids, family types stay distinct", () => {
  const result = ifcExportFixture();
  result.nativeIdentity!.identities.push(identity(20), identity(21), identity(30));
  const source = makeIfc(result);
  assert.ok(source.includes(`IFCBUILDINGSTOREY('${nativeIfcGlobalId(identity(30))}'`));
  assert.ok(source.includes(`IFCWALLTYPE('${nativeIfcGlobalId(identity(20))}'`));
  assert.ok(!source.includes(`IFCDOORTYPE('${nativeIfcGlobalId(identity(21))}'`));
  const roots = [...source.matchAll(/=IFC[A-Z]+\('([0-3][0-9A-Za-z_$]{21})'/g)].map((match) => match[1]);
  assert.equal(new Set(roots).size, roots.length);
});

test("missing and inconsistent native evidence keeps deterministic fallback ids", () => {
  const missing = ifcExportFixture();
  delete missing.nativeIdentity;
  const first = makeIfc(missing);
  assert.equal(first, makeIfc(missing));
  assert.match(first, /IFCWALL\('[0-3][0-9A-Za-z_$]{21}'/);
  const inconsistent = ifcExportFixture();
  inconsistent.nativeIdentity!.identities[0]!.episodeGuid = "malformed";
  assert.doesNotMatch(makeIfc(inconsistent), new RegExp(`IFCWALL\\('${nativeIfcGlobalId(ifcExportFixture().nativeIdentity!.identities[0]!)}'`));
});

test("a native type projected into differing IFC classes never claims one projection as native", () => {
  const result = ifcExportFixture();
  result.nativeIdentity!.identities.push(identity(20));
  Object.assign(result.elementBounds[1]!, {
    categoryId: -2_000_032, categoryName: "Floors", typeId: 20,
    familyId: undefined, familyName: undefined,
  });
  const source = makeIfc(result);
  assert.ok(!source.includes(`IFCWALLTYPE('${nativeIfcGlobalId(identity(20))}'`));
  assert.ok(!source.includes(`IFCSLABTYPE('${nativeIfcGlobalId(identity(20))}'`));
});
