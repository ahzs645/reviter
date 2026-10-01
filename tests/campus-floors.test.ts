import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pc from "polygon-clipping";
import { campusFloors, campusFloorLabel } from "../lib/reviter/campus-floors.ts";
import { directoryModelFloor, directoryRoomGroup, landingWithoutTreads } from "../app/studio/directory-model.ts";
import { roomArea, type DirectoryRoom } from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

const room = (building: string, levelId: number, x: number, name = "Corridor"): DirectoryRoom => ({
  key: `${building}-${levelId}`, number: `${building}-100`, name, levelId, confidence: 1,
  polygonFeet: [[x,0],[x+10,0],[x+10,10],[x,10]], labelPointFeet: [x+5,5],
});
const levels = [{levelId: 311, name: "Floor 1", elevation: 0, candidates: 1},
  {levelId: 694, name: "Floor 2", elevation: 14.44, candidates: 1},
  {levelId: 1487816, name: "Floor 1.25", elevation: 3.28, candidates: 1},
  {levelId: 999, elevation: 99, candidates: 1}];

test("campus levels include every active building, preserve native identities and omit levels without mapped areas", () => {
  const rooms = [room("05",311,0), room("07",311,11), room("08",1487816,30), room("05",694,0), {...room("03",311,50),status:"deleted" as const}];
  const before = JSON.stringify(rooms);
  const floors = campusFloors(rooms, levels);
  assert.deepEqual(floors.map(f => f.levelId), [311,1487816,694]);
  assert.deepEqual(floors[0]!.buildings.map(b => b.building), ["05","07"]);
  assert.equal(floors[0]!.records, 2);
  assert.equal(campusFloorLabel(floors[0]!), "Floor 1 · 0.00 ft · #311 · 2 buildings");
  assert.equal(JSON.stringify(rooms), before);
});

test("same-height native levels and differently numbered source plans are not merged", () => {
  const a = {...room("05",311,0),dwg:{sectionId:"05 Libr LVL 1"}} as DirectoryRoom;
  const b = {...room("07",311,11),dwg:{sectionId:"07 Agora LVL 1N"}} as DirectoryRoom;
  const floors = campusFloors([a,b,room("08",1487816,30)], levels.map(l=>({...l,elevation:0})));
  assert.equal(floors.length, 2);
  assert.deepEqual(floors.find(f=>f.levelId===311)!.buildings.map(b=>b.sections), [["05 Libr LVL 1"],["07 Agora LVL 1N"]]);
});

test("combined 3D floor retains building areas, native slab heights and shaft openings", () => {
  const a=room("05",311,0), b=room("07",311,11);
  a.floorOpeningsFeet=[[[2,2],[4,2],[4,4],[2,4]]];
  const slab=(elementId:number,x:number,z:number,levelId:number)=>({elementId,categoryId:-2000032,kind:"solid",boundsFeet:{min:{x,y:0,z:z-1},max:{x:x+10,y:10,z}},loops:[[[x,0,z],[x+10,0,z],[x+10,10,z],[x,10,z]]],levelId});
  const model={levels,elementBounds:[slab(1,0,0,311),slab(2,11,3.28,1487816)],nativeAssociatedLevelRelations:[{elementId:1,levelId:311},{elementId:2,levelId:1487816}]} as unknown as ConvertResult;
  const floor=directoryModelFloor(model,[a,b,room("05",694,0)],311,null)!;
  assert.equal(floor.rooms.length,2);
  assert.deepEqual(floor.areas.map(a=>a.building),["05","07"]);
  assert.equal(floor.roomElevations[a.key]!.elevation,0);
  assert.equal(floor.roomElevations[b.key]!.elevation,3.28);
  assert.equal(floor.areas[0]!.areaFeet,96);
  assert.equal(floor.primaryBuilding,undefined);
  const meshes=directoryRoomGroup(floor,{x:0,y:0,z:0},null).children.filter(o=>o.userData.roomKey);
  assert.equal(meshes.length,2);
  assert.ok(meshes.some(m=>Math.abs(m.position.z-3.43)<.001));
});

test("coincident native stair edges clip safely without filling treads or changing reviewed coordinates", () => {
  const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/coincident-stair-landing.json",import.meta.url),"utf8")) as {area:DirectoryRoom["polygonFeet"][][];steps:DirectoryRoom["polygonFeet"][][][]};
  const before=JSON.stringify(fixture);
  const landing=landingWithoutTreads(fixture.area,fixture.steps);
  assert.equal(landing.length,9);
  const snapped=fixture.steps.map(p=>p.map(r=>r.map(h=>h.map(([x,y])=>[Math.round(x*1e6)/1e6,Math.round(y*1e6)/1e6] as [number,number]))));
  for(const tread of snapped){const overlap=pc.intersection(landing,tread);const area=overlap.reduce((sum,p)=>sum+roomArea(p[0]!)-p.slice(1).reduce((s,h)=>s+roomArea(h),0),0);assert.ok(area<1e-8,"No flat landing covers a native tread beyond floating-point slivers");}
  assert.equal(JSON.stringify(fixture),before);
});
