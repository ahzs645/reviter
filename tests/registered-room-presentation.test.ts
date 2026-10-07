import assert from 'node:assert/strict';import test from 'node:test';
import{recoverRegisteredRoomInteriors as recoverWithExactFloors}from'../lib/reviter/registered-room-presentation.ts';
import type{ArchitecturalPlanGeometry}from'../lib/reviter/architectural-plan.ts';import type{IndoorDataset,IndoorRecord}from'../lib/reviter/indoor-contract.ts';import type{BoundaryReference,BoundarySegment}from'../lib/reviter/room-boundaries.ts';import{containsRoomPoint,type DirectoryRoom,type RoomPoint}from'../lib/reviter/room-directory.ts';
// Synthetic fixtures explicitly provide one physical floor per level; pass it
// through the strict per-record support input rather than association fallback.
const recoverRegisteredRoomInteriors=(dataset:IndoorDataset,annotations:readonly DirectoryRoom[],reference:BoundaryReference|undefined,geometries:ReadonlyMap<number,ArchitecturalPlanGeometry>,keys:ReadonlySet<string>)=>recoverWithExactFloors(dataset,annotations,reference,geometries,keys,new Map(dataset.records.map(r=>[r.key,geometries.get(r.levelId)?.floors??[]])));
const rect=(x0:number,y0:number,x1:number,y1:number):RoomPoint[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];const edges=(r:RoomPoint[]):BoundarySegment[]=>r.map((p,i)=>[p,r[(i+1)%r.length]!]);
const setup=()=>{
 const annotations:DirectoryRoom[]=[0,10].map((x,i)=>({key:`room${i}`,number:`Office${i}`,name:'Office',levelId:1,confidence:1,polygonFeet:rect(x+.4,.4,x+9.6,9.6),labelPointFeet:[x+5,5],dwg:{sha256:'survey',sectionId:'sheet'}}));
 const walls:IndoorDataset['walls']=[rect(-1,-1,21,0),rect(-1,10,21,11),rect(-1,0,0,10),rect(20,0,21,10)].map((r,i)=>({kind:'wall',levelId:1,nativeElementId:i+1,ringsFeet:[r]}));
 const records:IndoorRecord[]=annotations.map(a=>({key:a.key,number:a.number!,name:'Office',building:'A',levelId:1,elevationFeet:0,elevationEvidence:'native',surfaceId:'1',circulation:false,stair:false,access:'public',walkable:true,confidence:1,ringsFeet:[a.polygonFeet],properties:{}}));
 const dataset={source:{modelSha256:"a".repeat(64)},nativeLevels:[{id:1,name:'Fixture floor',elevationFeet:0}],records,walls,doors:[]}as unknown as IndoorDataset;
 const reference:BoundaryReference={format:'reviter-boundary-reference',version:1,coordinateSystem:'revit-model-feet',sourceSha256:'survey',sections:[{sectionId:'sheet',levelId:1,registrationErrorFeet:0,wallSegments:[...edges(rect(0,0,20,10)),[[10,0],[10,10]]],doorSegments:[]}]};
 const geometry:ArchitecturalPlanGeometry={cutElevation:4,walls:[],columns:[],doors:[],floors:[[rect(0,0,20,10)]]};
 return{dataset,annotations,reference,geometry,keys:new Set(annotations.map(a=>a.key))};
};
test('registered source partitions resolve distinct labels for display while preserving original source and native walls',()=>{
 const s=setup(),before=JSON.stringify(s);const result=recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,s.geometry]]),s.keys);
 assert.equal(result.rooms.length,2);assert.equal(result.diagnostics.length,0);assert.equal(JSON.stringify(s),before);
 assert.match(result.rooms[0]!.boundaryEvidence,/visual evidence only/);assert.equal(result.rooms[0]!.sourceProof.sourceSha256,'survey');assert.ok(result.rooms.every(r=>r.boundaryElementIds.length>=2));
 assert.ok(!containsRoomPoint(s.annotations[1]!.labelPointFeet,result.rooms[0]!.ringsFeet[0]!));
});
test('precise native faces close a missing drawing edge without changing existing cells or accepting approximate walls',()=>{
 const s=setup();
 s.reference.sections[0]!.wallSegments=s.reference.sections[0]!.wallSegments.filter((_,i)=>i!==1);
 s.geometry.walls=[{elementId:4,polygon:rect(20,0,21,10),approximate:false}];
 const before=JSON.stringify(s),result=recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,s.geometry]]),s.keys);
 assert.equal(result.rooms.length,2);assert.equal(JSON.stringify(s),before);
 assert.match(result.rooms.find(r=>r.roomKey==='room1')!.boundaryEvidence,/Precise native wall\/column faces/);
 assert.doesNotMatch(result.rooms.find(r=>r.roomKey==='room0')!.boundaryEvidence,/Precise native wall\/column faces/);
 const approximate={...s.geometry,walls:s.geometry.walls.map(w=>({...w,approximate:true}))};
 assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,approximate]]),s.keys).rooms.filter(r=>r.roomKey==='room1').length,0);
 const contested=[...s.annotations,{...s.annotations[1]!,key:'third',labelPointFeet:[16,5] as RoomPoint}];
 assert.equal(recoverRegisteredRoomInteriors(s.dataset,contested,s.reference,new Map([[1,s.geometry]]),s.keys).rooms.filter(r=>r.roomKey==='room1').length,0);
});
test('stale registrations, conflicting labels, absent floors and unsupported outer floor edges cannot manufacture room blocks',()=>{
 const s=setup();assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,{...s.reference,sourceSha256:'stale'},new Map([[1,s.geometry]]),s.keys).rooms.length,0);
 assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,{...s.reference,sections:[{...s.reference.sections[0]!,registrationErrorFeet:.051}]},new Map([[1,s.geometry]]),s.keys).rooms.length,0);
 assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,{...s.geometry,floors:[]}]]),s.keys).rooms.length,0);
 const partial={...s.geometry,floors:[[rect(0,0,9,10)]]};assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,partial]]),s.keys).rooms.length,0);
 const overlap=[...s.annotations,{...s.annotations[0]!,key:'third',labelPointFeet:[6,5] as RoomPoint}];assert.equal(recoverRegisteredRoomInteriors(s.dataset,overlap,s.reference,new Map([[1,s.geometry]]),s.keys).rooms.filter(r=>r.roomKey==='room0').length,0);
 const unclosed={...s.reference,sections:[{...s.reference.sections[0]!,wallSegments:s.reference.sections[0]!.wallSegments.filter((_,i)=>i!==4)}]};assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,unclosed,new Map([[1,s.geometry]]),s.keys).rooms.length,0);
});
test('native columns and actual interior floor holes stay hollow and labels inside apertures are rejected',()=>{
 const s=setup();s.dataset.walls.push({kind:'column',levelId:1,nativeElementId:90,ringsFeet:[rect(7,7,8,8)]});
 const g={...s.geometry,floors:[[rect(0,0,20,10),rect(2,2,3,3)]]};const result=recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,g]]),s.keys);
 const r=result.rooms.find(r=>r.roomKey==='room0')!;assert.ok(r);assert.ok(r.ringsFeet.slice(1).some(h=>containsRoomPoint([2.5,2.5],h)));assert.ok(r.ringsFeet.slice(1).some(h=>containsRoomPoint([7.5,7.5],h)));
 const excluded={...s.geometry,floors:[[rect(0,0,20,10),rect(4,4,6,6)]]};assert.equal(recoverRegisteredRoomInteriors(s.dataset,s.annotations,s.reference,new Map([[1,excluded]]),s.keys).rooms.filter(r=>r.roomKey==='room0').length,0);
});

