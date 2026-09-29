import assert from "node:assert/strict";
import test from "node:test";

import { makePascalScene } from "../lib/reviter/export-pascal.ts";
import { makeIfcCenterlines } from "../lib/reviter/export-ifc.ts";
import {
  annotationsToReviewedRooms,
  appendRoomZones,
  applyPascalRoomEdits,
  diffPascalWalls,
  feetToPascalPlan,
  mergeRoomAnnotations,
  mintRoomKey,
  pascalFrameFor,
  pascalPlanToFeet,
  proposalFromDerivedRoom,
  readPascalFrame,
  readPascalRoomEdits,
  rebaseWallEdits,
  zoneIdForKey,
} from "../lib/reviter/room-annotations.ts";
import type { PascalBuild, Point2, RoomAnnotation } from "../lib/reviter/room-annotations.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const FOOT = 0.3048;
const LEVEL = 311;

function wallRecord(elementId: number, start: Point2, end: Point2): ElementBoundsRecord {
  return {
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    elementId,
    categoryId: -2_000_011,
    categoryName: "Walls",
    boundsFeet: {
      min: { x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), z: 10 },
      max: { x: Math.max(start[0], end[0]), y: Math.max(start[1], end[1]) + 1, z: 20 },
    },
    solid: {
      elementId,
      start: { x: start[0], y: start[1] },
      end: { x: end[0], y: end[1] },
      baseElevation: 10,
      topElevation: 20,
      thickness: 0.5,
    },
  };
}

/** A 20 ft × 10 ft room of four walls on level 311, well away from the origin. */
function fixture(origin = { x: 105, y: 205, z: 10 }): ConvertResult {
  const corners: Point2[] = [[100, 200], [120, 200], [120, 210], [100, 210]];
  const records = corners.map((corner, index) => wallRecord(20 + index, corner, corners[(index + 1) % 4]!));
  return {
    fileName: "fixture.rvt",
    origin,
    bbox: { min: { x: -20, y: -20, z: 0 }, max: { x: 20, y: 20, z: 20 } },
    levels: [{ levelId: LEVEL, elevation: 10, source: "assoc-level-id" }],
    elementBounds: records,
    meshes: [],
    materials: [],
    segments: [],
    nativeAssociatedLevelRelations: records.map((record) => ({ elementId: record.elementId, levelId: LEVEL })),
    decoderCoverage: { revitVersion: 2027 },
  } as unknown as ConvertResult;
}

function annotation(overrides: Partial<RoomAnnotation> = {}): RoomAnnotation {
  return {
    key: "rm-311-aaa",
    levelId: LEVEL,
    number: "101",
    name: "Seminar",
    polygonFeet: [[100.25, 200.25], [119.75, 200.25], [119.75, 209.75], [100.25, 209.75]],
    labelPointFeet: [110, 205],
    source: { number: "dwg", name: "dwg", polygon: "derived" },
    dwg: {
      sha256: "ab".repeat(32),
      sectionId: "3",
      entityHandle: "2A3F",
      tag: "ROOMNUM",
      layer: "A-ANNO-ROOM",
      rawText: "101",
      anchorDwg: [5000, 7000],
    },
    confidence: 0.9,
    derivedRoomKey: "311:abc",
    status: "active",
    ...overrides,
  };
}

