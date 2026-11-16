import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryDoorReviews,
  directoryDoors,
  NATIVE_DOOR_OWNER_MAX_GAP_FEET,
  type DoorReview,
  type NativeDoorCell,
  type ReviewedDoorLink,
} from "../lib/reviter/directory-navigation.ts";
import {
  evaluateNativeDoorOwner,
  nativeDoorOwnerPlaneCells,
  reviewedNativeDoorOwnerPortal,
  validateNativeDoorOwnerDecisions,
  type NativeDoorOwnerEvidence,
} from "../lib/reviter/reviewed-native-door-owners.ts";
import { prepareIndoorDataset } from "../lib/reviter/indoor-pipeline.ts";
import { prepareNativeCirculationGeometry } from "../lib/reviter/native-circulation-geometry.ts";
import { nativeIndoorEnvelopeHash } from "../lib/reviter/native-indoor-envelopes.ts";
import { nativeMaterialSectionsHash } from "../lib/reviter/native-material-sections.ts";
import { initializeNativeExactGeosOverlay } from "../lib/reviter/native-exact-geos-overlay.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { DirectoryDoor, DirectoryRoom, RoomDirectoryData } from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key: string, ring: Point[], extra: Partial<DirectoryRoom> = {}): DirectoryRoom => ({
  key, levelId: 1, name: key, polygonFeet: ring, labelPointFeet: ring[0]!, confidence: 1, ...extra,
});
const cell = (id: string, roomKeys: string[], ...rings: Point[][]): NativeDoorCell => ({ id, roomKeys, ringsFeet: rings });
/** A door in a thin vertical wall at x = 10 (wall faces 9.9 and 10.1). */
const door = (id = 7, y0 = 4, y1 = 7): DirectoryDoor => ({
  id, point: [10, (y0 + y1) / 2], halfWidth: 0.1, halfHeight: (y1 - y0) / 2,
  footprint: rect(9.9, y0, 10.1, y1), normal: [1, 0],
});
// Outlines stop 1.4 ft short of each wall face; the native cells reach the faces.
const shortRooms = () => [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(11.5, 0, 20, 10))];
const wallCells = () => [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
const ordinary = (rooms: DirectoryRoom[], d: DirectoryDoor, links: ReviewedDoorLink[] = []): DoorReview =>
  directoryDoorReviews(rooms, [d], links)[0]!;
const evaluate = (over: Partial<Parameters<typeof evaluateNativeDoorOwner>[0]> = {}): NativeDoorOwnerEvidence => {
  const rooms = (over.rooms as DirectoryRoom[] | undefined) ?? shortRooms(), d = "door" in over ? over.door : door();
  return evaluateNativeDoorOwner({
    levelId: 1, nativeDoorId: 7, listedRoomKeys: ["office", "corridor"], rooms, door: d,
    review: d ? ordinary(rooms, d) : undefined, explicitLinks: [], cells: wallCells(), roomElevationFeet: () => 0, ...over,
  });
};

test("a listed door the legacy matcher leaves open is accepted when the native cells give exactly the listed rooms", () => {
  assert.equal(ordinary(shortRooms(), door()).state, "unmatched");
  const evidence = evaluate();
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.applied, false, "evaluation alone never applies");
  assert.equal(evidence.reason, undefined);
  assert.deepEqual(evidence.native!.rooms, ["corridor", "office"]);
  assert.deepEqual(evidence.native!.sides.map((s) => [s.side, s.cellId, s.owner, s.stepFeet]), [
    ["against-normal", "A", "corridor", 0.25],
    ["along-normal", "B", "office", 0.25],
  ]);
  assert.deepEqual(evidence.native!.sides.map((s) => s.cellRoomKeys), [["corridor"], ["office"]]);
  assert.deepEqual(evidence.native!.sides.map((s) => s.cellBoundsFeet), [[0, 0, 9.9, 10], [10.1, 0, 20, 10]]);
  for (const s of evidence.native!.sides) assert.ok(Math.abs(s.ownerGapFeet! - 1.15) < 1e-9);
  assert.deepEqual(evidence.ordinary, { state: "unmatched", candidates: [], hasExplicitReview: false });
  // The limits are the matcher's own defaults; nothing here can widen them.
  assert.deepEqual(evidence.limits, { stepsFeet: [0.25, 0.5, 1, 1.5], maxOwnerGapFeet: 2 });
  assert.equal(NATIVE_DOOR_OWNER_MAX_GAP_FEET, 2);
  const portal = reviewedNativeDoorOwnerPortal(shortRooms(), door(), wallCells())!;
  assert.deepEqual(portal.rooms, ["corridor", "office"]);
  assert.equal(portal.reviewed, true);
  assert.deepEqual([portal.from, portal.to], [[8.5, 5.5], [11.5, 5.5]]);
});

