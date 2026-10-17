import assert from "node:assert/strict";
import test from "node:test";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {reviewedDrawingReferencesHash,validateReviewedDrawingReferences,type ReviewedDrawingReferences} from "../lib/reviter/reviewed-drawing-references.ts";
import {reviewedDrawingReferenceElementIds} from "../lib/reviter/reviewed-drawing-reference-source.ts";
import {nativeDrawingReferenceInstanceHash,nativeDrawingReferenceSourceHash,type NativeDrawingReferenceInstanceFact} from "../lib/reviter/native-drawing-reference-source.ts";
import {prepareNativeLocalStairMaterial} from "../lib/reviter/native-local-transition-qualification.ts";
import {validNativeSourceStairMaterial} from "../lib/reviter/native-source-stair-material.ts";
import type {ConvertResult} from "../lib/reviter/types.ts";
import type {IndoorDataset} from "../lib/reviter/indoor-contract.ts";
const modelSha="a".repeat(64),uid="12345678-1234-4321-abcd-0123456789ab-00000190";
const hash=(v:string)=>bytesToHex(sha256(new TextEncoder().encode(v)));
function fixture() {
 const fact:NativeDrawingReferenceInstanceFact={nativeElementId:400,sourceClass:"ImportInstance",instanceFrameSha256:"b".repeat(64),masterSymbolId:500,masterSourceClass:"MasterImportSymbol",masterFrameSha256:"c".repeat(64),masterName:"Floor plan.DWG",sourceFileName:"Floor plan.DWG",sourceFileNameEvidence:"SymbolInfo.name",sourceFileNameSha256:hash("Floor plan.DWG")};
 const inventory={version:1 as const,sourceModelSha256:modelSha,schemaSha256:"d".repeat(64),instances:[fact],geometrySha256:""};inventory.geometrySha256=nativeDrawingReferenceSourceHash(inventory);
 const review:ReviewedDrawingReferences={version:1,sourceModelSha256:modelSha,sourceInventorySha256:inventory.geometrySha256,decisionEvidenceSha256:"e".repeat(64),instances:[{nativeElementId:400,nativeUniqueId:uid,sourceFactSha256:nativeDrawingReferenceInstanceHash(fact),sourceName:fact.sourceFileName,classification:"drawing-reference"}],geometrySha256:""};review.geometrySha256=reviewedDrawingReferencesHash(review);
 const record=(elementId:number,categoryId?:number)=>({elementId,categoryId,boundsFeet:{min:{x:.2,y:-.2,z:.1},max:{x:.8,y:.2,z:.4}},...(elementId===400?{familySymbolId:500}:{})});
 const model={origin:{x:0,y:0,z:0},meshes:[],elementBounds:[record(201,-2000919),record(400),record(401,-2000011),record(402)],nativeIdentity:{identities:[{elementId:400,uniqueId:uid,provenance:"Global/ElemTable.ElementHistory+Global/History.Episode"}]},nativeDrawingReferenceSource:inventory} as unknown as ConvertResult;
 const data={source:{modelSha256:modelSha},reviewedDrawingReferences:review} as IndoorDataset;
 const receipt={nativeStairId:200,nativeRunIds:[201],nativeFloorElementIds:[300,301] as [number,number],pointsFeet:[[0,0,0],[1,0,.5],[2,0,1]] as [number,number,number][]};
 return {model,data,review,fact,receipt};
}
test("reviewed original drawing imports are omitted while native walls and other unknowns remain",()=>{
 const {model,data,receipt}=fixture(),before=JSON.stringify(model);
 const material=prepareNativeLocalStairMaterial(model,data,receipt,[201]);
 assert.deepEqual(material.sourceElementIds,[401,402]);assert.deepEqual(material.bands[0]!.unclassifiedSourceElementIds,[402]);
 assert.equal(JSON.stringify(model),before);assert.equal(validNativeSourceStairMaterial(material,modelSha,200,receipt.pointsFeet,undefined,undefined,undefined,true,data.reviewedDrawingReferences),false);
});
test("source semantics are exact identity and revision bound, never a filename wildcard",()=>{
 for(const mutation of ["model","inventory","uid","name","fact","native-wall","duplicate"]){
  const {model,review}=fixture();
  if(mutation==="model")review.sourceModelSha256="f".repeat(64);
  if(mutation==="inventory")review.sourceInventorySha256="f".repeat(64);
  if(mutation==="uid")review.instances[0]!.nativeUniqueId=uid.replace("00000190","00000191");
  if(mutation==="name")review.instances[0]!.sourceName="Other.DWG";
  if(mutation==="fact")review.instances[0]!.sourceFactSha256="f".repeat(64);
  if(mutation==="native-wall")review.instances[0]!.nativeElementId=401;
  if(mutation==="duplicate")review.instances.push(structuredClone(review.instances[0]!));
  review.geometrySha256=reviewedDrawingReferencesHash(review);
  assert.throws(()=>reviewedDrawingReferenceElementIds(model,review,modelSha),Error,mutation);
 }
});
test("changing or removing a reviewed reference invalidates old stair material receipts",()=>{
 const {model,data,review,receipt}=fixture();model.elementBounds=model.elementBounds.filter(r=>r.elementId!==401&&r.elementId!==402);
 const material=prepareNativeLocalStairMaterial(model,data,receipt,[201]);
 assert.equal(validNativeSourceStairMaterial(material,modelSha,200,receipt.pointsFeet,undefined,undefined,undefined,true,review),true);
 assert.equal(validNativeSourceStairMaterial(material,modelSha,200,receipt.pointsFeet,undefined,undefined,undefined,true),false);
 const revoked=structuredClone(review);revoked.instances=[];revoked.geometrySha256=reviewedDrawingReferencesHash(revoked);
 assert.equal(validNativeSourceStairMaterial(material,modelSha,200,receipt.pointsFeet,undefined,undefined,undefined,true,revoked),false);
 const legacy=prepareNativeLocalStairMaterial(model,{...data,reviewedDrawingReferences:undefined},receipt,[201]);assert.deepEqual(legacy.bands[0]!.unclassifiedSourceElementIds,[400]);
});
test("malformed review hashes and classifications fail before source use",()=>{
 const {review}=fixture();review.instances[0]!.sourceName="Changed";assert.throws(()=>validateReviewedDrawingReferences(review,modelSha));
});
test("source-only drawings may lack bounds, but duplicate or conflicting bounds refuse",()=>{
 const {model,review}=fixture();
 const original=model.elementBounds.find(row=>row.elementId===400)!;
 model.elementBounds=model.elementBounds.filter(row=>row.elementId!==400);
 assert.deepEqual([...reviewedDrawingReferenceElementIds(model,review,modelSha)],[400]);
 model.elementBounds.push({...original,familySymbolId:501});
 assert.throws(()=>reviewedDrawingReferenceElementIds(model,review,modelSha));
 model.elementBounds[model.elementBounds.length-1]=original;
 model.elementBounds.push(structuredClone(original));
 assert.throws(()=>reviewedDrawingReferenceElementIds(model,review,modelSha));
});
