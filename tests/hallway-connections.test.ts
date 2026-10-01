import assert from "node:assert/strict";
import test from "node:test";
import { connectHallwaysThroughFloor } from "../lib/reviter/hallway-connections.ts";
import { findDirectoryRoute, hallwayComponents, type DirectoryRoom, type RoomPoint } from "../lib/reviter/room-directory.ts";
import type { ArchitecturalPlanGeometry } from "../lib/reviter/architectural-plan.ts";
const rectangle = (x0: number, y0: number, x1: number, y1: number): RoomPoint[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rooms: DirectoryRoom[] = [{ key: "west", number: "10-W", name: "Corridor", levelId: 1, confidence: 1, polygonFeet: rectangle(0, 0, 5, 10), labelPointFeet: [2, 5] }, { key: "east", number: "10-E", name: "Corridor", levelId: 1, confidence: 1, polygonFeet: rectangle(25, 0, 30, 10), labelPointFeet: [27, 5] }];
const geometry: ArchitecturalPlanGeometry = { floors: [[rectangle(0, 0, 30, 10)]], walls: [], doors: [], columns: [], cutElevation: 4 };

test("unlabelled floor connects separated hallways and exports its inference for review", () => {
  const result = connectHallwaysThroughFloor(rooms, [], geometry);
  assert.equal(result.added, 1); assert.equal(result.unresolvedNetworks, 1); assert.equal(hallwayComponents(result.rooms, []).length, 1);
  assert.equal((result.rooms[2]!.source as { polygon: string }).polygon, "native-floor-connection");
  const route = findDirectoryRoute(result.rooms, [], "west", "east"); assert.ok(route);
  assert.ok(route.points.every(([x, y]) => x >= 0 && x <= 30 && y >= 0 && y <= 10));
});

test("thin walls, floor voids and private rooms block invented hallway connections", () => {
  const wall = { elementId: 2, polygon: rectangle(14.31, -1, 14.34, 11), approximate: false };
  assert.equal(connectHallwaysThroughFloor(rooms, [], { ...geometry, walls: [wall] }).added, 0);
  assert.equal(connectHallwaysThroughFloor(rooms, [], { ...geometry, floors: [[rectangle(0, 0, 30, 10), rectangle(10, -1, 20, 11)]] }).added, 0);
  const privateRoom: DirectoryRoom = { ...rooms[0]!, key: "private", name: "Office", polygonFeet: rectangle(12, 0, 18, 10), labelPointFeet: [15, 5] };
  assert.equal(connectHallwaysThroughFloor([...rooms, privateRoom], [], geometry).added, 0);
});

test("a precise door footprint allows a real opening; approximate envelopes cannot remove walls", () => {
  const wall = { elementId: 2, polygon: rectangle(14, -1, 15, 11), approximate: false };
  const door = { elementId: 3, polygon: rectangle(13.5, 4, 15.5, 6), approximate: false };
  assert.equal(connectHallwaysThroughFloor(rooms, [], { ...geometry, walls: [wall], doors: [door] }).added, 1);
  assert.equal(connectHallwaysThroughFloor(rooms, [], { ...geometry, walls: [wall], doors: [{ ...door, approximate: true }] }).added, 0);
});

test("a slab spanning buildings cannot claim an adjoining building's hallway as a new local strip", () => {
  const adjoining:DirectoryRoom={...rooms[0]!,key:"neighbor",number:"09-H",name:"Corridor",polygonFeet:rectangle(12,0,18,10),labelPointFeet:[15,5]};
  assert.equal(connectHallwaysThroughFloor(rooms,[],geometry,[...rooms,adjoining]).added,0);
  assert.equal(connectHallwaysThroughFloor(rooms,[],geometry,[...rooms,{...adjoining,levelId:2}]).added,1);
  assert.equal(connectHallwaysThroughFloor(rooms,[],geometry,[...rooms,{...adjoining,status:"deleted"}]).added,1);
});

test('floor-gap recovery cannot flatten a lower circulation area on the same directory level',()=>{
  const elevations={west:{elevation:0},east:{elevation:-3.28}},original=structuredClone(rooms);
  const result=connectHallwaysThroughFloor(rooms,[],geometry,[],elevations);
  assert.equal(result.added,0);assert.deepEqual(result.rooms,original);assert.equal(result.unresolvedNetworks,2);
});
