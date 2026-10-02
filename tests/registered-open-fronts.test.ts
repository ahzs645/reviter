import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recoverRegisteredOpenFronts, recoverRegisteredCirculationSeams } from "../lib/reviter/registered-open-fronts.ts";
import { buildIndoorGrid } from "../lib/reviter/indoor-grid.ts";
import { nativeRouteBlocker, type DirectoryRoom } from "../lib/reviter/room-directory.ts";
import type { ArchitecturalPlanGeometry } from "../lib/reviter/architectural-plan.ts";
import type { BoundaryReference } from "../lib/reviter/room-boundaries.ts";
const room: DirectoryRoom = { key: "service", number: "05-1", name: "Service point", levelId: 1, confidence: .65, polygonFeet: [[0,0],[5,0],[5,10],[0,10]], labelPointFeet: [2,5], dwg: { sectionId: "05 floor" } };
const hall: DirectoryRoom = { key: "hall", number: "05-2", name: "Corridor", levelId: 1, confidence: .65, polygonFeet: [[5.4,0],[11,0],[11,10],[5.4,10]], labelPointFeet: [8,5], dwg: { sectionId: "05 floor" } };
const reference: BoundaryReference = { format: "reviter-boundary-reference", version: 1, coordinateSystem: "revit-model-feet", sourceSha256: "source", sections: [{ sectionId: "05 floor", levelId: 1, registrationErrorFeet: 0, wallSegments: [], doorSegments: [] }] };
const geometry: ArchitecturalPlanGeometry = { walls: [], columns: [], doors: [], cutElevation: 4, floors: [[[[0,0],[11,0],[11,10],[0,10]]]] };
const recover = (rooms = [room,hall], g = geometry, ref: BoundaryReference | undefined = reference) => recoverRegisteredOpenFronts(rooms, new Set([room.key]), ref, g);
const strip = [[5.1,0],[5.2,0],[5.2,10],[5.1,10]] as [number,number][];
test("registered doorless seam yields one full-width native-floor-supported entrance without mutating the source", () => {
 const before = JSON.stringify([room,hall]), fronts = recover();
 assert.equal(fronts.length, 1); assert.deepEqual(fronts[0]!.rooms, ["service","hall"]);
 assert.equal(fronts[0]!.proof.widthFeet,2); assert.ok(Math.abs(fronts[0]!.proof.boundaryGapFeet-.4)<1e-8);
 assert.ok(fronts[0]!.proof.floorCoveredSquareFeet>2); assert.ok(!("doorId" in fronts[0]!));
 assert.equal(JSON.stringify([room,hall]),before); assert.equal(room.access,undefined);
});
test("open front never crosses native walls, columns, repaired joints, or a registered drawing wall", () => {
 for (const kind of ["walls","columns"] as const) assert.equal(recover(undefined,{...geometry,[kind]:[{elementId:123,polygon:strip,approximate:false}]}).length,0);
 // A thin repair strip is smaller than the legacy explicit-opening area tolerance.
 assert.equal(recover(undefined,{...geometry,walls:[{elementId:456,polygon:[[5.15,0],[5.1501,0],[5.1501,10],[5.15,10]],approximate:true}]}).length,0);
 assert.equal(recover(undefined,geometry,{...reference,sections:[{...reference.sections[0]!,wallSegments:[[[5.15,0],[5.15,10]]]}]}).length,0);
});
test("full swept width rejects missing native floor coverage even if the centerline is supported", () => {
 assert.equal(recover(undefined,{...geometry,floors:[]}).length,0);
 assert.equal(recover(undefined,{...geometry,floors:[[[[0,0],[5.1,0],[5.1,10],[0,10]]],[[[5.2,0],[11,0],[11,10],[5.2,10]]]]}).length,0);
 assert.equal(recover(undefined,{...geometry,floors:[[[[0,4.99],[11,4.99],[11,5.01],[0,5.01]]]]}).length,0);
});
test("source holes, floor openings and third-room masks veto a geometrically clear front", () => {
 assert.equal(recover([{...room,holesFeet:[strip]},hall]).length,0);
 assert.equal(recover([room,{...hall,floorOpeningsFeet:[strip]}]).length,0);
 assert.equal(recover([room,hall,{...room,key:"private",polygonFeet:strip,labelPointFeet:[5.15,5],access:{kind:"staff",evidence:"user-reported"}}]).length,0);
});
test("recovery requires the same well-registered source section, small seam and ordinary accessible candidate", () => {
 assert.equal(recoverRegisteredOpenFronts([room,hall],new Set([room.key]),undefined,geometry).length,0);
 assert.equal(recover(undefined,geometry,{...reference,sections:[{...reference.sections[0]!,registrationErrorFeet:.051}]}).length,0);
 assert.equal(recover([room,{...hall,dwg:{sectionId:"different"}}]).length,0);
 assert.equal(recover([{...room,access:{kind:"staff",evidence:"user-reported"}},hall]).length,0);
 assert.equal(recover([{...room,walkability:"void"},hall]).length,0);
 assert.equal(recover([{...room,name:"Staircase",stairAccess:"local-only"},hall]).length,0);
 assert.equal(recover([room,{...hall,polygonFeet:[[5.8,0],[11,0],[11,10],[5.8,10]]}]).length,0);
});
test("actual Library Services Desk uses the source-proven gap between counters and connects its arrival", async () => {
 const fixture = JSON.parse(await readFile(new URL("./fixtures/unbc-services-desk-open-front.json",import.meta.url),"utf8"));
 const fronts = recoverRegisteredOpenFronts(fixture.rooms,new Set([fixture.roomKey]),fixture.reference,fixture.geometry);
 assert.equal(fronts.length,1); const front = fronts[0]!;
 assert.deepEqual(front.rooms,["rm-311-ac6ce9426f1c","rm-311-ac7069426f1f"]);
 assert.equal(front.proof.widthFeet,2); assert.ok(Math.abs(front.proof.boundaryGapFeet-.03809523809522375)<1e-8);
 assert.ok(Math.abs(front.proof.floorCoveredSquareFeet-2.0761904761893675)<1e-7);
 const source = fixture.rooms.find((r: DirectoryRoom)=>r.key===fixture.roomKey);
 const grid = buildIndoorGrid([source],fixture.rooms.filter((r: DirectoryRoom)=>r.key!==source.key),[
  {id:"arrival",roomKey:source.key,point:source.labelPointFeet,maxSnapFeet:1.2},
  {id:"front",roomKey:source.key,point:front.from,maxSnapFeet:2,nativeClearWidthFootprint:front.footprint},
 ],fixture.geometry,fronts,.6);
 assert.deepEqual(grid.missing,[]); assert.ok(grid.branches.some(b=>[b.from,b.to].includes("arrival")&&[b.from,b.to].includes("front")));
 const blocked=nativeRouteBlocker(fixture.geometry,fronts);
 for(const branch of grid.branches) for(let i=1;i<branch.points.length;i++) assert.equal(blocked(branch.points[i-1]!,branch.points[i]!),false);
});

