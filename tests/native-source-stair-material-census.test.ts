import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeStairOwnedBodyElementIds,
  prepareNativeLocalStairMaterial,
} from "../lib/reviter/native-local-transition-qualification.ts";
import { validNativeSourceStairMaterial } from "../lib/reviter/native-source-stair-material.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import { prepareNativeMaterialSource } from "../lib/reviter/native-material-source.ts";
import type { ElementHeader } from "../lib/reviter/element-headers.ts";

const sourceModelSha256 = "a".repeat(64);
const receipt = {
  nativeStairId: 200,
  nativeRunIds: [201],
  nativeFloorElementIds: [300, 301] as [number, number],
  pointsFeet: [[0, 0, 0], [1, 0, 0.5], [2, 0, 1]] as [number, number, number][],
};
const sourceRun = {
  elementId: 201,
  categoryId: -2000919,
  boundsFeet: { min: { x: -1, y: -2, z: 0 }, max: { x: 3, y: 2, z: 2 } },
} as ElementBoundsRecord;
function record(id: number, categoryId: number | undefined): ElementBoundsRecord {
  return {
    elementId: id,
    categoryId,
    boundsFeet: { min: { x: 0.2, y: -0.2, z: 0.1 }, max: { x: 0.8, y: 0.2, z: 0.4 } },
  } as ElementBoundsRecord;
}
function fixture(extra: ElementBoundsRecord[], owners: { elementId: number; owningElementId: number | null }[] = []) {
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    meshes: [],
    elementBounds: [structuredClone(sourceRun), ...extra],
    nativeStairAssemblies: [{ stairElementId: 200, runAndLandingIds: [201] }],
    elementOwnership: { records: owners },
  } as unknown as ConvertResult;
  const data = { source: { modelSha256: sourceModelSha256 } } as IndoorDataset;
  return { model, data };
}

test("source-declared sketches, lines, grids and multistory containers are not invented as solid bounds", () => {
  const categories = [-2000045, -2000051, -2000321, -2000980];
  const { model, data } = fixture(categories.map((category, i) => record(400 + i, category)));
  const before = JSON.stringify(model);
  const result = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(result.sourceElementIds, []);
  assert.equal(validNativeSourceStairMaterial(result, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), true);
  assert.equal(JSON.stringify(model), before);
});

test("real curtain walls, rails and stair bodies remain physical even without a directly rendered mesh", () => {
  const { model, data } = fixture([-2000011, -2000126, -2000120].map((category, i) => ({
    ...record(410 + i, category),
    renderGeometryProvenance: "not-rendered-helper",
  })));
  const result = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(result.sourceElementIds, [410, 411, 412]);
  assert.deepEqual(result.bands[0]!.sections.map((s) => s.nativeElementId), [410, 411, 412]);
  assert.equal(validNativeSourceStairMaterial(result, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), false);
});

test("a Treads/Risers finish needs original ownership and compatible physical run bounds", () => {
  const owned = record(420, -2000921), foreign = record(421, -2000921), unowned = record(422, -2000921);
  const escaped = record(423, -2000921);
  escaped.boundsFeet.max.x = 3.001;
  const { model, data } = fixture([owned, foreign, unowned, escaped], [
    { elementId: 420, owningElementId: 200 },
    { elementId: 421, owningElementId: 999 },
    { elementId: 423, owningElementId: 201 },
  ]);
  const before = JSON.stringify(model);
  // Even a caller-provided finish ID does not waive absent original ownership.
  assert.deepEqual(nativeStairOwnedBodyElementIds(model, receipt, [201, 422]), [201, 420]);
  const result = prepareNativeLocalStairMaterial(model, data, receipt, [201, 422]);
  assert.deepEqual(result.sourceElementIds, [421, 422, 423]);
  assert.equal(JSON.stringify(model), before);
});

test("contradictory source ownership cannot hide a foreign finish", () => {
  const { model, data } = fixture([record(430, -2000921)], [
    { elementId: 430, owningElementId: 200 },
    { elementId: 430, owningElementId: 999 },
  ]);
  assert.deepEqual(nativeStairOwnedBodyElementIds(model, receipt, [201]), [201]);
  assert.deepEqual(prepareNativeLocalStairMaterial(model, data, receipt, [201]).sourceElementIds, [430]);
});

test("unknown original physical material without a usable mesh or category remains unclassified", () => {
  const { model, data } = fixture([record(440, undefined)]);
  const result = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(result.sourceElementIds, [440]);
  assert.deepEqual(result.bands[0]!.unclassifiedSourceElementIds, [440]);
  assert.equal(validNativeSourceStairMaterial(result, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), false);
});

function ownedLandingFixture() {
  const landing = record(450, -2000920);
  landing.boundsFeet = { min: { x: 0.2, y: 3.2, z: 0.2 }, max: { x: 0.8, y: 3.8, z: 0.4 } };
  const finish = { ...structuredClone(landing), elementId: 451, categoryId: -2000921 };
  const { model, data } = fixture([landing, finish], [
    { elementId: 450, owningElementId: 200 },
    { elementId: 451, owningElementId: 200 },
  ]);
  const ringsFeet = [[[0.2, 3.2], [0.8, 3.2], [0.8, 3.8], [0.2, 3.8]]] as [number, number][][];
  model.meshes.push({
    source: "native-brep",
    positions: ringsFeet[0]!.flatMap(([x, y]) => [x, y, 0.4]),
    indices: [0, 1, 2, 0, 2, 3],
    elementIds: [450, 450],
  } as unknown as ConvertResult["meshes"][number]);
  const withLanding = {
    ...receipt,
    landings: [{ nativeElementId: 450, elevationFeet: 0.4, ringsFeet }],
  };
  return { model, data, withLanding };
}