test("an observation reports the same predicate without listed rooms", () => {
  const evidence = evaluate({ listedRoomKeys: undefined });
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.listedRoomKeys, undefined);
  assert.deepEqual(evidence.native!.rooms, ["corridor", "office"]);
});

test("every refusal reason leaves the door undecided", () => {
  const refused = (evidence: NativeDoorOwnerEvidence, pattern: RegExp) => {
    assert.equal(evidence.accepted, false);
    assert.equal(evidence.applied, false);
    assert.match(evidence.reason!, pattern);
  };
  // The door is not on the level.
  refused(evaluate({ door: undefined }), /does not exist on level 1/);
  // No precise footprint, or no normal.
  refused(evaluate({ door: { ...door(), footprint: undefined } }), /no precise footprint and normal/);
  refused(evaluate({ door: { ...door(), normal: undefined } }), /no precise footprint and normal/);
  // The listed rooms are not the native owners.
  refused(evaluate({ listedRoomKeys: ["corridor", "closet"] }), /are not the listed rooms corridor, closet/);
  // The legacy matcher already pairs the door (outlines reach the wall).
  const reaching = [room("corridor", rect(0, 0, 9.9, 10)), room("office", rect(10.1, 0, 20, 10))];
  assert.equal(ordinary(reaching, door()).state, "connected");
  refused(evaluate({ rooms: reaching }), /already paired without this review \(corridor, office\)/);
  // Automatic recovery paired it after the legacy matcher (portal on the review).
  const recovered = { ...ordinary(shortRooms(), door()), state: "connected" as const, portal: reviewedNativeDoorOwnerPortal(shortRooms(), door(), wallCells())! };
  refused(evaluate({ review: recovered }), /already paired without this review/);
  // An explicit reviewed link names the door: accepted or rejected, it wins.
  const link: ReviewedDoorLink = { doorId: 7, levelId: 1, rooms: ["corridor", "office"] };
  refused(evaluate({ explicitLinks: [link] }), /explicit reviews keep precedence/);
  refused(evaluate({ review: { ...ordinary(shortRooms(), door()), hasExplicitReview: true } }), /explicit reviews keep precedence/);
  assert.equal(evaluate({ explicitLinks: [{ ...link, levelId: 2 }] }).accepted, true, "a link on another level is another door");
  // Both faces open into one native cell: no wall separates the sides.
  refused(evaluate({ cells: [cell("AB", ["corridor", "office"], rect(0, 0, 20, 10))] }), /Both faces open into one native cell/);
  // Only one side has a native cell (exterior or unsupported side).
  refused(evaluate({ cells: [wallCells()[0]!] }), /Only one face opens into a native cell/);
  refused(evaluate({ cells: [] }), /Neither face opens into a native cell/);
  // The owner outline is beyond the fail-closed 2 ft owner gap (2.15 ft from the probe).
  const far = [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(12.5, 0, 20, 10))];
  refused(evaluate({ rooms: far }), /2\.150 ft from the probe \(limit 2 ft\)/);
  // A non-walkable owner.
  const voided = [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(11.5, 0, 20, 10), { walkability: "void" })];
  refused(evaluate({ rooms: voided }), /does not decide this door/);
  // Two rooms equally near inside one cell.
  const tied = [...shortRooms(), room("office-2", rect(11.5, 0, 20, 10))];
  refused(evaluate({ rooms: tied, cells: [wallCells()[0]!, cell("B", ["office", "office-2"], rect(10.1, 0, 20, 10))] }), /equally near/);
  // The plane's native cells could not be built at all.
  refused(evaluate({ cellsUnavailable: "Several native levels share this plane." }), /Several native levels share this plane/);
  // The owners are not at one floor height.
  refused(evaluate({ roomElevationFeet: (key) => (key === "office" ? 0.5 : 0) }), /not at one floor height/);
  refused(evaluate({ roomElevationFeet: (key) => (key === "office" ? undefined : 0) }), /not at one floor height/);
});

