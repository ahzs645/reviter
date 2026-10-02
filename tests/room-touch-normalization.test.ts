import assert from'node:assert/strict';import test from'node:test';import{readFileSync}from'node:fs';import pc from'polygon-clipping';import{normalizeRoomTouchRings}from'../lib/reviter/room-touch-normalization.ts';import{containsDirectoryRoomPoint,roomArea,validRoomBoundary,type RoomPoint}from'../lib/reviter/room-directory.ts';
const area=(parts:pc.MultiPolygon)=>parts.reduce((s,p)=>s+roomArea(p[0] as RoomPoint[])-p.slice(1).reduce((s,h)=>s+roomArea(h as RoomPoint[]),0),0);
const box:RoomPoint[]=[[0,0],[10,0],[10,10],[0,10]];
test('remove only zero-area contact backtracks, preserving the actual room corner and exact region',()=>{
 const ring:RoomPoint[]=[[0,0],[10,0],[10,5],[12,5],[10,5],[10,10],[0,10]];assert.equal(validRoomBoundary(ring),false);const p=normalizeRoomTouchRings([ring])!;assert.ok(p);assert.equal(area(pc.difference([ring],p.ringsFeet)),0);assert.equal(area(pc.difference(p.ringsFeet,[ring])),0);assert.equal(roomArea(p.ringsFeet[0]!),100);assert.ok(p.ringsFeet.every(validRoomBoundary));assert.ok(p.ringsFeet[0]!.some(p=>p[0]===10&&p[1]===10));
});
test('material touching the room edge remains a separate real hole with unchanged void area',()=>{
 const ring:RoomPoint[]=[[0,0],[10,0],[10,10],[0,10],[0,5],[2,5],[2,3],[0,5]];const p=normalizeRoomTouchRings([ring])!;assert.ok(p);assert.equal(p.ringsFeet.length,2);assert.equal(roomArea(p.ringsFeet[1]!),2);assert.equal(area(pc.difference([ring],p.ringsFeet)),0);assert.equal(area(pc.difference(p.ringsFeet,[ring])),0);assert.equal(containsDirectoryRoomPoint([1.5,4.5],{key:'test',levelId:1,labelPointFeet:[5,5],confidence:1,polygonFeet:p.ringsFeet[0]!,holesFeet:p.ringsFeet.slice(1)}),false);
 // An independent floor opening stays present too.
 const floorHole:RoomPoint[]=[[6,6],[6,8],[8,8],[8,6]],withFloor=normalizeRoomTouchRings([ring,floorHole])!;assert.equal(withFloor.ringsFeet.length,3);assert.equal(containsDirectoryRoomPoint([7,7],{key:'test',levelId:1,labelPointFeet:[5,5],confidence:1,polygonFeet:withFloor.ringsFeet[0]!,holesFeet:withFloor.ringsFeet.slice(1)}),false);
});
test('reject genuine crossings, disconnected positive cells, unsupported holes and microscopic real void loss',()=>{
 assert.equal(normalizeRoomTouchRings([[[0,0],[10,10],[0,10],[10,0]]]),undefined);
 const joined:RoomPoint[]=[[0,0],[2,0],[2,2],[4,2],[4,4],[2,4],[2,2],[0,2]];assert.equal(normalizeRoomTouchRings([joined]),undefined);
 assert.equal(normalizeRoomTouchRings([box,[[12,12],[12,14],[14,14],[14,12]]]),undefined);
 // A real tiny hole cannot be discarded as a zero-area backtrack.
 const tiny:RoomPoint[]=[[4,4],[4,4.01],[4.01,4.01],[4.01,4]];assert.equal(normalizeRoomTouchRings([box,tiny]),undefined);
 const smaller:RoomPoint[]=[[4,4],[4,4.00001],[4.00001,4.00001],[4.00001,4]];assert.equal(normalizeRoomTouchRings([box,smaller]),undefined);
});
test('actual UNBC09-250 contact ring recovers with identical coverage while10-2078 real crossing remains unresolved',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/unbc-touch-room-09-250.json',import.meta.url),'utf8'));const p=normalizeRoomTouchRings(f.rings)!;assert.ok(p);assert.ok(p.ringsFeet.every(validRoomBoundary));assert.ok(containsDirectoryRoomPoint(f.label,{key:'test',levelId:1,labelPointFeet:[5,5],confidence:1,polygonFeet:p.ringsFeet[0]!,holesFeet:p.ringsFeet.slice(1)}));assert.ok(area(pc.difference(f.rings,p.ringsFeet))<=1e-8);assert.ok(area(pc.difference(p.ringsFeet,f.rings))<=1e-8);
 const crossed=JSON.parse(readFileSync(new URL('./fixtures/unbc-crossed-room-10-2078.json',import.meta.url),'utf8'));assert.equal(normalizeRoomTouchRings(crossed.rings),undefined);
});
