import test from "node:test";
import assert from "node:assert/strict";
import { buildIndoorGrid } from "../lib/reviter/indoor-grid.ts";
import { nativeArrivalFloorSupport } from "../lib/reviter/indoor-arrival-recovery.ts";
import { nativeRouteBlocker, type DirectoryRoom, type RoomPoint } from "../lib/reviter/room-directory.ts";
const rectangle = (x:number,y:number,w:number,h:number):RoomPoint[] => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const room:DirectoryRoom = {key:"room",levelId:1,building:"01",confidence:1,polygonFeet:rectangle(0,0,12,10),labelPointFeet:[6,5]};
const ts = [
  {id:"arrival",roomKey:"room",point:[6,5] as RoomPoint,maxSnapFeet:1.2},
  {id:"door",roomKey:"room",point:[1,5] as RoomPoint,maxSnapFeet:1.2},
];
const barriers = {walls:[],columns:[{polygon:rectangle(4,3,4,4)}]};
const floor = nativeArrivalFloorSupport({floors:[[rectangle(0,0,12,10)]]})!;
const recovery = {arrivalTerminalIds:new Set(["arrival"]),nativeFloorSupported:floor};

test("obstructed labels recover only by a native-floor-supported path from their own room entrance", () => {
  const original = structuredClone(room);
  const legacy = buildIndoorGrid([room],[],ts,barriers,[]);
  assert.deepEqual(legacy.missing,["arrival"]);
  const grid = buildIndoorGrid([room],[],ts,barriers,[],.6,recovery);
  assert.deepEqual(grid.missing,[]);
  assert.equal(grid.arrivalRecoveries.length,1);
  assert.equal(grid.arrivalRecoveries[0]!.entranceId,"door");
  assert.deepEqual(grid.arrivalRecoveries[0]!.sourcePointFeet,[6,5]);
  assert.deepEqual(room,original,"source polygon and label are preserved");
  const blocked = nativeRouteBlocker(barriers,[]);
  for (const branch of grid.branches) for (let i=1;i<branch.points.length;i++) {
    assert.equal(blocked(branch.points[i-1]!,branch.points[i]!),false);
    assert.equal(floor(branch.points[i-1]!,branch.points[i]!),true);
  }
  assert.equal(blocked(ts[0]!.point,grid.positions.get("arrival")!),true,"the obstructed label is not drawn as a walking segment");
});

test("recovery cannot choose a nearer cell across a thin divider or private mask", () => {
  const bs = {walls:[{polygon:rectangle(4,0,.02,10)}],columns:[{polygon:rectangle(5,4,2,2)}]};
  for (const [masks,walls] of [[[],bs.walls],[[{...room,key:"private",polygonFeet:rectangle(4,0,.02,10)}],[]]] as [DirectoryRoom[], typeof bs.walls][]) {
    const grid=buildIndoorGrid([room],masks,ts,{...bs,walls},[],.6,recovery);
    const p=grid.positions.get("arrival")!;
    assert.ok(p && p[0]<4,"arrival remains on its proved entrance component");
  }
});

test("missing floors, missing entrances, unsupported cells and fixed stair/door terminals never relocate", () => {
  assert.equal(nativeArrivalFloorSupport({floors:[]}),undefined);
  assert.deepEqual(buildIndoorGrid([room],[],[ts[0]!],barriers,[],.6,recovery).missing,["arrival"]);
  const noSupport={...recovery,nativeFloorSupported:()=>false};
  assert.deepEqual(buildIndoorGrid([room],[],ts,barriers,[],.6,noSupport).missing,["arrival"]);
  const fixed=ts.map(t=>t.id==="arrival"?{...t,id:"stair"}:t);
  assert.deepEqual(buildIndoorGrid([room],[],fixed,barriers,[],.6,recovery).missing,["stair"]);
});

test("native floor coverage rejects subcell gaps and holes continuously", () => {
  const support=nativeArrivalFloorSupport({floors:[[rectangle(0,0,4.99,10)],[rectangle(5.01,0,6.99,10)]]})!;
  assert.equal(support([4.8,5],[5.2,5]),false);
  const holed=nativeArrivalFloorSupport({floors:[[rectangle(0,0,12,10),rectangle(4.99,0,.02,10)]]})!;
  assert.equal(holed([4.8,5],[5.2,5]),false);
});
