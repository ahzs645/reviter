import assert from "node:assert/strict";
import test from "node:test";
import { createNativeMepDimensionCollector, curveLengthInBounds, fittingNominalDiameter, pipeAxisFromBounds } from "../lib/reviter/native-mep-dimensions.ts";
import type { MepPartitionSource } from "../lib/reviter/native-mep.ts";
import { emitNativeMepIfc } from "../lib/reviter/export-ifc-mep.ts";

const source: MepPartitionSource = { stream: "Partitions/7", chunkIndex: 1, byteOffset: 100, revitVersion: 2025, decoder: "RE-134" };
const options = { revitVersion: 2025, classes: [{ name: "RbsCurveConnectorManager", tag: 200 }], elementIds: new Set([10, 20, 30]) };
function connector(diameter: number) {
  const bytes = new Uint8Array(72), v = new DataView(bytes.buffer);
  v.setFloat64(0, 1, true); v.setFloat64(48, diameter / 2, true); v.setFloat64(64, diameter, true); return bytes;
}
function anchor() {
  const bytes = new Uint8Array(2000), v = new DataView(bytes.buffer);
  v.setUint16(0, 200, true); v.setUint32(2, 0xffffffff, true); v.setUint16(6, 201, true);
  v.setFloat64(8, .2, true); v.setFloat64(16, .2, true); v.setBigUint64(64, 30n, true);
  for (const [i, x] of [0, 10].entries()) {
    const p = 1250 + i * 60; v.setBigUint64(p, 10n, true); v.setUint32(p + 8, i, true); v.setUint32(p + 12, 1, true); v.setFloat64(p + 16, x, true);
  }
  return bytes;
}
const bounds = { elementId: 10, stream: "Partitions/7", categoryId: -2008044, boundsFeet: { min: { x: 0, y: -.1, z: -.1 }, max: { x: 10, y: .1, z: .1 } } };
test("nominal fitting sizes require a unit direction and exact radius/diameter pair; reducers stay unresolved", () => {
  assert.equal(fittingNominalDiameter(connector(.2)), .2);
  const reducer = new Uint8Array(144); reducer.set(connector(.2)); reducer.set(connector(.4), 72);
  assert.equal(fittingNominalDiameter(reducer), null);
  const bad = connector(.2); new DataView(bad.buffer).setFloat64(0, 2, true);
  assert.equal(fittingNominalDiameter(bad), undefined);
  assert.equal(fittingNominalDiameter(connector(.2).subarray(0, 71)), undefined);
});
test("pipe axis reconstructs six source faces and rejects mismatched or nonfinite bounds", () => {
  assert.equal(pipeAxisFromBounds([0, -.1, -.1, 10, .1, .1], [0, 0, 0], [10, 0, 0])!.radiusFeet, .1);
  assert.equal(pipeAxisFromBounds([0, -.1, -.1, 10, .2, .1], [0, 0, 0], [10, 0, 0]), undefined);
  assert.equal(pipeAxisFromBounds([0, -.1, -.1, Infinity, .1, .1], [0, 0, 0], [10, 0, 0]), undefined);
  assert.equal(curveLengthInBounds([0, 0, 0, 10, 2, 3], 2, 3), 10);
});
test("late source bounds resolve one unique native curve and equal section does not invent shape", () => {
  const c = createNativeMepDimensionCollector(options); c.observeCurveAnchor(anchor(), 0, source);
  c.observeElementBounds([bounds]);
  const dimension = c.finish().dimensions[0]!;
  assert.equal(dimension.widthFeet, .2); assert.equal(dimension.typeId, 30);
  assert.equal(dimension.lengthFeet, 10); assert.equal(dimension.pipeAxis!.radiusFeet, .1);
  assert.equal("shape" in dimension, false);
  const ambiguous = createNativeMepDimensionCollector(options); ambiguous.observeCurveAnchor(anchor(), 0, source);
  ambiguous.observeElementBounds([bounds, { ...bounds, elementId: 20 }]);
  assert.equal(ambiguous.finish().dimensions.length, 0);
});
test("pipe wall diameters are bounded to the verified object and releases are measured", () => {
  const bytes = new Uint8Array(565), v = new DataView(bytes.buffer); v.setFloat64(549, .18, true); v.setFloat64(557, .2, true);
  const c = createNativeMepDimensionCollector(options); c.observeVerifiedObject(bytes, 10, "RbsPipeCurve", source); c.observeElementHeaders([{ elementId: 10, categoryId: -2008044 }]);
  assert.equal(c.finish().dimensions[0]!.pipeInnerDiameterFeet, .18);
  const older = createNativeMepDimensionCollector({ ...options, revitVersion: 2024 }); older.observeVerifiedObject(bytes, 10, "RbsPipeCurve", source);
  assert.equal(older.finish().dimensions.length, 0);
  const truncated = createNativeMepDimensionCollector(options); truncated.observeVerifiedObject(bytes.subarray(0, 557), 10, "RbsPipeCurve", source);
  assert.equal(truncated.finish().dimensions.length, 0);
});
test("conflicting source bounds remain suppressed when a matching later copy arrives", () => {
  const c = createNativeMepDimensionCollector(options); c.observeCurveAnchor(anchor(), 0, source);
  c.observeElementBounds([bounds, { ...bounds, boundsFeet: { ...bounds.boundsFeet, max: { x: 11, y: .1, z: .1 } } }, bounds]);
  assert.equal(c.finish().dimensions.length, 0);
});

test("IFC dimensional recovery converts feet to metres and filters unexported owners", () => {
  const expressions: string[] = [];
  emitNativeMepIfc({ add(s) { expressions.push(s); return expressions.length; } }, { revitVersion: 2025, systems: [], connections: [], dimensions: [{ elementId: 10, nominalDiameterFeet: .05, sources: [{ ...source, decoder: "RE-165" }] }, { elementId: 20, widthFeet: 1, sources: [source] }], limitations: [] }, { ownerHistory: 1, elementEntities: new Map([[10, 100]]), guid: (_kind, key) => String(key), quoted: (s) => `'${s}'` });
  const measure = expressions.map((s) => /IFCLENGTHMEASURE\(([^)]+)\)/.exec(s)?.[1]).find((v) => v != null);
  assert.ok(measure != null && Math.abs(Number(measure) - .01524) < 1e-12);
  assert.equal(expressions.filter((s) => s.includes("'Reviter_NativeMepDimensions'")).length, 1);
});
