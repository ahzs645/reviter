import test from "node:test";
import assert from "node:assert/strict";
import { proposeNativeRampTerminalArrival } from "../lib/reviter/native-ramp-terminal-arrival.ts";
import { certifyExportedNativeRampCrossfall } from "../lib/reviter/indoor-ramps.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const rect = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
function fixture() {
  const sha = "a".repeat(64), lower = "landing:ramp:10:lower", upper = "landing:ramp:10:upper";
  const record = (key: string, levelId: number, z: number) => ({key,number:key,name:"Corridor",building:"B",levelId,elevationFeet:z,surfaceId:key,walkable:true,circulation:true,stair:false,access:"unknown",ringsFeet:[rect(0,-3,8,3)],properties:{}});
  const records = [record("target",1,0),record(lower,1,0),record(upper,2,2),record("hall",1,0)];
  records[1]!.properties={generatedLanding:true,nativeRampId:10,nativeFloorId:1};records[2]!.properties={generatedLanding:true,nativeRampId:10,nativeFloorId:2};
  const node = (id: string, roomKey: string, kind: string, pointFeet: number[], levelId=1) => ({id,roomKey,kind,pointFeet,levelId,building:"B",surfaceId:roomKey,geographic:[0,0]});
  const points: [number,number,number][] = [[3,0,0],[7,0,2]], triangles: [number,number,number][][] = [[[3,-2,0],[7,-2,2],[7,2,2]],[[3,-2,0],[7,2,2],[3,2,0]]];
  const nodes=[node("arrival:target","target","arrival",[5,0,0]),node("ramp:10:lower",lower,"connector",points[0]!),node("ramp:10:upper",upper,"connector",points[1]!,2),node("own-portal","target","portal",[2,0,0]),node("other-portal","hall","portal",[1.5,0,0])];
  const edges=[{id:"ramp:10",kind:"ramp",from:"ramp:10:lower",to:"ramp:10:upper",nativeElementId:10,pointsFeet:points,roomKeys:[lower,upper],enabled:true,accessible:"unknown"},{id:"approach",kind:"walk",nativeCellId:"cell",from:"own-portal",to:"ramp:10:lower",pointsFeet:[[2,0,0],[3,0,0]],roomKeys:["target",lower],enabled:true,accessible:"unknown"},{id:"door",kind:"door",from:"own-portal",to:"other-portal",nativeElementId:20,pointsFeet:[[2,0,0],[1.5,0,0]],roomKeys:["target","hall"],enabled:true,accessible:"unknown"}];
  const d={source:{modelSha256:sha},records,nodes,edges,doors:[{id:"door",state:"connected",nativeElementId:20,hostWallNativeElementId:30,roomKeys:["target","hall"]}],walkingSupport:{version:1,sourceModelSha256:sha,floors:[{nativeElementId:1,elevationFeet:0,ringsFeet:[rect(0,-5,3.01,5)]},{nativeElementId:2,elevationFeet:2,ringsFeet:[rect(6.99,-5,10,5)]}]},rampDisplay:{version:1,sourceModelSha256:sha,ramps:[{edgeId:"ramp:10",nativeElementId:10,trianglesFeet:triangles}]},circulationGeometry:{version:1,sourceModelSha256:sha,cells:[{id:"cell",elevationFeet:0,nativeFloorIds:[1],roomKeys:["target",lower]}]}} as unknown as IndoorDataset;
  const certificate=certifyExportedNativeRampCrossfall(d,triangles,[1,2],points);assert.ok(certificate);
  d.edges[0]!.nativeRampSurface={version:1,sourceModelSha256:sha,nativeRampId:10,nativeFloorElementIds:[1,2],pointsFeet:points,widthCertificate:certificate};
  const recipes={version:1,sourceModelSha256:sha,ramps:[{id:"ramp:10",nativeRampId:10,floorElementIds:[1,2],pointsFeet:points,trianglesFeet:triangles,accessible:"unknown",evidence:"Original source qualified ramp"}]};
  return {d,recipes};
}
test("a flat label on its own nonplanar ramp proposes the unique existing physically checked native landing, editing nothing",()=>{
  const {d,recipes}=fixture(),before=JSON.stringify(d),checked:string[]=[];
  const p=proposeNativeRampTerminalArrival(d,recipes,"target",e=>{checked.push(e.id);return true;});
  assert.ok(p);assert.equal(p.proposedArrivalNodeId,"ramp:10:lower");assert.deepEqual(p.originalArrivalPointFeet,[5,0,0]);assert.deepEqual(p.proposedArrivalPointFeet,[3,0,0]);
  assert.deepEqual(p.roomKeys,["hall","landing:ramp:10:lower","landing:ramp:10:upper","target"]);
  assert.deepEqual(new Set(checked),new Set(["ramp:10","approach","door"]));assert.equal(JSON.stringify(d),before);
});
test("existing arrivals, staff owners, a different plane or no physical replay remain refusals",()=>{
  for(const mutate of [(d:IndoorDataset)=>{d.records[0]!.arrivalNodeId="existing"},(d:IndoorDataset)=>{d.records[3]!.access="staff"},(d:IndoorDataset)=>{d.nodes[1]!.pointFeet[2]=.01},(d:IndoorDataset)=>{d.edges[1]!.enabled=false}]){
    const {d,recipes}=fixture();mutate(d);assert.equal(proposeNativeRampTerminalArrival(d,recipes,"target",()=>true),undefined);
  }
  const {d,recipes}=fixture();assert.equal(proposeNativeRampTerminalArrival(d,recipes,"target",()=>false),undefined);
});
test("changed source triangles, stale source model and a genuine native landing hole cannot supply an arrival",()=>{
  const stale=fixture();stale.recipes.sourceModelSha256="b".repeat(64);assert.equal(proposeNativeRampTerminalArrival(stale.d,stale.recipes,"target",()=>true),undefined);
  const changed=fixture();changed.recipes=structuredClone(changed.recipes);changed.recipes.ramps[0]!.trianglesFeet[0]![0]![0]+=.01;
  assert.equal(proposeNativeRampTerminalArrival(changed.d,changed.recipes,"target",()=>true),undefined);
  const hole=fixture();hole.d.walkingSupport!.floors[0]!.ringsFeet.push(rect(2.9,-.1,3.1,.1));assert.equal(proposeNativeRampTerminalArrival(hole.d,hole.recipes,"target",()=>true),undefined);
});
