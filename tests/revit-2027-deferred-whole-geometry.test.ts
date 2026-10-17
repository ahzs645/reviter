import assert from "node:assert/strict";
import test from "node:test";
import { createRevit2027NativeMeshCollector, buildRevit2027NativeMeshScene } from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { createRevit2027SplitGElementCollector } from "../lib/reviter/revit-2027-split-alternate-frame-collector.ts";
import type { InstancePlacement } from "../lib/reviter/instanced-geometry.ts";

/** Independently serialized FIFO: GElement -> GPolyMesh -> FacetedTopology0.
 * Unused finite points make the complete frame exceed 64KiB without changing
 * the two drawn triangles. No padding or copied production byte writer. */
function polyFrame(owner: number, points = 6000, z = 0): Uint8Array {
  const end = 270 + points * 12, length = end - 16;
  const bytes = new Uint8Array(end + 4), view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(owner), true); view.setUint32(12, length, true); view.setUint16(16, 2246, true);
  view.setBigInt64(18, -1n, true); view.setUint32(26, owner, true); view.setUint32(34, 0x88004, true);
  view.setUint32(38, 1, true); view.setInt32(42, -1, true); view.setUint16(46, 2277, true);
  for (const at of [48, 96]) { view.setFloat64(at + 16, z, true); view.setFloat64(at + 24, 1, true); view.setFloat64(at + 32, 1, true); view.setFloat64(at + 40, z, true); }
  view.setBigInt64(144, BigInt(owner), true); view.setInt32(152, 2, true); view.setUint32(156, 2, true);
  view.setBigInt64(160, -1n, true); view.setInt32(168, -1, true); view.setUint32(176, 0x8c004, true);
  view.setInt32(180, -1, true); view.setUint16(184, 1868, true); view.setBigInt64(186, -1n, true); view.setBigInt64(194, -1n, true); view.setUint32(202, 2, true);
  view.setInt32(206, 2, true); view.setInt32(222, 2, true);
  view.setFloat32(234, 1, true); view.setFloat32(246, 1, true); view.setInt32(250, points, true);
  const square = [0,0,z, 1,0,z, 1,1,z, 0,1,z];
  square.forEach((value, index) => view.setFloat32(254 + index * 4, value, true));
  const triangles = 254 + points * 12; view.setInt32(triangles, 2, true);
  [0,1,2,0,2,3].forEach((index, at) => view.setUint16(triangles + 4 + at * 2, index, true));
  view.setUint32(end, length, true);
  let a = 1, b = 0; for (let cursor = 16; cursor < end; cursor++) { a = (a + bytes[cursor]!) % 65521; b = (b + a) % 65521; }
  view.setUint32(8, (b * 65536 + a) >>> 0, true);
  return bytes;
}

function nestedFrame(owner: number, symbol: number): Uint8Array {
  const bytes = new Uint8Array(320), view = new DataView(bytes.buffer);
  view.setUint32(0, owner, true); view.setUint32(12, 300, true); view.setUint16(16, 2246, true);
  view.setBigInt64(18, -1n, true); view.setUint32(26, owner, true); view.setUint32(34, 0x88004, true);
  view.setUint32(38, 1, true); view.setInt32(42, -1, true); view.setUint16(46, 2215, true);
  view.setBigInt64(144, BigInt(owner), true); view.setUint32(152, 2, true); view.setUint32(156, 2, true);
  view.setBigInt64(160, -1n, true); view.setInt32(168, -1, true); view.setUint32(176, 0x88004, true);
  view.setInt32(180, -1, true); view.setUint16(184, 2513, true);
  [1,0,0,0,1,0,0,0,1,0,0,0].forEach((value, index) => view.setFloat64(204 + index * 8, value, true));
  view.setBigInt64(300, BigInt(symbol), true); view.setUint32(312, 1, true); view.setUint32(316, 300, true);
  return bytes;
}

test("verified supplemental bodies cannot consume the ordinary definition budget first", () => {
  const collector = createRevit2027NativeMeshCollector(2027, { maxStoredTriangles: 2 });
  const splitter = createRevit2027SplitGElementCollector(2027);
  const extra = splitter.pushPage(polyFrame(20)); assert.equal(extra.length, 1);
  collector.deferWholeGElementFrame(extra[0]!);
  collector.scanPage(polyFrame(10, 4, 3));
  collector.scanPage(nestedFrame(30, 10));
  collector.finishDeferredWholeGElementFrames();
  const scene = collector.snapshot([10, 20, 30]);
  assert.equal(scene.owners.get(10)?.triangles, 2);
  assert.equal(scene.owners.get(30)?.triangles, 2, "ordinary nested roots still finalize after supplemental exhaustion");
  assert.equal(scene.owners.has(20), false);
  assert.equal(scene.truncated, false, "optional exhaustion cannot disable primary nested composition");
  assert.equal(collector.deferredWholeFrameDiagnostics.skippedDefinitionBudget, 1);
});