test("review rows are shape-checked: integers, two different rooms, no duplicates", () => {
  const ok = { levelId: 1, nativeDoorId: 7, roomKeys: ["a", "b"] };
  validateNativeDoorOwnerDecisions([ok]);
  validateNativeDoorOwnerDecisions([]);
  for (const bad of [
    "x", [null], [{ ...ok, levelId: 1.5 }], [{ ...ok, nativeDoorId: "7" }], [{ ...ok, roomKeys: ["a", "a"] }],
    [{ ...ok, roomKeys: ["a"] }], [{ ...ok, roomKeys: ["a", " "] }], [{ ...ok, roomKeys: ["a", "b", "c"] }], [ok, { ...ok, roomKeys: ["c", "d"] }],
  ])
    assert.throws(() => validateNativeDoorOwnerDecisions(bad), /Native door owner review/);
});

test("plane cells come from exact native free floor and thresholds, named by the majority rule", async () => {
  await initializeNativeExactGeosOverlay();
  const record = (key: string, ring: Point[], extra: Record<string, unknown> = {}) =>
    ({ key, levelId: 1, elevationFeet: 0, walkable: true, access: "unknown", ringsFeet: [ring], properties: {}, ...extra });
  // Free floor: two rooms either side of a thin wall at x = 10 whose doorway
  // (y 4..7) is open floor, plus an unlabelled closet and a far room.
  const free = nativeRationalOverlay("union", [[rect(0, 0, 9.9, 10)]], [[rect(10.1, 0, 20, 10)]], [[rect(9.9, 4, 10.1, 7)]], [[rect(100, 0, 110, 10)]]);
  const dataset = (records: unknown[]) => ({ source: { modelSha256: "a".repeat(64) }, nativeIndoorEnvelopes: {}, records, nativeLevels: [{ id: 1, elevationFeet: 0 }] }) as unknown as IndoorDataset;
  const records = [record("corridor", rect(0, 0, 8.5, 10)), record("office", rect(11.5, 0, 20, 10)), record("far", rect(100, 0, 110, 10))];
  const plane = (data: IndoorDataset, thresholds: Point[][] = [door().footprint as Point[]]) =>
    nativeDoorOwnerPlaneCells({ dataset: data, elevationFeet: 0, region: { exact: { free, walkable: free } }, thresholdsFeet: thresholds, doors: [door()] });
  const result = plane(dataset(records));
  // The far room's face is never classified: no probe of this door can reach it.
  assert.equal(result.planeFaces, 3);
  assert.equal(result.classifiedNearDoor, 2);
  assert.deepEqual(result.cells.map((c) => c.roomKeys), [["corridor"], ["office"]]);
  const evidence = evaluate({ cells: result.cells });
  assert.equal(evidence.accepted, true);
  assert.notEqual(evidence.native!.sides[0]!.cellId, evidence.native!.sides[1]!.cellId);
  // Without the door threshold the doorway joins both sides into one face:
  // the cells then carry both rooms and the matcher refuses (same cell).
  const joined = plane(dataset(records), []);
  assert.deepEqual(joined.cells.map((c) => c.roomKeys), [["corridor", "office"]]);
  assert.match(evaluate({ cells: joined.cells }).reason!, /Both faces open into one native cell/);
  // A staff room or an unlabelled face carries no cell: that side stays open.
  const staff = plane(dataset([records[0], record("office", rect(11.5, 0, 20, 10), { access: "staff" })]));
  assert.deepEqual(staff.cells.map((c) => c.roomKeys), [["corridor"]]);
  assert.match(evaluate({ cells: staff.cells }).reason!, /Only one face opens into a native cell/);
  const unlabelled = plane(dataset([records[0]]));
  assert.deepEqual(unlabelled.cells.map((c) => c.roomKeys), [["corridor"]]);
  // A room at another floor height is not an owner of this plane.
  const raised = plane(dataset([records[0], record("office", rect(11.5, 0, 20, 10), { elevationFeet: 4 })]));
  assert.deepEqual(raised.cells.map((c) => c.roomKeys), [["corridor"]]);
  // Unsupported (non-walkable) free floor is not a cell.
  const unsupported = nativeDoorOwnerPlaneCells({ dataset: dataset(records), elevationFeet: 0,
    region: { exact: { free, walkable: nativeRationalOverlay("union", [[rect(0, 0, 9.9, 10)]]) } }, thresholdsFeet: [door().footprint as Point[]], doors: [door()] });
  assert.deepEqual(unsupported.cells.map((c) => c.roomKeys), [["corridor"]]);
  // Room outlines never stand in for native cells.
  assert.throws(() => nativeDoorOwnerPlaneCells({ dataset: { ...dataset(records), nativeIndoorEnvelopes: undefined } as IndoorDataset, elevationFeet: 0, region: { exact: { free, walkable: free } }, thresholdsFeet: [], doors: [door()] }), /exact native walking authority/);
  assert.throws(() => nativeDoorOwnerPlaneCells({ dataset: dataset(records), elevationFeet: 0, region: {}, thresholdsFeet: [], doors: [door()] }), /exact native walking authority/);
});

