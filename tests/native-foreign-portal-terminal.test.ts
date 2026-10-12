import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeCirculationGeometry, attachNativeCirculationCellRoutes } from "../lib/reviter/native-circulation-geometry.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const owner = (key: string, ring: Point[], extra: Partial<IndoorRecord> = {}): IndoorRecord => ({ key, number: key, name: key, building: "B", levelId: 1, elevationFeet: 0, elevationEvidence: "native", surfaceId: "B:1:0", circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [ring], properties: {}, ...extra });
/** Left room | wall x=10 with a measured door | right native face. The right face's
 * majority owner is a store room; corridor "hall" owns the door's right portal, but
 * its source identity lies mostly beyond the slab, so majority association omits it. */
async function fixture(hallAccess: IndoorRecord["access"] = "unknown") {
  const floor = { elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 20, y: 10, z: 0 } }, loops: [rect(0, 0, 20, 10).map((p) => [p[0], p[1], 0])] };
  const model = { elementBounds: [floor], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [] } as unknown as ConvertResult;
  for (const [id, y0, y1] of [[110, 0, 4], [111, 6, 10]] as const) model.elementBounds.push({ elementId: id, categoryId: -2000011, solid: { start: { x: 10, y: y0 }, end: { x: 10, y: y1 }, thickness: 0.4, baseElevation: 0, topElevation: 10 } } as never);
  const data = {
    source: { modelSha256: "a".repeat(64) },
    records: [owner("left", rect(1, 1, 9, 9)), owner("hall", rect(11, 1, 60, 4), { access: hallAccess }), owner("store", rect(12, 5, 19, 9), { circulation: false })],
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }], walls: [],
    doors: [{ id: "door", nativeElementId: 115, hostWallNativeElementId: 110, levelId: 1, pointFeet: [10, 5], footprintFeet: rect(9.7, 4, 10.3, 6), normalFeet: [1, 0], roomKeys: ["left", "hall"], state: "connected" }],
    nodes: [
      { id: "left-arrival", roomKey: "left", kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [3, 5, 0] },
      { id: "left-portal", roomKey: "left", kind: "portal", levelId: 1, surfaceId: "B:1:0", pointFeet: [9.85, 5, 0] },
      { id: "hall-portal", roomKey: "hall", kind: "portal", levelId: 1, surfaceId: "B:1:0", pointFeet: [10.15, 5, 0] },
      { id: "store-arrival", roomKey: "store", kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [16, 7, 0] },
    ],
    edges: [{ id: "door", nativeElementId: 115, kind: "door", from: "left-portal", to: "hall-portal", roomKeys: ["left", "hall"], enabled: true, pointsFeet: [[9.85, 5, 0], [10.15, 5, 0]], lengthMetres: 0.1, accessible: "unknown", evidence: "native" }],
    alignment: { horizontalMetresPerFoot: 0.3048 }, report: { components: 0, largestComponentArrivals: 0 },
    walkingSupport: { version: 1, sourceModelSha256: "a".repeat(64), floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 20, 10)] }] },
  } as unknown as IndoorDataset;
  const { nativeIndoorEnvelopeHash } = await import("../lib/reviter/native-indoor-envelopes.ts");
  const source = { version: 1 as const, sourceModelSha256: data.source.modelSha256, levels: [{ levelId: 1, elevationFeet: 0, partsFeet: [[rect(1, 1, 19, 9)]], sourceElementIds: [100], cutElevationsFeet: [4, 8], evidenceSha256: "b".repeat(64) }] };
  data.nativeIndoorEnvelopes = { ...source, geometrySha256: await nativeIndoorEnvelopeHash(source) };
  data.circulationGeometry = prepareNativeCirculationGeometry(model, data).geometry;
  return data;
}
const touches = (data: IndoorDataset, id: string) => data.edges.filter((e) => e.nativeCellId && [e.from, e.to].includes(id));
test("a connected portal whose owner lost majority association still terminates the physical cell it lies in", async () => {
  const data = await fixture();
  const right = data.circulationGeometry!.cells.find((c) => c.roomKeys.includes("store"))!;
  assert.ok(right && !right.roomKeys.includes("hall"), "fixture reproduces the ownership-association omission");
  const before = JSON.stringify(data.circulationGeometry), nodes = JSON.stringify(data.nodes);
  attachNativeCirculationCellRoutes(data);
  const branches = touches(data, "hall-portal");
  assert.ok(branches.length > 0, "omitted supported doorway branch is restored");
  for (const e of branches) {
    assert.equal(e.nativeCellId, right.id);
    assert.ok(e.roomKeys.includes("hall") && e.roomKeys.includes("store"), "branch keeps the whole-cell owners and adds the portal owner");
    assert.equal(e.accessible, "unknown");
  }
  assert.equal(JSON.stringify(data.circulationGeometry), before, "cell geometry and ownership are unchanged");
  assert.equal(JSON.stringify(data.nodes), nodes, "original node coordinates are unchanged");
  assert.ok(!data.edges.some((e) => e.nativeCellId && [e.from, e.to].includes("left-portal") && [e.from, e.to].includes("hall-portal")), "the door stays its own graph edge");
  const { nativeCirculationWalkBlockers } = await import("../../openindoormaps/app/indoor-project/native-circulation.ts");
  const { createImmutableRoutingSession } = await import("../../openindoormaps/app/indoor-project/routing-cache.ts");
  const blocked = createImmutableRoutingSession(data as never)(() => nativeCirculationWalkBlockers(data as never));
  assert.ok(branches.every((e) => !blocked.has(e.id)), "runtime walk guard accepts the restored branch with the same own-threshold halves");
});
test("restricted, non-walkable, disabled or unconnected portals are still not admitted", async () => {
  for (const edit of [
    (d: IndoorDataset) => { d.records.find((r) => r.key === "hall")!.access = "staff"; },
    (d: IndoorDataset) => { d.records.find((r) => r.key === "hall")!.walkable = false; },
    (d: IndoorDataset) => { d.edges.find((e) => e.id === "door")!.enabled = false; },
    (d: IndoorDataset) => { d.doors![0]!.state = "unmatched" as never; },
  ]) {
    const data = await fixture(); edit(data);
    attachNativeCirculationCellRoutes(data);
    assert.equal(touches(data, "hall-portal").length, 0);
  }
});
test("a portal outside the cell's exact physical face is never admitted", async () => {
  const data = await fixture();
  data.nodes.find((n) => n.id === "hall-portal")!.pointFeet = [9.85, 5, 0];
  data.nodes.find((n) => n.id === "left-portal")!.pointFeet = [10.15, 5, 0];
  attachNativeCirculationCellRoutes(data);
  const right = data.circulationGeometry!.cells.find((c) => c.roomKeys.includes("store"))!;
  assert.ok(!data.edges.some((e) => e.nativeCellId === right.id && [e.from, e.to].includes("hall-portal")));
});