test("coincident registered edges recover only an actual full-width clear opening",()=>{
 const touch={...hall,polygonFeet:[[5,0],[11,0],[11,10],[5,10]] as [number,number][]};
 const fronts=recover([room,touch]);assert.equal(fronts.length,1);assert.equal(fronts[0]!.proof.boundaryGapFeet,0);
 const wall={elementId:99,approximate:false,polygon:[[4.99,0],[5.01,0],[5.01,10],[4.99,10]] as [number,number][]};
 assert.equal(recover([room,touch],{...geometry,walls:[wall]}).length,0);
 assert.equal(recover([room,touch],geometry,{...reference,sections:[{...reference.sections[0]!,wallSegments:[[[5,0],[5,10]]]}]}).length,0);
 assert.equal(recover([room,touch],{...geometry,floors:[[[[0,0],[4.9,0],[4.9,10],[0,10]]],[[[5.1,0],[11,0],[11,10],[5.1,10]]]]}).length,0);
});

test("slightly overlapping registered outlines orient an opening out of the room",()=>{
 const overlap={...hall,polygonFeet:[[4.85,0],[11,0],[11,10],[4.85,10]] as [number,number][]};
 const fronts=recover([room,overlap]); assert.equal(fronts.length,1);
 assert.ok(fronts[0]!.from[0] < 5); assert.ok(fronts[0]!.to[0] > 5);
 assert.equal(recover([room,overlap],{...geometry,walls:[{elementId:99,approximate:false,polygon:[[4.99,0],[5.01,0],[5.01,10],[4.99,10]]}]}).length,0);
});

test("actual 07-244 washroom recovers its doorless front despite a slightly overlapping corridor",async()=>{
 const fixture=JSON.parse(await readFile(new URL("./fixtures/unbc-washroom-open-front.json",import.meta.url),"utf8"));
 const fronts=recoverRegisteredOpenFronts(fixture.rooms,new Set([fixture.roomKey]),fixture.reference,fixture.geometry);
 assert.equal(fronts.length,1); assert.equal(fronts[0]!.proof.widthFeet,2);
 assert.deepEqual(fronts[0]!.rooms,["rm-311-47fab5792af4","rm-311-05a95d8222f3"]);
 const source=fixture.rooms.find((r:DirectoryRoom)=>r.key===fixture.roomKey);
 const grid=buildIndoorGrid([source],fixture.rooms.filter((r:DirectoryRoom)=>r.key!==source.key),[
  {id:"arrival",roomKey:source.key,point:source.labelPointFeet,maxSnapFeet:1.2},
  {id:"front",roomKey:source.key,point:fronts[0]!.from,maxSnapFeet:2,nativeClearWidthFootprint:fronts[0]!.footprint},
 ],fixture.geometry,fronts,.6);
 assert.deepEqual(grid.missing,[]);
 assert.ok(grid.branches.some(b=>[b.from,b.to].includes("arrival")&&[b.from,b.to].includes("front")));
});


