import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalPanelSymbolTypedFifo } from "../lib/reviter/native-source-panel-symbol.ts";
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
const fixtures = [307725, 1071727].map((id) => ({
  id,
  bytes: readFileSync(
    new URL(`./fixtures/native-panel-symbol-${id}.bin`, import.meta.url),
  ),
}));
test("both actual empty-graphics panel definitions completely decode but original semantic empty flags remain false", () => {
  for (const { id, bytes } of fixtures) {
    const result = readOriginalPanelSymbolTypedFifo(bytes, schema);
    assert.ok(result.ok);
    const r = result.value;
    assert.equal(r.nativeElementId, id);
    assert.equal(r.rootClassName, "SysPanelFamSym");
    assert.equal(r.endOffset, bytes.length - 4);
    assert.equal(r.root.m_empty, 0);
    assert.equal(r.root.m_hasBadLoops, 0);
    assert.equal(r.root.m_active, 1);
    assert.deepEqual(r.root.m_outline, {
      m_minmax: [
        [1e30, 1e30, 1e30],
        [-1e30, -1e30, -1e30],
      ],
    });
    assert.equal(r.completeOriginalTypedRootAndFifoByteReplay, true);
    assert.equal(r.entries.length, id === 307725 ? 9 : 10);
    const omitted = r.rootFields.filter(
      (f) => f.omitted && f.sourceClassName === "FamilySymbol",
    );
    assert.equal(omitted.length, 2);
    assert.ok(omitted.every((f) => f.start === f.end));
    assert.ok(
      r.entries.some((e) => e.sourceClassName === "BaseFamilySymbolGStep"),
    );
    assert.ok(
      r.entries.some(
        (e) => e.sourceClassName === "SysPanelFamSymPatternHelper",
      ),
    );
  }
});
test("a changed original transient declaration, unknown FIFO class, changed owner or unconsumed byte refuses complete panel decoding", () => {
  for (const defect of ["flag", "type", "dynamic", "owner", "suffix"]) {
    const s = structuredClone(schema),
      bytes = Buffer.from(fixtures[0]!.bytes);
    if (defect === "flag")
      s.classes
        .find((c) => c.name === "FamilySymbol")!
        .properties.find((p) => p.name === "m_invalidSymbol")!.unknownWord = 0;
    if (defect === "type")
      s.classes
        .find((c) => c.name === "FamilySymbol")!
        .properties.find((p) => p.name === "m_invalidSymbol")!.fieldType = 7;
    if (defect === "dynamic")
      s.classes.find((c) => c.name === "BaseFamilySymbolGStep")!.name =
        "UnsupportedPanelGenerator";
    if (defect === "owner") bytes.writeBigInt64LE(307726n, 0);
    let input = bytes;
    if (defect === "suffix") {
      input = Buffer.concat([
        bytes.subarray(0, -4),
        Buffer.from([0]),
        bytes.subarray(-4),
      ]);
      input.writeUInt32LE(bytes.readUInt32LE(12) + 1, 12);
      input.writeUInt32LE(input.readUInt32LE(12), input.length - 4);
    }
    const r = readOriginalPanelSymbolTypedFifo(input, s);
    assert.equal(r.ok, false, defect);
  }
});
