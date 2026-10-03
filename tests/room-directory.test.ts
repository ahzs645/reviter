import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanRoomBoundary, containsRoomPoint, containsDirectoryRoomPoint, isHallway, findDirectoryRoute, hallwayRouteComponents, parseRoomDirectory, roomPortals, validRoomBoundary,
  type DirectoryRoom,
} from "../lib/reviter/room-directory.ts";

const room = (key: string, name: string, polygonFeet: [number, number][], labelPointFeet: [number, number], levelId = 1): DirectoryRoom => ({
  key, name, number: key, polygonFeet, labelPointFeet, levelId, confidence: 1,
});
const rooms = [
  room("office-a", "Office", [[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]),
  room("hall", "Corridor", [[11, 0], [16, 0], [16, 25], [11, 25]], [13, 12]),
  room("office-b", "Office", [[0, 15], [10, 15], [10, 25], [0, 25]], [5, 20]),
];
const doors = [
  { id: 10, point: [10.5, 5] as [number, number], halfWidth: .6, halfHeight: 1.5 },
  { id: 20, point: [10.5, 20] as [number, number], halfWidth: .6, halfHeight: 1.5 },
];

test("routes connect rooms through recovered doors and stay in their hallway", () => {
  const portals = roomPortals(rooms, doors);
  assert.equal(portals.length, 2);
  const route = findDirectoryRoute(rooms, portals, "office-a", "office-b");
  assert.ok(route);
  assert.deepEqual(route.roomKeys, ["office-a", "hall", "office-b"]);
  assert.ok(route.points.some((p) => p[0] > 11));
  // Check every part of the path, including the space between simplified vertices.
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!; const b = route.points[i]!;
    for (let t = 0; t <= 1; t += .05) {
      const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      assert.ok(rooms.some((r) => containsRoomPoint(p, r.polygonFeet)) || doors.some((d) =>
        Math.abs(p[0] - d.point[0]) <= d.halfWidth + .3 && Math.abs(p[1] - d.point[1]) <= d.halfHeight + .3));
    }
  }
});

test("missing door evidence, adjacent room walls, and different floors cannot form routes", () => {
  assert.equal(findDirectoryRoute(rooms, roomPortals(rooms, doors.slice(0, 1)), "office-a", "office-b"), null);
  const adjacent = [room("a", "Office", [[0, 0], [5, 0], [5, 5], [0, 5]], [2, 2]), room("b", "Office", [[5, 0], [10, 0], [10, 5], [5, 5]], [8, 2])];
  assert.equal(findDirectoryRoute(adjacent, [], "a", "b"), null);
  assert.equal(findDirectoryRoute([rooms[0]!, { ...rooms[2]!, levelId: 2 }], [], "office-a", "office-b"), null);
});

test("hallway networks cannot connect through a private room with two doors", () => {
  const separated = [
    room("left", "Corridor", [[0, 0], [5, 0], [5, 10], [0, 10]], [2, 5]),
    room("class", "Classroom", [[6, 0], [16, 0], [16, 10], [6, 10]], [11, 5]),
    room("right", "Corridor", [[17, 0], [22, 0], [22, 10], [17, 10]], [20, 5]),
  ];
  const portals = roomPortals(separated, [
    { id: 1, point: [5.5, 5], halfWidth: .6, halfHeight: 1.5 },
    { id: 2, point: [16.5, 5], halfWidth: .6, halfHeight: 1.5 },
  ]);
  assert.equal(portals.length, 2);
  assert.equal(findDirectoryRoute(separated, portals, "left", "right"), null);
  assert.equal(hallwayRouteComponents(separated, portals).length, 2);
  assert.ok(findDirectoryRoute(separated, portals, "left", "class"));
});

test("private-room obstacles override overlapping hallway fills in either annotation order", () => {
  const overlapping = [
    room("hall", "Corridor", [[0, 0], [22, 0], [22, 10], [0, 10]], [2, 5]),
    room("class", "Classroom", [[6, 0], [16, 0], [16, 10], [6, 10]], [11, 5]),
    room("lobby", "Lobby", [[17, 0], [22, 0], [22, 10], [17, 10]], [20, 5]),
  ];
  assert.equal(findDirectoryRoute(overlapping, [], "hall", "lobby"), null);
  assert.equal(findDirectoryRoute([...overlapping].reverse(), [], "hall", "lobby"), null);
});