test('UNBC10-B514 recovers registered source corners where the novice native model cannot enclose its authored room',async()=>{
 const {readFile}=await import('node:fs/promises');const fixture=JSON.parse(await readFile(new URL('./fixtures/unbc-source-wall-boundary-regression.json',import.meta.url),'utf8'))as{roomKey:string;annotations:DirectoryRoom[];dataset:IndoorDataset;reference:BoundaryReference;geometry:ArchitecturalPlanGeometry};
 const before=JSON.stringify(fixture);const result=recoverRegisteredRoomInteriors(fixture.dataset,fixture.annotations,fixture.reference,new Map([[fixture.annotations[0]!.levelId,fixture.geometry]]),new Set([fixture.roomKey]));
 const recovered=result.rooms.find(r=>r.roomKey===fixture.roomKey);assert.ok(recovered,JSON.stringify(result.diagnostics));assert.ok(recovered.sourceCoverage>.99);assert.ok(recovered.cellCoverage>.9);assert.ok(recovered.boundaryElementIds.length>=2);assert.ok(recovered.sourceProof.wallSegmentIndices.length>=3);
 assert.equal(JSON.stringify(fixture),before);
 const unsupported={...fixture.geometry,floors:[]};assert.equal(recoverRegisteredRoomInteriors(fixture.dataset,fixture.annotations,fixture.reference,new Map([[fixture.annotations[0]!.levelId,unsupported]]),new Set([fixture.roomKey])).rooms.length,0);
});

