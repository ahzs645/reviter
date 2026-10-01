import assert from "node:assert/strict";
import test from "node:test";
import { boundaryFaces, rebuildRoomBoundaries, registerBoundaryReference, type BoundaryReference, type BoundarySegment } from "../lib/reviter/room-boundaries.ts";
import { containsDirectoryRoomPoint, findDirectoryRoute, hallwayComponents, parseRoomDirectory, roomArea, roomPortals, validRoomBoundary, type DirectoryRoom, type RoomPoint } from "../lib/reviter/room-directory.ts";
import type { ArchitecturalPlanGeometry } from "../lib/reviter/architectural-plan.ts";
const segments = (ps: RoomPoint[]): BoundarySegment[] => ps.map((p, i) => [p, ps[(i + 1) % ps.length]!]);
const empty: ArchitecturalPlanGeometry = { walls: [], doors: [], columns: [], floors: [], cutElevation: 4 };
const makeRoom = (key: string, name: string, polygonFeet: RoomPoint[], labelPointFeet: RoomPoint): DirectoryRoom => ({ key, name, polygonFeet, labelPointFeet, levelId: 1, confidence: .7, dwg: { sha256: "survey-hash", sectionId: "sheet" }, source: { polygon: "derived" } });
const reference = (wallSegments: BoundarySegment[]): BoundaryReference => ({ format: "reviter-boundary-reference", version: 1, coordinateSystem: "revit-model-feet", sourceSha256: "survey-hash", sections: [{ sectionId: "sheet", levelId: 1, registrationErrorFeet: 0, wallSegments, doorSegments: [] }] });

test("vector faces preserve a rotated concave room and ignore dangling door leaves", () => {
  const rotate = ([x, y]: RoomPoint): RoomPoint => [x * .8 - y * .6 + 100, x * .6 + y * .8 + 800];
  const ps: RoomPoint[] = ([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]] as RoomPoint[]).map(rotate);
  const lines = [...segments(ps), [rotate([0, 5]), rotate([2, 5])] as BoundarySegment];
  const faces = boundaryFaces(lines).filter((f) => f.signedArea > 0);
  assert.equal(faces.length, 1); assert.equal(faces[0]!.polygon.length, 6); assert.ok(Math.abs(roomArea(faces[0]!.polygon) - 75) < 1e-8);
  assert.ok(!faces[0]!.polygon.some(([x, y]) => x === 98.6 && y === 805.2));
});

test("shared hallway labels become one region with enclosed rooms retained as holes", () => {
  const outer: RoomPoint[] = [[0, 0], [30, 0], [30, 30], [0, 30]];
  const inner: RoomPoint[] = [[5, 5], [25, 5], [25, 25], [5, 25]];
  const a = makeRoom("north", "Corridor", [[0, 25], [30, 25], [30, 30], [0, 30]], [15, 27]);
  const b = makeRoom("south", "Corridor", [[0, 0], [30, 0], [30, 5], [0, 5]], [15, 2]);
  const office = makeRoom("office", "Office", inner, [15, 15]);
  // Hallway pieces also include the side circulation area in their old partition.
  a.polygonFeet = [[0, 5], [5, 5], [5, 25], [30, 25], [30, 30], [0, 30]];
  b.polygonFeet = [[0, 0], [30, 0], [30, 25], [25, 25], [25, 5], [0, 5]];
  const rebuilt = rebuildRoomBoundaries([a, b, office], reference([...segments(outer), ...segments(inner)]), empty);
  assert.equal(rebuilt.rebuilt, 3);
  assert.equal(rebuildRoomBoundaries(rebuilt.rooms, reference([...segments(outer), ...segments(inner)]), empty).rebuilt, 3); assert.equal(rebuilt.rooms[0]!.holesFeet?.length, 1);
  assert.equal(rebuilt.rooms[0]!.circulationGroup, rebuilt.rooms[1]!.circulationGroup);
  assert.equal(containsDirectoryRoomPoint([15, 15], rebuilt.rooms[0]!), false);
  assert.equal(hallwayComponents(rebuilt.rooms, []).length, 1);
  const route = findDirectoryRoute(rebuilt.rooms, [], "north", "south"); assert.ok(route);
  for (let i = 1; i < route.points.length; i++) {
    const p = route.points[i - 1]!; const q = route.points[i]!;
    for (let t = 0; t <= 1; t += .05) assert.ok(containsDirectoryRoomPoint([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], rebuilt.rooms[0]!));
  }
  const json = { format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: { fileName: "test.rvt" }, annotations: rebuilt.rooms, boundaryReference: reference([...segments(outer), ...segments(inner)]) };
  assert.deepEqual(parseRoomDirectory(JSON.stringify(json)), JSON.parse(JSON.stringify(json)));
});