test("routing preserves a concave hallway instead of drawing across its exterior", () => {
  const bent = [room("hall", "Corridor", [[0, 0], [15, 0], [15, 5], [5, 5], [5, 15], [0, 15]], [2, 12]),
    room("lobby", "Lobby", [[0, 15], [5, 15], [5, 20], [0, 20]], [2, 18])];
  const route = findDirectoryRoute(bent, [], "hall", "lobby");
  assert.ok(route);
  assert.ok(route.points.every((p) => bent.some((r) => containsRoomPoint(p, r.polygonFeet))));
});

test("ambiguous door matches are omitted", () => {
  assert.equal(roomPortals([...rooms, { ...rooms[0]!, key: "duplicate-geometry" }], doors).length, 1);
});

test("boundary cleanup preserves corners and edits reject crossings and repeated vertices", () => {
  assert.deepEqual(cleanRoomBoundary([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]]), [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.equal(validRoomBoundary([[0, 0], [10, 10], [0, 10], [10, 0]]), false);
  assert.equal(validRoomBoundary([[0, 0], [10, 0], [10, 10], [0, 10]]), true);
  assert.equal(validRoomBoundary([[0, 0], [10, 0], [5, 5], [10, 10], [0, 10], [5, 5]]), false);
});

test("annotation import preserves provenance while rejecting unsupported frames and invalid numbers", () => {
  const input = { format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: { fileName: "a.rvt" }, annotations: [{ ...rooms[0], source: { polygon: "derived" }, dwg: { sha256: "original-hash" } }] };
  assert.deepEqual(parseRoomDirectory(JSON.stringify(input)), input);
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...input, coordinateSystem: "metres" })));
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...input, annotations: [input.annotations[0], input.annotations[0]] })));
  assert.throws(() => parseRoomDirectory(JSON.stringify({ ...input, annotations: [{ ...rooms[0], confidence: null }] })));
});


test("dining and multipurpose halls are destinations, not hallway shortcuts", () => {
  for (const name of ["Lower Dining Hall", "Multi Purpose Hall", "Lecture Hall"]) assert.equal(isHallway({ ...rooms[0]!, name }), false);
  for (const name of ["Hallway", "Corridor", "Main Hall", "Atrium", "Multi Purpose Circulation Space and Hall"]) assert.equal(isHallway({ ...rooms[0]!, name }), true);
});

test("standalone links are circulation while private rooms and explicit room reviews remain destinations", () => {
  for (const name of ["Link", "Connecting Link"])
    assert.equal(isHallway({ ...rooms[0]!, name }), true);
  assert.equal(isHallway({ ...rooms[0]!, name: "Data Link Room" }), false);
  assert.equal(isHallway({ ...rooms[0]!, name: "Link", access: { kind: "staff", evidence: "user-reported" } }), false);
  assert.equal(isHallway({ ...rooms[0]!, name: "Link", spaceUse: { kind: "room", evidence: "user-reported" } }), false);
});

test('a void is selectable geometry but cannot be a route endpoint or a shortcut through an overlapping hallway',()=>{
  const hall={...room('hall','Corridor',[[0,0],[20,0],[20,10],[0,10]],[2,5]),circulationGroup:'hall'};
  const end={...hall,key:'right',labelPointFeet:[18,5] as [number,number]};
  const voidRoom={...room('drop','Rotunda',[[8,0],[12,0],[12,10],[8,10]],[10,5]),walkability:'void' as const};
  assert.ok(findDirectoryRoute([hall,end],[],'hall','right'));
  assert.ok(containsDirectoryRoomPoint([10,5],voidRoom));
  assert.equal(findDirectoryRoute([hall,end,voidRoom],[],'drop','drop'),null);
  assert.equal(findDirectoryRoute([hall,end,voidRoom],[],'hall','right'),null);
  const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:[voidRoom]};
  assert.deepEqual(parseRoomDirectory(JSON.stringify(data)).annotations[0],voidRoom);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,annotations:[{...voidRoom,walkability:'floating'}]})));
});

