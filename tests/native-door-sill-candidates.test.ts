import assert from "node:assert/strict";
import test from "node:test";
import { nativeDoorSillCandidates } from "../lib/reviter/native-door-sill-candidates.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const ring=(x0:number,x1:number)=>[[x0,-1.5],[x1,-1.5],[x1,1.5],[x0,1.5]];
function fixture(){
 const top=50/304.8,sha="a".repeat(64);
 const model={elementBounds:[{elementId:1,wallKind:"curtain"},{elementId:2,boundsFeet:{min:{z:top}}},
  {elementId:3,categoryId:-2000171,renderGeometryProvenance:"native",orientedBox:Array.from({length:8},()=>[0,0,0]),boundsFeet:{min:{z:0},max:{z:top}}}],
  nativeHostRelations:[{elementId:2,hostId:1,evidence:"persisted"},{elementId:3,hostId:1,evidence:"persisted"}]} as unknown as ConvertResult;
 const data={source:{modelSha256:sha},nativeLevels:[{id:10,elevationFeet:0}],doors:[{id:"door:10:2",nativeElementId:2,hostWallNativeElementId:1,levelId:10,state:"unmatched",roomKeys:[],footprintFeet:ring(-.04,.04)}],edges:[],nativeMaterialSections:{sourceModelSha256:sha,levels:[{levelId:10,elevationFeet:0,cutElevationFeet:.1,sections:[{nativeElementId:3,partsFeet:[[ring(-.25,.25)]]}]}]}} as unknown as IndoorDataset;
 return {model,data};
}
test("recognizes a native own-host 50 mm sill with exact positive doorway material; grants no route authority",()=>{
 const {model,data}=fixture(),before=JSON.stringify([model,data]);const rows=nativeDoorSillCandidates(model,data,[10]);
 assert.equal(rows.length,1);assert.equal(rows[0]!.members[0]!.heightMillimetres,50);
 assert.equal(rows[0]!.authorityGranted,false);assert.equal(JSON.stringify([model,data]),before);
 assert.equal(nativeDoorSillCandidates(model,data,[99]).length,0);
});
test("foreign/unbound children, approximate bodies and wrong source elevations are not this pattern",()=>{
 for(const change of [(m:ConvertResult)=>m.nativeHostRelations![1].hostId=9,(m:ConvertResult)=>m.elementBounds[2].renderGeometryProvenance="reconstructed",(m:ConvertResult)=>m.elementBounds[2].boundsFeet.min.z=.01,(m:ConvertResult)=>m.elementBounds[1].boundsFeet.min.z=.5]){
  const {model,data}=fixture();change(model);assert.equal(nativeDoorSillCandidates(model,data,[10]).length,0);
 }
});
test("a source-material gap or tangency cannot be rounded into sill overlap",()=>{
 for(const x of [.04,.04+2**-40]){
  const {model,data}=fixture();data.nativeMaterialSections!.levels[0]!.sections[0]!.partsFeet=[[ring(x,.3) as [number,number][]]];
  assert.equal(nativeDoorSillCandidates(model,data,[10]).length,0);
 }
 const {model,data}=fixture();data.nativeMaterialSections!.sourceModelSha256="b".repeat(64);
 assert.throws(()=>nativeDoorSillCandidates(model,data,[10]),/model-bound/);
});
