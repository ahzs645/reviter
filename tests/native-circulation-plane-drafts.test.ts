import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeCirculationElevations,prepareNativeCirculationGeometry,prepareNativeCirculationPlaneDraft,mergeNativeCirculationPlaneDrafts} from '../lib/reviter/native-circulation-geometry.ts';
import {nativeIndoorEnvelopeHash} from '../lib/reviter/native-indoor-envelopes.ts';
import {createNativeExactTopologyIndex,nativeRationalPointInParts as pointIn,nativeRationalArea} from '../lib/reviter/native-exact-planar-topology.ts';
import{NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION}from'../lib/reviter/native-rational-overlay.ts';
import{nativeCirculationBinding}from'../lib/reviter/native-circulation-binding.ts';
import type{IndoorDataset,IndoorRecord}from'../lib/reviter/indoor-contract.ts';
import type{ConvertResult}from'../lib/reviter/types.ts';
type P2=[number,number];const rect=(x:number,y:number,X:number,Y:number):P2[]=>[[x,y],[X,y],[X,Y],[x,Y]];
async function fixture(){
 const sourceModelSha256='a'.repeat(64),zs=[0,10,20];
 const records=zs.map((z,i)=>({key:'hall-'+i,number:'Hall '+i,name:'Corridor',building:'test',levelId:i+1,elevationFeet:z,elevationEvidence:'native',surfaceId:'test:'+i,circulation:true,stair:false,walkable:true,access:'unknown',confidence:1,ringsFeet:[rect(.5,.5,19.5,9.5)],properties:{}} as IndoorRecord));
 const elementBounds=zs.flatMap((z,i)=>[{elementId:100+i,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:z-1},max:{x:20,y:10,z}},loops:[rect(0,0,20,10),rect(14,7,16,8)].map(r=>r.map(p=>[...p,z]))}, {elementId:200+i,categoryId:-2000011,solid:{start:{x:0,y:0},end:{x:20,y:6},thickness:.5,baseElevation:z,topElevation:z+5,startCorners:[{x:0,y:-.25},{x:0,y:.25}],endCorners:[{x:20,y:5.75},{x:20,y:6.25}]}}]);
 elementBounds.push({elementId:300,categoryId:-2000032,boundsFeet:{min:{x:2,y:7,z:2.5},max:{x:4,y:9,z:3}},loops:[rect(2,7,4,9).map(p=>[...p,3])]} as typeof elementBounds[number]);
 const model={elementBounds,levels:zs.map((z,i)=>({levelId:i+1,elevation:z})),nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
 const data={source:{modelSha256:sourceModelSha256},records,nativeLevels:zs.map((z,i)=>({id:i+1,name:'Floor '+(i+1),elevationFeet:z})),walls:[],doors:[],nodes:[],edges:[],alignment:{horizontalMetresPerFoot:.3048},report:{components:0,largestComponentArrivals:0},walkingSupport:{version:1,sourceModelSha256,floors:zs.map((z,i)=>({nativeElementId:100+i,elevationFeet:z,ringsFeet:[rect(0,0,20,10),rect(14,7,16,8)]}))}} as unknown as IndoorDataset;
 const source={version:1 as const,sourceModelSha256,levels:zs.map((z,i)=>({levelId:i+1,elevationFeet:z,partsFeet:[[rect(1,1,19,9)]],sourceElementIds:[100+i],cutElevationsFeet:[z+4,z+8],evidenceSha256:'b'.repeat(64)}))};
 data.nativeIndoorEnvelopes={...source,geometrySha256:await nativeIndoorEnvelopeHash(source)};
 return{model,data};
}
test('reversed complete native plane drafts produce byte-identical whole-campus geometry',async()=>{
 const {model,data}=await fixture(),before=JSON.stringify([model,data]);
 assert.deepEqual(nativeCirculationElevations(data),[0,10,20]);
 const sequential=prepareNativeCirculationGeometry(model,data),drafts=[20,10,0].map(z=>prepareNativeCirculationPlaneDraft(model,data,z)),draftBefore=JSON.stringify(drafts);
 const merged=mergeNativeCirculationPlaneDrafts(data,drafts);
 assert.equal(JSON.stringify(merged),JSON.stringify(sequential));
 assert.equal(JSON.stringify([model,data]),before);assert.equal(JSON.stringify(drafts),draftBefore);
 assert.ok(merged.geometry.cells.length>=3);assert.ok(merged.geometry.fixtures?.some(f=>f.nativeElementId===300&&f.elevationFeet===0));
});
test('plane merge preserves exact holes, non-IEEE vertices and all globally remapped carriers',async()=>{
 const {model,data}=await fixture(),sequential=prepareNativeCirculationGeometry(model,data),drafts=[20,0,10].map(z=>prepareNativeCirculationPlaneDraft(model,data,z)),merged=mergeNativeCirculationPlaneDrafts(data,drafts),g=merged.geometry;
 assert.ok(g.exactTopology);assert.ok(g.displayResidualTopology,'diagonal intersections must retain their positive rendering residuals');
 const binding={sourceModelSha256:data.source.modelSha256,sourceGeometryKey:g.sourceGeometryKey,kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION};
 const exact=createNativeExactTopologyIndex(g.exactTopology,binding),residual=createNativeExactTopologyIndex(g.displayResidualTopology,binding);
 assert.ok(g.exactTopology.coordinates.some(p=>{let d=BigInt(p.x[1]);while(d%2n===0n)d/=2n;return d>1n;}),"original overlay produces rational vertices beyond exact IEEE coordinates");
 assert.ok(residual.ids().every(id=>nativeRationalArea(residual.parts(id)!).n>0n),"every positive residual is retained");
 assert.equal(new Set(exact.ids()).size,exact.ids().length);
 assert.ok(exact.ids().every((id,i)=>id.endsWith(':'+i)),"face IDs are remapped to global source order");
 assert.ok(residual.ids().some(id=>residual.parts(id)!.some(part=>part.some(ring=>ring.some((p,i)=>{
  const q=ring[(i+1)%ring.length]!,distinct=p[0].n*q[0].d!==q[0].n*p[0].d||p[1].n*q[1].d!==q[1].n*p[1].d;
  return distinct&&Number(p[0].n)/Number(p[0].d)===Number(q[0].n)/Number(q[0].d)&&Number(p[1].n)/Number(p[1].d)===Number(q[1].n)/Number(q[1].d);
 })))),"a positive sub-IEEE residual edge survives even when its endpoints collapse numerically");assert.equal(new Set(residual.ids()).size,residual.ids().length);
 assert.deepEqual(exact.ids(),sequential.geometry.exactTopology!.faces.map(f=>f.id));
 assert.deepEqual(residual.ids(),sequential.geometry.displayResidualTopology!.faces.map(f=>f.id));
 for(const [i,c]of g.cells.entries()){
  assert.equal(c.id,`native-cell:${c.elevationFeet.toFixed(6)}:${i}`);assert.ok(c.exactFaceId&&exact.parts(c.exactFaceId));
  const old=drafts.find(d=>d.elevationFeet===c.elevationFeet)!.result.geometry.cells.find(a=>JSON.stringify(a.roomKeys)===JSON.stringify(c.roomKeys)&&JSON.stringify(a.ringsFeet)===JSON.stringify(c.ringsFeet));assert.ok(old);
  const oldResidual=old.containedDisplay?.exactResidualFaceId,newResidual=c.containedDisplay?.exactResidualFaceId;
  if(oldResidual){assert.equal(newResidual,`${c.id}:render-residual`);assert.ok(residual.parts(newResidual!));}
 }
 // Exact point containment is checked against the actual native hole on each plane.
 for(const z of[0,10,20])assert.ok(!g.cells.filter(c=>c.elevationFeet===z).some(c=>{const p=exact.parts(c.exactFaceId!)!;return pointIn([15,7.5],p);}));
 assert.equal(JSON.stringify(merged),JSON.stringify(sequential));
});
test('plane merge rejects incomplete, duplicate, stale and altered draft inventories',async()=>{
 const {model,data}=await fixture(),drafts=[0,10,20].map(z=>prepareNativeCirculationPlaneDraft(model,data,z));
 assert.throws(()=>mergeNativeCirculationPlaneDrafts(data,drafts.slice(1)),/missing|duplicated/);
 assert.throws(()=>mergeNativeCirculationPlaneDrafts(data,[drafts[0]!,drafts[0]!,drafts[2]!]),/missing|duplicated/);
 for(const [mutationIndex,mutate] of[(d:typeof drafts)=>{d[0]!.elevationFeet=99;},(d:typeof drafts)=>{d[0]!.result.geometry.sourceModelSha256='c'.repeat(64);},(d:typeof drafts)=>{d[0]!.result.geometry.sourceGeometryKey='obsolete';},(d:typeof drafts)=>{d[0]!.result.geometry.preparedRoomKeys.pop();},(d:typeof drafts)=>{d[0]!.result.geometry.exactTopology!.coordinates[0]!.x[0]='900';},(d:typeof drafts)=>{d[0]!.result.geometry.cells[0]!.id='rewritten';},(d:typeof drafts)=>{d[0]!.result.geometry.cells[0]!.containedDisplay!.partsFeet[0]![0]![0]![0]+=1;},(d:typeof drafts)=>{d[0]!.result.geometry.cells[0]!.roomKeys=['mutated-source-owner'];},(d:typeof drafts)=>{d[0]!.result.report.diagnostics.push('mutated worker diagnostic');}].entries()){
  const changed=structuredClone(drafts);mutate(changed);assert.throws(()=>mergeNativeCirculationPlaneDrafts(data,changed),`mutated plane draft ${mutationIndex}`);
 }
 const stale=structuredClone(data);stale.records[0]!.access='staff';assert.throws(()=>mergeNativeCirculationPlaneDrafts(stale,drafts));
 assert.throws(()=>prepareNativeCirculationPlaneDraft(model,data,9));assert.throws(()=>prepareNativeCirculationPlaneDraft(model,data,NaN));
});
test('rehashed drafts cannot introduce unknown, restricted or wrong-plane owners',async()=>{
 const {model,data}=await fixture();data.records.push({...data.records[0]!,key:'staff-outside-source-cell',access:'staff',ringsFeet:[rect(90,90,100,100)]});
 const drafts=[0,10,20].map(z=>prepareNativeCirculationPlaneDraft(model,data,z));assert.ok(drafts[0]!.result.geometry.cells.length);
 for(const roomKey of['unknown-owner','staff-outside-source-cell','hall-1']){
  const changed=structuredClone(drafts);changed[0]!.result.geometry.cells[0]!.roomKeys=[roomKey];changed[0]!.resultBinding=nativeCirculationBinding([changed[0]!.elevationFeet,changed[0]!.result],true);
  assert.throws(()=>mergeNativeCirculationPlaneDrafts(data,changed),/unknown|restricted/);
 }
 assert.equal(JSON.stringify(mergeNativeCirculationPlaneDrafts(data,JSON.parse(JSON.stringify(drafts)).reverse())),JSON.stringify(prepareNativeCirculationGeometry(model,data)),'plain worker JSON roundtrip keeps complete source output identical');
});
