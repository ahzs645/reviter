import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import {
  inspectOriginalPartMakerPrefix,
  inspectOriginalZeroChildGElement,
} from "../lib/reviter/native-source-partmaker-prefix.ts";
const native = readFileSync(
    new URL("./fixtures/native-partmaker-668599.semantic.bin", import.meta.url),
  ),
  grep = readFileSync(
    new URL("./fixtures/native-partmaker-668599.grep.bin", import.meta.url),
  ),
  schema = readSchema(
    readFileSync(
      new URL(
        "./fixtures/native-drawing-reference-source-schema.bin",
        import.meta.url,
      ),
    ),
  );
assert.ok(schema.ok);
test("all158 original zero-child GElement bytes close despite the legacy too-large minimum", () => {
  const r = inspectOriginalZeroChildGElement(grep);
  assert.equal(r.nativeElementId, 668599);
  assert.equal(r.originalChildCount, 0);
  assert.equal(r.completeOriginalGRepByteReplay, true);
  assert.equal(r.genericPhysicalAbsenceApproved, false);
  assert.equal(r.routeApproved, false);
});
test("native PartMaker exact source dependencies remain separate from generic physical absence", () => {
  const r = inspectOriginalPartMakerPrefix(native, schema.schema);
  assert.equal(r.nativeElementId, 668599);
  assert.deepEqual(r.originalDividedElementIds, [642903]);
  assert.equal(r.originalSketchId, -1);
  assert.equal(r.completeSemanticRootDecoded, false);
  assert.ok(r.unreadOriginalRootSuffixBytes > 0);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.routeApproved, false);
});
test("zero-child roots reject forged owner, hidden child, checksum, extent or framing", () => {
  for (const offset of [0, 38, 42, 138, 154]) {
    const raw = Uint8Array.from(grep);
    raw[offset] ^= 1;
    assert.throws(() => inspectOriginalZeroChildGElement(raw));
  }
  assert.throws(() => inspectOriginalZeroChildGElement(grep.subarray(0, 157)));
});
test("native semantic class and dependency schema cannot be relabelled", () => {
  const wrong = Uint8Array.from(native);
  new DataView(wrong.buffer).setUint16(16, 2153, true);
  assert.throws(
    () => inspectOriginalPartMakerPrefix(wrong, schema.schema),
    /class/,
  );
  const changed = structuredClone(schema.schema);
  changed.classes
    .find((c) => c.name === "PartMaker")!
    .properties.find((p) => p.name === "m_dividedElementIds")!.name = "other";
  assert.throws(() => inspectOriginalPartMakerPrefix(native, changed), /list/);
});
