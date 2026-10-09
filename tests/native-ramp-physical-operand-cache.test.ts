import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeRampPhysicalOperandMemo,createNativeRampWalkingRegionQuery as candidate} from '../lib/reviter/native-circulation-links.ts';
import {nativeIndoorEnvelopeHash} from '../lib/reviter/native-indoor-envelopes';
import {nativeMaterialSectionsHash} from '../lib/reviter/native-material-sections';
import {nativeRationalOverlay} from '../lib/reviter/native-rational-overlay';
import {nativeRationalPointInParts} from '../lib/reviter/native-exact-planar-topology';
import type {IndoorDataset} from '../lib/reviter/indoor-contract';
import type {ConvertResult} from '../lib/reviter/types';
const rect=(a:number,b:number,c:number,d:number):[number,number][]=>[[a,b],[c,b],[c,d],[a,d]];
async function fixture(){
 const sha='a'.repeat(64),outer=rect(0,0,20,10),hole=rect(9,4,9+1e-9,6),wall=rect(14,0,14.2,10);
 const env={version:1 as const,sourceModelSha256:sha,levels:[{levelId:1,elevationFeet:0,partsFeet:[[outer]],sourceElementIds:[10,20],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const mat={version:1 as const,sourceModelSha256:sha,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:.1,evidenceSha256:'c'.repeat(64),sourceElementIds:[20],sections:[{nativeElementId:20,categoryId:-2000011,kind:'wall' as const,baseElevationFeet:0,topElevationFeet:8,partsFeet:[[wall]]}]}]};
 const staff={key:'tiny-staff',number:'S',name:'Staff',building:'',levelId:1,elevationFeet:0,elevationEvidence:'source',surfaceId:'s',circulation:false,stair:false,walkable:true,access:'staff' as const,confidence:1,ringsFeet:[rect(2,2,2.01,2.01)],properties:{}};
 const data={source:{modelSha256:sha},records:[staff],nodes:[],edges:[],walls:[],doors:[],nativeLevels:[{id:1,name:'L',elevationFeet:0}],nativeIndoorEnvelopes:{...env,geometrySha256:await nativeIndoorEnvelopeHash(env)},nativeMaterialSections:{...mat,geometrySha256:await nativeMaterialSectionsHash(mat)}} as unknown as IndoorDataset;
 const floor={elementId:10,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:20,y:10,z:0}},loops:[outer,hole].map(r=>r.map(p=>[...p,0]))};
 const physicalWall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:14,y:0,z:0},max:{x:14.2,y:10,z:8}},solid:{start:{x:14.1,y:0},end:{x:14.1,y:10},thickness:.2,baseElevation:0,topElevation:8}};
 const model={elementBounds:[floor,physicalWall],levels:[],meshes:[],origin:{x:0,y:0,z:0}} as unknown as ConvertResult;
 return {model,data};
}
test('identical complete ramp operands at distinct exact heights reuse free overlay while tiny staff/real hole stay blocked',async()=>{
 const {model,data}=await fixture(),b=candidate(model,data);
 for(const z of[0,.001,.002,0]){
  const y=b(z,true);
  assert.equal(y.exact!.floors[0].length,2,'the original positive floor hole remains');
  assert.equal(y.elevationFeet,z);
  assert.equal(nativeRationalPointInParts([2.005,2.005],y.exact!.walkable),false);
  assert.equal(nativeRationalPointInParts([9+5e-10,5],y.exact!.floors),false);
 }
 assert.ok(b.privatePhysicalMemoStatistics()!.hits>=1);
 assert.ok(b.privatePhysicalMemoStatistics()!.misses>=1);
});
test('protected identity mutation and new operation scope never reuse stale veto operands',async()=>{
 const {model,data}=await fixture(),q=candidate(model,data);
 q(0,true);data.records[0]!.ringsFeet=[rect(16,2,16.01,2.01)];
 // The existing compiler ownership index is phase-scoped: start a new query
 // after metadata authoring rather than reuse an unrelated stale index.
 const next=candidate(model,data);
 const current=next(.001,true);

 assert.equal(next.privatePhysicalMemoStatistics()!.misses,1);
 assert.equal(next.privatePhysicalMemoStatistics()!.hits,0);
 assert.equal(nativeRationalPointInParts([2,5],current.exact!.walkable),true);
 const scope=candidate(model,data);scope(.001,true);assert.equal(scope.privatePhysicalMemoStatistics()!.hits,0);
});
test('complete key protects original positive holes/material and kernel/policy changes; bounded eviction is count and byte based',()=>{
 const query=createNativeRampPhysicalOperandMemo();let calls=0;
 const compute=()=>{calls++;return nativeRationalOverlay('union',[[rect(0,0,10,10),rect(2,2,2+1e-9,3)]]);};
 const a={floor:[[rect(0,0,10,10)]],policy:'staff',material:[[rect(4,0,4.1,10)]],version:'v'};
 const r=query(a,compute);assert.strictEqual(query(a,compute),r);assert.equal(calls,1);
 a.policy='off-limits';query(a,compute);a.material[0]![0]![0]![0]=4.0000000001;query(a,compute);
 for(let i=0;i<12;i++)query({...a,id:i},compute);
 assert.ok(query.statistics().entries<=8);assert.ok(query.statistics().retainedBytes<=query.statistics().maximumBytes);
 const oversized={...a,large:'x'.repeat(34*1024*1024)};query(oversized,compute);query(oversized,compute);
 assert.equal(query.statistics().hits,1);
 assert.equal(nativeRationalPointInParts([2+5e-10,2.5],r),false);
});
