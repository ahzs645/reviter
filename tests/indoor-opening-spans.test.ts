import test from 'node:test';import assert from 'node:assert/strict';
import{recoverIndoorOpeningSpan}from'../lib/reviter/indoor-opening-spans.ts';
import{recoverRegisteredCirculationSeams}from'../lib/reviter/registered-open-fronts.ts';
import{nativeWalkingRegion,supportedWalkingPath}from'../lib/reviter/native-circulation-links.ts';
import type{DirectoryRoom,RoomPoint}from'../lib/reviter/room-directory.ts';import type{IndoorDataset}from'../lib/reviter/indoor-contract.ts';import type{ConvertResult}from'../lib/reviter/types.ts';import type{BoundaryReference}from'../lib/reviter/room-boundaries.ts';import type{ArchitecturalPlanGeometry}from'../lib/reviter/architectural-plan.ts';
const rect=(x0:number,y0:number,x1:number,y1:number):RoomPoint[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
function fixture(){
 const rooms:DirectoryRoom[]=['a','b'].map((key,i)=>({key,number:key,name:'Corridor',building:'01',levelId:1,confidence:1,polygonFeet:rect(i*10,0,(i+1)*10,12),labelPointFeet:[5+i*10,6],dwg:{sectionId:'section',sha256:'drawing'}}));
 const floor={elementId:10,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-.5},max:{x:20,y:12,z:0}},loops:[rect(0,0,20,12).map(p=>[...p,0])]};
 const model={origin:{x:0,y:0,z:0},levels:[{levelId:1,elevation:0}],elementBounds:[floor],nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
 const dataset={source:{modelSha256:'a'.repeat(64)},nativeLevels:[{id:1,name:'Floor1',elevationFeet:0}],records:rooms.map(r=>({key:r.key,building:'01',levelId:1,elevationFeet:0,circulation:true,stair:false,walkable:true,access:'unknown',ringsFeet:[r.polygonFeet],properties:{}})),doors:[],edges:[],nodes:[]} as unknown as IndoorDataset;
 const reference:BoundaryReference={format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:'drawing',sections:[{sectionId:'section',levelId:1,registrationErrorFeet:0,wallSegments:[],doorSegments:[]}]};
 const geometry:ArchitecturalPlanGeometry={walls:[],columns:[],doors:[],floors:[floor.loops.map(r=>r.map(p=>[p[0],p[1]]))],cutElevation:4};
 const support=new Map(rooms.map(r=>[r.key,{elevationFeet:0,floors:geometry.floors}]));
 const front=recoverRegisteredCirculationSeams(rooms,reference,geometry,support)[0]!;assert.ok(front);
 return{rooms,model,dataset,reference,geometry,front};
}
test('finite crossing centres reserve full body margins inside a continuously proved two-foot-deep aperture',()=>{
 const f=fixture(),before=JSON.stringify(f.rooms),span=recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry);assert.ok(span);assert.equal(span.walkingStripWidthFeet,2);assert.equal(span.sourceModelSha256,f.dataset.source.modelSha256);assert.deepEqual(span.nativeFloorElementIds,[10]);assert.equal(span.apertureFeet.length,4);assert.equal(JSON.stringify(f.rooms),before);
 assert.ok(Math.hypot(...span.pointsFeet[1].map((v,k)=>v-span.pointsFeet[0][k]!))>=.4);
 assert.equal(supportedWalkingPath(nativeWalkingRegion(f.model,f.dataset,0,true),span.pointsFeet),true);
 const n=[f.front.to[0]-f.front.from[0],f.front.to[1]-f.front.from[1]],len=Math.hypot(...n);
 for(const p of span.pointsFeet)assert.equal(supportedWalkingPath(nativeWalkingRegion(f.model,f.dataset,0,true),[[p[0]-n[0]!/len,p[1]-n[1]!/len,0],[p[0]+n[0]!/len,p[1]+n[1]!/len,0]]),true);
});
test('a source/native wall, native column or floor hole cannot be absorbed into a movable opening span',()=>{
 for(const obstacle of ['source-wall','native-wall','native-column','floor-hole']){const f=fixture();if(obstacle==='source-wall')f.reference.sections[0]!.wallSegments.push([[10,0],[10,12]]);else if(obstacle==='floor-hole')f.model.elementBounds[0]!.loops!.push(rect(9.8,0,10.2,12).map(p=>[...p,0] as [number,number,number]));else f.model.elementBounds.push({elementId:20,categoryId:obstacle==='native-wall'?-2000011:-2000100,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:12,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:12},thickness:.4,baseElevation:0,topElevation:8}} as ConvertResult['elementBounds'][number]);assert.equal(recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry),undefined,obstacle);}
});
test('only original coplanar source-registered circulation seams receive model-bound spans',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.front.openingId='reviewed-real-opening'},(f:ReturnType<typeof fixture>)=>{f.dataset.records[1]!.levelId=2},(f:ReturnType<typeof fixture>)=>{f.dataset.records[1]!.elevationFeet=3.28},(f:ReturnType<typeof fixture>)=>{f.dataset.records[1]!.access='staff'},(f:ReturnType<typeof fixture>)=>{f.rooms[0]!.dwg!.sha256='stale'},(f:ReturnType<typeof fixture>)=>{f.reference.sections[0]!.registrationErrorFeet=.06}]){const f=fixture();change(f);assert.equal(recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry),undefined);}
});

test('only a reviewed shared stair landing receives a continuously floor-supported planar span',()=>{
 const f=fixture();
 f.rooms[0]!.name='Stair 4';f.rooms[0]!.stairAccess='flight-and-landing';f.rooms[0]!.spaceUse={kind:'hallway',evidence:'user-reported'};
 f.dataset.records[0]!.stair=true;
 assert.ok(recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry));
 f.rooms[0]!.stairAccess='unreviewed';
 assert.equal(recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry),undefined);
 f.rooms[0]!.stairAccess='flight-and-landing';delete f.rooms[0]!.spaceUse;
 assert.equal(recoverIndoorOpeningSpan(f.model,f.dataset,f.rooms,f.front,f.reference,f.geometry),undefined);
});
