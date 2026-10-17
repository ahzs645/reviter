import assert from "node:assert/strict";
import test from "node:test";
import { createCheckedNativeDoorBridgeProof, type NativeDoorBridgeAuthority, type NativeDoorBridgeRequest } from "../lib/reviter/native-door-bridge-proof.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { recoverNativeDoorOwnership } from "../lib/reviter/native-door-ownership.ts";
import type { ArchitecturalPlanGeometry } from "../lib/reviter/architectural-plan.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";

const sourceModelSha256 = "a".repeat(64);
const rectangle = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const exact = (...rings: [number, number][][]) => nativeRationalOverlay("union", rings.map(r => [r]));
function fixture(): { authority: NativeDoorBridgeAuthority; request: NativeDoorBridgeRequest } {
  const plane = { sourceModelSha256, levelId: 20, elevationFeet: 10 };
  const aperture = rectangle(-0.2, -1.5, 0.2, 1.5);
  return {
    authority: {
      ...plane,
      originalDoor: { ...plane, nativeElementId: 101, hostNativeElementId: 102,
        footprintFeet: aperture, normalFeet: [1, 0], hostRelation: { elementId: 101, hostId: 102, evidence: "persisted" }, hasExplicitOwnershipReview: false },
      originalExactFloorParts: exact(rectangle(-5, -5, 5, 5)),
      originalObstacles: [{ kind: "native-door-leaf", nativeElementId: 101, hostNativeElementId: 102, sourceModelSha256, parts: exact(aperture) }],
      completeOriginalOwners: [102, 103].map(id => ({ ...plane, nativeElementId: id, sourceCategoryId: -2000011, cutElevationFeet: 10.1,
        ...(id === 103 ? {sourceNativeHostRelationsVerified: true as const} : {}), originalPhysicalChildIds: id === 103 ? [104, 105] : [] })),
      originalCheckedSourceElementIds: new Set([102, 103, 104, 105]),
      physicalScope: { ...plane, materialCutElevationFeet: 10.1, sourceTreadHeadroomVetoFeet: 6, includesAllOriginalWalkingOperands: true, includesPositiveMaterialParts: true,
        includesLowSlabs: true, includesRestrictedMasks: true, unclassifiedSourceElementIds: [] },
    },
    request: { ...plane, nativeDoorElementId: 101, nativeHostElementId: 102, originalNativeApertureFeet: structuredClone(aperture),
      fromDepthFeet: 0.7, toDepthFeet: 0.7, from: [-0.8999999999999999, 0], to: [0.8999999999999999, 0],
      footprint: exact(rectangle(-0.8999999999999999, -1, 0.8999999999999999, 1)), legacyBlockingNativeElementIds: [103] },
  };
}

test("a complete native curtain owner can supersede its gross legacy rectangle after full-width physical proof", () => {
  const { authority, request } = fixture();
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), true);
});

test("only the actual own leaf inside the unchanged native aperture is excepted", () => {
  for (const kind of ["physical-material", "native-door-leaf"] as const) {
    const { authority, request } = fixture();
    authority.originalObstacles = [...authority.originalObstacles, { kind, sourceModelSha256, nativeElementId: 999, hostNativeElementId: 102,
      parts: exact(authority.originalDoor.footprintFeet) }];
    assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false, kind);
  }
  const { authority, request } = fixture();
  authority.originalObstacles[0]!.parts = exact(rectangle(-0.4, -1.5, 0.4, 1.5));
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false, "own leaf outside the measured aperture remains a veto");
});

test("own host material, raised panels, headroom and restricted masks remain vetoes", () => {
  for (const kind of ["physical-material", "raised-panel", "headroom", "restricted-mask"] as const) {
    const { authority, request } = fixture();
    authority.originalObstacles = [...authority.originalObstacles, { kind, sourceModelSha256, nativeElementId: 102, parts: exact(rectangle(-0.1, -0.1, 0.1, 0.1)) }];
    assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false, kind);
  }
});