test("a door opening closes an office face without allowing wall crossings elsewhere", () => {
  const office = makeRoom("office", "Office", [[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]);
  const hall = makeRoom("hall", "Corridor", [[10, 0], [15, 0], [15, 10], [10, 10]], [12, 5]);
  const wallSegments: BoundarySegment[] = [...segments([[0, 0], [15, 0], [15, 10], [0, 10]]), [[10, 0], [10, 4]], [[10, 6], [10, 10]]];
  const noDoor = rebuildRoomBoundaries([office, hall], reference(wallSegments), empty);
  assert.equal(noDoor.rebuilt, 0); assert.deepEqual(noDoor.rooms[0], office);
  const geometry = { ...empty, doors: [{ elementId: 99, polygon: [[9.9, 4], [10.1, 4], [10.1, 6], [9.9, 6]] as RoomPoint[], approximate: false }] };
  const closed = rebuildRoomBoundaries([office, hall], reference(wallSegments), geometry);
  assert.equal(closed.rebuilt, 2);
  const portals = roomPortals(closed.rooms, [{ id: 99, point: [10, 5], halfWidth: .2, halfHeight: 1 }]);
  assert.equal(portals.length, 1); assert.ok(findDirectoryRoute(closed.rooms, portals, "office", "hall"));
  assert.equal(findDirectoryRoute(closed.rooms, [], "office", "hall"), null);
});

test("registration requires matching survey provenance and refuses moved or distorted anchors", () => {
  const samples: RoomPoint[] = [[0, 0], [100, 0], [0, 100], [100, 100]];
  const rooms = samples.map((p, i) => ({ ...makeRoom(String(i), "Office", [[0, 0], [1, 0], [1, 1]], [10 - p[1] * .01, 20 + p[0] * .01]), dwg: { sha256: "survey-hash", sectionId: "sheet", anchorDwg: p } }));
  const entities = [{ type: "LINE", layer: "Wall", points: [[0, 0], [100, 0]] as RoomPoint[] }];
  const sheets = [{ name: "sheet", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }];
  const fitted = registerBoundaryReference(rooms, entities, sheets, "survey-hash");
  assert.equal(fitted.sections.length, 1); assert.deepEqual(fitted.sections[0]!.wallSegments, [[[10, 20], [10, 21]]]);
  assert.equal(registerBoundaryReference(rooms, entities, sheets, "wrong-hash").sections.length, 0);
  const distorted = rooms.map((r, i) => ({ ...r, labelPointFeet: [r.labelPointFeet[0] + (i === 0 ? 10 : 0), r.labelPointFeet[1]] as RoomPoint }));
  assert.equal(registerBoundaryReference(distorted, entities, sheets, "survey-hash").sections.length, 0);
});

test('collinear drafting overlaps and island bridges produce simple outer and hole faces',()=>{
 const outer=segments([[0,0],[20,0],[20,20],[0,20]]),hole=segments([[5,5],[9,5],[9,9],[5,9]]);
 const faces=boundaryFaces([...outer,...hole,[[0,0],[10,0]],[[0,7],[5,7]]]);
 assert.ok(faces.some(f=>f.signedArea===400 && validRoomBoundary(f.polygon)));
 assert.ok(faces.some(f=>f.signedArea===-16 && validRoomBoundary(f.polygon)));
 assert.ok(faces.every(f=>validRoomBoundary(f.polygon)));
});

test('split plans on one survey sheet retain separate saved floor registrations',()=>{
 const anchors:RoomPoint[]=[[0,0],[100,0],[0,100]];
 const rooms=[1,2].flatMap(levelId=>anchors.map((p,i)=>({...makeRoom(`${levelId}:${i}`,'Atrium',[[0,0],[1,0],[1,1]],[levelId*10+p[0]*.01,levelId*20+p[1]*.01]),levelId,dwg:{sha256:'survey-hash',sectionId:`sheet #${levelId}`,anchorDwg:p}})));
 const reference=registerBoundaryReference(rooms,[{type:'LINE',layer:'Wall',points:[[0,0],[100,0]]}],[{name:'sheet',bounds:{minX:0,minY:0,maxX:100,maxY:100}}],'survey-hash');
 assert.equal(reference.sections.length,2);assert.deepEqual(reference.sections.map(s=>[s.sectionId,s.levelId]),[['sheet #1',1],['sheet #2',2]]);
 assert.notDeepEqual(reference.sections[0]!.wallSegments,reference.sections[1]!.wallSegments);
});
