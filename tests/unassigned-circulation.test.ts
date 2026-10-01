import test from 'node:test';import assert from 'node:assert/strict';
import{recoverUnassignedCirculation}from'../lib/reviter/unassigned-circulation.ts';
import{containsDirectoryRoomPoint,findDirectoryRoute,parseRoomDirectory,type DirectoryRoom,type RoomPoint}from'../lib/reviter/room-directory.ts';
import type{BoundaryReference}from'../lib/reviter/room-boundaries.ts';import type{ConvertResult,ElementBoundsRecord}from'../lib/reviter/types.ts';
const sha='a'.repeat(64),box=(x:number,y:number,w:number,h:number):RoomPoint[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const rooms:DirectoryRoom[]=[{key:'west',number:'07-1',name:'Corridor',levelId:311,polygonFeet:box(0,0,4,10),labelPointFeet:[2,5],confidence:1,dwg:{sectionId:'07 centre',sha256:sha}},{key:'east',number:'07-2',name:'Lobby',levelId:311,polygonFeet:box(16,0,4,10),labelPointFeet:[18,5],confidence:1,dwg:{sectionId:'07 centre',sha256:sha}}];
const ref:BoundaryReference={format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:sha,sections:[{sectionId:'07 centre',levelId:311,registrationErrorFeet:0,wallSegments:[[[4,0],[16,0]],[[4,10],[16,10]]],doorSegments:[]}]};
const slab:ElementBoundsRecord={elementId:1,categoryId:-2000032,stream:'Partitions/1',chunkIndex:0,rawOffset:0,recordOffset:0,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:20,y:10,z:0}},loops:[box(0,0,20,10).map(p=>[...p,0]),box(6,1,2,2).map(p=>[...p,0])]};
const column:ElementBoundsRecord={...slab,elementId:2,categoryId:-2000133,boundsFeet:{min:{x:12,y:1,z:0},max:{x:14,y:3,z:12}},loops:undefined};
const model={levels:[{levelId:311,elevation:0,candidates:1}],elementBounds:[slab,column],nativeAssociatedLevelRelations:[{elementId:1,levelId:311},{elementId:2,levelId:311}]}as unknown as ConvertResult;
const selection={building:'07',levelId:311,point:[10,5]as RoomPoint};

test('recover the bounded missing circulation and usable routes while preserving native holes, columns and original rooms',()=>{
 const before=structuredClone(rooms),result=recoverUnassignedCirculation(model,rooms,ref,selection);assert.ok(result.room,result.reason);const r=result.room;
 assert.deepEqual(rooms,before);assert.equal(r.number,undefined);assert.equal(r.modelSurface?.kind,'circulation');assert.equal(r.modelSurface?.elementId,1);
 assert.ok(containsDirectoryRoomPoint(selection.point,r));assert.ok(!containsDirectoryRoomPoint([7,2],r));assert.ok(!containsDirectoryRoomPoint([13,2],r));
 assert.ok(findDirectoryRoute([...rooms,r],[],r.key,'west'));assert.ok(findDirectoryRoute([...rooms,r],[],r.key,'east'));
 const d={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'native.rvt'},annotations:[...rooms,r],boundaryReference:ref};assert.deepEqual(parseRoomDirectory(JSON.stringify(d)),d);
 assert.equal(recoverUnassignedCirculation(model,d.annotations,ref,selection).room,undefined);
});
test('native campus slab alone cannot establish an outline, replace a neighbouring building, fill a void or claim another level',()=>{
 assert.equal(recoverUnassignedCirculation(model,rooms,{...ref,sections:[{...ref.sections[0]!,wallSegments:[]}]},selection).room,undefined);
 const neighbour={...rooms[0]!,key:'other-building',number:'08-1',name:'Office',polygonFeet:box(8,4,4,2),labelPointFeet:[10,5]as RoomPoint};
 assert.equal(recoverUnassignedCirculation(model,[...rooms,neighbour],ref,selection).room,undefined);
 assert.equal(recoverUnassignedCirculation(model,[...rooms,{...neighbour,number:'07-void',walkability:'void'}],ref,selection).room,undefined);
 assert.equal(recoverUnassignedCirculation(model,rooms,ref,{...selection,point:[7,2]}).room,undefined);
 assert.equal(recoverUnassignedCirculation({...model,nativeAssociatedLevelRelations:[{...model.nativeAssociatedLevelRelations![0]!,elementId:1,levelId:999}]},rooms,ref,selection).room,undefined);
 assert.equal(recoverUnassignedCirculation({...model,levels:[{levelId:311,elevation:14,candidates:1}]},rooms,ref,selection).room,undefined);
 assert.equal(recoverUnassignedCirculation(model,rooms,{...ref,sourceSha256:'b'.repeat(64)},selection).room,undefined);
});
test('an unassociated native slab is retained as elevation evidence; source islands are excluded rather than filled',()=>{
 const fixture={...rooms[0]!,key:'fixture',number:'07-3',name:'Waiting Lounge',polygonFeet:box(9,1,2,2),holesFeet:[box(9.5,1.5,1,1)],labelPointFeet:[9.25,1.25]as RoomPoint};
 const result=recoverUnassignedCirculation({...model,nativeAssociatedLevelRelations:[{...model.nativeAssociatedLevelRelations![0]!,elementId:2,levelId:311}]},[...rooms,fixture],ref,selection);assert.ok(result.room,result.reason);
 assert.equal((result.room.boundaryReview as {nativeLevelAssociation:string}).nativeLevelAssociation,'unassigned-elevation-match');
 assert.ok(!containsDirectoryRoomPoint([10,2],result.room));assert.equal(result.room.levelId,311);
});

test('survey coordinates share exact hallway edges without hairline disconnected outlines',async()=>{
 const {directoryAreas}=await import('../lib/reviter/directory-areas.ts');
 const west=3.9999962,east=15.9999962;
 const fractional=[{...rooms[0]!,polygonFeet:box(0,0,west,10)},{...rooms[1]!,polygonFeet:box(east,0,20-east,10)}];
 const survey={...ref,sections:[{...ref.sections[0]!,wallSegments:[[[west,0],[east,0]],[[west,10],[east,10]]]as BoundaryReference['sections'][number]['wallSegments']}]};
 const result=recoverUnassignedCirculation(model,fractional,survey,selection);assert.ok(result.room,result.reason);
 const merged=directoryAreas([...fractional,result.room]).find(a=>a.kind==='hallway')!;
 assert.equal(merged.polygons.length,1,'The filled circulation and both hallways must have one continuous outline');
});
