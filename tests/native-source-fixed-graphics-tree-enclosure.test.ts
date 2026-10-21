import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "../lib/reviter/revit-2027-nested-instance.ts";
import type { Revit2027FaceStatic } from "../lib/reviter/revit-2027-face-static.ts";
import type { Revit2027GEdgeStatic } from "../lib/reviter/revit-2027-edge-1423.ts";
import type { Revit2027GeometryStatic } from "../lib/reviter/revit-2027-geometry.ts";
import type { Revit2027GInstance, Revit2027InstanceInfo } from "../lib/reviter/revit-2027-ginstance.ts";
import { rational, Rational } from "../lib/reviter/native-rational-overlay.ts";
import {
  inspectOriginalFixedGraphicsTreeOperands,
  auditOriginalFixedGraphicsEnclosuresStanding,
  ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256,
  type OriginalFixedGraphicsOperands,
  type OriginalFixedGraphicsEnclosure,
} from "../lib/reviter/native-source-fixed-graphics-tree-enclosure.ts";
import {
  inspectOriginalFixedGraphicsSourceSchema,
  inspectOriginalFixedGraphicsTreeContext,
  proveOriginalFixedGraphicsForeignObstruction,
  originalFixedGraphicsForeignObstructionFacts,
  type OriginalFixedGraphicsTreeContext,
  type OriginalFixedGraphicsForeignObstruction,
} from "../lib/reviter/native-source-fixed-graphics-tree-context.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";

type Manifest = { sourceModelSha256: string; sourceSchemaSha256: string; baseSymbolReachableNativeIds: number[]; nodes: { nativeElementId: number; originalFrameSha256: string; binaryFile: string }[] };
const manifest = JSON.parse(readFileSync(new URL("./fixtures/native-original-fixed-graphics/manifest.json", import.meta.url), "utf8")) as Manifest;
const schema = readFileSync(new URL("./fixtures/native-drawing-reference-source-schema.bin", import.meta.url));
const contract = inspectOriginalFixedGraphicsSourceSchema(schema);
const originalNodes = manifest.nodes.map(n => {
  const b = readFileSync(new URL(`./fixtures/native-original-fixed-graphics/${n.binaryFile}`, import.meta.url));
  assert.equal(createHash("sha256").update(b).digest("hex"), n.originalFrameSha256);
  const v = new DataView(b.buffer, b.byteOffset, b.length);
  const d = decodeRevit2027FramedGRepRoot(b, { offset: 0, elementId: n.nativeElementId, marker: 2246, objectLength: v.getUint32(12, true), typeCode: v.getUint32(18, true) }, 2027); assert.ok(d.ok);
  const r = replayRevit2027GRepFifo(b, d.value); assert.ok(r.ok);
  return { nativeElementId: n.nativeElementId, originalFrameSha256: n.originalFrameSha256, replay: r.value };
});
function input(roots: number[] = [1641179]): OriginalFixedGraphicsOperands {
  const ids = new Set(roots), todo = [...roots];
  while (todo.length) {
    const id = todo.pop()!, n = originalNodes.find(n => n.nativeElementId === id); assert.ok(n);
    const b = collectRevit2027GInstanceBindings(n.replay); assert.ok(b.ok);
    for (const link of b.value) { const id = Number(link.instance.symbolElementId); if (!ids.has(id)) { ids.add(id); todo.push(id); } }
  }
  return { mode: "all-original-fixed-graphics-branches-v1", sourceModelSha256: manifest.sourceModelSha256, sourceSchemaSha256: manifest.sourceSchemaSha256, rootNativeElementIds: roots, nodes: structuredClone(originalNodes.filter(n => ids.has(n.nativeElementId))), contracts: structuredClone(contract) };
}
function refused(i: OriginalFixedGraphicsOperands, pattern?: RegExp) {
  const r = inspectOriginalFixedGraphicsTreeOperands(i); assert.equal(r.ok, false); if (r.ok) throw Error("Expected refusal");
  assert.equal(r.cells.length, 0); assert.equal(r.originalSourceAuthorityGranted, false); assert.equal(r.routeApproved, false);
  if (pattern) assert.match(r.blockers.join(";"), pattern);
}