function exported(annotations: RoomAnnotation[], result = fixture()) {
  const scene = makePascalScene(result, { extras: "none" }) as PascalBuild;
  const frame = pascalFrameFor(result);
  const report = appendRoomZones(scene, annotations, frame, { provenance: true });
  return { scene, frame, report };
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("the frame reproduces the Pascal exporter's own wall coordinates", () => {
  const result = fixture();
  const scene = makePascalScene(result, { extras: "none" });
  const frame = pascalFrameFor(result);
  const wall = scene.nodes.wall_e20!;
  assert.deepEqual(wall.start, feetToPascalPlan(frame, [100, 200]));
  // x shifts by the origin and scales; plan y is negated into Pascal z.
  assert.ok(Math.abs((wall.start as Point2)[0] - (100 - 105) * FOOT) < 1e-12);
  assert.ok(Math.abs((wall.start as Point2)[1] - -(200 - 205) * FOOT) < 1e-12);
  const back = pascalPlanToFeet(frame, wall.end as Point2);
  assert.ok(Math.abs(back[0] - 120) < 1e-9 && Math.abs(back[1] - 200) < 1e-9);

  const mirrored = makePascalScene(result, { extras: "none", mirrorPlan: true });
  assert.deepEqual(mirrored.nodes.wall_e20!.start, feetToPascalPlan(pascalFrameFor(result, { mirrorPlan: true }), [100, 200]));
});

test("writes a room as a Pascal zone under its level with every schema field explicit", () => {
  const { scene, report } = exported([annotation()]);
  assert.equal(report.written, 1);
  const zone = scene.nodes[zoneIdForKey("rm-311-aaa")]!;
  assert.equal(zone.type, "zone");
  assert.equal(zone.parentId, `level_r${LEVEL}`);
  assert.ok(scene.nodes[`level_r${LEVEL}`]!.children!.includes(zone.id));
  assert.equal(zone.spaceRole, "room");
  assert.equal(zone.roomNumber, "101");
  assert.equal(zone.name, "Seminar");
  for (const field of [
    "autoFromWalls", "boundaryWallIds", "enclosureStatus", "floorFinish", "wallFinish",
    "ceilingFinish", "ceilingHeight", "occupancy", "clearDimensionPolicy", "color",
  ]) assert.ok(field in zone, field);
  // Counter-clockwise in Pascal's [x, z] plan, like the exporter's slabs.
  const polygon = zone.polygon as Point2[];
  let area = 0;
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  });
  assert.ok(area > 0);
  const meta = zone.metadata!.reviter as Record<string, unknown>;
  assert.equal(meta.key, "rm-311-aaa");
  assert.equal((meta.dwg as { entityHandle: string }).entityHandle, "2A3F");
  assert.deepEqual(zone.provenance, {
    refs: [
      { ns: "reviter:room", id: "rm-311-aaa" },
      { ns: `dwg:${"ab".repeat(8)}`, id: "2A3F", role: "absorbed" },
    ],
  });
  assert.ok(readPascalFrame(scene));
});

test("appending again replaces the zone rather than duplicating it", () => {
  const { scene, frame } = exported([annotation()]);
  const report = appendRoomZones(scene, [annotation({ number: "102" })], frame);
  assert.equal(report.replaced, 1);
  const zones = Object.values(scene.nodes).filter((node) => node.type === "zone");
  assert.equal(zones.length, 1);
  assert.equal(zones[0]!.roomNumber, "102");
  assert.equal(scene.nodes[`level_r${LEVEL}`]!.children!.filter((id) => id === zones[0]!.id).length, 1);
});

test("skips rooms whose level is not in the scene and cuts long numbers to Pascal's 32", () => {
  const { report, scene } = exported([
    annotation({ key: "rm-x", levelId: 999 }),
    annotation({ key: "rm-long", number: "N".repeat(40) }),
  ]);
  assert.deepEqual(report.skipped.map((entry) => entry.key), ["rm-x"]);
  assert.deepEqual(report.truncatedNumbers, ["rm-long"]);
  const zone = scene.nodes[zoneIdForKey("rm-long")]!;
  assert.equal((zone.roomNumber as string).length, 32);
  assert.equal((zone.metadata!.reviter as { number: string }).number.length, 40);
});

test("an untouched scene reads back with no edits", () => {
  const { scene } = exported([annotation()]);
  const { edits } = readPascalRoomEdits(roundTrip(scene), { exportedKeys: ["rm-311-aaa"] });
  assert.equal(edits.length, 1);
  assert.equal(edits[0]!.kind, "edited");
  assert.deepEqual((edits[0] as { changed: object }).changed, {});
});