test("supplemental nested dependencies inherit lower output priority without duplicating own-body fallbacks", () => {
  const collector = createRevit2027NativeMeshCollector(2027);
  collector.scanPage(polyFrame(10, 4, 3));
  collector.scanPage(nestedFrame(30, 20));
  collector.deferWholeGElementFrame(polyFrame(20, 6000, 4));
  collector.finishDeferredWholeGElementFrames();
  const scene = collector.snapshot([10, 20, 30]);
  assert.equal(scene.supplementalOwnerIds?.has(30), true);
  const placement: InstancePlacement = { elementId: 20, geometryId: 10, origin: [0,0,0], basis: [1,0,0,0,1,0,0,0,1] };
  const pressured = buildRevit2027NativeMeshScene(scene, [placement], {x:0,y:0,z:0}, { maxOutputTriangles: 2 });
  assert.equal(pressured.coveredElementIds.has(20), true);
  assert.equal(pressured.coveredElementIds.has(30), false);
  assert.equal(pressured.triangles, 2);
  const onlyOwnAndFallback = { ...scene, owners: new Map([...scene.owners].filter(([id]) => id !== 30)) };
  const isolatedPressure = buildRevit2027NativeMeshScene(onlyOwnAndFallback, [placement], {x:0,y:0,z:0}, { maxOutputTriangles: 2 });
  assert.equal(isolatedPressure.triangles, 2);
  assert.equal(isolatedPressure.truncated, true, "the explicitly withheld own body reports output pressure even when no later item reaches the ordinary cap check");
  const fitted = buildRevit2027NativeMeshScene(scene, [placement], {x:0,y:0,z:0});
  assert.equal(fitted.triangles, 4, "two own bodies and no duplicate shared fallback");
});

test("supplemental FIFO bodies are recovered with remaining space and never overwrite ordinary owners", () => {
  const collector = createRevit2027NativeMeshCollector(2027);
  collector.deferWholeGElementFrame(polyFrame(10, 6000, 30));
  collector.scanPage(polyFrame(10, 4, 3));
  collector.deferWholeGElementFrame(polyFrame(20, 6000, 4));
  collector.finishDeferredWholeGElementFrames();
  const scene = collector.snapshot([10, 20]);
  assert.equal(scene.owners.get(10)?.faces[0]?.mesh.positions[2], 3);
  assert.equal(scene.owners.get(20)?.triangles, 2);
  assert.equal(scene.supplementalOwnerIds?.has(20), true);
  assert.equal(scene.supplementalOwnerIds?.has(10), false);
  const unusedFallback = collector.snapshot([10, 20], new Map(), new Map(), new Set(), new Set(), new Map([[10, [20]]]));
  assert.equal(unusedFallback.supplementalOwnerIds?.has(10), false, "an unused family-document form cannot demote an ordinary symbol");
  assert.equal(collector.deferredWholeFrameDiagnostics.existingOwnerPreserved, 1);
  const built = buildRevit2027NativeMeshScene(scene, [], { x: 0, y: 0, z: 0 }, { maxOutputTriangles: 2 });
  assert.equal(built.coveredElementIds.has(10), true);
  assert.equal(built.coveredElementIds.has(20), false);
});

test("queue replacement cannot revive older bytes when the newest frame exceeds its buffer budget", () => {
  const collector = createRevit2027NativeMeshCollector(2027, { maxDeferredWholeFrameBytes: 80_000 });
  collector.deferWholeGElementFrame(polyFrame(10, 6000));
  collector.deferWholeGElementFrame(polyFrame(10, 7000));
  collector.finishDeferredWholeGElementFrames();
  assert.equal(collector.snapshot([10]).owners.has(10), false);
  assert.equal(collector.deferredWholeFrameDiagnostics.supersededWholeFrames, 1);
  assert.equal(collector.deferredWholeFrameDiagnostics.skippedBufferBudget, 1);
});