test("actual complete railing symbol retains all 87 fixed occurrences, 39 definitions, visibility branches and original operands", () => {
  const i = input([1640585]), before = structuredClone(i), r = inspectOriginalFixedGraphicsTreeOperands(i); assert.ok(r.ok);
  assert.equal(r.originalOperandLedger.length, 40); assert.equal(r.cells.length, 1480);
  assert.deepEqual(new Set(r.originalOperandLedger.map(n => n.nativeElementId)), new Set(manifest.baseSymbolReachableNativeIds));
  assert.equal(r.cells.filter(c => c.kind === "original-planar-component-envelope").length, 87);
  assert.equal(r.cells.filter(c => c.kind === "original-GLine").length, 87 * 16);
  assert.equal(r.cells.filter(c => c.kind === "original-control-origin").length, 1);
  assert.equal(r.literalSelectorLedger.filter(c => c.readerId === "Revit2027GConditionDir").length, 39 * 21);
  assert.equal(r.targetSelectionPerformed, false); assert.equal(r.widgetExtentApproved, false); assert.equal(r.walkingSupportApproved, false); assert.equal(r.routeApproved, false); assert.equal(r.originalSourceAuthorityGranted, false);
  assert.deepEqual(i, before);
});

test("the actual full railing/top-rail tree refuses literal unqualified Geometry command without normalization", () => {
  const i = input([1640584, 1640600]), before = structuredClone(i);
  const restrictions = i.nodes.find(n => n.nativeElementId === 1640584)!.replay.spans.filter(s => s.readerId === "Revit2027GInstance").map(s => (s.value as Revit2027GInstance).forbiddenTarget);
  assert.deepEqual(restrictions, [53246, 0]);
  refused(i, /Geometry controlCommand 151982225/); assert.deepEqual(i, before);
});

test("math-only selector control retains a nonzero restriction and every fixed child instead of selecting a branch", () => {
  const i = input([1640585]);
  const instance = i.nodes.find(n => n.nativeElementId === 1640585)!.replay.spans.find(s => s.readerId === "Revit2027GInstance")!.value as Revit2027GInstance;
  instance.forbiddenTarget = 53246;
  const r = inspectOriginalFixedGraphicsTreeOperands(i); assert.ok(r.ok); assert.equal(r.cells.length, 1480);
  assert.equal((r.literalSelectorLedger.find(s => s.readerId === "Revit2027GInstance")!.originalValue as Revit2027GInstance).forbiddenTarget, 53246);
  assert.equal(r.originalSourceAuthorityGranted, false);
});

test("GBiFlipControl requires exact decoder/schema contract and remains a literal control ledger plus only a zero-dimensional origin", () => {
  assert.equal(contract.sourceSchemaSha256, manifest.sourceSchemaSha256);
  assert.equal(contract.gBiFlipControl.decoderSourceSha256, ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256);
  assert.equal(createHash("sha256").update(readFileSync(new URL("../lib/reviter/revit-2027-gbi-flip-control.ts", import.meta.url))).digest("hex"), ORIGINAL_FIXED_GRAPHICS_BIFLIP_DECODER_SHA256);
  const i = input([1640585]); i.contracts.gBiFlipControl.decoderSourceSha256 = "0".repeat(64); refused(i, /annotation\/control/);
  const missing = input([1640585]); missing.contracts.gBiFlipControl.originalAncestorNames = ["GNode"]; refused(missing, /annotation\/control/);
  const child = input([1640585]); child.contracts.gBiFlipControl.originalDerivedFieldNames.push("m_childMaterial"); refused(child, /annotation\/control/);
  const source = input([1640585]), r = inspectOriginalFixedGraphicsTreeOperands(source); assert.ok(r.ok);
  const control = r.cells.find(c => c.kind === "original-control-origin")!; assert.equal(control.pointsFeet.length, 1); assert.equal(control.originalFaceTokens.length, 0);
  const literal = r.literalSelectorLedger.find(s => s.readerId === "Revit2027GBiFlipControl")!.originalValue as { gInfo: { controlCommand: number }; length: number };
  assert.equal(literal.length, 16); assert.equal(literal.gInfo.controlCommand, 38798); assert.equal(r.widgetExtentApproved, false);
});

test("missing/foreign/reused/extra source operands, malformed topology and unknown source material refuse", () => {
  const missing = input([1640585]); missing.nodes.pop(); refused(missing, /Missing\/unfixed/);
  const foreign = input(); foreign.nodes[0]!.replay.spans[0]!.ownerElementId = 1n; refused(foreign, /owner/);
  const reused = input(); reused.nodes[0]!.replay.descriptors.find(d => d.state === "queued")!.state = "reused"; refused(reused, /reused/);
  const extra = input(); extra.nodes[0]!.replay.descriptors = [...extra.nodes[0]!.replay.descriptors, structuredClone(extra.nodes[0]!.replay.descriptors.find(d => d.state === "queued")!)]; refused(extra, /Unconsumed/);
  const unknown = input(); unknown.nodes[0]!.replay.spans[0]!.readerId = "UnknownGeometryChangingNode"; refused(unknown, /class/);
  const hole = input(); (hole.nodes[0]!.replay.spans.find(s => s.readerId === "Revit2027Face")!.value as Revit2027FaceStatic).faceRegions.count = 1; refused(hole, /Face/);
  const twin = input(); (twin.nodes[0]!.replay.spans.find(s => s.readerId === "Revit2027GEdge")!.value as Revit2027GEdgeStatic).faceReferences = [999, 1000]; refused(twin);
  const geometry = input(); (geometry.nodes[0]!.replay.spans.find(s => s.readerId === "Revit2027Geometry")!.value as Revit2027GeometryStatic).gInfo.controlCommand = 17; refused(geometry, /controlCommand 17/);
});

