import test from "node:test";
import assert from "node:assert/strict";
import { parseRoomDirectory, splitGeneratedLandingDoorLinks, type DirectoryDoor, type DirectoryRoom } from "../lib/reviter/room-directory.ts";
import { resolveGeneratedLandingDoorLinks } from "../lib/reviter/reviewed-landing-door-links.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";

type P = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const stair = { key: "stair", building: "08", levelId: 1, name: "Stair", number: "08-S101", polygonFeet: rect(5, 0, 10, 4), labelPointFeet: [7.5, 2] as P, confidence: 1 };
const link = { doorId: 70, levelId: 1, rooms: ["landing:ramp:300:upper", "stair"] };

test("a reviewed door link may name a generated landing of an existing ramp recipe, and is deferred", () => {
  const base = { format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: { fileName: "m.rvt" }, annotations: [stair], indoorRamps: { version: 1, sourceModelSha256: "a".repeat(64), ramps: [{ id: "ramp:300" }] } };
  const ok = parseRoomDirectory(JSON.stringify({ ...base, navigation: { version: 1, doorLinks: [link] } }));
  assert.deepEqual(splitGeneratedLandingDoorLinks(ok.navigation!.doorLinks), { immediate: [], deferred: [link] });
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...base, navigation: { version: 1, doorLinks: [{ ...link, rooms: ["landing:ramp:999:upper", "stair"] }] } })), /existing rooms/);
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...base, navigation: { version: 1, doorLinks: [{ ...link, rooms: ["landing:ramp:300:upper", "landing:ramp:300:lower"] }] } })), /existing rooms/);
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...base, indoorRamps: undefined, navigation: { version: 1, doorLinks: [link] } })), /existing rooms/);
});

const record = (key: string, ring: P[], extra = {}) => ({ key, number: "", name: key, building: "08", levelId: 1, elevationFeet: 3.28, elevationEvidence: "native", surfaceId: `s:${key}`, circulation: true, stair: false, access: "unknown" as const, walkable: true, confidence: 1, ringsFeet: [ring], properties: {}, ...extra });
const door: DirectoryDoor = { id: 70, point: [5, 2], halfWidth: 1.5, halfHeight: 0.2, footprint: rect(4.8, 0.5, 5.2, 3.5), normal: [1, 0] };
const fixture = (landingBuilt = true) => ({
  source: { modelSha256: "a".repeat(64) },
  records: [record("landing:ramp:300:upper", rect(0, 0, 1, 4), { properties: { generatedLanding: true, nativeFloorId: 77 } }), record("stair", rect(5.2, 0, 10, 4), { stair: true })],
  nodes: landingBuilt ? [{ id: "ramp:300:upper", roomKey: "landing:ramp:300:upper", levelId: 1, building: "08", surfaceId: "s:landing", kind: "connector", pointFeet: [1, 2, 3.28], geographic: [0, 0] }] : [],
  edges: [],
  doors: [{ id: "door:1:70", levelId: 1, nativeElementId: 70, hostWallNativeElementId: 9, pointFeet: [5, 2], footprintFeet: rect(4.8, 0.5, 5.2, 3.5), normalFeet: [1, 0], roomKeys: ["stair"], state: "unmatched" }],
  issues: [],
} as unknown as IndoorDataset);
const resolve = (dataset: IndoorDataset, crosses = false, d: DirectoryDoor | null = door, slab: P[] = rect(-1, -1, 5, 5)) => resolveGeneratedLandingDoorLinks({
  dataset, links: [link],
  directoryDoor: (l, id) => (l === 1 && id === 70 ? d ?? undefined : undefined),
  area: (r) => ({ key: r.key, levelId: r.levelId, building: r.building, name: r.name, polygonFeet: r.ringsFeet[0]!, holesFeet: [], labelPointFeet: [0, 0], confidence: 1 }) as DirectoryRoom,
  floorVoids: () => [],
  onLandingSlab: (_landing, p) => p[0] >= slab[0]![0] && p[0] <= slab[1]![0] && p[1] >= slab[0]![1] && p[1] <= slab[2]![1],
  crossesBarrier: () => crosses, geo: () => [0, 0], metresPerFoot: 0.3048, existingNodeIds: new Set(),
});

test("the deferred link becomes a two-owner connected physical door once the ramp builds its landing", () => {
  const d = fixture();
  const r = resolve(d);
  assert.equal(r.rejected.length, 0);
  assert.deepEqual(d.doors![0]!.roomKeys, ["landing:ramp:300:upper", "stair"]);
  assert.equal(d.doors![0]!.state, "connected");
  const edge = d.edges.find((e) => e.id === "door:1:70")!;
  assert.equal(edge.kind, "door");
  assert.equal(edge.nativeElementId, 70);
  assert.deepEqual(edge.roomKeys, ["landing:ramp:300:upper", "stair"]);
  assert.deepEqual(r.applied[0]!.nodes.map((n) => [n.id, n.roomKey, n.kind]), [["door:1:70:0", "landing:ramp:300:upper", "portal"], ["door:1:70:1", "stair", "portal"]]);
  // the landing outline is 4 ft away; its side is the threshold beyond the leaf, on the landing slab
  assert.deepEqual(r.applied[0]!.nodes[0]!.pointFeet, [4.2, 2, 3.28]);
  assert.deepEqual(r.applied[0]!.nodes[1]!.pointFeet, [5.2, 2, 3.28]);
});

test("unbuilt landings, non-adjoining doors and blocked crossings are rejected without changing the door", () => {
  for (const [d, crosses, dd, why] of [
    [fixture(false), false, door, /did not build/],
    [fixture(), false, { ...door, point: [5, 40] as P }, /does not adjoin the room/],
    [fixture(), true, door, /barrier/],
    [fixture(), false, null, /missing/],
  ] as const) {
    const r = resolve(d, crosses, dd);
    assert.match(r.rejected[0]!.reason, why);
    assert.equal(d.doors![0]!.state, "unmatched");
    assert.equal(d.edges.length, 0);
  }
  const offSlab = fixture();
  assert.match(resolve(offSlab, false, door, rect(-1, -1, 3, 5)).rejected[0]!.reason, /not on the landing's original native slab/);
  assert.equal(offSlab.doors![0]!.state, "unmatched");
});
