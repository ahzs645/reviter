import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalCurtainHostTypedFifo } from "../lib/reviter/native-source-curtain-host.ts";
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
const fixture = (id: number) =>
  readFileSync(
    new URL(`./fixtures/native-curtain-host-${id}.bin`, import.meta.url),
  );
test("actual curtain host native roots fully replay current panel cells and tagged mullions", () => {
  for (const id of [1514621, 2465236, 2320976]) {
    const bytes = fixture(id),
      r = readOriginalCurtainHostTypedFifo(bytes, schema, "SWall");
    assert.ok(r.ok);
    assert.equal(r.value.nativeElementId, id);
    assert.equal(r.value.endOffset, bytes.length - 4);
    const grid = r.value.entries.filter(
      (e) => e.sourceClassName === "CurtainGrid",
    );
    assert.equal(grid.length, 1);
    const divide = r.value.entries.filter(
      (e) => e.sourceClassName === "CGridDivideFaceGStep",
    );
    assert.equal(divide.length, 1);
    assert.ok(Array.isArray(divide[0]!.value.m_cellMap));
    assert.ok(
      r.value.entries.some((e) => e.sourceClassName === "CGDriverMullionData"),
    );
    assert.ok(
      r.value.entries.some(
        (e) =>
          e.sourceClassName ===
          (id === 2320976 ? "ExtrusionGStep" : "BaseWallGStep"),
      ),
    );
    if (id === 1514621) {
      const cells = divide[0]!.value.m_cellMap as {
        second: { m_panelId: { m_id: { m_id64: number } }; m_faceTag: number };
      }[];
      const target = cells.filter(
        (c) => c.second.m_panelId.m_id.m_id64 === 1514624,
      );
      assert.equal(target.length, 1);
      assert.equal(target[0]!.second.m_faceTag, 59);
    }
  }
});
test("actual native curtain grid lines fully retain finite curves and skipped-segment operands", () => {
  for (const id of [1514623, 325658]) {
    const bytes = fixture(id),
      r = readOriginalCurtainHostTypedFifo(bytes, schema, "CurtainGridLine");
    assert.ok(r.ok);
    assert.equal(r.value.endOffset, bytes.length - 4);
    assert.ok(r.value.entries.some((e) => e.sourceClassName === "GLine"));
    assert.ok(
      r.value.entries.some((e) => e.sourceClassName === "CurtainGridLineGStep"),
    );
  }
});
test("changed transient field shape, unknown generator, changed identity or unconsumed bytes refuse curtain host replay", () => {
  for (const defect of [
    "flag",
    "type",
    "loading",
    "items",
    "generator",
    "owner",
    "suffix",
  ]) {
    const s = structuredClone(schema),
      b = Buffer.from(fixture(1514621));
    const f = s.classes
      .find((c) => c.name === "CurtainGrid")!
      .properties.find((p) => p.name === "m_splitterGrids")!;
    if (defect === "flag") f.unknownWord = 0;
    if (defect === "type") f.fieldType = 7;
    if (defect === "loading") f.loadingMode = 1;
    if (defect === "items") f.itemMode = 0;
    if (defect === "generator")
      s.classes.find((c) => c.name === "CGridDivideFaceGStep")!.name =
        "UnknownCellGenerator";
    if (defect === "owner") b.writeBigInt64LE(1514622n, 0);
    let input = b;
    if (defect === "suffix") {
      input = Buffer.concat([
        b.subarray(0, -4),
        Buffer.from([0]),
        b.subarray(-4),
      ]);
      input.writeUInt32LE(b.readUInt32LE(12) + 1, 12);
      input.writeUInt32LE(input.readUInt32LE(12), input.length - 4);
    }
    assert.equal(
      readOriginalCurtainHostTypedFifo(input, s, "SWall").ok,
      false,
      defect,
    );
  }
});