// A complete strict-native project: one slab, a wall with one door, and two
// rooms whose registered outlines stop 1.8 ft short of the wall faces: out of
// the legacy reach, beyond the 1.5 ft automatic ownership recovery, and 1.55 ft
// from the native side probes.
const sha = "a".repeat(64);
async function fixture(leftEdge = 8.1, rightEdge = 11.9) {
  const floor = rect(0, 0, 20, 10), opening = rect(9.9, 4, 10.1, 7), walls = [rect(9.9, 0, 10.1, 4), rect(9.9, 7, 10.1, 10)];
  const bound = (r: Point[], z0: number, z1: number) => ({ min: { x: Math.min(...r.map((p) => p[0])), y: Math.min(...r.map((p) => p[1])), z: z0 }, max: { x: Math.max(...r.map((p) => p[0])), y: Math.max(...r.map((p) => p[1])), z: z1 } });
  const model = { fileName: "Synthetic.rvt", origin: { x: 0, y: 0, z: 0 }, levels: [{ levelId: 1, elevation: 0, candidates: 1 }], elementBounds: [
    { elementId: 100, categoryId: -2000032, boundsFeet: bound(floor, -0.5, 0), loops: [floor.map((p) => [...p, 0])] },
    { elementId: 10, categoryId: -2000023, boundsFeet: bound(opening, 0, 8), orientedBox: opening.map((p) => [...p, 0]) },
    ...walls.map((r, i) => ({ elementId: 20 + i, categoryId: -2000100, boundsFeet: bound(r, 0, 8), orientedBox: r.map((p) => [...p, 0]) })),
  ], nativeAssociatedLevelRelations: [10, 20, 21, 100].map((elementId) => ({ elementId, levelId: 1 })), nativeStairAssemblies: [] } as unknown as ConvertResult;
  const envelope = { version: 1 as const, sourceModelSha256: sha, levels: [{ levelId: 1, elevationFeet: 0, partsFeet: [[floor]], sourceElementIds: [100], cutElevationsFeet: [4], evidenceSha256: "b".repeat(64) }] };
  const material = { version: 1 as const, sourceModelSha256: sha, levels: [{ levelId: 1, elevationFeet: 0, cutElevationFeet: 0.1, evidenceSha256: "c".repeat(64), sourceElementIds: [100], sections: [] }] };
  const annotation = (key: string, name: string, ring: Point[], label: Point) => ({ key, number: key, building: "01", name, levelId: 1, confidence: 1, polygonFeet: ring, labelPointFeet: label });
  const source: RoomDirectoryData = { format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: { fileName: model.fileName },
    annotations: [annotation("left", "Vestibule", rect(0, 0, leftEdge, 10), [2, 5]), annotation("right", "Office", rect(rightEdge, 0, 20, 10), [18, 5])],
    georeference: { format: "reviter-georeference", version: 1, modelFileName: model.fileName, coordinateSystem: "WGS84", method: "fixed-scale", points: [{ id: "p", name: "Origin", modelFeet: [0, 0], levelId: 1, geographic: { longitude: -122, latitude: 53 } }, { id: "q", name: "Second", modelFeet: [100, 0], levelId: 1, geographic: { longitude: -121.999545, latitude: 53 } }] },
    nativeIndoorEnvelopes: { ...envelope, geometrySha256: await nativeIndoorEnvelopeHash(envelope) }, nativeMaterialSections: { ...material, geometrySha256: await nativeMaterialSectionsHash(material) } };
  return { model, source };
}
class Stop extends Error {}
type Options = NonNullable<Parameters<typeof prepareIndoorDataset>[4]>;
/** Compile through door matching and stop at the detached pre-landing snapshot. */
async function preLanding(input: Awaited<ReturnType<typeof fixture>>, options: Options = {}): Promise<IndoorDataset> {
  let snapshot: IndoorDataset | undefined;
  await assert.rejects(prepareIndoorDataset(input.model, input.source, sha, undefined, { ...options, onPreLandingSnapshot: (data) => { snapshot = data; throw new Stop(); } }), Stop);
  return snapshot!;
}