test("reads a person's renumbering, renaming, reshaping, drawing and deleting as manual edits", () => {
  const { scene, frame } = exported([annotation(), annotation({ key: "rm-311-bbb", number: "102", dwg: undefined, derivedRoomKey: undefined })]);
  const edited = roundTrip(scene);
  const zone = edited.nodes[zoneIdForKey("rm-311-aaa")]!;
  zone.roomNumber = "101A";
  zone.name = "Faculty Office";
  const moved = (zone.polygon as Point2[]).map(([x, z]) => [x + 1, z] as Point2);
  zone.polygon = moved;
  // Delete the second zone as Pascal does: node and child reference both go.
  delete edited.nodes[zoneIdForKey("rm-311-bbb")];
  const level = edited.nodes[`level_r${LEVEL}`]!;
  level.children = level.children!.filter((id) => id !== zoneIdForKey("rm-311-bbb"));
  // Draw a new room in Pascal.
  edited.nodes.zone_k3j2h1g0f9e8d7c6 = {
    object: "node", id: "zone_k3j2h1g0f9e8d7c6", type: "zone", name: "Storage", parentId: level.id,
    visible: true, polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], roomNumber: "103", spaceRole: "room", metadata: {},
  };
  level.children.push("zone_k3j2h1g0f9e8d7c6");

  const { edits } = readPascalRoomEdits(edited, { exportedKeys: ["rm-311-aaa", "rm-311-bbb"] });
  const edit = edits.find((entry) => entry.kind === "edited")!;
  assert.equal(edit.kind, "edited");
  if (edit.kind !== "edited") return;
  assert.equal(edit.changed.number, "101A");
  assert.equal(edit.changed.name, "Faculty Office");
  const shiftedFeet = pascalPlanToFeet(frame, moved[0]!);
  assert.ok(edit.changed.polygonFeet!.some(([x, y]) => Math.abs(x - shiftedFeet[0]) < 1e-9 && Math.abs(y - shiftedFeet[1]) < 1e-9));
  assert.ok(edits.some((entry) => entry.kind === "deleted" && entry.key === "rm-311-bbb"));
  const added = edits.find((entry) => entry.kind === "added");
  assert.ok(added && added.kind === "added");
  assert.equal(added.annotation.number, "103");
  assert.equal(added.annotation.source.number, "manual");

  const next = applyPascalRoomEdits(
    [annotation(), annotation({ key: "rm-311-bbb", number: "102" })],
    edits,
    "2026-09-29T00:00:00.000Z",
  );
  const aaa = next.find((entry) => entry.key === "rm-311-aaa")!;
  assert.equal(aaa.number, "101A");
  assert.deepEqual(aaa.source, { number: "manual", name: "manual", polygon: "manual" });
  assert.equal(aaa.dwg?.entityHandle, "2A3F", "DWG provenance is kept alongside the manual value");
  assert.equal(next.find((entry) => entry.key === "rm-311-bbb")!.status, "deleted");
  assert.equal(next.length, 3);
});

test("a copied zone becomes a new manual room that remembers where it came from", () => {
  const { scene } = exported([annotation()]);
  const edited = roundTrip(scene);
  const copy = { ...roundTrip(edited.nodes[zoneIdForKey("rm-311-aaa")]!), id: "zone_copyofroom000001" };
  edited.nodes[copy.id] = copy;
  edited.nodes[`level_r${LEVEL}`]!.children!.push(copy.id);
  const { edits } = readPascalRoomEdits(edited);
  const added = edits.find((entry) => entry.kind === "added");
  assert.ok(added && added.kind === "added");
  assert.equal(added.copiedFromKey, "rm-311-aaa");
  assert.deepEqual(added.annotation.lineage, { op: "duplicate", fromKeys: ["rm-311-aaa"] });
  assert.equal(edits.filter((entry) => entry.kind === "edited").length, 1);
});

