import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "../lib/reviter/native-source-element-level-prefix.ts";
const schemaResult = readSchema(
  readFileSync(
    new URL(
      "./fixtures/native-drawing-reference-source-schema.bin",
      import.meta.url,
    ),
  ),
);
assert.ok(schemaResult.ok);
const originalSchema = schemaResult.schema,
  floor = readFileSync(
    new URL("./fixtures/native-floor-semantic-402395.bin", import.meta.url),
  ),
  stair = readFileSync(
    new URL("./fixtures/native-stair-element-1696006.bin", import.meta.url),
  );
test("original Floor and StairsElement named prefixes expose consistent source level IDs and preserve the empty reciprocal list", () => {
  const f = inspectOriginalElementLevelPrefix(floor, originalSchema, "Floor"),
    s = inspectOriginalElementLevelPrefix(
      stair,
      originalSchema,
      "StairsElement",
    );
  assert.equal(f.nativeElementId, 402395);
  assert.equal(f.nativeAssociatedLevelId, 400176);
  assert.equal(s.nativeElementId, 1696006);
  assert.equal(s.nativeAssociatedLevelId, -1);
  assert.equal(s.stair!.originalBaseLevelId, 400176);
  assert.equal(s.stair!.originalTopLevelId, 402367);
  assert.equal(s.stair!.originalBaseLevelOffsetFeet, 0);
  assert.equal(s.stair!.originalTopLevelOffsetFeet, 0);
  assert.deepEqual(s.stair!.originalRunsAndLandings, []);
  for (const p of [f, s]) {
    assert.ok(p.unreadOriginalRootSuffixBytes > 0);
    assert.equal(p.completeSemanticRootDecoded, false);
    assert.equal(p.originalSourceAuthorityGranted, false);
    assert.equal(p.routeApproved, false);
    assert.ok(p.retainedDynamicDescriptors.length);
    assert.ok(
      p.originalNamedStaticPrefixFields.every(
        (f) =>
          f.start >= 18 &&
          f.start <= f.end &&
          f.end <= p.originalNamedStaticPrefixEnd,
      ),
    );
  }
  assert.ok(
    f.originalNamedStaticPrefixFields.some(
      (f) =>
        f.sourceClassName === "Element" &&
        f.fieldPath === "Floor.m_assocLevelId",
    ),
  );
});
test("wrong semantic role, changed owner and missing original schema level member cannot establish a level attachment", () => {
  assert.throws(
    () =>
      inspectOriginalElementLevelPrefix(floor, originalSchema, "StairsElement"),
    /class/,
  );
  const changed = Buffer.from(floor);
  changed.writeBigInt64LE(402396n, 0);
  assert.throws(
    () => inspectOriginalElementLevelPrefix(changed, originalSchema, "Floor"),
    /owner/,
  );
  const schema = structuredClone(originalSchema),
    element = schema.classes.find((c) => c.name === "Element")!;
  element.properties.find((p) => p.name === "m_assocLevelId")!.name =
    "unknownLevel";
  assert.throws(
    () => inspectOriginalElementLevelPrefix(floor, schema, "Floor"),
    /Required|Unsupported|Truncated|Invalid/,
  );
  const broken = structuredClone(originalSchema);
  broken.classes.find(
    (c) => c.name === "Identifier",
  )!.properties[0]!.unknownWord = 2;
  assert.throws(
    () => inspectOriginalElementLevelPrefix(floor, broken, "Floor"),
    /flagged/,
  );
});