test("the compile connects only the listed door, exactly as listed, and refuses anything else", async () => {
  const input = await fixture();
  const nativeDoor = directoryDoors(input.model, 1)[0]!;
  assert.equal(nativeDoor.id, 10);
  assert.equal(directoryDoorReviews(input.source.annotations, [nativeDoor])[0]!.state, "unmatched");
  // Accepted: evidence names two different native cells and the listed rooms.
  const seen: NativeDoorOwnerEvidence[] = [];
  const before = await preLanding(input);
  const after = await preLanding(input, { nativeDoorOwnerReview: { decisions: [{ levelId: 1, nativeDoorId: 10, roomKeys: ["right", "left"] }], onEvidence: (e) => seen.push(e) } });
  assert.equal(seen.length, 1);
  // Before: an unmatched door with no edge. After: an ordinary connected door.
  assert.deepEqual(before.doors!.map((d) => [d.id, d.state, d.roomKeys]), [["door:1:10", "unmatched", []]]);
  assert.equal(before.edges.some((e) => e.kind === "door"), false);
  assert.equal(before.issues.some((i) => i.code === "door-unmatched"), true);
  assert.equal(after.doors!.length, 1);
  assert.equal(after.doors![0]!.state, "connected");
  assert.deepEqual([...after.doors![0]!.roomKeys].sort(), ["left", "right"]);
  const edge = after.edges.find((e) => e.kind === "door")!;
  assert.deepEqual([edge.id, edge.evidence, edge.accessible, edge.nativeElementId, [...edge.roomKeys].sort()], ["door:1:10", "reviewed-native-door", "unknown", 10, ["left", "right"]]);
  assert.deepEqual(after.nodes.filter((n) => n.kind === "portal").map((n) => n.id).sort(), ["door:1:10:0", "door:1:10:1"]);
  assert.equal(after.issues.some((i) => i.code === "door-unmatched"), false);
  assert.equal(after.issues.filter((i) => i.code === "reviewed-native-cell-door-owner").length, 1);
  assert.equal(after.report.unmatchedDoors, 0);
  // Nothing but the door, its portal nodes, its edge and the issues changed.
  const rest = (d: IndoorDataset) => JSON.stringify({ ...d, doors: undefined, edges: d.edges.filter((e) => e.kind !== "door"), nodes: d.nodes.filter((n) => n.kind !== "portal"), issues: undefined, report: { ...d.report, unmatchedDoors: undefined } });
  assert.equal(rest(after), rest(before));
  const applied = seen[0]!;
  assert.equal(applied.accepted, true);
  assert.equal(applied.applied, true);
  assert.deepEqual([...applied.portal!.rooms].sort(), ["left", "right"]);
  assert.equal(applied.portal!.reviewed, true);
  assert.equal(applied.elevationFeet, 0);
  assert.deepEqual(applied.ordinary, { state: "unmatched", candidates: [], hasExplicitReview: false });
  assert.equal(applied.native!.kind, "native-pair");
  assert.notEqual(applied.native!.sides[0]!.cellId, applied.native!.sides[1]!.cellId);
  for (const s of applied.native!.sides) assert.ok(s.ownerGapFeet! > 0 && s.ownerGapFeet! <= 2);
  // An observation reports the same decision and changes nothing.
  const observed: NativeDoorOwnerEvidence[] = [];
  const watched = await preLanding(input, { nativeDoorOwnerReview: { decisions: [], observe: [{ levelId: 1, nativeDoorId: 10 }, { levelId: 1, nativeDoorId: 999 }], onEvidence: (e) => observed.push(e) } });
  assert.equal(JSON.stringify(watched), JSON.stringify(before));
  assert.deepEqual(observed.map((e) => [e.nativeDoorId, e.accepted, e.applied]), [[10, true, false], [999, false, false]]);
  assert.deepEqual(observed[0]!.native!.rooms && [...observed[0]!.native!.rooms].sort(), ["left", "right"]);
  // Refusals abort the compile with the reason.
  const refuse = async (decision: { levelId: number; nativeDoorId: number; roomKeys: [string, string] }, pattern: RegExp, from = input) =>
    assert.rejects(prepareIndoorDataset(from.model, from.source, sha, undefined, { nativeDoorOwnerReview: { decisions: [decision] } }), pattern);
  await refuse({ levelId: 1, nativeDoorId: 999, roomKeys: ["left", "right"] }, /door 999 on level 1: no native door with this id/);
  await refuse({ levelId: 2, nativeDoorId: 10, roomKeys: ["left", "right"] }, /door 10 on level 2: no native door with this id/);
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "missing"] }, /room missing is not a walkable area on the door's level/);
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "left"] as [string, string] }, /two different room keys/);
  const linked = await fixture();
  linked.source.navigation = { version: 1, doorLinks: [{ doorId: 10, levelId: 1, rooms: ["left", "right"] }] };
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }, /explicit reviews keep precedence/, linked);
  // The outline is beyond the 2 ft owner gap: never widened, so refused.
  const far = await fixture(8.1, 12.6);
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }, /Native door owner review refused for door 10 on level 1: .*limit 2 ft/, far);
  // The legacy matcher, or the automatic ownership recovery, already pairs the
  // door: the review is not needed and is refused.
  for (const paired of [await fixture(9.9, 10.1), await fixture(8.5, 11.5)])
    await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }, /already paired without this review/, paired);
  // Two native levels on one plane: its reviewed walls are not complete yet.
  const shared = await fixture();
  (shared.model.levels as unknown[]).push({ levelId: 2, elevation: 0.01, candidates: 1 });
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }, /Several native levels share this plane/, shared);
  // Without native envelopes there are no native cells to decide from.
  const legacy = await fixture();
  delete legacy.source.nativeIndoorEnvelopes;
  await refuse({ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }, /needs a project with native indoor envelopes/, legacy);
});

