import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import {
  inspectOriginalNonPhysicalSketchGrid,
  originalSketchGridCensusVariantsMatch,
} from "../lib/reviter/native-source-sketch-grid.ts";
const read = (name: string) =>
  readFileSync(new URL("./fixtures/" + name, import.meta.url));
const semantic = read("native-original-sketch-grid-24930.2386.bin"),
  drawing = read("native-original-sketch-grid-24930.2246.bin"),
  schemaBytes = read("native-drawing-reference-source-schema.bin");
assert.equal(
  createHash("sha256").update(semantic).digest("hex"),
  "06ee56cc12b2e00960cd007d299a223f713f12f290b3cc8e2f0a0e729544330d",
);
assert.equal(
  createHash("sha256").update(drawing).digest("hex"),
  "0f88252f46625a13370c7b7eef40268219cc4cfbeccc4125200cebdf217ecad3",
);
const parsed = readSchema(schemaBytes);
assert(parsed.ok);
const schema = parsed.schema;
function input() {
  return {
    semanticBytes: new Uint8Array(semantic),
    gElementBytes: new Uint8Array(drawing),
    schema,
    header: {
      elementId: 24930,
      categoryId: -2000055,
      familyId: null,
      ownerViewId: null,
      designOptionId: null,
    },
    nativeParentId: 316,
    originalOwnedChildIds: [] as number[],
    // Pure reader demands, independently rechecked by the live original census.
    originalViewClasses: new Map([
      [316, ["DBViewPlan"]],
      [695, ["DBViewPlan"]],
    ]),
  };
}
function checksum(bytes: Uint8Array) {
  let a = 1,
    b = 0;
  for (let i = 16; i < bytes.length - 4; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    8,
    (b * 65536 + a) >>> 0,
    true,
  );
}
test("complete original SketchGrid root and drawing compose view identity without category-only omission", () => {
  const proof = inspectOriginalNonPhysicalSketchGrid(input());
  assert.equal(proof.originalViewId, 695);
  assert.equal(proof.originalNativeParentId, 316);
  assert.equal(proof.sourceQualifiedNonPhysicalViewGrid, true);
  assert.equal(proof.sourceCategoryAloneUsedAsPhysicalAbsence, false);
  assert.equal(proof.routeApproved, false);
  assert.equal(proof.originalDrawingReaderCounts.Revit2027GBitmap, 4);
  assert.equal(proof.originalDrawingReaderCounts.Revit2027Face, 1);
  assert.doesNotThrow(() => JSON.stringify(proof));
});
test("category, saved bounds and a view name cannot replace complete original semantic/material evidence", () => {
  for (const mutate of [
    (v: ReturnType<typeof input>) => {
      v.header.categoryId = -2000032;
    },
    (v: ReturnType<typeof input>) => {
      v.originalViewClasses.delete(695);
    },
    (v: ReturnType<typeof input>) => {
      v.originalViewClasses.set(695, ["Floor"]);
    },
    (v: ReturnType<typeof input>) => {
      v.nativeParentId = 6950;
    },
    (v: ReturnType<typeof input>) => {
      v.originalOwnedChildIds.push(123);
    },
    (v: ReturnType<typeof input>) => {
      v.header.elementId = 123;
    },
    (v: ReturnType<typeof input>) => {
      v.semanticBytes = new Uint8Array();
    },
    (v: ReturnType<typeof input>) => {
      v.gElementBytes = new Uint8Array();
    },
  ]) {
    const v = input();
    mutate(v);
    assert.throws(() => inspectOriginalNonPhysicalSketchGrid(v));
  }
});
test("changed literal view pointer, foreign owner, checksum and appended children refuse", () => {
  for (const change of ["view", "owner", "checksum", "suffix"]) {
    const v = input();
    if (change === "view") {
      new DataView(v.semanticBytes.buffer).setBigInt64(121, 696n, true);
      checksum(v.semanticBytes);
    }
    if (change === "owner") {
      new DataView(v.gElementBytes.buffer).setBigInt64(0, 123n, true);
      checksum(v.gElementBytes);
    }
    if (change === "checksum") v.gElementBytes[300] ^= 1;
    if (change === "suffix")
      v.gElementBytes = new Uint8Array([...v.gElementBytes, 0]);
    assert.throws(() => inspectOriginalNonPhysicalSketchGrid(v));
  }
});
test("a same-owner non-grid physical Floor frame stays physical even with misleading grid category", () => {
  const v = input();
  v.gElementBytes = new Uint8Array(
    read("native-original-floor-400238.2246.bin"),
  );
  // Even mutating the outer owner/checksum cannot change its complete body role.
  new DataView(v.gElementBytes.buffer).setBigInt64(0, 24930n, true);
  checksum(v.gElementBytes);
  assert.throws(() => inspectOriginalNonPhysicalSketchGrid(v));
});

test("one valid grid drawing cannot erase an invalid, oversized, unconsumed or different same-ID variant", () => {
  const proof = inspectOriginalNonPhysicalSketchGrid(input()),
    valid = {
      nativeElementId: 24930,
      sourceFrameSha256: proof.originalGElementSha256,
    };
  assert.equal(originalSketchGridCensusVariantsMatch(proof, [valid]), true);
  for (const variant of [
    { ...valid, blocker: "checksum failed" },
    { ...valid, sourceFrameSha256: "", blocker: "unconsumed header" },
    { ...valid, sourceFrameSha256: "", blocker: "oversized" },
    { ...valid, sourceFrameSha256: "0".repeat(64) },
  ])
    assert.equal(
      originalSketchGridCensusVariantsMatch(proof, [valid, variant]),
      false,
    );
  assert.equal(originalSketchGridCensusVariantsMatch(proof, []), false);
});
test("virtual role schema and all seven null material descriptors are literal requirements", () => {
  for (const key of [
    "m_pParamValueSetDouble",
    "m_pParamValueSetInt",
    "m_pParamValueSetAString",
    "m_pParamValueSetElementId",
    "m_geomSteps",
    "m_pGeomTable",
    "m_cellList",
  ]) {
    const v = input(),
      clone = structuredClone(v.schema),
      element = clone.classes.find((c) => c.name === "Element")!;
    const field = element.properties.find((p) => p.name === key)!;
    field.name = "unexpectedMaterialDescriptor";
    v.schema = clone;
    assert.throws(
      () => inspectOriginalNonPhysicalSketchGrid(v),
      /role changed/,
    );
  }
  const v = input(),
    clone = structuredClone(v.schema),
    root = clone.classes.find((c) => c.name === "SketchGrid")!;
  root.properties[0]!.name = "m_physicalBody";
  v.schema = clone;
  assert.throws(() => inspectOriginalNonPhysicalSketchGrid(v), /role changed/);
});