test("all coplanar circulation seams recover even for already connected corridors, with independent exact floor and storey guards",()=>{
 const a={...room,key:"hall-a",name:"Corridor",dwg:{sectionId:"05 floor",sha256:"source"}},b={...hall,key:"hall-b",dwg:{sectionId:"05 floor",sha256:"source"}};
 const support=new Map([a,b].map(r=>[r.key,{elevationFeet:0,floors:geometry.floors}]));
 const seams=recoverRegisteredCirculationSeams([a,b],reference,geometry,support);
 assert.equal(seams.length,1);assert.deepEqual(seams[0]!.rooms,[a.key,b.key]);assert.match(seams[0]!.openingId,/recovered-circulation-seam:/);assert.equal(seams[0]!.proof.widthFeet,2);
 assert.equal(recoverRegisteredCirculationSeams([a,b],reference,geometry,new Map([[a.key,support.get(a.key)!],[b.key,{elevationFeet:3.28,floors:geometry.floors}]] )).length,0);
 assert.equal(recoverRegisteredCirculationSeams([a,b],reference,geometry,new Map([[a.key,support.get(a.key)!],[b.key,{elevationFeet:0,floors:[]}]] )).length,0);
 assert.equal(recoverRegisteredCirculationSeams([a,{...b,dwg:{...b.dwg,sha256:"stale"}}],reference,geometry,support).length,0);
 assert.equal(recoverRegisteredCirculationSeams([a,b],reference,{...geometry,walls:[{elementId:123,polygon:strip,approximate:false}]},support).length,0);
 assert.equal(recoverRegisteredCirculationSeams([a,b],{...reference,sections:[{...reference.sections[0]!,wallSegments:[[[5.15,0],[5.15,10]]]}]},geometry,support).length,0);
 const hole:ArchitecturalPlanGeometry["floors"][number]=[[[0,0],[11,0],[11,10],[0,10]],strip];
 assert.equal(recoverRegisteredCirculationSeams([a,b],reference,geometry,new Map([[a.key,support.get(a.key)!],[b.key,{elevationFeet:0,floors:[hole]}]])).length,0);
});

test("reviewed shared stair landings recover flat circulation seams while flights and unsupported landings do not", () => {
 const a:DirectoryRoom={...room,key:"landing",name:"Stair 4",stairAccess:"flight-and-landing",spaceUse:{kind:"hallway",evidence:"user-reported"},dwg:{sectionId:"05 floor",sha256:"source"}};
 const b:DirectoryRoom={...hall,dwg:{sectionId:"05 floor",sha256:"source"}};
 const support=new Map([a,b].map(r=>[r.key,{elevationFeet:0,floors:geometry.floors}]));
 const before=JSON.stringify([a,b]);
 const recover=(landing:DirectoryRoom=a,g:ArchitecturalPlanGeometry=geometry,s=support)=>recoverRegisteredCirculationSeams([landing,b],reference,g,s);
 assert.equal(recover().length,1);
 assert.equal(JSON.stringify([a,b]),before,"stair identity, access and source outlines remain unchanged");
 assert.equal(recover({...a,spaceUse:undefined}).length,0);
 assert.equal(recover({...a,stairAccess:"unreviewed"}).length,0);
 assert.equal(recover({...a,stairAccess:"local-only"}).length,0);
 assert.equal(recover({...a,access:{kind:"staff",evidence:"user-reported"}}).length,0);
 assert.equal(recover(a,{...geometry,walls:[{elementId:123,polygon:strip,approximate:false}]}).length,0);
 const hole:ArchitecturalPlanGeometry["floors"][number]=[geometry.floors[0]![0]!,strip];
 assert.equal(recover(a,geometry,new Map([[a.key,{elevationFeet:0,floors:[hole]}],[b.key,support.get(b.key)!]])).length,0);
 assert.equal(recover(a,geometry,new Map([[a.key,{elevationFeet:1,floors:geometry.floors}],[b.key,support.get(b.key)!]])).length,0);
});

test("actual Conference shared landing joins Lobby and Corridor across source-outline seams",async()=>{
 const f=JSON.parse(await readFile(new URL('./fixtures/unbc-shared-landing.json',import.meta.url),'utf8'));
 const support=new Map<string,{elevationFeet:number;floors:ArchitecturalPlanGeometry['floors']}>(f.rooms.map((r:DirectoryRoom)=>[r.key,{elevationFeet:f.elevationFeet,floors:f.geometry.floors}]));
 const fronts=recoverRegisteredCirculationSeams(f.rooms,f.reference,f.geometry,support);
 const numbers=(front:typeof fronts[number])=>front.rooms.map(k=>f.rooms.find((r:DirectoryRoom)=>r.key===k).number).sort().join('|');
 assert.deepEqual(fronts.map(numbers).sort(),f.expectedPairs.map((p:string[])=>p.sort().join('|')).sort());
 assert.ok(fronts.every(front=>front.proof.widthFeet===2));
 assert.ok(fronts.some(front=>front.proof.boundaryGapFeet>.05&&front.proof.boundaryGapFeet<.053));
 const unreviewed=f.rooms.map((r:DirectoryRoom)=>r.number==='06-S204'?{...r,spaceUse:undefined}:r);
 assert.equal(recoverRegisteredCirculationSeams(unreviewed,f.reference,f.geometry,support).length,0);
});