test("re-applying DWG labels updates automated fields and never clobbers manual ones", () => {
  const manualName = { ...annotation(), name: "Faculty Office", source: { number: "dwg", name: "manual", polygon: "derived" } } as RoomAnnotation;
  manualName.auto = { number: "101", name: "Seminar", polygonFeet: manualName.polygonFeet };
  const deleted = annotation({ key: "rm-311-ddd", number: "105", status: "deleted", dwg: { ...annotation().dwg!, entityHandle: "2B00" } });
  const proposals: RoomAnnotation[] = [
    // Same handle: DWG now says 101B and "Lab"; the polygon was re-derived.
    annotation({ key: "", number: "101B", name: "Lab", polygonFeet: [[100, 200], [120, 200], [120, 210], [100, 210]] }),
    // The deleted room's label is still in the drawing.
    annotation({ key: "", number: "105", dwg: { ...annotation().dwg!, entityHandle: "2B00" } }),
    // A new label in a new place.
    annotation({ key: "", number: "107", derivedRoomKey: "311:new", labelPointFeet: [300, 300],
      polygonFeet: [[295, 295], [305, 295], [305, 305], [295, 305]], dwg: { ...annotation().dwg!, entityHandle: "2C00" } }),
  ];
  const { annotations, report } = mergeRoomAnnotations([manualName, deleted], proposals, "2026-09-29T00:00:00.000Z");
  const room = annotations.find((entry) => entry.key === "rm-311-aaa")!;
  assert.equal(room.number, "101B", "automated number follows the drawing");
  assert.equal(room.name, "Faculty Office", "manual name survives");
  assert.equal(room.polygonFeet[0]![0], 100, "automated polygon follows the re-derivation");
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0]!.conflict.field, "name");
  assert.equal(report.conflicts[0]!.conflict.proposed, "Lab");
  assert.equal(annotations.find((entry) => entry.key === "rm-311-ddd")!.status, "deleted", "tombstones stay deleted");
  const added = annotations.find((entry) => entry.number === "107")!;
  assert.equal(added.key, mintRoomKey(LEVEL, { dwgHandle: "2C00" }));
  assert.equal(report.added, 1);

  // Running the same proposals again is a no-op: no new conflict, no new room.
  const again = mergeRoomAnnotations(annotations, proposals, "2026-09-30T00:00:00.000Z");
  assert.equal(again.report.conflicts.length, 0);
  assert.equal(again.annotations.length, annotations.length);
});

test("an automated room the new pass no longer proposes is kept and reported stale", () => {
  const { annotations, report } = mergeRoomAnnotations([annotation()], []);
  assert.equal(annotations.length, 1);
  assert.deepEqual(report.stale, ["rm-311-aaa"]);
});

test("keys are deterministic from first evidence and independent of the DWG revision", () => {
  assert.equal(mintRoomKey(311, { dwgHandle: "2A3F" }), mintRoomKey(311, { dwgHandle: "2A3F" }));
  assert.notEqual(mintRoomKey(311, { dwgHandle: "2A3F" }), mintRoomKey(694, { dwgHandle: "2A3F" }));
  assert.match(zoneIdForKey(mintRoomKey(311, { number: "101" })), /^zone_rm-311-[0-9a-f]{12}$/);
  assert.match(zoneIdForKey("a b/c"), /^zone_[A-Za-z0-9._-]+$/);
});

test("a derived room becomes a boundary-only proposal with holes kept apart", () => {
  const proposal = proposalFromDerivedRoom({
    id: 1, levelId: LEVEL, key: "311:k", closure: "closed", gapIds: [], areaSquareFeet: 96, centroid: [5, 5],
    loops: [[[4, 4], [6, 4], [6, 6], [4, 6]], [[0, 0], [10, 0], [10, 10], [0, 10]]],
  });
  assert.equal(proposal.number, "");
  assert.equal(proposal.polygonFeet.length, 4);
  assert.equal(proposal.polygonFeet[2]![0], 10);
  assert.equal(proposal.holesFeet?.length, 1);
  assert.equal(proposal.derivedRoomKey, "311:k");
});