test("the cells used at door matching are the finished native circulation cells on both sides", async () => {
  const input = await fixture();
  const seen: NativeDoorOwnerEvidence[] = [];
  let finished: NonNullable<IndoorDataset["circulationGeometry"]>["cells"] | undefined;
  await assert.rejects(prepareIndoorDataset(input.model, input.source, sha, undefined, {
    nativeDoorOwnerReview: { decisions: [{ levelId: 1, nativeDoorId: 10, roomKeys: ["left", "right"] }], onEvidence: (e) => seen.push(e) },
    nativeLandingApproaches: async () => ({ edges: [], diagnostics: [] }),
    nativeCirculationCompiler: async (model, data) => { finished = prepareNativeCirculationGeometry(model, data).geometry.cells; throw new Stop(); },
  }), Stop);
  const bounds = (ring: readonly (readonly number[])[]) => [Math.min(...ring.map((p) => p[0]!)), Math.min(...ring.map((p) => p[1]!)), Math.max(...ring.map((p) => p[0]!)), Math.max(...ring.map((p) => p[1]!))];
  assert.equal(finished!.length, 2);
  for (const side of seen[0]!.native!.sides) {
    const same = finished!.filter((c) => JSON.stringify(c.roomKeys) === JSON.stringify(side.cellRoomKeys) && JSON.stringify(bounds(c.ringsFeet[0]!)) === JSON.stringify(side.cellBoundsFeet));
    assert.equal(same.length, 1, `${side.side} cell is a finished circulation cell`);
  }
});

test("without the option, and with an empty review, the compile is unchanged", async () => {
  const input = await fixture();
  const snapshot = JSON.stringify(input.source);
  const plain = JSON.stringify(await preLanding(input));
  assert.equal(JSON.stringify(await preLanding(input, { nativeDoorOwnerReview: { decisions: [] } })), plain);
  assert.equal(JSON.stringify(await preLanding(input, { nativeDoorOwnerReview: undefined })), plain);
  assert.equal(JSON.stringify(input.source), snapshot, "source rooms are not mutated");
});