test("view-resolved, missing, degenerate and cyclic fixed definitions refuse", () => {
  const view = input([1640600]); (view.nodes.find(n => n.nativeElementId === 1640600)!.replay.spans.find(s => s.readerId === "Revit2027GInstance")!.value as Revit2027GInstance).resolveSymbolInView = true;
  refused(view, /Missing\/unfixed/);
  const cycle = input([1640585]), root = cycle.nodes.find(n => n.nativeElementId === 1640585)!;
  (root.replay.spans.find(s => s.readerId === "Revit2027InstanceInfo")!.value as Revit2027InstanceInfo).symbolElementId = 1640585n;
  refused(cycle, /Cyclic/);
  const singular = input([1640585]); const info = singular.nodes.find(n => n.nativeElementId === 1640585)!.replay.spans.find(s => s.readerId === "Revit2027InstanceInfo")!.value as Revit2027InstanceInfo;
  Object.assign(info.transform, { matrix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }); refused(singular, /Degenerate/);
});

test("actual affine occurrences transform the same source points by original column-major matrix", () => {
  const i = input([1640585]), r = inspectOriginalFixedGraphicsTreeOperands(i); assert.ok(r.ok);
  const root = i.nodes.find(n => n.nativeElementId === 1640585)!, bindings = collectRevit2027GInstanceBindings(root.replay); assert.ok(bindings.ok);
  for (const binding of bindings.value.slice(0, 4)) {
    const id = Number(binding.instance.symbolElementId), leaf = input([id]), local = inspectOriginalFixedGraphicsTreeOperands(leaf); assert.ok(local.ok);
    const target: OriginalFixedGraphicsEnclosure = r.cells.find(c => c.sourceGeometryOwnerElementId === id && c.originalInstancePath[0]?.sourceReplayIndex === binding.instance.instanceReplayIndex)!;
    const matrix = binding.instance.transform.matrix;
    const expected = local.cells[0]!.pointsFeet[0]!.map((_, row) => {
      let result = rational(matrix[12 + row]!);
      for (let j = 0; j < 3; j++) { const p = local.cells[0]!.pointsFeet[0]![j]!, q = rational(matrix[j * 4 + row]!); result = new Rational(result.n * p.d * q.d + p.n * q.n * result.d, result.d * p.d * q.d); }
      return result;
    }); assert.deepEqual(target.pointsFeet[0], expected);
  }
});

test("closed source hull separation is sufficient only, retains touching material and cannot prove intersection or route", () => {
  const r = inspectOriginalFixedGraphicsTreeOperands(input()); assert.ok(r.ok);
  const far = auditOriginalFixedGraphicsEnclosuresStanding(r.cells, [rational(-1000), rational(-1000)], rational(0), rational(6));
  assert.equal(far.everyOriginalEnclosureDisjointFromStatedVolume, true); assert.equal(far.routeApproved, false);
  const p = r.cells[0]!.pointsFeet[0]!, contact = auditOriginalFixedGraphicsEnclosuresStanding([r.cells[0]!], [p[0], p[1]], new Rational(p[2].n - p[2].d, p[2].d), rational(6));
  assert.equal(contact.everyOriginalEnclosureDisjointFromStatedVolume, false); assert.equal(contact.physicalIntersectionProved, false);
});

test("plain source-schema contracts, replays and serialized objects cannot forge actual-source contexts or certificates", () => {
  const changedSchema = Uint8Array.from(schema); changedSchema[100] = changedSchema[100]! ^ 1;
  assert.throws(() => inspectOriginalFixedGraphicsSourceSchema(changedSchema), /schema decoder contract/);
  const forged = { sourceModelSha256: manifest.sourceModelSha256, sourceSchemaSha256: manifest.sourceSchemaSha256, completeSourcePages: 3666 } as OriginalFixedGraphicsTreeContext;
  assert.throws(() => inspectOriginalFixedGraphicsTreeContext(forged), /Untrusted/);
  assert.throws(() => proveOriginalFixedGraphicsForeignObstruction(forged, {} as OriginalNativeForeignEnvelopeCensus, 1640584), /Untrusted/);
  assert.throws(() => originalFixedGraphicsForeignObstructionFacts({ nativeRootId: 1640584 } as OriginalFixedGraphicsForeignObstruction), /Untrusted/);
});
