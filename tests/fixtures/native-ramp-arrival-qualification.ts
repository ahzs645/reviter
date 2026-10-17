import assert from "node:assert/strict";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";
import { certifyExportedNativeRampCrossfall } from "../../lib/reviter/indoor-ramps.ts";
const rect = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
export function fixture() {
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
