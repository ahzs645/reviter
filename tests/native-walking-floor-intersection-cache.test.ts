import test from 'node:test';import assert from 'node:assert/strict';
import {nativeRationalOverlay,type NativeRationalParts} from '../lib/reviter/native-rational-overlay.ts';
import {nativeRationalPointInParts} from '../lib/reviter/native-exact-planar-topology.ts';
import {nativeWalkingRegion as original,supportedWalkingPath} from '../lib/reviter/native-circulation-links.ts';
import {createNativeWalkingFloorIntersectionQuery,createNativeWalkingRegionQuery} from '../lib/reviter/native-circulation-links.ts';
import {nativeIndoorEnvelopeHash} from '../lib/reviter/native-indoor-envelopes.ts';
import type{IndoorDataset}from'../lib/reviter/indoor-contract.ts';import type{ConvertResult}from'../lib/reviter/types.ts';
const rect=(x0:number,y0:number,x1:number,y1:number):[number,number][]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const wire=(parts:NativeRationalParts)=>parts.map(p=>p.map(r=>r.map(q=>q.map(v=>`${v.n}/${v.d}`))));
test('same-height complete original slab/enclosure intersection is immutable/reused and keeps true narrow holes and multipart floors',()=>{
 const floors=[[rect(0,0,10,10),rect(4,4,4.000000001,6)],[rect(12,0,14,2)]],envelopes=[[rect(0,0,20,20)]],q=createNativeWalkingFloorIntersectionQuery('a'.repeat(64));
 const expected=nativeRationalOverlay('intersection',floors,envelopes),a=q(0,floors,envelopes),b=q(0,floors,envelopes);
 assert.deepEqual(wire(a),wire(expected));assert.equal(a,b);assert.ok(Object.isFrozen(a)&&Object.isFrozen(a[0]![0]![0]![0]));
 assert.equal(nativeRationalPointInParts([4.0000000005,5],b),false);assert.equal(nativeRationalPointInParts([13,1],b),true);assert.equal(q.statistics().hits,1);
});
test('complete current operand keys reject stale in-place floor/enclosure edits and independent query snapshots cannot borrow entries',()=>{
 const floors=[[rect(0,0,10,10)]],envelopes=[[rect(0,0,20,20)]],q=createNativeWalkingFloorIntersectionQuery('a'.repeat(64));assert.equal(nativeRationalPointInParts([5,5],q(0,floors,envelopes)),true);
 floors[0]!.push(rect(4,4,6,6));assert.equal(nativeRationalPointInParts([5,5],q(0,floors,envelopes)),false);
 envelopes[0]![0]![1]![0]=3;envelopes[0]![0]![2]![0]=3;assert.equal(nativeRationalPointInParts([8,2],q(0,floors,envelopes)),false);assert.equal(q.statistics().hits,0);
 assert.equal(createNativeWalkingFloorIntersectionQuery('a'.repeat(64)).statistics().entries,0);assert.equal(createNativeWalkingFloorIntersectionQuery('b'.repeat(64)).statistics().entries,0);
});
test('floor-cache count/bytes are bounded and empty support remains empty without deleting any positive piece',()=>{
 const q=createNativeWalkingFloorIntersectionQuery('a'.repeat(64)),floors=[[rect(0,0,1,1)]],envelopes=[[rect(0,0,1,1)]];
 for(let i=0;i<40;i++)assert.deepEqual(wire(q(i,floors,envelopes)),wire(nativeRationalOverlay('intersection',floors,envelopes)));
 assert.equal(q.statistics().entries,12);assert.ok(q.statistics().retainedBytes<=q.statistics().maximumBytes);assert.deepEqual(q(0,[],envelopes),[]);
 const thin=[[rect(0,0,1e-12,1e-12)]];assert.equal(q(0,thin,thin).length,1);
});
test('two physical portal variants share only complete floor authority and retain individual own-side/foreign-wall vetoes and majority policy',async()=>{
 const sha='a'.repeat(64),envelope={version:1 as const,sourceModelSha256:sha,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10,20],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const record=(key:string,x0:number,x1:number)=>({key,number:key,name:'Corridor',building:'test',levelId:1,elevationFeet:0,elevationEvidence:'native',surfaceId:key,circulation:true,stair:true,walkable:true,access:'unknown' as const,confidence:1,ringsFeet:[rect(x0,0,x1,10)],properties:{}});
 const a=record('left',0,9.6),b=record('right',10.4,20),door={id:'door:1:30',levelId:1,nativeElementId:30,pointFeet:[10,5] as[number,number],footprintFeet:rect(9.8,3,10.2,7),normalFeet:[1,0] as[number,number],roomKeys:[a.key,b.key],state:'connected' as const};
 const nodes=[{id:door.id+':0',roomKey:a.key,pointFeet:[9.4,5,0] as[number,number,number],levelId:1,building:'test',surfaceId:a.key,kind:'portal' as const,geographic:[0,0] as[number,number]},{id:door.id+':1',roomKey:b.key,pointFeet:[10.6,5,0] as[number,number,number],levelId:1,building:'test',surfaceId:b.key,kind:'portal' as const,geographic:[0,0] as[number,number]}];
 const d={source:{modelSha256:sha},nativeLevels:[{id:1,name:'Native',elevationFeet:0}],records:[a,b],nodes,edges:[{id:door.id,from:nodes[0]!.id,to:nodes[1]!.id,kind:'door',enabled:true}],doors:[door],walls:[],alignment:{horizontalMetresPerFoot:.3048},nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)}} as unknown as IndoorDataset;
 const floor={elementId:10,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:20,y:10,z:0}},loops:[rect(0,0,20,10).map(p=>[...p,0])]},wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:0,topElevation:8}};
 const m={elementBounds:[floor,wall],levels:[{levelId:1,elevation:0}],nativeAssociatedLevelRelations:[],nativeHostRelations:[{elementId:30,hostId:20}]} as unknown as ConvertResult,q=createNativeWalkingRegionQuery(m,d);
 for(const n of nodes){const cached=q(0,true,n),fresh=original(m,d,0,true,n);for(const key of['floors','free','walkable','barriers'] as const)assert.deepEqual(wire(cached.exact![key]),wire(fresh.exact![key]));assert.deepEqual(cached.identityFaces,fresh.identityFaces);assert.equal(supportedWalkingPath(cached,[n.pointFeet,[n.id.endsWith(':0')?4:16,5,0]]),supportedWalkingPath(fresh,[n.pointFeet,[n.id.endsWith(':0')?4:16,5,0]]));}
 assert.equal(q.floorCacheStatistics().hits,1);assert.equal(q.floorCacheStatistics().misses,1);
 const foreign={...m,elementBounds:[...m.elementBounds,{...wall,elementId:22}]} as unknown as ConvertResult,foreignQ=createNativeWalkingRegionQuery(foreign,d);
 assert.equal(supportedWalkingPath(foreignQ(0,true,nodes[1]),[[10.1,5,0],[16,5,0]]),false,'sharing floors cannot erase a foreign wall');
 const restricted={...d,records:[...d.records,{...record('tiny-staff',12,12.1),access:'staff' as const,ringsFeet:[rect(12,2,12.1,2.1)]}]},privateQ=createNativeWalkingRegionQuery(m,restricted);
 assert.equal(privateQ(0,true,nodes[1]).exact!.walkable.length,1,'left physical face remains independently available');assert.equal(nativeRationalPointInParts([16,5],privateQ(0,true,nodes[1]).exact!.walkable),false,'tiny protected metadata still vetoes complete right face');
});