test('two nearby areas on the same side of a precise door do not become a false door link',()=>{
 const rs=[room('a','Corridor',[[0,0],[5,0],[5,10],[0,10]],[2,5]),room('b','Copy',[[6,0],[11,0],[11,10],[6,10]],[8,5])];
 assert.equal(roomPortals(rs,[{id:1,point:[5.5,-.5],halfWidth:2,halfHeight:.6,normal:[0,1]}]).length,0);
});

test("omitted source plans survive export without becoming imported floors or rooms", () => {
  const hash="a".repeat(64);
  const data={format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:"model.rvt"},annotations:rooms,sourceCoverage:{sourceSha256:hash,omittedSheets:[{building:"07",sectionId:"07 Agora LVL 0 and 2",labelCount:25,reason:"registration ambiguous"}]}};
  const loaded=parseRoomDirectory(JSON.stringify(data));
  assert.deepEqual(loaded.annotations,rooms);
  assert.deepEqual(loaded.sourceCoverage,data.sourceCoverage);
  assert.deepEqual(parseRoomDirectory(JSON.stringify(loaded)).sourceCoverage,data.sourceCoverage);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,sourceCoverage:{...data.sourceCoverage,omittedSheets:[{...data.sourceCoverage.omittedSheets[0],labelCount:-1}]}})),/Source coverage/);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,sourceCoverage:{...data.sourceCoverage,omittedSheets:[...data.sourceCoverage.omittedSheets,...data.sourceCoverage.omittedSheets]}})),/Source coverage/);
  assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,boundaryReference:{format:"reviter-boundary-reference",version:1,coordinateSystem:"revit-model-feet",sourceSha256:"b".repeat(64),sections:[]}})),/Source coverage/);
});

test('native partial dividers inside shared circulation require a detour',()=>{
  const shared=[room('left','Corridor',[[0,0],[8,0],[8,12],[0,12]],[3,4]),room('right','Lobby',[[8,0],[16,0],[16,12],[8,12]],[13,4])];
  const wall={polygon:[[7.95,0],[8.05,0],[8.05,8],[7.95,8]] as [number,number][]};
  const route=findDirectoryRoute(shared,[],'left','right',{}, {walls:[wall],columns:[]});
  assert.ok(route);assert.ok(route.points.some(p=>p[1]>8));
  for(let i=1;i<route.points.length;i++){const a:[number,number]=route.points[i-1]!;const b:[number,number]=route.points[i]!;for(let t=0;t<=1;t+=.01)assert.equal(containsRoomPoint([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],wall.polygon),false);}
  const complete={polygon:[[7.95,0],[8.05,0],[8.05,12],[7.95,12]] as [number,number][]};
  assert.equal(findDirectoryRoute(shared,[],'left','right',{}, {walls:[complete],columns:[]}),null);
  assert.equal(hallwayRouteComponents(shared,[],{}, {walls:[complete],columns:[]}).length,2);
});

test('only matched precise openings can permit native walls and never columns',()=>{
  const shared=[room('left','Corridor',[[0,0],[8,0],[8,12],[0,12]],[3,4]),room('right','Lobby',[[8,0],[16,0],[16,12],[8,12]],[13,4])];
  const wall={polygon:[[7.9,0],[8.1,0],[8.1,12],[7.9,12]] as [number,number][]};
  const portal={rooms:['left','right'] as [string,string],point:[8,4] as [number,number],from:[7.7,4] as [number,number],to:[8.3,4] as [number,number],halfWidth:.5,halfHeight:1,footprint:[[7.5,3],[8.5,3],[8.5,5],[7.5,5]] as [number,number][]};
  assert.ok(findDirectoryRoute(shared,[portal],'left','right',{}, {walls:[wall],columns:[]}));
  assert.equal(findDirectoryRoute(shared,[{...portal,footprint:undefined}],'left','right',{}, {walls:[wall],columns:[]}),null);
  assert.equal(findDirectoryRoute(shared,[{...portal,rooms:['left','missing']}],'left','right',{}, {walls:[wall],columns:[]}),null);
  assert.equal(findDirectoryRoute(shared,[portal],'left','right',{}, {walls:[],columns:[wall]}),null);
});
