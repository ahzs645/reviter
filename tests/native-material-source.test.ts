import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import test from'node:test';
import{decodeRevit2027FramedGRepRoot}from'../lib/reviter/revit-2027-framed-grep-root.ts';
import{replayRevit2027GRepFifo}from'../lib/reviter/revit-2027-grep-replay.ts';
import{originalInstanceOnlyContainer,prepareNativeMaterialSource,nativeSourceNonPhysicalElementIds,nativeStairMaterialContainerChildren}from'../lib/reviter/native-material-source.ts';
import type{ElementHeader}from'../lib/reviter/element-headers.ts';
import type{ConvertResult}from'../lib/reviter/types.ts';
import type{Revit2027GRepReplaySpan}from'../lib/reviter/revit-2027-grep-replay.ts';
import type{Revit2027GInstance,Revit2027InstanceInfo}from'../lib/reviter/revit-2027-ginstance.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-material-source-graphs.json',import.meta.url),'utf8')) as {sourceModelSha256:string;frames:{nativeElementId:number;sourceFrameSha256:string;frameHex:string}[]};
const sourceModelSha256=fixture.sourceModelSha256;
const header=(elementId:number,categoryId:number|null):ElementHeader=>({elementId,categoryId,familyId:null,ownerViewId:null,designOptionId:null});
function replay(nativeElementId:number){
 const record=fixture.frames.find((r)=>r.nativeElementId===nativeElementId)!,bytes=Uint8Array.from(Buffer.from(record.frameHex,'hex'));
 const root=decodeRevit2027FramedGRepRoot(bytes,{offset:0,elementId:nativeElementId,objectLength:bytes.length-20,marker:2246,typeCode:0},2027);if(!root.ok)assert.fail(root.error);
 const result=replayRevit2027GRepFifo(bytes,root.value);if(!result.ok)assert.fail(result.error);return{bytes,replay:result.value};
}
function modelFixture(){
 const{bytes,replay:original}=replay(2046769),proof=originalInstanceOnlyContainer(original,bytes)!;assert.ok(proof);
 const physical=[...proof.childElementIds,2046780],metadata=[2046782,2046784];
 const elementHeaders=[header(2046769,-2000120),...physical.map(id=>header(id,-2000919)),header(2046782,null),header(2046784,-2000045)];
 const records=[{elementId:2046769,owningElementId:null,byteOffset:0},...physical.map((id,i)=>({elementId:id,owningElementId:id===2046770?null:2046769,byteOffset:i+1})),...metadata.map((id,i)=>({elementId:id,owningElementId:2046780,byteOffset:20+i}))];
 const ownership={format:'revit-2024-2027-elem-table',declaredRecordCount:records.length+1,decodedRecordCount:records.length,skippedLeadingRecordCount:1,rootRecordCount:2,selfOwnedRecordCount:0,danglingOwnerCount:0,records,relations:[]};
 const model={elementBounds:physical.map(elementId=>({elementId,categoryId:-2000919,boundsFeet:{min:{x:0,y:0,z:0},max:{x:1,y:1,z:1}}})),elementOwnership:ownership,nativeStairAssemblies:[{stairElementId:2046769,runAndLandingIds:[2046770,2046773],stringerIds:[2046772,2046777],railingIds:[2046780],supportIds:[],evidence:'runs-and-element-frame'}]}as unknown as ConvertResult;
 const refresh=()=>model.nativeMaterialSource=prepareNativeMaterialSource(sourceModelSha256,elementHeaders,[proof],model.elementOwnership);
 refresh();return{model,proof,elementHeaders,physical,metadata,refresh};
}
test('original complete stair wrapper replay contains only identity-placed child instances, never an invented body',()=>{
 for(const id of[1506328,2046769]){const{bytes,replay:original}=replay(id),before=JSON.stringify(original,(_,v)=>typeof v==='bigint'?v.toString():v);const proof=originalInstanceOnlyContainer(original,bytes)!;assert.ok(proof);assert.equal(proof.childElementIds.length,7);assert.equal(proof.sourceFrameSha256,fixture.frames.find((f)=>f.nativeElementId===id)!.sourceFrameSha256);assert.equal(JSON.stringify(original,(_,v)=>typeof v==='bigint'?v.toString():v),before);}
});
test('a scaled CAD import root is not given a physical-empty or container certificate',()=>{const{bytes,replay:original}=replay(2228308);assert.equal(originalInstanceOnlyContainer(original,bytes),undefined);});
test('local physical geometry, nonidentity placement and source selectors reject wrapper evidence',()=>{
 for(const change of['body','translation','selector','scale','embedded']as const){const{bytes,replay:original}=replay(2046769);if(change==='body')(original.spans as Revit2027GRepReplaySpan[]).push({...original.spans[0],readerId:'Revit2027Geometry'});else if(change==='translation')((original.spans.find(s=>s.readerId==='Revit2027InstanceInfo')!.value as Revit2027InstanceInfo).transform.matrix as unknown as number[])[12]=1;else if(change==='selector')(original.spans.find(s=>s.readerId==='Revit2027InstanceInfo')!.value as Revit2027InstanceInfo).gRepId=1;else if(change==='scale')(original.spans.find(s=>s.readerId==='Revit2027GInstance')!.value as Revit2027GInstance).hasScale=true;else(original.spans.find(s=>s.readerId==='Revit2027GInstance')!.value as Revit2027GInstance).resolveSymbolInView=true;assert.equal(originalInstanceOnlyContainer(original,bytes),undefined,change);}
});
test('metadata exclusion requires an explicit original header; custom positive and absent categories stay physical or unknown',()=>{
 const{model,elementHeaders,refresh}=modelFixture();elementHeaders.push(header(400,null),header(401,2228285),header(402,-2000126));refresh();const ids=nativeSourceNonPhysicalElementIds(model,sourceModelSha256);assert.equal(ids.has(400),true);assert.equal(ids.has(401),false);assert.equal(ids.has(402),false);assert.equal(ids.has(403),false);
 elementHeaders.push(header(400,-2000011));refresh();assert.equal(nativeSourceNonPhysicalElementIds(model,sourceModelSha256).has(400),false);
});
test('stair children include source GRep refs, assembly parts and all original ownership descendants',()=>{
 const{model,physical,metadata}=modelFixture(),before=JSON.stringify(model);assert.deepEqual(nativeStairMaterialContainerChildren(model,2046769,sourceModelSha256),[...physical,...metadata].sort((a,b)=>a-b));assert.equal(JSON.stringify(model),before);
});
test('missing child geometry, unknown metadata and incomplete or contradictory ownership keep the parent physical',()=>{
 for(const change of['missing-body','unknown-metadata','incomplete-ownership','duplicate-owner','stale-owner','stale-model','import-parent']as const){const{model,elementHeaders,refresh}=modelFixture();let expected=sourceModelSha256;if(change==='missing-body')model.elementBounds.pop();if(change==='unknown-metadata'){elementHeaders.splice(elementHeaders.findIndex(h=>h.elementId===2046782),1);refresh();}if(change==='incomplete-ownership'){model.elementOwnership!.declaredRecordCount++;refresh();}if(change==='duplicate-owner'){model.elementOwnership!.records.push({...model.elementOwnership!.records[1]!});model.elementOwnership!.decodedRecordCount++;model.elementOwnership!.declaredRecordCount++;refresh();}if(change==='stale-owner')model.elementOwnership!.records[1]!.owningElementId=999;if(change==='stale-model')expected='f'.repeat(64);if(change==='import-parent'){elementHeaders.find(h=>h.elementId===2046769)!.categoryId=2228285;refresh();}assert.equal(nativeStairMaterialContainerChildren(model,2046769,expected),undefined,change);}
});

