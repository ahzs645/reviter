/* eslint-disable @typescript-eslint/no-explicit-any -- Sparse native records exercise source geometry recovery. */
import assert from 'node:assert/strict';import test from 'node:test';import{readFileSync}from'node:fs';
import{recoverNativeCurtainOpenings,recoverNativeCurtainMemberSections}from'../lib/reviter/native-curtain-openings.ts';
import{recoverNativeDoorOwnership,recoverRegisteredStairDoorOwnership}from'../lib/reviter/native-door-ownership.ts';import{registeredDoubleDoorSwingSegments}from'../lib/reviter/registered-door-symbols.ts';import{directoryDoorReviews}from'../lib/reviter/directory-navigation.ts';import type{ConvertResult}from'../lib/reviter/types.ts';import type{BoundaryReference}from'../lib/reviter/room-boundaries.ts';import type{DirectoryRoom,DirectoryDoor}from'../lib/reviter/room-directory.ts';import type{ArchitecturalPlanGeometry}from'../lib/reviter/architectural-plan.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/unbc-curtain-stair-door.json',import.meta.url),'utf8'));
const call=(f:ReturnType<typeof fixture>)=>recoverRegisteredStairDoorOwnership(f.rooms,directoryDoorReviews(f.rooms,[f.door]),f.geometry,f.reference,new Map(f.support.map((r:{key:string;elevation:number;floors:ArchitecturalPlanGeometry['floors']})=>[r.key,{elevationFeet:r.elevation,floors:r.floors}])));
test('real UNBC curtain doorway uses exact persisted frame members, not the one-metre container thickness',()=>{
 const f=fixture(),proof=recoverNativeCurtainOpenings(f.model as ConvertResult,7.280839895)[0]!;assert.equal(proof.hostId,2018178);assert.equal(proof.doorId,2018182);assert.deepEqual(proof.barriers.map(b=>b.elementId),[2018192,2018195]);assert.ok(Math.abs(Math.max(...proof.apertureFeet.map(p=>p[1]))-Math.min(...proof.apertureFeet.map(p=>p[1]))-.492125984)<1e-7);
 assert.equal(recoverNativeDoorOwnership(f.rooms,directoryDoorReviews(f.rooms,[f.door]),f.geometry).length,0);const recovered=call(f);assert.equal(recovered.length,1);assert.deepEqual(new Set(recovered[0]!.portal.rooms),new Set(f.rooms.filter((r:DirectoryRoom)=>r.name==='Stair'||r.name==='Corridor').map((r:DirectoryRoom)=>r.key)));assert.ok(recovered[0]!.proof.sourceDoorSymbolSegmentIndices!.length>=60);
 f.geometry.walls.push(f.originalHost);assert.equal(call(f).length,0);
});
test('missing or foreign-owned members, opaque cut panels and incomplete frame geometry preserve the container',()=>{
 for(const change of [(f:any)=>{f.model.elementBounds=f.model.elementBounds.filter((r:any)=>r.elementId!==2018195)},(f:any)=>{f.model.nativeHostRelations.push({...f.model.nativeHostRelations.find((r:any)=>r.elementId===2018195),hostId:12345})},(f:any)=>{f.model.elementBounds.find((r:any)=>r.elementId===2018192).orientedBox=undefined},(f:any)=>{const p=f.model.elementBounds.find((r:any)=>r.elementId===2018185);p.orientedBox=p.orientedBox.map(([x,y,z]:number[])=>[x,y,z-6]);},(f:any)=>{f.model.elementBounds.find((r:any)=>r.elementId===2018178).wallKind='basic'}]){const f=fixture();change(f);assert.equal(recoverNativeCurtainOpenings(f.model,7.280839895).length,0);}
});
test('ankle and overhead member sections retain real sills and opaque panels without declaring an open cut',()=>{
 const f=fixture();assert.equal(recoverNativeCurtainOpenings(f.model,3.380839895).length,0);const ankle=recoverNativeCurtainMemberSections(f.model,3.380839895);assert.equal(ankle.length,1);assert.ok(ankle[0]!.barriers.some(b=>b.elementId===2018191));const overhead=recoverNativeCurtainMemberSections(f.model,12);assert.ok(overhead[0]!.barriers.some(b=>b.elementId===2018185));assert.equal(recoverNativeCurtainMemberSections(f.model,20).length,0);
});
test('source swing filtering needs complementary circular quarter chains at actual native double-door hinges',()=>{
 const f=fixture(),section=f.reference.sections[0];const ids=registeredDoubleDoorSwingSegments(section,f.door);assert.ok(ids.size>=60);
 const lone={...section,wallSegments:section.wallSegments.filter((_s:any,i:number)=>!ids.has(i)||section.wallSegments[i][0][0]<66.91)};assert.equal(registeredDoubleDoorSwingSegments(lone,f.door).size,0);
 const shifted={...f.door,footprint:f.door.footprint.map(([x,y]:number[])=>[x+1,y])};assert.equal(registeredDoubleDoorSwingSegments(section,shifted).size,0);
 const broken={...section,wallSegments:section.wallSegments.map((s:any,i:number)=>ids.has(i)?s.map(([x,y]:number[])=>[x,y+(i%2?.1:0)]):s)};assert.equal(registeredDoubleDoorSwingSegments(broken,f.door).size,0);
 // A true straight wall across the recessed approach is not a swing symbol.
 f.reference.sections[0].wallSegments.push([[65.8,479],[68,479]]);assert.equal(call(f).length,0);
});
test('registered stair approach retains exact floors, source registration, native columns, holes and ordinary-room bounds',()=>{
 for(const change of [(f:any)=>{f.support[0].elevation+=1},(f:any)=>{f.reference.sourceSha256='stale'},(f:any)=>{f.reference.sections[0].registrationErrorFeet=.06},(f:any)=>{f.geometry.columns.push({elementId:9,approximate:false,polygon:[[66.5,479],[67,479],[67,479.5],[66.5,479.5]]})},(f:any)=>{f.rooms[1].floorOpeningsFeet=[[[66.5,479],[67,479],[67,479.5],[66.5,479.5]]]},(f:any)=>{const r=f.rooms.find((r:DirectoryRoom)=>r.name==='Stair');r.name='Office';r.spaceUse='room';},(f:any)=>{f.support.forEach((r:any)=>r.floors=r.floors.map((p:any)=>[...p,[[66.5,479],[67,479],[67,479.5],[66.5,479.5]]]))}]){const f=fixture();change(f);assert.equal(call(f).length,0);}
});