test("annotations reach IFC as IfcSpace with Name = number and LongName = name", () => {
  const rooms = annotationsToReviewedRooms([annotation({ heightFeet: 9 }), annotation({ key: "gone", status: "deleted" })]);
  assert.equal(rooms.length, 1);
  const ifc = makeIfcCenterlines(fixture(), { rooms });
  const spaces = ifc.match(/IFCSPACE\([^\n]+/g) ?? [];
  assert.equal(spaces.length, 1);
  assert.match(spaces[0]!, /IFCSPACE\('[^']+',#\d+,'101',/);
  assert.match(spaces[0]!, /,'Seminar',\.ELEMENT\.,\.INTERNAL\./);
  // Deterministic: the same annotation gives the same GUID on every export.
  assert.equal(makeIfcCenterlines(fixture(), { rooms }).match(/IFCSPACE\('([^']+)'/)![1], spaces[0]!.match(/IFCSPACE\('([^']+)'/)![1]);
});

test("wall edits made in Pascal are read in feet and replayed on a fresh export three-way", () => {
  const { scene } = exported([]);
  const edited = roundTrip(scene);
  const frame = readPascalFrame(edited)!;
  // Heal a gap: pull wall 20's end 0.5 ft further along x.
  edited.nodes.wall_e20!.end = feetToPascalPlan(frame, [120.5, 200]);
  // Delete wall 22 and draw a new one.
  delete edited.nodes.wall_e22;
  edited.nodes[`level_r${LEVEL}`]!.children = edited.nodes[`level_r${LEVEL}`]!.children!.filter((id) => id !== "wall_e22");
  edited.nodes.wall_newonepascal01 = {
    ...roundTrip(scene.nodes.wall_e21!), id: "wall_newonepascal01", metadata: {},
    start: feetToPascalPlan(frame, [110, 200]), end: feetToPascalPlan(frame, [110, 210]),
  };
  // Split wall 23 into two pieces carrying its Revit id (Pascal copies metadata).
  const original = scene.nodes.wall_e23!;
  delete edited.nodes.wall_e23;
  const mid = feetToPascalPlan(frame, [100, 205]);
  edited.nodes.wall_piece000000001 = { ...roundTrip(original), id: "wall_piece000000001", end: mid };
  edited.nodes.wall_piece000000002 = { ...roundTrip(original), id: "wall_piece000000002", start: mid };

  const edits = diffPascalWalls(scene, edited);
  const kinds = edits.map((edit) => edit.kind).sort();
  assert.deepEqual(kinds, ["added", "deleted", "modified", "split"]);
  const modified = edits.find((edit) => edit.kind === "modified")!;
  assert.ok(modified.kind === "modified" && Math.abs(modified.after.endFeet[0] - 120.5) < 1e-9);

  // The RVT was re-saved with an element far away, so the fresh export's
  // origin moved. Edits are in feet, so they still land where they were made.
  const moved = fixture({ x: 140, y: 180, z: 10 });
  const fresh = makePascalScene(moved, { extras: "none" }) as PascalBuild;
  appendRoomZones(fresh, [], pascalFrameFor(moved));
  // ...and the RVT itself moved wall 21, so a (hypothetical) edit to it must conflict.
  const conflicting = { ...modified, nodeId: "wall_e21", before: { ...modified.before, nodeId: "wall_e21" } };
  const report = rebaseWallEdits(fresh, [...edits, conflicting]);
  assert.equal(report.applied, 4);
  assert.equal(report.conflicts.length, 1);
  const freshFrame = readPascalFrame(fresh)!;
  const end = pascalPlanToFeet(freshFrame, fresh.nodes.wall_e20!.end as Point2);
  assert.ok(Math.abs(end[0] - 120.5) < 1e-9 && Math.abs(end[1] - 200) < 1e-9);
  assert.equal(fresh.nodes.wall_e22, undefined);
  assert.equal(fresh.nodes.wall_e23, undefined);
  assert.ok(fresh.nodes.wall_piece000000001 && fresh.nodes.wall_newonepascal01);
  const newStart = pascalPlanToFeet(freshFrame, fresh.nodes.wall_newonepascal01!.start as Point2);
  assert.ok(Math.abs(newStart[0] - 110) < 1e-9 && Math.abs(newStart[1] - 200) < 1e-9);
});