test('an instantiated definition cannot disappear through its no-category or family-internal header',()=>{
 for(const variant of['no-category','family-internal']as const){const{model,elementHeaders,refresh}=modelFixture(),id=model.nativeMaterialSource!.instanceOnlyContainers[0]!.childElementIds[0]!;const h=elementHeaders.find(h=>h.elementId===id)!;if(variant==='no-category')h.categoryId=null;else h.familyId=999;refresh();assert.equal(nativeSourceNonPhysicalElementIds(model,sourceModelSha256).has(id),false,variant);model.elementBounds=model.elementBounds.filter(e=>e.elementId!==id);assert.equal(nativeStairMaterialContainerChildren(model,2046769,sourceModelSha256),undefined,variant);}
});
test('mutually instanced wrapper references cannot delegate both physical boxes away',()=>{
 const{model,proof,elementHeaders}=modelFixture(),child=proof.childElementIds[0]!;
 model.nativeMaterialSource=prepareNativeMaterialSource(sourceModelSha256,elementHeaders,[proof,{version:1,nativeElementId:child,sourceFrameSha256:'b'.repeat(64),childElementIds:[2046769]}],model.elementOwnership);
 assert.equal(nativeStairMaterialContainerChildren(model,2046769,sourceModelSha256),undefined);
});
