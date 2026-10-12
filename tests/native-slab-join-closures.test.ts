import assert from "node:assert/strict";
import test from "node:test";
import { nativeSlabJoinClosures, nativeWalkingFloorsWithSlabJoins } from "../lib/reviter/native-slab-join-closures.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { prepareNativeCirculationGeometry, attachNativeCirculationCellRoutes } from "../lib/reviter/native-circulation-geometry.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const hair = 10 + 2 * 2 ** -49; // a few ulps east of x = 10 (about 3.6e-15 ft)
const envelope = [[rect(-1, -1, 21, 11)]];

test("a numerical gap between two flat slabs is closed exactly; a real gap is not", () => {
  const a = [rect(0, 0, 10, 10)], b = [rect(hair, 0, 20, 10)];
  assert.equal(nativeRationalOverlay("intersection", [a, b], envelope).length, 2, "the raw slabs leave a hairline gap");
  assert.equal(nativeWalkingFloorsWithSlabJoins([a, b], envelope).length, 1, "the join makes one continuous walking floor");
  const apart = [rect(10 + 1e-6, 0, 20, 10)];
  assert.equal(nativeWalkingFloorsWithSlabJoins([a, apart], envelope).length, 2, "a 1e-6 ft gap is a real gap");
  assert.equal(nativeSlabJoinClosures([{ nativeElementId: 1, partsFeet: [a] }]).length, 0, "one slab is never joined to itself");
  const touching = [rect(10, 10, 20, 20)];
  assert.equal(nativeSlabJoinClosures([{ nativeElementId: 1, partsFeet: [a] }, { nativeElementId: 2, partsFeet: [touching] }]).length, 0, "a corner contact is not a join");
});
test("a skewed join that crosses the other edge is closed without a twisted piece", () => {
  const a = [rect(0, 0, 10, 10)];
  const b: Point[][] = [[[10 - 2e-12, 0], [20, 0], [20, 10], [10 + 2e-12, 10]]];
  const joined = nativeWalkingFloorsWithSlabJoins([a, b], envelope);
  assert.equal(joined.length, 1);
  assert.equal(joined[0]!.length, 1, "no sliver hole remains along the join");
});
test("the join is outside the envelope or under a wall: no walking floor is created there", async () => {
  const a = [rect(0, 0, 10, 10)], b = [rect(hair, 0, 20, 10)];
  assert.equal(nativeWalkingFloorsWithSlabJoins([a, b], [[rect(-1, -1, 9, 11)], [[[11, -1], [21, -1], [21, 11], [11, 11]]]]).length, 2, "envelope gap stays");
  const data = await fixture(true);
  assert.equal(data.circulationGeometry!.cells.length, 2, "a native wall along the join still divides the floor");
});
const record = (key: string, ring: Point[], building: string): IndoorRecord => ({ key, number: key, name: key, building, levelId: 1, elevationFeet: 0, elevationEvidence: "native", surfaceId: `${building}:1:0`, circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [ring], properties: {} });
async function fixture(wall = false) {
  const slab = (id: number, ring: Point[]) => ({ elementId: id, categoryId: -2000032, boundsFeet: { min: { x: ring[0]![0], y: 0, z: -1 }, max: { x: ring[2]![0], y: 10, z: 0 } }, loops: [ring.map((p) => [p[0], p[1], 0])] });
  const model = { elementBounds: [slab(100, rect(0, 0, 10, 10)), slab(101, rect(hair, 0, 20, 10))], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [] } as unknown as ConvertResult;
  if (wall) model.elementBounds.push({ elementId: 110, categoryId: -2000011, solid: { start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.4, baseElevation: 0, topElevation: 10 } } as never);
  const SHA = "a".repeat(64);
  const data = {
    source: { modelSha256: SHA },
    // One corridor spans both buildings' slabs; its two arrivals stand on different slabs.
    records: [record("west", rect(0, 0, 10, 10), "A"), record("seam", rect(5, 0, 15, 10), "A"), record("east", rect(10, 0, 20, 10), "B")],
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }], walls: [], doors: [],
    nodes: [
      { id: "a:west", roomKey: "west", kind: "arrival", levelId: 1, surfaceId: "A:1:0", pointFeet: [2, 5, 0] },
      { id: "a:seam-w", roomKey: "seam", kind: "arrival", levelId: 1, surfaceId: "A:1:0", pointFeet: [7, 5, 0] },
      { id: "a:seam-e", roomKey: "seam", kind: "portal", levelId: 1, surfaceId: "A:1:0", pointFeet: [13, 5, 0] },
      { id: "a:east", roomKey: "east", kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [18, 5, 0] },
    ],
    edges: [], alignment: { horizontalMetresPerFoot: 0.3048 }, report: { components: 0, largestComponentArrivals: 0 },
    walkingSupport: { version: 1, sourceModelSha256: SHA, floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 10, 10)] }, { nativeElementId: 101, elevationFeet: 0, ringsFeet: [rect(hair, 0, 20, 10)] }] },
  } as unknown as IndoorDataset;
  const { nativeIndoorEnvelopeHash } = await import("../lib/reviter/native-indoor-envelopes.ts");
  const source = { version: 1 as const, sourceModelSha256: SHA, levels: [{ levelId: 1, elevationFeet: 0, partsFeet: [[rect(-1, -1, 21, 11)]], sourceElementIds: [100, 101], cutElevationsFeet: [4, 8], evidenceSha256: "b".repeat(64) }] };
  data.nativeIndoorEnvelopes = { ...source, geometrySha256: await nativeIndoorEnvelopeHash(source) };
  data.circulationGeometry = prepareNativeCirculationGeometry(model, data).geometry;
  return data;
}
test("a corridor across a wall-less flat slab join is one walking cell and its branch crosses the join", async () => {
  const data = await fixture();
  assert.equal(data.circulationGeometry!.cells.length, 1);
  attachNativeCirculationCellRoutes(data);
  const across = data.edges.find((e) => e.nativeCellId && [e.from, e.to].includes("a:seam-w") && [e.from, e.to].includes("a:seam-e"));
  assert.ok(across, "the same-surface branch crosses the slab join");
  const { nativeCirculationWalkBlockers } = await import("../../openindoormaps/app/indoor-project/native-circulation.ts");
  const { createImmutableRoutingSession } = await import("../../openindoormaps/app/indoor-project/routing-cache.ts");
  const blocked = createImmutableRoutingSession(data as never)(() => nativeCirculationWalkBlockers(data as never));
  assert.ok(!blocked.has(across.id), "the runtime authority closes the same join");
  assert.ok(!data.edges.some((e) => e.nativeCellId && [e.from, e.to].includes("a:west") && [e.from, e.to].includes("a:east")), "different metadata surfaces still need one original slab");
});