test('associated foreign slab cannot override strict per-record physical floor support',()=>{
 const s=setup();
 assert.equal(recoverWithExactFloors(s.dataset,s.annotations,s.reference,new Map([[1,s.geometry]]),s.keys).rooms.length,0,'absence of exact support must disable fallback');
 const noPhysicalFloors=new Map(s.dataset.records.map(r=>[r.key,[] as ArchitecturalPlanGeometry['floors']]));
 assert.equal(recoverWithExactFloors(s.dataset,s.annotations,s.reference,new Map([[1,s.geometry]]),s.keys,noPhysicalFloors).rooms.length,0,'a foreign associated slab in geometry cannot fill absent physical floor');
 const physicalHole={...s.geometry,floors:[[rect(0,0,20,10),rect(4,4,6,6)]]};
 const exact=new Map(s.dataset.records.map(r=>[r.key,physicalHole.floors]));
 const result=recoverWithExactFloors(s.dataset,s.annotations,s.reference,new Map([[1,s.geometry]]),s.keys,exact);
 assert.equal(result.rooms.filter(r=>r.roomKey==='room0').length,0,'foreign associated solid slab cannot fill physical aperture at the label');
});


test('integrated presentation exports source proof and preserves the distinction from native routing promotion',async()=>{
 const {prepareIndoorPresentation}=await import('../lib/reviter/indoor-presentation.ts');const {promoteNativeRoomInteriors}=await import('../lib/reviter/native-room-promotion.ts');
 const s=setup(),before=JSON.stringify(s),geometries=new Map([[1,s.geometry]]),floorsByRecord=new Map(s.dataset.records.map(r=>[r.key,s.geometry.floors]));
 const nativeOnly=prepareIndoorPresentation(s.dataset,s.annotations);assert.equal(nativeOnly.rooms.length,0,'the omitted native partition leaves two distinct labels in one enclosure');
 const presentation=prepareIndoorPresentation(s.dataset,s.annotations,undefined,{boundaryReference:s.reference,geometries,floorsByRecord});
 assert.equal(presentation.rooms.length,2);assert.equal(presentation.diagnostics.length,0);
 for(const room of presentation.rooms){assert.equal(room.boundarySource,'registered-source-wall-enclosure');assert.equal(room.sourceProof!.sourceSha256,'survey');assert.equal(room.sourceGeometryKey,JSON.stringify([1,s.dataset.records.find(r=>r.key===room.roomKey)!.ringsFeet]));assert.ok(room.blockPartsFeet.length>0);}
 assert.equal(JSON.stringify(s),before);
 const source={annotations:s.annotations}as import('../lib/reviter/room-directory.ts').RoomDirectoryData;
 const promoted=promoteNativeRoomInteriors({...s.dataset,presentation},source);assert.equal(promoted.report.candidates,0);assert.equal(promoted.report.promoted,0);assert.deepEqual(promoted.data,source);
});
