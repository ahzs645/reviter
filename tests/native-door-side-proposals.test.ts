import assert from "node:assert/strict";
import test from "node:test";
import { proposeNativeDoorSides } from "../lib/reviter/native-door-side-proposals.ts";
import type { RoomPoint } from "../lib/reviter/room-directory.ts";
const box = (x0:number,y0:number,x1:number,y1:number):RoomPoint[] => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const room = (key:string,x0:number,x1:number,levelId=3) => ({key,levelId,ringsFeet:[box(x0,-4,x1,4)]});
const door = {levelId:3,footprintFeet:box(-.04,-2,.04,2),normalFeet:[1,0] as RoomPoint};
test("proposes asymmetric recessed original room sides without admitting or moving a doorway",()=>{
  const rooms=[room('link',-10,-1.64),room('hall',4.85,12)],before=JSON.stringify([rooms,door]);
  const p=proposeNativeDoorSides(rooms,door);assert.equal(p.status,'proposed');
  if(p.status!=='proposed')throw Error('missing proposal');
  assert.equal(p.from.roomKey,'link');assert.equal(p.to.roomKey,'hall');
  assert.ok(p.to.depthFeet>4.8);assert.equal(p.authorityGranted,false);
  assert.equal(JSON.stringify([rooms,door]),before);
});
test("an intervening room cannot be skipped in favour of a corridor",()=>{
  const p=proposeNativeDoorSides([room('link',-10,-1),room('private',1,2),room('hall',4,10)],door);
  assert.equal(p.status,'proposed');if(p.status==='proposed')assert.equal(p.to.roomKey,'private');
});
test("overlapping owners, holes, another floor and insufficient reach stay unresolved",()=>{
  const left=room('left',-10,-1),right=room('right',2,10);
  assert.notEqual(proposeNativeDoorSides([left,right,{...right,key:'overlap'}],door).status,'proposed');
  assert.notEqual(proposeNativeDoorSides([left,room('other',2,10,4)],door).status,'proposed');
  assert.notEqual(proposeNativeDoorSides([left,right],door,1).status,'proposed');
  const hole={...right,ringsFeet:[right.ringsFeet[0]!,box(1,-3,11,3)]};
  assert.notEqual(proposeNativeDoorSides([left,hole],door).status,'proposed');
});
test("source threshold geometry is required and narrow openings are refused",()=>{
  assert.equal(proposeNativeDoorSides([], {levelId:3}).status,'missing-native-threshold');
  assert.equal(proposeNativeDoorSides([], {...door,footprintFeet:box(-.04,-.5,.04,.5)}).status,'narrow-native-threshold');
  assert.throws(()=>proposeNativeDoorSides([],door,Infinity));
});
