import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo, type Revit2027GRepReplay } from "../lib/reviter/revit-2027-grep-replay.ts";
import { inspectOriginalFloorObstacleDomains } from "../lib/reviter/native-source-floor-obstacle-domains.ts";
import { inspectOriginalFloorChainEnvelopeMaterial } from "../lib/reviter/native-source-floor-chain-envelope-material.ts";
import type { Revit2027EdgeLoopWithChainEnvelopesStatic } from "../lib/reviter/revit-2027-edge-loop-static.ts";
import type { Revit2027FaceStatic } from "../lib/reviter/revit-2027-face-static.ts";
import type { Revit2027GEdgeStatic } from "../lib/reviter/revit-2027-edge-1423.ts";
const bytes = readFileSync(new URL("./fixtures/native-original-floor-chain-427511.bin", import.meta.url)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
const root = decodeRevit2027FramedGRepRoot(bytes, { offset: 0, elementId: 427511, marker: 2246, objectLength: view.getUint32(12, true), typeCode: view.getUint32(18, true) }, 2027); assert.ok(root.ok);
const replay = replayRevit2027GRepFifo(bytes, root.value); assert.ok(replay.ok); const source = replay.value;
const clone = () => structuredClone(source);
const wrapper = (r: Revit2027GRepReplay) => r.spans.find(s => s.readerId === "Revit2027EdgeLoopWithChainEnvelopes")!.value as Revit2027EdgeLoopWithChainEnvelopesStatic;
const references = (v: Revit2027EdgeLoopWithChainEnvelopesStatic) => { v.staticReferences = [...v.loop.staticReferences, ...v.chains.map(c => c.startEdgeReference)]; };
const refused = (r: Revit2027GRepReplay) => { const report = inspectOriginalFloorChainEnvelopeMaterial(r); assert.equal(report.completeSourceChainOperands, false); assert.ok(report.blockers.length); assert.equal(report.positiveFloorSupportApproved, false); assert.equal(report.routeApproved, false); };
test("exact original trimmed516 cap loops retain every chain box and original classic hole loop as obstruction only", () => {
  const before = clone(), report = inspectOriginalFloorChainEnvelopeMaterial(source);
  assert.equal(report.completeSourceChainOperands, true); assert.deepEqual(report.blockers, []);
  assert.equal(report.sourceChainLoopCount, 2); assert.equal(report.cells.length, 10); assert.equal(report.chainOperands.length, 10);
  assert.ok(report.originalFaceLoopChains.every(c => c.originalLoopTokens.length > 1));
  assert.ok(report.cells.every(c => c.sourceGeometryOwnerElementId === 427511 && c.originalFaceTokens.length === 1));
  assert.equal(report.positiveFloorSupportApproved, false); assert.equal(report.completeFloorBodyApproved, false); assert.equal(report.originalSourceAuthorityGranted, false);
  assert.deepEqual(source, before);
});
test("foreign/reused/unread source identities and extra queued operands refuse", () => {
  const owner = clone(); owner.spans[0]!.ownerElementId = 1n; refused(owner);
  const unknown = clone(); unknown.spans.find(s => s.readerId === "Revit2027EdgeLoopWithChainEnvelopes")!.propertySourceClassSlot = 1438; refused(unknown);
  const reused = clone(); reused.descriptors.find(d => d.state === "queued")!.state = "reused"; refused(reused);
  const extra = clone(), w = wrapper(extra); w.queuedProperties = [...w.queuedProperties, ...w.queuedProperties]; refused(extra);
});
test("reference/null loops, nonplanes, unclosed coedges and foreign chain starts refuse", () => {
  const reference = clone(); (reference.spans.find(s => s.readerId === "Revit2027Face" && s.propertyToken === 4)!.value as Revit2027FaceStatic).firstLoop.token = 0; refused(reference);
  const nonplane = clone(); (nonplane.spans.find(s => s.readerId === "Revit2027Face" && s.propertyToken === 4)!.value as Revit2027FaceStatic).surface.sourceClassSlot = 1144; refused(nonplane);
  const open = clone(); wrapper(open).loop.open = true; refused(open);
  const disconnected = clone(), e = disconnected.spans.find(s => s.readerId === "Revit2027GEdge" && s.propertyToken === wrapper(disconnected).loop.nextEdgeReference)!.value as Revit2027GEdgeStatic; e.nextReferences = [999999, 999999]; refused(disconnected);
  const foreign = clone(), w = wrapper(foreign); w.chains[0]!.startEdgeReference = 999999; references(w); refused(foreign);
});
test("duplicate starts, malformed bounds, oversized wrappers and unknown static references refuse", () => {
  const duplicate = clone(), d = wrapper(duplicate); d.chains[1]!.startEdgeReference = d.chains[0]!.startEdgeReference; references(d); refused(duplicate);
  const invalid = clone(); wrapper(invalid).chains[0]!.envelope.minimum = [Number.NaN, 0]; refused(invalid);
  const reverse = clone(); wrapper(reverse).chains[0]!.envelope.minimum = [1000, 1000]; refused(reverse);
  const huge = clone(), h = wrapper(huge); h.chains = Array.from({ length: 10001 }, () => structuredClone(h.chains[0]!)); references(h); refused(huge);
  const unknown = clone(); wrapper(unknown).staticReferences = [...wrapper(unknown).staticReferences, 999999]; refused(unknown);
});
test("a source chain box outside the whole plane parameter domain becomes explicit additional closed obstruction", () => {
  const changed = clone(), before = inspectOriginalFloorChainEnvelopeMaterial(source); assert.equal(before.completeSourceChainOperands, true);
  const w = wrapper(changed), upper = before.chainOperands[0]!.originalPlaneUvMaximum;
  w.chains[0]!.envelope.maximum = [upper[0]! + 10, upper[1]! + 10];
  const after = inspectOriginalFloorChainEnvelopeMaterial(changed); assert.equal(after.completeSourceChainOperands, true);
  assert.ok(after.additionalCells.some(c => c.originalLoopToken === 386 && c.originalChainIndex === 0));
  assert.equal(after.allChainBoxesCoveredByOriginalWholePlaneDomains, false);
  assert.equal(after.cells.length, before.cells.length); assert.equal(after.positiveFloorSupportApproved, false);
});

test("complete Floor obstruction consumer requires and retains strict chain operands without granting support", () => {
  const result = inspectOriginalFloorObstacleDomains(source);
  assert.equal(result.completeOriginalSourceDomainEnclosure, true);
  assert.equal(result.originalFaces, 97);
  assert.equal(result.chainEnvelopeMaterial?.chainOperands.length, 10);
  assert.equal(result.chainEnvelopeMaterial?.allChainBoxesCoveredByOriginalWholePlaneDomains, true);
  assert.equal(result.positiveFloorSupportApproved, false);
  const bad = clone(); wrapper(bad).chains[0]!.startEdgeReference = 999999; references(wrapper(bad));
  assert.equal(inspectOriginalFloorObstacleDomains(bad).completeOriginalSourceDomainEnclosure, false);
  const expanded = clone(), baseline = inspectOriginalFloorChainEnvelopeMaterial(source);
  wrapper(expanded).chains[0]!.envelope.maximum = baseline.chainOperands[0]!.originalPlaneUvMaximum.map(n => n + 10) as [number, number];
  const outside = inspectOriginalFloorObstacleDomains(expanded); assert.equal(outside.completeOriginalSourceDomainEnclosure, true);
  assert.ok(outside.cells.some(c => c.sourceKind === "original-chain-envelope-domain"));
});