test("strict rational broad phase retains touching and positive 1e-12 foreign overlaps", () => {
  const { authority, request } = fixture();
  authority.originalObstacles = [...authority.originalObstacles, { kind: "physical-material", sourceModelSha256, nativeElementId: 999,
    parts: exact(rectangle(-0.5, 1 - 1e-12, 0.5, 2)) }];
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
  authority.originalObstacles = [...authority.originalObstacles.slice(0, -1), { kind: "physical-material", sourceModelSha256, nativeElementId: 999,
    parts: exact(rectangle(-0.5, 1, 0.5, 2)) }];
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), true);
});

test("native floor holes and a positive 1e-12 gap across the full proof width are preserved", () => {
  const { authority, request } = fixture();
  authority.originalExactFloorParts = nativeRationalOverlay("union", [[rectangle(-5, -5, 5, 5), rectangle(-0.1, 0.8, 0.1, 0.9)]]);
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
  authority.originalExactFloorParts = exact(rectangle(-5, -5, 0, 5), rectangle(1e-12, -5, 5, 5));
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
});

test("positive subsets, unknown owners and incomplete physical child inventories cannot replace legacy vetoes", () => {
  for (const mutate of [
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.positiveSubsetOnly = true; },
    (a: NativeDoorBridgeAuthority) => { a.originalCheckedSourceElementIds = new Set([102, 103, 104]); },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners = a.completeOriginalOwners.slice(1); },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.cutElevationFeet = 14; },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.sourceModelSha256 = "b".repeat(64); },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.originalPhysicalChildIds = [104, 104]; },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.originalPhysicalChildIds = [-1]; },
    (a: NativeDoorBridgeAuthority) => { delete a.completeOriginalOwners[1]!.sourceNativeHostRelationsVerified; },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.originalPhysicalChildIds = []; },
    (a: NativeDoorBridgeAuthority) => { a.completeOriginalOwners[1]!.sourceCategoryId = -2000100; },
  ]) {
    const { authority, request } = fixture(); mutate(authority);
    assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
  }
  const { authority, request } = fixture(); request.legacyBlockingNativeElementIds = [999];
  assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
});

test("native ID, model, physical plane, body height and original host relation are bound", () => {
  for (const mutate of [
    (a: NativeDoorBridgeAuthority) => { a.originalDoor.nativeElementId = 999; },
    (a: NativeDoorBridgeAuthority) => { a.originalDoor.sourceModelSha256 = "b".repeat(64); },
    (a: NativeDoorBridgeAuthority) => { a.originalDoor.hostRelation.hostId = 999; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.levelId++; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.elevationFeet += 0.01; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.sourceTreadHeadroomVetoFeet = 5.99; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.sourceTreadHeadroomVetoFeet = Infinity; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.sourceTreadHeadroomVetoFeet = NaN; },
    (a: NativeDoorBridgeAuthority) => { a.physicalScope.unclassifiedSourceElementIds = [999]; },
    (a: NativeDoorBridgeAuthority) => { a.originalDoor.hasExplicitOwnershipReview = true; },
  ]) {
    const { authority, request } = fixture(); mutate(authority);
    assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
  }
});

test("the producer's original width, native aperture, endpoints and bounded depths cannot be changed", () => {
  for (const mutate of [
    (r: NativeDoorBridgeRequest) => { r.footprint = exact(rectangle(-0.8999999999999999, -0.5, 0.8999999999999999, 0.5)); },
    (r: NativeDoorBridgeRequest) => { r.from[0] += 1e-12; },
    (r: NativeDoorBridgeRequest) => { r.originalNativeApertureFeet = rectangle(-0.3, -1.5, 0.3, 1.5); },
    (r: NativeDoorBridgeRequest) => { r.fromDepthFeet = 1.50000000001; },
    (r: NativeDoorBridgeRequest) => { r.levelId++; },
  ]) {
    const { authority, request } = fixture(); mutate(request);
    assert.equal(createCheckedNativeDoorBridgeProof(authority)(request), false);
  }
});

