import test from 'node:test';
import assert from 'node:assert/strict';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
import {deriveNativeSelectionContactRepair,deriveNativeSelectionContactRepairs,deriveNativeSelectionContactRepairAttempts,nativeSelectionContactRepairMasks,validateNativeSelectionContactRepairs,type NativeSelectionContactRepair} from '../lib/reviter/native-selection-contact-repairs.ts';
import {nativeRationalOverlay} from '../lib/reviter/native-rational-overlay.ts';
import {nativeMaterialPlanExactWalls} from '../lib/reviter/native-material-plan.ts';
import {createNativeRoutingMaterialQuery} from '../lib/reviter/native-routing-material.ts';
import {nativeExactPartsForProposals,nativeRationalAreaCompare} from '../lib/reviter/native-exact-planar-topology.ts';
const hash='a'.repeat(64),materialHash='b'.repeat(64);
type P=[number,number];
// Descriptors bind the current original-material carrier, including its start
// vertex and winding; a fixture's pre-overlay loop is not that authority.
function bindCurrentCarriers(data:IndoorDataset,repair:NativeSelectionContactRepair){
 const current=nativeMaterialPlanExactWalls(data,repair.levelId,createNativeRoutingMaterialQuery(data));
 for(const body of [repair.source,repair.target])body.ringsFeet=structuredClone(current.find(w=>w.nativeElementId===body.nativeElementId)!.ringsFeet);
}
function fixture(gap=2**-45){
 const source:P[]=[[-10,0],[0,0],[0,1],[-10,1]],target:P[]=[[gap,-2],[3,-2],[3,3],[gap,3]];
 const data={source:{modelSha256:hash},nativeLevels:[{id:1,elevationFeet:0}],walls:[],nativeMaterialSections:{version:1,sourceModelSha256:hash,geometrySha256:materialHash,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:4,evidenceSha256:'c'.repeat(64),sourceElementIds:[10,20],sections:[{nativeElementId:10,categoryId:-2000011,kind:'wall',baseElevationFeet:0,topElevationFeet:10,partsFeet:[[source]]},{nativeElementId:20,categoryId:-2000011,kind:'wall',baseElevationFeet:0,topElevationFeet:10,partsFeet:[[target]]}]}]}} as unknown as IndoorDataset;
 const repair:NativeSelectionContactRepair={id:'contact:1:10-20',sourceModelSha256:hash,sourceMaterialGeometrySha256:materialHash,levelId:1,elevationFeet:0,status:'proposed',source:{nativeElementId:10,ringsFeet:[source],capFeet:[source[1],source[2]]},target:{nativeElementId:20,ringsFeet:[target],faceFeet:[target[3],target[0]]},evidenceSha256:'d'.repeat(64),notes:'Provisional extracted contact. Revisit original joint; selection only.',assumption:{kind:'provisional-extracted-native-contact',revisitRequired:true}};
 return {data,repair};
}
test('derives exact numerical gap without moving source vertices, adding overlap, or mutating input',()=>{
 const {data,repair}=fixture();const before=structuredClone({data,repair});const mask=deriveNativeSelectionContactRepair(data,repair);
 assert.equal(mask.length,1);assert.equal(nativeRationalAreaCompare(mask,[]),1);
 assert.equal(nativeRationalOverlay('intersection',mask,[repair.source.ringsFeet]).length,0);
 assert.equal(nativeRationalOverlay('intersection',mask,[repair.target.ringsFeet]).length,0);
 assert.deepEqual({data,repair},before);
 const projection=nativeExactPartsForProposals(mask)[0][0];assert(projection.some(p=>p[0]===repair.source.capFeet[0][0]&&p[1]===repair.source.capFeet[0][1]));
 const applied={...data,nativeSelectionContactRepairs:{version:1 as const,sourceModelSha256:hash,repairs:[{...repair,status:'applied' as const}]}};
 assert.equal(nativeSelectionContactRepairMasks(applied,1).length,1);assert.equal(nativeSelectionContactRepairMasks(applied,2).length,0);
 applied.nativeSelectionContactRepairs.repairs[0].status='restored' as any;assert.equal(nativeSelectionContactRepairMasks(applied,1).length,0);
});
test('rejects physical gaps, all-touch, overlap, partial-width and stale material/model/elevation/geometry',()=>{
 for(const g of [0,-(2**-45),.000001]){const{data,repair}=fixture(g);assert.throws(()=>deriveNativeSelectionContactRepair(data,repair));}
 for(const edit of [
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.sourceModelSha256='f'.repeat(64),
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.sourceMaterialGeometrySha256='f'.repeat(64),
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.elevationFeet=.01,
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.source.ringsFeet=structuredClone(r.source.ringsFeet).map(a=>a.map(([x,y])=>[x+.01,y] as P)),
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.source.capFeet=[[0,.2],[0,.8]],
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.target.faceFeet=[[2**-45,.1],[2**-45,.9]],
  (d:IndoorDataset,r:NativeSelectionContactRepair)=>r.source.capFeet=[[-10,0],[0,0]],
 ]){const{data,repair}=fixture();edit(data,repair);assert.throws(()=>deriveNativeSelectionContactRepair(data,repair));}
});
test('rejects unknown states, missing provisional evidence and duplicate descriptor IDs',()=>{
 const{repair}=fixture();const value={version:1 as const,sourceModelSha256:hash,repairs:[repair]};validateNativeSelectionContactRepairs(value,hash);
 assert.throws(()=>validateNativeSelectionContactRepairs({...value,repairs:[repair,repair]},hash));
 assert.throws(()=>validateNativeSelectionContactRepairs({...value,repairs:[{...repair,status:'nonsense'} as any]},hash));
 assert.throws(()=>validateNativeSelectionContactRepairs({...value,repairs:[{...repair,assumption:{kind:'provisional-extracted-native-contact',revisitRequired:false}} as any]},hash));
});
test('allows one touching cap endpoint when exact gap area stays positive',()=>{
 const{data,repair}=fixture();const x=2**-45;const target:P[]=[[0,0],[x,1],[3,1],[3,0]];
 data.nativeMaterialSections!.levels[0].sections[1].partsFeet=[[target]];repair.target.ringsFeet=[target];repair.target.faceFeet=[target[0],target[1]];
 bindCurrentCarriers(data,repair);
 const mask=deriveNativeSelectionContactRepair(data,repair);assert.equal(nativeRationalAreaCompare(mask,[]),1);assert.equal(mask[0][0].length,4);
});
test('supports an oblique original cap and keeps analytical target intersections rational',()=>{
 const{data,repair}=fixture();const transform=([x,y]:P):P=>[2*x-y,x+2*y];
 for(const body of [repair.source,repair.target])body.ringsFeet=body.ringsFeet.map(r=>r.map(transform));
 repair.source.capFeet=repair.source.capFeet.map(transform) as [P,P];repair.target.faceFeet=repair.target.faceFeet.map(transform) as [P,P];
 data.nativeMaterialSections!.levels[0].sections[0].partsFeet=[repair.source.ringsFeet];data.nativeMaterialSections!.levels[0].sections[1].partsFeet=[repair.target.ringsFeet];
 // Width of this source cap is sqrt5>2ft, so use a shorter rigid scale.
 const scale=([x,y]:P):P=>[x/2,y/2];
 for(const body of [repair.source,repair.target])body.ringsFeet=body.ringsFeet.map(r=>r.map(scale));
 repair.source.capFeet=repair.source.capFeet.map(scale) as [P,P];repair.target.faceFeet=repair.target.faceFeet.map(scale) as [P,P];
 data.nativeMaterialSections!.levels[0].sections[0].partsFeet=[repair.source.ringsFeet];data.nativeMaterialSections!.levels[0].sections[1].partsFeet=[repair.target.ringsFeet];
 bindCurrentCarriers(data,repair);
 assert.equal(nativeRationalAreaCompare(deriveNativeSelectionContactRepair(data,repair),[]),1);
});
test('batch uses fresh material and rejects an in-place source edit with an unchanged declared hash',()=>{
 const {data,repair}=fixture();assert.equal(deriveNativeSelectionContactRepairs(data,[repair]).length,1);
 repair.source.ringsFeet=structuredClone(repair.source.ringsFeet);
 data.nativeMaterialSections!.levels[0].sections[0].partsFeet[0][0][0][0]-=.001;
 assert.throws(()=>deriveNativeSelectionContactRepairs(data,[repair]));
});
test('rejects a nonconvex target rather than trusting only its two endpoint rays',()=>{
 const{data,repair}=fixture();const x=2**-45;const target:P[]=[[x,-2],[3,-2],[3,3],[x,3],[x,.7],[2,.5],[x,.3]];
 data.nativeMaterialSections!.levels[0].sections[1].partsFeet=[[target]];repair.target.ringsFeet=[target];repair.target.faceFeet=[target[3],target[4]];
 assert.throws(()=>deriveNativeSelectionContactRepair(data,repair));
});
test('rejects a trapezoid source rather than treating its sloped side as a member axis',()=>{
 const {data,repair}=fixture();const source:P[]=[[-10,-1],[0,0],[0,1],[-10,2]];
 data.nativeMaterialSections!.levels[0].sections[0].partsFeet=[[source]];bindCurrentCarriers(data,repair);
 assert.throws(()=>deriveNativeSelectionContactRepair(data,repair),/rectangular/);
});
test('accepts a short 1.32:1 native rectangular return but rejects square and long-side caps',()=>{
 for(const length of [1.32,1,.8]){
  const {data,repair}=fixture();const source:P[]=[[-length,0],[0,0],[0,1],[-length,1]];
  data.nativeMaterialSections!.levels[0].sections[0].partsFeet=[[source]];bindCurrentCarriers(data,repair);
  if(length>1)assert.equal(nativeRationalAreaCompare(deriveNativeSelectionContactRepair(data,repair),[]),1);
  else assert.throws(()=>deriveNativeSelectionContactRepair(data,repair),/short original member cap/);
 }
});
test('independent attempts retain strict failure and freshly bind actual material on every invocation',()=>{
 const {data,repair}=fixture();const bad={...repair,id:'bad',source:{...repair.source,capFeet:[[0,.2],[0,.8]] as [P,P]}};
 const rows=deriveNativeSelectionContactRepairAttempts(data,[repair,bad]);assert.equal(rows.length,2);assert(rows[0].mask);assert.match(rows[1].error!,/full actual original edge/);
 assert.throws(()=>deriveNativeSelectionContactRepairs(data,[repair,bad]),/full actual original edge/);
 repair.source.ringsFeet=structuredClone(repair.source.ringsFeet);data.nativeMaterialSections!.levels[0].sections[0].partsFeet[0][0][0][0]-=.001;
 const edited=deriveNativeSelectionContactRepairAttempts(data,[repair]);assert.match(edited[0].error!,/changed, missing or non-original/);assert.equal(edited[0].mask,undefined);
});
