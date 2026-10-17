import assert from "node:assert/strict";
import test from "node:test";
import { auditStairHeadroomEnvelopeCensus, prepareNativeStairHeadroomAudit } from "../lib/reviter/native-stair-headroom-audit.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const points = [[0, 0, 0], [4, 0, 0]] as [number, number, number][];
const box = (id: number, minZ: number, maxZ: number) => ({nativeElementId: id, boundsFeet: {min: {x: 1, y: -0.5, z: minZ}, max: {x: 2, y: 0.5, z: maxZ}}});

test("a two-inch raised glass panel remains a full-height body-space blocker above the ankle-only band", () => {
  const glass = box(1, 2 / 12, 5), result = auditStairHeadroomEnvelopeCensus(points, [glass], 6);
  assert.deepEqual(result.candidateNativeElementIds, [1]); assert.equal(result.candidates.length, 1);
  assert.equal(result.headroomApproved, false); assert.equal(result.routeApproved, false);
});

test("zero-thickness raised glass and exact strip-side contact remain candidates despite zero projected area", () => {
  const glass = box(1, 2 / 12, 4); glass.boundsFeet.max.x = glass.boundsFeet.min.x;
  const touching = box(2, 1, 3); touching.boundsFeet.min.y = 1; touching.boundsFeet.max.y = 2;
  const result = auditStairHeadroomEnvelopeCensus(points, [glass, touching], 6);
  assert.deepEqual(result.candidateNativeElementIds, [1, 2]);
  assert.ok(result.candidates.every((c) => c.contactOnly && c.projectedAreaSqFt === 0));
  const clear = structuredClone(touching); clear.boundsFeet.min.y = 1 + 2 ** -50;
  assert.deepEqual(auditStairHeadroomEnvelopeCensus(points, [clear], 6).candidateNativeElementIds, []);
});

test("own stair, run and terminal floor IDs do not exempt upper flights and landings", () => {
  const model = {elementBounds: [{elementId: 10, categoryId: -2000120, boundsFeet: box(10, 2, 3).boundsFeet},
    {elementId: 11, categoryId: -2000919, boundsFeet: box(11, 3, 4).boundsFeet},
    {elementId: 12, categoryId: -2000032, boundsFeet: box(12, 4, 5).boundsFeet}], meshes: []} as unknown as ConvertResult;
  const data = {source: {modelSha256: "a".repeat(64)}} as IndoorDataset;
  const result = prepareNativeStairHeadroomAudit(model, data, {nativeStairId: 10, nativeRunIds: [11], nativeFloorElementIds: [12, 13], pointsFeet: points}, 6);
  assert.deepEqual(result.candidateNativeElementIds, [10, 11, 12]);
  assert.equal(result.ownStairRunAndTerminalFloorCandidates.length, 3); assert.equal(result.noWholeStairOrRunOrTerminalSlabExemption, true);
});

test("under-foot support is separate from exact six-foot overhead contact and a genuinely higher body", () => {
  const result = auditStairHeadroomEnvelopeCensus(points, [box(1, -1, 0), box(2, 6, 7), box(3, 6.01, 7)], 6);
  assert.deepEqual(result.candidateNativeElementIds, [2]);
});

test("complete component envelopes can avoid a coarse empty upper-flight box while retaining original component interior", () => {
  const body = box(1, 1, 5), far = box(1, 1, 5).boundsFeet; far.min.y = 3; far.max.y = 4;
  assert.deepEqual(auditStairHeadroomEnvelopeCensus(points, [body], 6).candidateNativeElementIds, [1]);
  assert.deepEqual(auditStairHeadroomEnvelopeCensus(points, [{...body, componentBoundsFeet: [far]}], 6).candidateNativeElementIds, []);
  assert.deepEqual(auditStairHeadroomEnvelopeCensus(points, [{...body, componentBoundsFeet: [body.boundsFeet]}], 6).candidateNativeElementIds, [1]);
});

test("unknown source categories, malformed bounds and an empty component census remain unresolved", () => {
  const result = auditStairHeadroomEnvelopeCensus(points, [{...box(1, 1, 3), categoryUnknown: true},
    {...box(2, 1, 3), boundsFeet: {min: {x: NaN, y: 0, z: 0}, max: {x: 2, y: 2, z: 4}}}, {...box(3, 1, 3), componentBoundsFeet: []}], 6);
  assert.equal(result.candidates[0]!.categoryUnknown, true); assert.deepEqual(result.unboundedSourceElementIds, [2, 3]);
  assert.equal(result.sourceCompletenessApproved, false); assert.equal(result.headroomApproved, false);
});

test("reversed routes preserve blockers and the audit leaves source coordinates and census untouched", () => {
  const bodies = [box(1, 1, 4)], snapshot = JSON.stringify([points, bodies]);
  assert.deepEqual(auditStairHeadroomEnvelopeCensus(points, bodies, 6).candidateNativeElementIds,
    auditStairHeadroomEnvelopeCensus(points.toReversed(), bodies, 6).candidateNativeElementIds);
  assert.equal(JSON.stringify([points, bodies]), snapshot);
});
