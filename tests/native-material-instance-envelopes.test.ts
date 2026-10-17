import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { originalForeignInstanceEnvelope, originalInstanceOnlyContainer, prepareNativeMaterialSource, nativeMaterialSourceHash, nativeStairMaterialContainerChildren, nativeStairMaterialContainerCoverage, nativeSourceNonPhysicalElementIds } from "../lib/reviter/native-material-source.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import { prepareNativeLocalStairMaterial } from "../lib/reviter/native-local-transition-qualification.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-material-instance-envelopes.json", import.meta.url), "utf8"));
const modelSha = fixture.sourceModelSha256 as string;
const raw = (id: number): Uint8Array => Uint8Array.from(Buffer.from(fixture.frames.find((f: { nativeElementId: number }) => f.nativeElementId === id).frameHex, "hex"));
function decoded(bytes: Uint8Array, id: number) {
  const result = decodeRevit2027FramedGRepRoot(bytes, { offset: 0, elementId: id, objectLength: bytes.length - 20, marker: 2246, typeCode: 0 }, 2027);
  if (!result.ok) throw Error(result.error);
  const replay = replayRevit2027GRepFifo(bytes, result.value); if (!replay.ok) throw Error(replay.error);
  return { root: result.value, replay: replay.value };
}
function modelFixture() {
  const carrier = 2046788, leaf = 2046789, parent = 2046769;
  const fact = originalForeignInstanceEnvelope(raw(carrier), raw(leaf))!; assert.ok(fact);
  const proof = originalInstanceOnlyContainer(decoded(raw(carrier), carrier).replay, raw(carrier))!;
  const headers = [
    { elementId: parent, categoryId: -2000120 }, { elementId: carrier, categoryId: -2000946 }, { elementId: leaf, categoryId: null },
    { elementId: 461, categoryId: -2000919 }, { elementId: 470, categoryId: -2000011 },
  ].map((h) => ({ ...h, familyId: null, ownerViewId: null, designOptionId: null }));
  const records = [{ elementId: parent, owningElementId: null }, { elementId: carrier, owningElementId: null }, { elementId: leaf, owningElementId: parent }, { elementId: 461, owningElementId: parent }].map((r, i) => ({ ...r, byteOffset: i }));
  const parentProof = { version: 1 as const, nativeElementId: parent, sourceFrameSha256: "a".repeat(64), childElementIds: [461] };
  const box = fact.boundsFeet, far = { min: { x: 1000, y: 1000, z: 20 }, max: { x: 1001, y: 1001, z: 21 } };
  const model = { origin: { x: 0, y: 0, z: 0 }, meshes: [],
    elementBounds: [{ elementId: parent, categoryId: -2000120, boundsFeet: structuredClone(box) },
      { elementId: carrier, categoryId: -2000946, familySymbolId: leaf, boundsFeet: structuredClone(box) },
      { elementId: 461, categoryId: -2000919, boundsFeet: far }],
    elementOwnership: { format: "revit-2024-2027-elem-table", declaredRecordCount: records.length + 1, decodedRecordCount: records.length, skippedLeadingRecordCount: 1, rootRecordCount: 2, selfOwnedRecordCount: 0, danglingOwnerCount: 0, records, relations: [] },
    nativeStairAssemblies: [{ stairElementId: parent, runAndLandingIds: [461], stringerIds: [], railingIds: [], supportIds: [], evidence: "runs-and-element-frame" }],
  } as unknown as ConvertResult;
  const refresh = () => { model.nativeMaterialSource = prepareNativeMaterialSource(modelSha, headers, [parentProof, proof], model.elementOwnership, [fact]); };
  refresh(); return { model, fact, headers, refresh, parent, carrier, leaf };
}
test("both actual original identity instances retain the whole source envelope including all twelve unresolved null-loop faces", () => {
  for (const [carrier, leaf] of [[1506347, 1506348], [2046788, 2046789]]) {
    const a = raw(carrier!), b = raw(leaf!), before = [Buffer.from(a).toString("hex"), Buffer.from(b).toString("hex")];
    const fact = originalForeignInstanceEnvelope(a, b)!;
    assert.ok(fact); assert.equal(fact.originalFaceCount, 42); assert.equal(fact.nullLoopFaceTokens.length, 12);
    assert.equal(fact.use, "foreign-material-envelope-only"); assert.equal(fact.carrierElementId, carrier); assert.equal(fact.definitionElementId, leaf);
    assert.deepEqual([Buffer.from(a).toString("hex"), Buffer.from(b).toString("hex")], before);
  }
});
test("nonidentity instances, noncomplete frames, changed source boxes, wrong targets and unsupported leaf bodies refuse evidence", () => {
  for (const mutation of ["translation", "trailing", "corrupt-echo", "different-box", "wrong-target", "primitive-carrier", "unsupported-leaf"] as const) {
    const carrier = raw(2046788), leaf = raw(2046789), c = decoded(carrier, 2046788), l = decoded(leaf, 2046789);
    let a = carrier, b = leaf;
    if (mutation === "translation") { const info = c.replay.spans.find((s) => s.readerId === "Revit2027InstanceInfo")!.value as { transform: { byteOffset: number } }; new DataView(a.buffer).setFloat64(info.transform.byteOffset + 72, 1, true); }
    if (mutation === "trailing") { b = new Uint8Array(leaf.length + 1); b.set(leaf); }
    if (mutation === "corrupt-echo") b[b.length - 1] ^= 1;
    if (mutation === "different-box") { const at = l.root.dynamicPayloadOffset - 112; new DataView(b.buffer).setFloat64(at, 1, true); }
    if (mutation === "wrong-target") b = raw(1506348);
    if (mutation === "primitive-carrier") a = leaf;
    if (mutation === "unsupported-leaf") new DataView(b.buffer).setUint16(l.root.children[0]!.endOffset - 2, 32767, true);
    assert.equal(originalForeignInstanceEnvelope(a, b), undefined, mutation);
  }
});
test("detailed coverage preserves physical template material through the whole carrier box; the legacy API stays strict", () => {
  const { model, parent, carrier, leaf } = modelFixture();
  assert.equal(nativeStairMaterialContainerChildren(model, parent, modelSha), undefined);
  const result = nativeStairMaterialContainerCoverage(model, parent, modelSha)!;
  assert.ok(result); assert.deepEqual(result.childElementIds, [461, carrier].sort((a, b) => a - b));
  assert.deepEqual(result.requiredCarrierBounds.map((p) => p.definitionElementId), [leaf]);
  assert.equal(nativeSourceNonPhysicalElementIds(model, modelSha).has(leaf), false);
});
test("stale or conflicting original bounds, source frames, model/ownership, instances and unrelated unknown material retain the parent", () => {
  for (const mutation of ["model", "owner", "bounds", "missing-carrier", "duplicate-bounds", "symbol", "custom-positive", "frame", "duplicate-proof", "unknown-child", "cycle"] as const) {
    const { model, parent, carrier, headers, refresh } = modelFixture();
    if (mutation === "model") model.nativeMaterialSource!.sourceModelSha256 = "f".repeat(64);
    if (mutation === "owner") model.elementOwnership!.records[0]!.owningElementId = 999;
    if (mutation === "bounds") model.elementBounds.find((r) => r.elementId === carrier)!.boundsFeet.min.x += 1;
    if (mutation === "missing-carrier") model.elementBounds = model.elementBounds.filter((r) => r.elementId !== carrier);
    if (mutation === "duplicate-bounds") model.elementBounds.push(structuredClone(model.elementBounds.find((r) => r.elementId === carrier)!));
    if (mutation === "symbol") model.elementBounds.find((r) => r.elementId === carrier)!.familySymbolId = 500;
    if (mutation === "custom-positive") { model.elementBounds.find((r) => r.elementId === carrier)!.categoryId = 500; headers.find((h) => h.elementId === carrier)!.categoryId = 500; refresh(); }
    if (mutation === "frame") { model.nativeMaterialSource!.foreignInstanceEnvelopes![0]!.definitionFrameSha256 = "f".repeat(64); model.nativeMaterialSource!.geometrySha256 = nativeMaterialSourceHash(model.nativeMaterialSource!); }
    if (mutation === "duplicate-proof") { model.nativeMaterialSource!.foreignInstanceEnvelopes!.push(structuredClone(model.nativeMaterialSource!.foreignInstanceEnvelopes![0]!)); model.nativeMaterialSource!.geometrySha256 = nativeMaterialSourceHash(model.nativeMaterialSource!); }
    if (mutation === "unknown-child") { model.elementOwnership!.records.push({ elementId: 499, owningElementId: parent, byteOffset: 100 }); model.elementOwnership!.declaredRecordCount++; model.elementOwnership!.decodedRecordCount++; refresh(); }
    if (mutation === "cycle") { model.nativeMaterialSource!.instanceOnlyContainers.push({ version: 1, nativeElementId: 2046789, sourceFrameSha256: "b".repeat(64), childElementIds: [carrier] }); model.nativeMaterialSource!.geometrySha256 = nativeMaterialSourceHash(model.nativeMaterialSource!); }
    assert.equal(nativeStairMaterialContainerCoverage(model, parent, modelSha), undefined, mutation);
  }
});
test("the material census uses the WHOLE retained carrier box despite a sparse rendered mesh, and genuine walls still block", () => {
  const { model, parent, carrier, fact } = modelFixture(), b = fact.boundsFeet;
  const x = b.min.x + (b.max.x - b.min.x) / 2, y = (b.min.y + b.max.y) / 2, z = b.min.z + 1;
  model.meshes = [{ positions: [b.min.x, b.min.y, z, b.min.x + .01, b.min.y, z, b.min.x, b.min.y + .01, z], indices: [0, 1, 2], elementIds: [carrier] }] as unknown as ConvertResult["meshes"];
  model.elementBounds.push({ elementId: 470, categoryId: -2000011, boundsFeet: { min: { x: x - .1, y: y - .1, z }, max: { x: x + .1, y: y + .1, z: z + 1 } } } as ConvertResult["elementBounds"][number]);
  const data = { source: { modelSha256: modelSha } } as IndoorDataset;
  const receipt = { nativeStairId: 900, nativeRunIds: [901], nativeFloorElementIds: [902, 903] as [number, number], pointsFeet: [[x, y, z], [x + 1, y, z + .5]] as [number, number, number][] };
  const material = prepareNativeLocalStairMaterial(model, data, receipt, []);
  assert.equal(material.sourceElementIds.includes(parent), false); assert.equal(material.sourceElementIds.includes(carrier), true); assert.equal(material.sourceElementIds.includes(470), true);
  const parts = material.bands[0]!.sections.find((r) => r.nativeElementId === carrier)!.partsFeet;
  assert.deepEqual(parts, [[[[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]]]]);
  // Excluding the carrier cannot erase its physical definition through parent delegation.
  assert.equal(prepareNativeLocalStairMaterial(model, data, { ...receipt, nativeRunIds: [carrier] }, []).sourceElementIds.includes(parent), true);
});
