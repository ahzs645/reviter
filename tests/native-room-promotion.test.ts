import assert from "node:assert/strict";
import test from "node:test";
import { recoverNativeRoomInteriors } from "../lib/reviter/native-room-presentation.ts";
import { promoteNativeRoomInteriors } from "../lib/reviter/native-room-promotion.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
import { containsRoomPoint } from "../lib/reviter/room-directory.ts";
type Point = [number, number];
const rect=(x0:number,y0:number,x1:number,y1:number):Point[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const setup=()=>{
  const r:IndoorRecord={key:"room",number:"05-139C",name:"Office",building:"05",levelId:1,elevationFeet:0,elevationEvidence:"native",surfaceId:"1",circulation:false,stair:false,access:"public",walkable:true,confidence:.7,ringsFeet:[rect(.4,.4,9.6,9.6)],properties:{}};
  const dataset={source:{modelSha256:"a".repeat(64)},records:[r],walls:[],presentation:{sourceModelSha256:"a".repeat(64),rooms:[{roomKey:r.key,levelId:1,sourceGeometryKey:JSON.stringify([r.levelId,r.ringsFeet]),interiorRingsFeet:[rect(0,0,10,10)],blockPartsFeet:[[rect(-1,-1,11,11)]],boundarySource:"native-wall-enclosure",boundaryElementIds:[10,11,12,13],sourceCoverage:1,cellCoverage:.84}]}} as unknown as IndoorDataset;
  const source={format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:"UNBC.rvt"},annotations:[{key:r.key,levelId:1,polygonFeet:r.ringsFeet[0]!,labelPointFeet:[5,5],confidence:.7}],georeference:{modelFileName:"UNBC.rvt",points:[]}} as unknown as RoomDirectoryData;
  return {dataset,source};
};
test("opt-in promotion uses enclosed interior rather than roof/wall material and preserves source provenance",()=>{
  const{dataset,source}=setup(),before=JSON.stringify([dataset,source]);
  const {data,report}=promoteNativeRoomInteriors(dataset,source);
  assert.equal(report.promoted,1);assert.deepEqual(data.annotations[0]!.polygonFeet,rect(0,0,10,10));
  assert.deepEqual((data.annotations[0]!.nativeInteriorProvenance as {originalRingsFeet:Point[][]}).originalRingsFeet,[source.annotations[0]!.polygonFeet]);
  assert.equal(JSON.stringify([dataset,source]),before);assert.deepEqual(data.georeference,source.georeference);
});
test("promotion preserves explicit floor apertures and rejects route anchors within openings",()=>{
  const{dataset,source}=setup();source.annotations[0]!.floorOpeningsFeet=[rect(1,1,2,2)];
  let result=promoteNativeRoomInteriors(dataset,source);assert.equal(result.report.promoted,1);
  assert.ok(result.data.annotations[0]!.holesFeet!.some(h=>containsRoomPoint([1.5,1.5],h)));
  source.annotations[0]!.routePointFeet=[1.5,1.5];
  result=promoteNativeRoomInteriors(dataset,source);assert.equal(result.report.promoted,0);assert.equal(result.report.rejected[0]!.code,"anchor-outside-interior");
});
test("repeating native promotion retains the first source outline and remains deterministic", () => {
  const {dataset, source} = setup();
  const first = promoteNativeRoomInteriors(dataset, source);
  dataset.records[0]!.ringsFeet = [first.data.annotations[0]!.polygonFeet, ...(first.data.annotations[0]!.holesFeet ?? [])];
  dataset.presentation!.rooms[0]!.sourceGeometryKey = JSON.stringify([dataset.records[0]!.levelId, dataset.records[0]!.ringsFeet]);
  const repeated = promoteNativeRoomInteriors(dataset, first.data);
  assert.equal(repeated.report.promoted, 1);
  assert.deepEqual(repeated.data, first.data);
});
test("promotion rejects stairs, stale geometry/digest and any significant native barrier or protected circulation overlap",()=>{
  for(const code of ["ineligible-room","stale-source-geometry","native-barrier-overlap","protected-floor-overlap"]){
    const{dataset,source}=setup();
    if(code==="ineligible-room")dataset.records[0]!.stair=true;
    if(code==="stale-source-geometry")source.annotations[0]!.polygonFeet=rect(1,1,9,9);
    if(code==="native-barrier-overlap")dataset.walls.push({kind:"wall",levelId:1,nativeElementId:10,ringsFeet:[rect(8,0,8.1,10)]});
    if(code==="protected-floor-overlap")dataset.records.push({...dataset.records[0]!,key:"hall",circulation:true,ringsFeet:[rect(9,0,10,10)]});
    const result=promoteNativeRoomInteriors(dataset,source);assert.equal(result.report.promoted,0);assert.equal(result.report.rejected[0]!.code,code);
  }
  const{dataset,source}=setup();dataset.presentation!.sourceModelSha256="b".repeat(64);
  assert.throws(()=>promoteNativeRoomInteriors(dataset,source),/stale/);
});

test('small source-cell coverage requires recomputing a real sole-label enclosure, not saved claims',()=>{
 const {dataset,source}=setup();
 const record=dataset.records[0]!;record.ringsFeet=[rect(3,3,7,7)];source.annotations[0]!.polygonFeet=record.ringsFeet[0]!;
 const boundary=dataset.presentation!.rooms[0]!;boundary.sourceGeometryKey=JSON.stringify([record.levelId,record.ringsFeet]);boundary.cellCoverage=.16;
 assert.equal(promoteNativeRoomInteriors(dataset,source).report.promoted,0,'a fabricated enclosure with no walls cannot be promoted');
 dataset.walls=[rect(-1,-1,11,0),rect(-1,10,11,11),rect(-1,0,0,10),rect(10,0,11,10)].map((ring,i)=>({kind:'wall',levelId:1,nativeElementId:i+10,ringsFeet:[ring]}));
 // Normalization can rotate/reorder rings; store the exact independently recovered shape.
 const recovered=recoverNativeRoomInteriors(dataset.records,dataset.walls,[],new Map([['room',[5,5]]])).rooms[0]!;
 boundary.interiorRingsFeet=recovered.ringsFeet;boundary.boundaryElementIds=recovered.boundaryElementIds;
 const result=promoteNativeRoomInteriors(dataset,source);assert.equal(result.report.promoted,1);
 assert.deepEqual((result.data.annotations[0]!.nativeInteriorProvenance as {originalRingsFeet:Point[][]}).originalRingsFeet,record.ringsFeet);
 const hall={...record,key:'hall',circulation:true,ringsFeet:[rect(8,1,9,2)]};dataset.records.push(hall);
 assert.equal(promoteNativeRoomInteriors(dataset,source).report.promoted,0);
});
