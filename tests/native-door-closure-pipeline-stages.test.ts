import assert from "node:assert/strict";
import test from "node:test";
import { prepareIndoorDataset } from "../lib/reviter/indoor-pipeline.ts";
import { prepareNativeCirculationGeometry } from "../lib/reviter/native-circulation-geometry.ts";
import { nativeIndoorEnvelopeHash } from "../lib/reviter/native-indoor-envelopes.ts";
import { nativeMaterialSectionsHash } from "../lib/reviter/native-material-sections.ts";
import { directoryDoors } from "../lib/reviter/directory-navigation.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";

const sha="a".repeat(64),rect=(x0:number,y0:number,x1:number,y1:number):[number,number][]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
async function fixture(){
  const floor=rect(0,0,20,10),aperture=rect(4,4,8,5),jambs=[rect(3,4,3.9,5),rect(8.1,4,9,5)];
  const bound=(r:[number,number][],z0:number,z1:number)=>({min:{x:Math.min(...r.map(p=>p[0])),y:Math.min(...r.map(p=>p[1])),z:z0},max:{x:Math.max(...r.map(p=>p[0])),y:Math.max(...r.map(p=>p[1])),z:z1}});
  const model={fileName:"Synthetic.rvt",origin:{x:0,y:0,z:0},levels:[{levelId:1,elevation:0,candidates:1}],elementBounds:[
    {elementId:100,categoryId:-2000032,boundsFeet:bound(floor,-.5,0),loops:[floor.map(p=>[...p,0])]},
    {elementId:10,categoryId:-2000023,boundsFeet:bound(aperture,0,8),orientedBox:aperture.map(p=>[...p,0])},
    ...jambs.map((r,i)=>({elementId:20+i,categoryId:-2000100,boundsFeet:bound(r,0,8),orientedBox:r.map(p=>[...p,0])})),
  ],nativeAssociatedLevelRelations:[10,20,21,100].map(elementId=>({elementId,levelId:1})),nativeStairAssemblies:[]} as unknown as ConvertResult;
  const envelope={version:1 as const,sourceModelSha256:sha,levels:[{levelId:1,elevationFeet:0,partsFeet:[[floor]],sourceElementIds:[100],cutElevationsFeet:[4],evidenceSha256:"b".repeat(64)}]};
  const material={version:1 as const,sourceModelSha256:sha,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:.1,evidenceSha256:"c".repeat(64),sourceElementIds:[100],sections:[]}]};
  const nativeDoor=directoryDoors(model,1)[0]!;
  const source:RoomDirectoryData={format:"reviter-room-annotations",version:1,coordinateSystem:"revit-model-feet",model:{fileName:model.fileName},annotations:[{key:"a",number:"a",building:"01",name:"Corridor",levelId:1,confidence:1,polygonFeet:rect(0,0,10,4.5),labelPointFeet:[1,1]}],
    georeference:{format:"reviter-georeference",version:1,modelFileName:model.fileName,coordinateSystem:"WGS84",method:"fixed-scale",points:[{id:"p",name:"Origin",modelFeet:[0,0],levelId:1,geographic:{longitude:-122,latitude:53}},{id:"q",name:"Second",modelFeet:[100,0],levelId:1,geographic:{longitude:-121.999545,latitude:53}}]},
    nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)},nativeMaterialSections:{...material,geometrySha256:await nativeMaterialSectionsHash(material)},
    nativeDoorBoundaryClosures:{version:1,sourceModelSha256:sha,doors:[{id:"closure:10",levelId:1,nativeElementId:10,selectionBarrierOnly:true,originalDoor:{pointFeet:nativeDoor.point,normalFeet:nativeDoor.normal!,footprintFeet:nativeDoor.footprint!,roomKeys:["a"]},footprintFeet:rect(3.8998,4,8.1002,5),jambEvidence:jambs.map((r,i)=>({nativeElementId:20+i,ringsFeet:[r]})),evidenceSha256:"d".repeat(64),notes:"Synthetic exact measured column jambs"}]}};
  return{model,source};
}
test("stale active doorway metadata refuses before any expensive landing-pair callback",async()=>{
  const {model,source}=await fixture();source.nativeDoorBoundaryClosures!.doors[0]!.originalDoor.pointFeet[0]+=.01;let landingCalls=0;
  await assert.rejects(prepareIndoorDataset(model,source,sha,undefined,{nativeLandingApproaches:async()=>{landingCalls++;return{edges:[],diagnostics:[]};}}),/stale original doorway/);assert.equal(landingCalls,0);
});
test("the completed-geometry replay retains physical fixtures after earlier closure checks passed",async()=>{
  const {model,source}=await fixture();let landingCalls=0,compilerCalls=0;
  await assert.rejects(prepareIndoorDataset(model,source,sha,undefined,{nativeLandingApproaches:async()=>{landingCalls++;return{edges:[],diagnostics:[]};},nativeCirculationCompiler:async(m,d)=>{compilerCalls++;const result=prepareNativeCirculationGeometry(m,d);result.geometry.fixtures!.push({id:"late-physical-fixture",nativeElementId:999,levelIds:[1],elevationFeet:0,heightFeet:1,ringsFeet:[rect(3.95,4.1,4.05,4.2)]});return result;}}),/threshold crosses a physical fixture/);
  assert.equal(landingCalls,1);assert.equal(compilerCalls,1);
});
test("active native closures require a same-source complete fixture inventory at the final stage",async()=>{
  for(const mode of["missing-fixtures","foreign-source","missing-fixtures-no-envelope"]){const {model,source}=await fixture();if(mode==="missing-fixtures-no-envelope")delete source.nativeIndoorEnvelopes;await assert.rejects(prepareIndoorDataset(model,source,sha,undefined,{nativeLandingApproaches:async()=>({edges:[],diagnostics:[]}),nativeCirculationCompiler:async(m,d)=>{const result=prepareNativeCirculationGeometry(m,d);if(mode.startsWith("missing-fixtures"))Reflect.deleteProperty(result.geometry,"fixtures");else result.geometry.sourceModelSha256="b".repeat(64);return result;}}),/completed same-source physical fixture inventory/);}
});
