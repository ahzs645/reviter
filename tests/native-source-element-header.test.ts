import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalElementHeaderTypedFifo } from "../lib/reviter/native-source-element-header.ts";
const decoded = readSchema(
  readFileSync(
    new URL(
      "./fixtures/native-drawing-reference-source-schema.bin",
      import.meta.url,
    ),
  ),
);
assert.ok(decoded.ok);
const schema = decoded.schema;
test("complete original headers retain null bounding boxes and fully decoded dependency roles", () => {
  for (const id of [1514624, 1378058, 668599]) {
    const bytes = readFileSync(
        new URL(`./fixtures/native-element-header-${id}.bin`, import.meta.url),
      ),
      r = readOriginalElementHeaderTypedFifo(bytes, schema);
    assert.ok(r.ok);
    assert.equal(r.value.nativeElementId, id);
    assert.equal(r.value.endOffset, bytes.length - 4);
    assert.equal(r.value.completeOriginalTypedRootAndFifoByteReplay, true);
    assert.equal((r.value.root.m_pBBox as { token: number }).token, 0);
    assert.equal(r.value.entries.length, 1);
    assert.equal(r.value.entries[0]!.sourceClassName, "ElementParents");
    assert.ok(Array.isArray(r.value.entries[0]!.value.m_appearanceParents));
  }
});
test("unknown header bounds, changed source flags and broken original length closure remain unsupported", () => {
  const original = readFileSync(
    new URL("./fixtures/native-element-header-1514624.bin", import.meta.url),
  );
  const changed = Buffer.from(original);
  changed.writeUInt32LE(changed.readUInt32LE(8) + 1, 8);
  assert.equal(readOriginalElementHeaderTypedFifo(changed, schema).ok, false);
  const s = structuredClone(schema);
  s.classes
    .find((c) => c.name === "ElementHeader")!
    .properties.find((p) => p.name === "m_pBBox")!.unknownWord = 2;
  assert.equal(readOriginalElementHeaderTypedFifo(original, s).ok, false);
  const t = structuredClone(schema);
  t.classes.find((c) => c.name === "ElementParents")!.name =
    "UnknownElementBounds";
  assert.equal(readOriginalElementHeaderTypedFifo(original, t).ok, false);
});