test("each proof snapshots its original source context without mutating the caller's geometry", () => {
  const { authority, request } = fixture();
  const carrier = (parts: typeof authority.originalExactFloorParts) => parts.map(p => p.map(r => r.map(q => q.map(v => [v.n, v.d, v.original]))));
  const originalFloor = carrier(authority.originalExactFloorParts);
  const proof = createCheckedNativeDoorBridgeProof(authority);
  assert.deepEqual(carrier(authority.originalExactFloorParts), originalFloor);
  assert.equal(Object.isFrozen(authority.originalExactFloorParts), false);
  authority.originalDoor.footprintFeet[0]![0] = -100;
  authority.originalExactFloorParts.length = 0;
  assert.equal(proof(request), true);
});

test("ownership recovery uses the checked proof only after original ownership, full-width, floor, hole and column guards", () => {
  const { authority, request } = fixture(), proof = createCheckedNativeDoorBridgeProof(authority);
  const room = (key: string, polygonFeet: [number, number][]): DirectoryRoom => ({ key, levelId: 20, name: "Office", polygonFeet,
    labelPointFeet: [key === "a" ? -2 : 2, 0], confidence: 1 });
  const rooms = [room("a", rectangle(-5, -5, -0.5, 5)), room("b", rectangle(0.5, -5, 5, 5))];
  const review = { door: { id: 101, point: [0, 0] as [number, number], footprint: authority.originalDoor.footprintFeet,
    normal: [1, 0] as [number, number], halfWidth: 0.2, halfHeight: 1.5 }, candidates: ["a", "b"], state: "unmatched" as const };
  const geometry = { walls: [
    { elementId: 102, approximate: false, polygon: rectangle(-0.19, -5, 0.19, 5) },
    { elementId: 103, approximate: false, polygon: rectangle(-0.4, -1.2, -0.3, 1.2) },
  ], columns: [], doors: [], floors: [[rectangle(-5, -5, 5, 5)]] } as unknown as ArchitecturalPlanGeometry;
  let calls = 0;
  const callback: NonNullable<Parameters<typeof recoverNativeDoorOwnership>[4]> = candidate => {
    calls++;
    return proof({ ...request, fromDepthFeet: candidate.fromDepthFeet, toDepthFeet: candidate.toDepthFeet,
      from: candidate.from, to: candidate.to, footprint: nativeRationalOverlay("union", candidate.footprint),
      legacyBlockingNativeElementIds: candidate.legacyBlockingNativeElementIds });
  };
  assert.equal(recoverNativeDoorOwnership(rooms, [review], geometry).length, 0);
  const recovered = recoverNativeDoorOwnership(rooms, [review], geometry, undefined, callback);
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0]!.proof.nativeAssemblyBarrierOwnerIds, [103]);
  for (const badGeometry of [
    { ...geometry, floors: [[rectangle(-5, -5, 0, 5)]] },
    { ...geometry, columns: [{ elementId: 300, approximate: false, polygon: rectangle(-0.1, -0.1, 0.1, 0.1) }] },
  ]) {
    calls = 0;
    assert.equal(recoverNativeDoorOwnership(rooms, [review], badGeometry, undefined, callback).length, 0);
    assert.equal(calls, 0);
  }
  calls = 0;
  assert.equal(recoverNativeDoorOwnership(rooms, [{ ...review, hasExplicitReview: true }], geometry, undefined, callback).length, 0);
  assert.equal(calls, 0);
  const foreign = { ...geometry, walls: [...geometry.walls, { elementId: 999, approximate: false, polygon: rectangle(0.3, -1, 0.4, 1) }] };
  assert.equal(recoverNativeDoorOwnership(rooms, [review], foreign, undefined, callback).length, 0);
});