test("a landing omitted from the assembly summary remains owned only with original ownership and matching native top faces", () => {
  const { model, withLanding } = ownedLandingFixture();
  const before = JSON.stringify(model);
  assert.deepEqual(model.nativeStairAssemblies![0]!.runAndLandingIds, [201]);
  assert.deepEqual(nativeStairOwnedBodyElementIds(model, withLanding, [201]), [201, 450, 451]);
  assert.equal(JSON.stringify(model), before);
});

test("an arbitrary receipt landing cannot hide foreign material or its finish", () => {
  for (const mutation of ["profile", "owner", "missing-native-top", "conflicting-owner"] as const) {
    const { model, withLanding } = ownedLandingFixture();
    if (mutation === "profile") withLanding.landings[0]!.ringsFeet[0]![0]![0] += 0.001;
    if (mutation === "owner") model.elementOwnership!.records.find((r) => r.elementId === 450)!.owningElementId = 999;
    if (mutation === "missing-native-top") model.meshes = [];
    if (mutation === "conflicting-owner") model.elementOwnership!.records.push({ elementId: 450, owningElementId: 999, byteOffset: 0 });
    assert.deepEqual(nativeStairOwnedBodyElementIds(model, withLanding, [201]), [201], mutation);
  }
});

function originalMaterialFixture() {
  const parent = record(460, -2000120), child = record(461, -2000919), metadata = record(462, undefined);
  // A broad container box reaches the path, but its actual physical child is
  // well outside it. Both still overlap the same height range.
  child.boundsFeet.min.y = 4; child.boundsFeet.max.y = 5;
  const { model, data } = fixture([parent, child, metadata], [
    { elementId: 460, owningElementId: null },
    { elementId: 461, owningElementId: 460 },
    { elementId: 462, owningElementId: 460 },
  ]);
  Object.assign(model.elementOwnership!, { declaredRecordCount: 4, decodedRecordCount: 3, danglingOwnerCount: 0 });
  model.nativeStairAssemblies!.push({
    stairElementId: 460, runAndLandingIds: [461], stringerIds: [], railingIds: [], supportIds: [], spiralRunIds: [], shape: "undetermined", evidence: "runs-and-element-frame",
  } as NonNullable<ConvertResult["nativeStairAssemblies"]>[number]);
  const header = (elementId: number, categoryId: number | null): ElementHeader => ({
    elementId, categoryId, familyId: null, ownerViewId: null, designOptionId: null,
  } as ElementHeader);
  model.nativeMaterialSource = prepareNativeMaterialSource(sourceModelSha256,
    [header(460, -2000120), header(461, -2000919), header(462, null)],
    [{ version: 1, nativeElementId: 460, sourceFrameSha256: "b".repeat(64), childElementIds: [461] }], model.elementOwnership);
  return { model, data };
}

test("an original identity-only stair container delegates to all physical children and exact nonphysical headers", () => {
  const { model, data } = originalMaterialFixture();
  const before = JSON.stringify(model);
  const clear = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(clear.sourceElementIds, []);
  assert.equal(validNativeSourceStairMaterial(clear, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), true);
  assert.equal(JSON.stringify(model), before);
  // Physical children cannot inherit the wrapper's exclusion: moving the
  // original child bounds into the path makes it an actual material blocker.
  model.elementBounds.find((r) => r.elementId === 461)!.boundsFeet = structuredClone(record(461, -2000919).boundsFeet);
  const blocked = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(blocked.sourceElementIds, [461]);
  assert.equal(validNativeSourceStairMaterial(blocked, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), false);
});

test("missing child bodies, stale source facts and unknown custom categories retain material blockers", () => {
  for (const mutation of ["missing-child", "stale-model", "stale-ownership", "positive-category"] as const) {
    const { model, data } = originalMaterialFixture();
    if (mutation === "missing-child") model.elementBounds = model.elementBounds.filter((r) => r.elementId !== 461);
    if (mutation === "stale-model") model.nativeMaterialSource!.sourceModelSha256 = "f".repeat(64);
    if (mutation === "stale-ownership") model.elementOwnership!.records[1]!.owningElementId = 999;
    if (mutation === "positive-category") {
      const value = model.nativeMaterialSource!;
      value.elementHeaders.find((r) => r.elementId === 462)!.categoryId = 123456;
      model.nativeMaterialSource = prepareNativeMaterialSource(sourceModelSha256, value.elementHeaders, value.instanceOnlyContainers, model.elementOwnership);
    }
    const result = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
    assert.equal(result.sourceElementIds.includes(460), true, mutation);
    if (mutation === "positive-category") assert.equal(result.bands[0]!.unclassifiedSourceElementIds.includes(462), true);
    assert.equal(validNativeSourceStairMaterial(result, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), false, mutation);
  }
});

test("a source-instantiated definition retains its physical bounds despite a helper category", () => {
  const { model, data } = originalMaterialFixture();
  const child = model.elementBounds.find((r) => r.elementId === 461)!;
  child.categoryId = -2000045;
  child.boundsFeet = structuredClone(record(461, -2000045).boundsFeet);
  const value = model.nativeMaterialSource!;
  value.elementHeaders.find((r) => r.elementId === 461)!.categoryId = -2000045;
  model.nativeMaterialSource = prepareNativeMaterialSource(sourceModelSha256, value.elementHeaders, value.instanceOnlyContainers, model.elementOwnership);
  const result = prepareNativeLocalStairMaterial(model, data, receipt, [201]);
  assert.deepEqual(result.sourceElementIds, [461]);
  assert.equal(validNativeSourceStairMaterial(result, sourceModelSha256, 200, receipt.pointsFeet, undefined, undefined, undefined, true), false);
});
