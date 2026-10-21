import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo, type Revit2027GRepReplay } from "../lib/reviter/revit-2027-grep-replay.ts";
import { inspectOriginalStairLandingCarrierMaterial } from "../lib/reviter/native-source-stair-landing-carrier-material.ts";
import type { Revit2027GEdgeStatic } from "../lib/reviter/revit-2027-edge-1423.ts";
import type { Revit2027FaceStatic } from "../lib/reviter/revit-2027-face-static.ts";
const decode = (id: number) => {
  const bytes = readFileSync(new URL(`./fixtures/native-original-landing-carrier-${id}.bin`, import.meta.url)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const root = decodeRevit2027FramedGRepRoot(bytes, { offset: 0, elementId: id, marker: 2246, objectLength: view.getUint32(12, true), typeCode: view.getUint32(18, true) }, 2027);
  assert.ok(root.ok); const replay = replayRevit2027GRepFifo(bytes, root.value); assert.ok(replay.ok); return replay.value;
};
const original = decode(1294440), rotated = decode(2474574);
const inspect = (replay: Revit2027GRepReplay = original, definition = 1294441) => inspectOriginalStairLandingCarrierMaterial(replay, definition);
const clone = () => structuredClone(original);
const refused = (replay: Revit2027GRepReplay) => { const r = inspect(replay); assert.equal(r.allOriginalCarrierMaterialEnclosed, false); assert.ok(r.blockers.length); assert.equal(r.positiveWalkingSupportApproved, false); assert.equal(r.routeApproved, false); };
test("actual original and rotated landing carriers retain all inline vertical sheets, finite lines and points as closed obstruction", () => {
  for (const [replay, definition] of [[original, 1294441], [rotated, 2474575]] as const) {
    const before = structuredClone(replay), result = inspect(replay, definition);
    assert.equal(result.allOriginalCarrierMaterialEnclosed, true); assert.deepEqual(result.blockers, []);
    assert.equal(result.inlineFaceCount, 5); assert.equal(result.primitiveCount, 7); assert.equal(result.cells.length, 12);
    assert.equal(result.faceDomains.length, 5);
    assert.ok(result.cells.every(c => c.sourceGeometryOwnerElementId === Number(replay.ownerElementId)));
    const profiles = result.cells.filter(c => c.sourceKind === "original-inline-planar-face-domain");
    assert.ok(profiles.every(c => c.partsFeet.length === 0 && c.closedSegmentsFeet.length === 1 && c.closedSegmentsFeet[0]!.length === 2));
    assert.equal(new Set(profiles.flatMap(c => c.originalFaceTokens)).size, 5);
    assert.equal(result.physicalThicknessInvented, false); assert.equal(result.positiveWalkingSupportApproved, false); assert.equal(result.routeApproved, false);
    assert.deepEqual(replay, before);
  }
});
test("foreign source owners, wrong external definition, unknown material and reused/unconsumed descriptors refuse", () => {
  const owner = clone(); owner.spans[23]!.ownerElementId = 1n; refused(owner);
  assert.equal(inspect(original, 1294442).allOriginalCarrierMaterialEnclosed, false);
  const unknown = clone(); unknown.spans[23]!.readerId = "unread-material"; refused(unknown);
  const reused = clone(); reused.descriptors.find(d => d.state === "queued")!.state = "reused"; refused(reused);
  const extra = clone(); extra.descriptors = [...extra.descriptors, structuredClone(extra.descriptors.find(d => d.state === "queued")!)]; refused(extra);
});
test("holed or filled faces, unfamiliar orientation, missing topology and foreign twins refuse", () => {
  const hole = clone(); (hole.spans.find(s => s.readerId === "Revit2027Face")!.value as Revit2027FaceStatic).faceRegions.count = 1; refused(hole);
  const fill = clone(); (fill.spans.find(s => s.readerId === "Revit2027Face")!.value as Revit2027FaceStatic).foregroundFilling.token = 999; refused(fill);
  const flags = clone(); (flags.spans.find(s => s.readerId === "Revit2027Face")!.value as Revit2027FaceStatic).faceFlags = 6; refused(flags);
  const missing = clone(); missing.spans = missing.spans.filter(s => s.readerId !== "Revit2027EdgeLoop"); refused(missing);
  const twin = clone(); Object.assign(twin.spans.find(s => s.readerId === "Revit2027GEdge")!.value as Revit2027GEdgeStatic, { faceReferences: [23, 999] }); refused(twin);
  const curve = clone(); (curve.spans.find(s => s.readerId === "Revit2027GEdge")!.value as Revit2027GEdgeStatic).flags = 2; refused(curve);
});
test("finite source UV witnesses outside the declared plane envelope remain enclosed without acquiring support", () => {
  const changed = clone(), edge = changed.spans.find(s => s.readerId === "Revit2027GEdge")!.value as Revit2027GEdgeStatic;
  edge.firstAndLastEdgePoints[1].firstFaceUv = [0.38011517639808107, 2];
  const before = inspect(), after = inspect(changed); assert.equal(after.allOriginalCarrierMaterialEnclosed, true);
  assert.equal(after.faceDomains[0]!.originalEnclosingUvBounds[1]![1], 2);
  const a = after.cells.find(c => c.sourceKind === "original-inline-planar-face-domain")!, b = before.cells.find(c => c.sourceKind === "original-inline-planar-face-domain")!;
  assert.ok(a.maximumElevationFeet.n * b.maximumElevationFeet.d > b.maximumElevationFeet.n * a.maximumElevationFeet.d);
  assert.equal(after.positiveWalkingSupportApproved, false);
});
