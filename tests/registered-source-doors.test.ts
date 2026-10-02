/* eslint-disable @typescript-eslint/no-explicit-any -- Sparse native records exercise source geometry recovery. */
import assert from 'node:assert/strict';
import test from 'node:test';
import{readFileSync}from'node:fs';
import{recoverRegisteredSourceDoors,registeredSourceDoorSymbols}from'../lib/reviter/registered-source-doors.ts';
import type{DirectoryRoom}from'../lib/reviter/room-directory.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/unbc-source-corridor-door.json',import.meta.url),'utf8'));
const call=(f:ReturnType<typeof fixture>)=>recoverRegisteredSourceDoors(f.rooms,f.reference,f.geometry,new Map(f.support.map((s:any)=>[s.key,s])),f.sourceModelSha256);
const obstacle=[[68.5,535],[70,535],[70,536],[68.5,536]];
test('actual source-only double-egress doorway connects unique corridor sides without changing original room boundaries',()=>{
 const f=fixture(),before=JSON.stringify(f),symbols=registeredSourceDoorSymbols(f.reference.sections[0]);assert.equal(symbols.length,1);assert.deepEqual(new Set(symbols[0]!.indices),new Set([369,371,372,374]));const doors=call(f);assert.equal(doors.length,1);const d=doors[0]!;assert.deepEqual(new Set(d.rooms.map(k=>f.rooms.find((r:DirectoryRoom)=>r.key===k).number)),new Set(['08-102','08-105']));assert.equal(d.proof.walkingStripWidthFeet,2);assert.ok(d.halfWidth>2.99&&d.halfWidth<3.01);assert.ok(Math.abs(d.halfHeight-.1875)<1e-8);assert.equal(d.proof.sourceModelSha256,f.sourceModelSha256);assert.equal(d.proof.sourceSha256,f.reference.sourceSha256);assert.equal(d.proof.doorSymbolCollection,'wallSegments');assert.equal(d.proof.doorSymbolSegmentIndices.length,38);assert.ok(d.sourceDoorId.startsWith('source-door:'));assert.ok(Math.abs(d.from[1]-d.to[1])>5);assert.equal(JSON.stringify(f),before);assert.equal('nativeElementId'in d,false);assert.equal('accessible'in d,false);
});
test('paired circular curves alone, missing leaf thickness/caps or any missing jamb face cannot invent a source door',()=>{
 for(const index of [3256,3257,3258,3259,3275,3276,3277,369,371,372,374]){const f=fixture();f.reference.sections[0].wallSegments[index]=[[1000,1000],[1001,1000]];assert.equal(registeredSourceDoorSymbols(f.reference.sections[0]).length,0,`source primitive${index}`);}
 const lone=fixture();for(let i=3260;i<=3274;i++)lone.reference.sections[0].wallSegments[i]=[[1000,1000],[1001,1000]];assert.equal(call(lone).length,0);
 const broken=fixture();broken.reference.sections[0].wallSegments[3249][0][0]+=.05;assert.equal(call(broken).length,0);
});
test('native walls, columns and closed native doors veto source-only doorway recovery',()=>{
 for(const collection of ['walls','columns','doors']){const f=fixture();f.geometry[collection].push({elementId:9,approximate:false,polygon:obstacle});assert.equal(call(f).length,0,collection);}
 // Thin walls must not be discarded as negligible drawing/tessellation noise.
 const f=fixture();f.geometry.walls.push({elementId:10,approximate:true,polygon:[[68.5,535],[70,535],[70,535.0001],[68.5,535.0001]]});assert.equal(call(f).length,0);
});
test('only the proved door primitives are excluded: true source walls and additional door symbols stay barriers',()=>{
 for(const collection of ['wallSegments','doorSegments']){const f=fixture();f.reference.sections[0][collection].push([[68,535],[71,535]]);assert.equal(call(f).length,0,collection);}
});
test('exact same-height support requires floor IDs and full bridge width; source holes and third-room ownership are preserved',()=>{
 const f=fixture(),keys=call(f)[0]!.rooms;
 for(const modify of [(f:any)=>{f.support.find((s:any)=>s.key===keys[0]).elevationFeet+=.1},(f:any)=>{f.support.find((s:any)=>s.key===keys[0]).floors=[]},(f:any)=>{f.support.find((s:any)=>s.key===keys[0]).nativeFloorElementIds=[]},(f:any)=>{for(const k of keys){const s=f.support.find((s:any)=>s.key===k);s.floors=s.floors.map((p:any)=>[...p,obstacle]);}},(f:any)=>{f.rooms.find((r:DirectoryRoom)=>r.key===keys[0]).floorOpeningsFeet=[obstacle]},(f:any)=>{f.rooms.push({...f.rooms.find((r:DirectoryRoom)=>r.key===keys[0]),key:'third-room',name:'Office',polygonFeet:obstacle,labelPointFeet:[69,535.5],access:{kind:'staff',evidence:'user-reported'}})}]){const f=fixture();modify(f);assert.equal(call(f).length,0);}
});
test('stale/missing provenance, section registration, noncirculation targets and ambiguous overlapping aliases are rejected',()=>{
 const f=fixture(),keys=call(f)[0]!.rooms;
 for(const modify of [(f:any)=>{f.reference.sourceSha256='a'.repeat(64)},(f:any)=>{f.sourceModelSha256='missing'},(f:any)=>{f.reference.sections[0].registrationErrorFeet=.051},(f:any)=>{f.reference.sections[0].registrationErrorFeet=NaN},(f:any)=>{f.rooms.find((r:DirectoryRoom)=>r.key===keys[0]).dwg.sectionId='foreign'},(f:any)=>{const r=f.rooms.find((r:DirectoryRoom)=>r.key===keys[0]);r.name='Office';r.spaceUse={kind:'room',evidence:'user-reported'};},(f:any)=>{f.rooms.push({...f.rooms.find((r:DirectoryRoom)=>r.key===keys[0]),key:'unresolved-alias'});}]){const f=fixture();modify(f);assert.equal(call(f).length,0);}
});
