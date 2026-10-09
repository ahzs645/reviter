import test from 'node:test';
import assert from 'node:assert/strict';
import {attachNativeCirculation,findNativeWalkingPath,nativeWalkingRegion,supportedWalkingPath,type NativeWalkingRegion} from '../lib/reviter/native-circulation-links.ts';
import type {IndoorDataset,IndoorRecord,IndoorNode} from '../lib/reviter/indoor-contract.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
import {readFileSync} from 'node:fs';
const rect=(x0:number,y0:number,x1:number,y1:number):[number,number][]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const region:NativeWalkingRegion={elevationFeet:0,floors:[[rect(0,0,20,10)]],barriers:[],masks:[],nativeFloorIds:[10]};
test('continuous full-width floor proof rejects holes, unsupported heights, wall slivers and private areas',()=>{
 const path:[number,number,number][]=[[2,5,0],[18,5,0]];
 assert.equal(supportedWalkingPath(region,path),true);
 assert.equal(supportedWalkingPath({...region,floors:[[rect(0,0,20,10),rect(9,4.7,9.01,5.3)]]},path),false);
 assert.equal(supportedWalkingPath(region,[[2,5,0],[18,5,3.28]]),false);
 assert.equal(supportedWalkingPath({...region,barriers:[[rect(9,4.7,9.01,5.3)]]},path),false);
 assert.equal(supportedWalkingPath({...region,masks:[[rect(9,4.7,10,6)]]},path),false);
 assert.equal(supportedWalkingPath({...region,circulation:[[rect(0,0,5,10)],[rect(15,0,20,10)]]},path),false);
});
test('native landing search goes around barriers with continuous proof and cannot cross a sealed floor',()=>{
 const blocked={...region,barriers:[[rect(9,0,11,7)]]};
 const path=findNativeWalkingPath(blocked,[2,5,0],[18,5,0]);assert.ok(path);assert.ok(path.length>2);assert.equal(supportedWalkingPath(blocked,path),true);
 assert.equal(findNativeWalkingPath({...blocked,barriers:[[rect(9,0,11,10)]]},[2,5,0],[18,5,0]),undefined);
});
const record=(key:string,x0:number,x1:number,levelId:number,z=0):IndoorRecord=>({key,number:key,name:'Corridor',building:key,levelId,elevationFeet:z,elevationEvidence:'native floor',surfaceId:`${key}:${levelId}`,circulation:true,stair:false,walkable:true,access:'unknown',confidence:1,ringsFeet:[rect(x0,0,x1,10)],properties:{}});
const node=(r:IndoorRecord,x:number):IndoorNode=>({id:`arrival:${r.key}`,roomKey:r.key,levelId:r.levelId,building:r.building,surfaceId:r.surfaceId,kind:'arrival',pointFeet:[x,5,r.elevationFeet],geographic:[0,0]});
const a=record('a',0,10,1),b=record('b',10,20,1),nodes=[node(a,8),node(b,12)];
const data={source:{modelSha256:'a'.repeat(64)},nativeLevels:[{id:1,name:'A',elevationFeet:0},{id:2,name:'B',elevationFeet:0}],records:[a,b],nodes,edges:[],alignment:{horizontalMetresPerFoot:.3048}} as unknown as IndoorDataset;
const floor={elementId:10,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:20,y:10,z:0}},loops:[rect(0,0,20,10).map(p=>[...p,0])]};
const model={elementBounds:[floor],levels:data.nativeLevels.map(l=>({levelId:l.id,elevation:l.elevationFeet})),nativeAssociatedLevelRelations:[],nativeHostRelations:[{elementId:30,hostId:20}]} as unknown as ConvertResult;
test('continuous floor supports explicit doorless seams across surfaces of one native level',()=>{
 const attached=attachNativeCirculation(model,data);assert.equal(attached.edges.length,1);assert.equal(attached.edges[0]!.kind,'opening');assert.deepEqual(attached.edges[0]!.roomKeys,['a','b']);assert.match(attached.edges[0]!.evidence,/full 2 ft/);
 assert.equal(attachNativeCirculation(model,{...data,records:[a,{...b,elevationFeet:3.28}],nodes:[nodes[0]!,{...nodes[1]!,pointFeet:[12,5,3.28]}]}).edges.length,0);
 assert.equal(attachNativeCirculation(model,{...data,records:[a,{...b,access:'staff'}]}).edges.length,0);
 assert.equal(attachNativeCirculation(model,{...data,nodes:[nodes[0]!,{...nodes[1]!,levelId:2}]}).edges.length,0);
 assert.equal(attachNativeCirculation({...model,elementBounds:[]},data).edges.length,0);
});
test('attachment progress counts preserve the geometry result and report empty scopes',()=>{
 const updates:number[][]=[];
 const withProgress=attachNativeCirculation(model,data,(checked,total,edges)=>updates.push([checked,total,edges]));
 assert.deepEqual(withProgress,attachNativeCirculation(model,data));
 assert.deepEqual(updates,[[0,1,0],[1,1,1]]);
 const empty:number[][]=[];
 assert.deepEqual(attachNativeCirculation(model,{...data,nodes:[]},(checked,total,edges)=>empty.push([checked,total,edges])),{edges:[],diagnostics:[]});
 assert.deepEqual(empty,[[0,0,0],[0,0,0]]);
});
test('floor profile holes are retained when constructing physical walking regions',()=>{
 const holed={...model,elementBounds:[{...floor,loops:[...floor.loops,rect(9,4,11,6).map(p=>[...p,0])]}]} as unknown as ConvertResult;
 assert.equal(nativeWalkingRegion(holed,data,0).floors[0]!.length,2);
 assert.equal(attachNativeCirculation(holed,data).edges.length,0);
});

test('empty exact flat support skips free-face overlays while retaining ramp-height material and real floor holes',async()=>{
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const {nativeMaterialSectionsHash}=await import('../lib/reviter/native-material-sections.ts');
 const {nativeRationalPointInParts}=await import('../lib/reviter/native-exact-planar-topology.ts');
 const {nativeRationalOverlay}=await import('../lib/reviter/native-rational-overlay.ts');
 const {createNativeExactRoutingAuthority}=await import('../lib/reviter/native-exact-routing-authority.ts');
 const {createNativeExactRoutingAuthority:runtimeAuthority}=await import('../../openindoormaps/app/indoor-project/native-exact-routing-authority.ts');
 const envelope={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10,20],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const material={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:.1,evidenceSha256:'c'.repeat(64),sourceElementIds:[20],sections:[{nativeElementId:20,categoryId:-2000011,kind:'wall' as const,baseElevationFeet:0,topElevationFeet:8,partsFeet:[[rect(14,0,14.2,10)]]}]}]};
 const d={...data,walls:[],doors:[],nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)},nativeMaterialSections:{...material,geometrySha256:await nativeMaterialSectionsHash(material)},walkingSupport:{version:1 as const,sourceModelSha256:data.source.modelSha256,floors:[]}};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:14,y:0,z:0},max:{x:14.2,y:10,z:8}},solid:{start:{x:14.1,y:0},end:{x:14.1,y:10},thickness:.2,baseElevation:0,topElevation:8}};
 const empty=nativeWalkingRegion({...model,elementBounds:[wall]} as ConvertResult,d,0,true);
 assert.deepEqual(empty.exact!.free,[]);assert.deepEqual(empty.exact!.walkable,[]);
 assert.ok(empty.barriers.some(p=>nativeRationalPointInParts([14.1,5],nativeRationalOverlay('union',[p]))), 'physical ramp-height wall barrier remains independently available');
 assert.ok(nativeRationalPointInParts([14.1,5],empty.exact!.barriers),'lazy exact barrier inventory is complete');
 assert.deepEqual(createNativeExactRoutingAuthority(d)(0),[]);
 assert.deepEqual(runtimeAuthority(d)(0),[]);
 const hole=rect(9,4,9.000000001,6),holedFloor={...floor,loops:[...floor.loops,hole.map(p=>[...p,0])]};
 const supported={...d,walkingSupport:{...d.walkingSupport,floors:[{nativeElementId:10,elevationFeet:0,ringsFeet:[rect(0,0,20,10),hole]}]}};
 const nonempty=nativeWalkingRegion({...model,elementBounds:[holedFloor,wall]} as ConvertResult,supported,0,true);
 assert.ok(nativeRationalPointInParts([2,5],nonempty.exact!.walkable));
 assert.ok(!nativeRationalPointInParts([9.0000000005,5],nonempty.exact!.walkable),'positive original floor hole remains excluded');
 assert.ok(!nativeRationalPointInParts([14.1,5],nonempty.exact!.walkable),'nonempty flat support still subtracts physical material');
 const runtime=createNativeExactRoutingAuthority(supported)(0);
 assert.equal(nativeRationalPointInParts([2,5],runtime),true);
 assert.equal(nativeRationalPointInParts([9.0000000005,5],runtime),false);
 assert.equal(nativeRationalPointInParts([14.1,5],runtime),false);
 const wire=(parts:typeof runtime)=>parts.map(p=>p.map(r=>r.map(q=>q.map(v=>`${v.n}/${v.d}`))));
 assert.deepEqual(wire(runtimeAuthority(supported)(0)),wire(runtime),'source/runtime exact flat-support authority stays identical');
});

test('immutable ownership memo reuses complete exact faces and preserves tiny restricted identities, holes and new snapshots',async()=>{
 const {createNativeWalkingRegionQuery}=await import('../lib/reviter/native-circulation-links.ts');
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const {nativeRationalPointInParts}=await import('../lib/reviter/native-exact-planar-topology.ts');
 const e={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const d={...data,nativeIndoorEnvelopes:{...e,geometrySha256:await nativeIndoorEnvelopeHash(e)},walls:[],doors:[]};
 const hole=rect(9,4,9.000000001,6),m={...model,elementBounds:[{...floor,loops:[...floor.loops,hole.map(p=>[...p,0])]}]} as ConvertResult;
 const query=createNativeWalkingRegionQuery(m,d),wire=(g:NativeWalkingRegion)=>g.exact!.walkable.map(p=>p.map(r=>r.map(q=>q.map(v=>`${v.n}/${v.d}`))));
 for(const z of[0,.001,.002]){
  const cached=query(z,true),direct=nativeWalkingRegion(m,d,z,true);
  assert.deepEqual(wire(cached),wire(direct));assert.deepEqual(cached.identityFaces,direct.identityFaces);
  assert.ok(!nativeRationalPointInParts([9.0000000005,5],cached.exact!.walkable));
 }
 assert.ok(query.ownershipCacheStatistics().hits>=2,'different physical-height queries reuse only exactly identical complete free faces');
 assert.equal(query.ownershipCacheStatistics().misses,1);
 assert.ok(query.ownershipCacheStatistics().keyBytes<=query.ownershipCacheStatistics().maximumBytes);
 const privateRoom={...record('tiny-private',2,2.1,1),access:'staff' as const,ringsFeet:[rect(2,2,2.1,2.1)]};
 const changed={...d,records:[...d.records,privateRoom]},privateQuery=createNativeWalkingRegionQuery(m,changed);
 assert.equal(privateQuery(0,true).exact!.walkable.length,0,'new tiny restricted metadata identity still vetoes its complete shared face');
 assert.equal(privateQuery.ownershipCacheStatistics().hits,0,'fresh authoring snapshot cannot borrow old ownership memo');
 assert.deepEqual(wire(privateQuery(.001,true)),wire(nativeWalkingRegion(m,changed,.001,true)));
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:14,y:0,z:0},max:{x:14.2,y:10,z:8}},solid:{start:{x:14.1,y:0},end:{x:14.1,y:10},thickness:.2,baseElevation:0,topElevation:8}};
 const newMaterial=createNativeWalkingRegionQuery({...m,elementBounds:[...m.elementBounds,wall]} as ConvertResult,d);
 assert.ok(!nativeRationalPointInParts([14.1,5],newMaterial(0,true).exact!.walkable),'new physical snapshot retains full material veto');
 assert.equal(newMaterial.ownershipCacheStatistics().hits,0);
});

test('metadata intersection omits only exactly disjoint holes without changing whole-face authority or majority area',async()=>{
 const {nativeWalkingOwnershipIntersection}=await import('../lib/reviter/native-circulation-links.ts');
 const {nativeRationalOverlay}=await import('../lib/reviter/native-rational-overlay.ts');
 const {nativeRationalAreaCompare}=await import('../lib/reviter/native-exact-planar-topology.ts');
 const face=nativeRationalOverlay('union',[[rect(0,0,20,10),rect(2,2,3,3),rect(9,4,9.000000001,6),rect(17,1,18,2)]]);
 const wire=(p:typeof face)=>p.map(p=>p.map(r=>r.map(q=>q.map(v=>`${v.n}/${v.d}`))));
 const original=wire(face);
 const identities=[
  [[rect(10,3,12,7)]], // distant physical holes
  [[rect(9,4,9.000000001,6)]], // entirely inside a true tiny hole
  [[rect(8,4,9,6)]], // touching the exact original void edge
  [[rect(8,3,10,7)]], // intersects the void
  [[rect(1,1,4,4),rect(2,2,3,3)]], // identity also has a real hole
  [[rect(1,1,4,4)],[rect(16,0,19,3)]], // multipart identity on two sides
 ] as [number,number][][][][];
 for(const identity of identities){
  const parts=nativeRationalOverlay('union',identity),expected=nativeRationalOverlay('intersection',face,parts),actual=nativeWalkingOwnershipIntersection(face,parts);
  assert.deepEqual(nativeRationalOverlay('xor',expected,actual),[],'complete exact intersection geometry must equal unchanged original operation');
  assert.equal(nativeRationalAreaCompare(actual,face,2n),nativeRationalAreaCompare(expected,face,2n),'full original face, including EVERY distant hole, stays the majority denominator');
 }
 assert.deepEqual(wire(face),original,'physical/routing/carrier input faces are not mutated');
 const generated=nativeRationalOverlay('difference',[[rect(0,0,20,10)]],[[[[2,1],[3,8],[17,9]]]]);
 const identity=nativeRationalOverlay('union',[[rect(0,0,4,3)]]);
 assert.deepEqual(nativeRationalOverlay('xor',nativeWalkingOwnershipIntersection(generated,identity),nativeRationalOverlay('intersection',generated,identity)),[],'generated rational corners keep exact equality');
});

test('private ramp veto query exactly preserves full-face restricted policy and physical holes while omitting public associations only',async()=>{
 const {createNativeWalkingRegionQuery,createNativeRampWalkingRegionQuery}=await import('../lib/reviter/native-circulation-links.ts');
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const e={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const d={...data,nativeIndoorEnvelopes:{...e,geometrySha256:await nativeIndoorEnvelopeHash(e)},walls:[],doors:[]};
 const m={...model,elementBounds:[{...floor,loops:[...floor.loops,rect(9,4,9.000000001,6).map(p=>[...p,0])]}]} as ConvertResult;
 const tiny=(access:IndoorRecord['access'],walkable=true)=>({...record('tiny',2,2.1,1),access,walkable,ringsFeet:[rect(2,2,2.1,2.1)]});
 const snapshots=[d,{...d,records:[...d.records,tiny('staff')]},{...d,records:[...d.records,tiny('unknown',false)]},{...d,records:[...d.records,tiny('public')]},{...d,records:[...d.records,tiny('unknown')]},
  {...d,records:[...d.records,{...tiny('staff'),ringsFeet:[rect(9,4,9.000000001,6)]}]}];
 const wire=(parts:NonNullable<NativeWalkingRegion['exact']>['free'])=>parts.map(p=>p.map(r=>r.map(q=>q.map(v=>`${v.n}/${v.d}`))));
 for(const snapshot of snapshots){
  const complete=createNativeWalkingRegionQuery(m,snapshot),specialized=createNativeRampWalkingRegionQuery(m,snapshot);
  assert.throws(()=>specialized(0,false),/explicit unlabelled/,'specialization cannot be mistaken for named circulation approval');
  for(const z of[0,.001,.002]){
   const a=complete(z,true),b=specialized(z,true);
   for(const key of['floors','free','walkable','barriers'] as const)assert.deepEqual(wire(a.exact![key]),wire(b.exact![key]),'all exact physical and protected-policy authority remains identical');
   assert.deepEqual(a.masks,b.masks);assert.deepEqual(a.barriers,b.barriers);
   assert.equal(supportedWalkingPath(a,[[2,5,z],[8,5,z]]),supportedWalkingPath(b,[[2,5,z],[8,5,z]]));
  }
 }
 const privateSnapshot={...d,records:[...d.records,tiny('staff')]};
 assert.equal(createNativeRampWalkingRegionQuery(m,privateSnapshot)(0,true).exact!.walkable.length,0,'a tiny staff identity keeps its whole shared free face unavailable');
 const empty=createNativeRampWalkingRegionQuery({...m,elementBounds:[]},d)(0,true);assert.deepEqual(empty.exact!.walkable,[]);
});

test('checked ankle sections preserve original native material and certified raised-body absence',async()=>{
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const {nativeMaterialSectionsHash}=await import('../lib/reviter/native-material-sections.ts');
 const envelope={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10,20],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const materials={version:1 as const,sourceModelSha256:data.source.modelSha256,levels:[{levelId:1,elevationFeet:0,cutElevationFeet:.1,evidenceSha256:'c'.repeat(64),sourceElementIds:[20],sections:[] as {nativeElementId:number;categoryId:number;kind:'wall';baseElevationFeet:number;topElevationFeet:number;partsFeet:[number,number][][][]}[]}]};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:3.28},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:3.28,topElevation:8}};
 const d={...data,nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)},nativeMaterialSections:{...materials,geometrySha256:await nativeMaterialSectionsHash(materials)}};
 const m={...model,elementBounds:[floor,wall] as ConvertResult['elementBounds']},path:[number,number,number][]=[[2,5,0],[18,5,0]];
 assert.equal(supportedWalkingPath(nativeWalkingRegion(m,d,0,true),path),true,'the source-certified upper body is absent at the lower walking cut');
 materials.levels[0]!.sections.push({nativeElementId:20,categoryId:-2000011,kind:'wall',baseElevationFeet:0,topElevationFeet:8,partsFeet:[[rect(9.9,0,10.1,10)]]});
 const present={...d,nativeMaterialSections:{...materials,geometrySha256:await nativeMaterialSectionsHash(materials)}};
 assert.equal(supportedWalkingPath(nativeWalkingRegion(m,present,0,true),path),false,'a measured source material seam vetoes the full swept path');
 const column={elementId:21,categoryId:-2000100,boundsFeet:{min:{x:5,y:4,z:0},max:{x:6,y:6,z:8}},solid:{start:{x:5.5,y:4},end:{x:5.5,y:6},thickness:1,baseElevation:0,topElevation:8}};
 assert.equal(supportedWalkingPath(nativeWalkingRegion({...m,elementBounds:[...m.elementBounds,column] as ConvertResult['elementBounds']},d,0,true),path),false,'an uncertified original native column keeps its physical veto');
});

test('a matched doorway exit can extend on its own floor side while the threshold remains a veto',()=>{
 const side={...record('stair',10.4,12,2),stair:true},outside=record('outside',0,9.6,1),door={id:'door:2:30',levelId:2,nativeElementId:30,pointFeet:[10,5] as [number,number],footprintFeet:rect(9.8,3,10.2,7),normalFeet:[1,0] as [number,number],roomKeys:[outside.key,side.key],state:'connected' as const};
 const exit={...node(side,10.6),id:door.id+':1',kind:'portal' as const};const entry={...node(outside,9.4),id:door.id+':0',kind:'portal' as const};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:0,topElevation:8}};
 const d={...data,records:[side,outside],nodes:[exit,entry],doors:[door],edges:[{id:door.id,from:entry.id,to:exit.id,enabled:true}]} as IndoorDataset;
 const m={...model,elementBounds:[floor,wall] as ConvertResult['elementBounds']};const region=nativeWalkingRegion(m,d,0,true,exit);
 assert.equal(supportedWalkingPath(region,[exit.pointFeet,[14,5,0]]),true);
 assert.equal(supportedWalkingPath(region,[exit.pointFeet,[8,5,0]]),false);
 const closed={...d,edges:[{...d.edges[0]!,enabled:false}]};assert.equal(supportedWalkingPath(nativeWalkingRegion(m,closed,0,true,exit),[exit.pointFeet,[8,5,0]]),false);
 const column={elementId:21,categoryId:-2000100,boundsFeet:{min:{x:10.3,y:4.8,z:0},max:{x:10.7,y:5.2,z:8}},solid:{start:{x:10.5,y:4.8},end:{x:10.5,y:5.2},thickness:.4,baseElevation:0,topElevation:8}};
 assert.equal(supportedWalkingPath(nativeWalkingRegion({...m,elementBounds:[...m.elementBounds,column] as ConvertResult['elementBounds']},d,0,true,exit),[exit.pointFeet,[14,5,0]]),false);
 const foreignWall={...wall,elementId:22};
 const halfThreshold:[[number,number,number],[number,number,number]]=[[10.1,5,0],[14,5,0]];
 assert.equal(supportedWalkingPath(region,halfThreshold),true,'the verified own-host aperture supports its original side');
 assert.equal(supportedWalkingPath(nativeWalkingRegion({...m,elementBounds:[...m.elementBounds,foreignWall] as ConvertResult['elementBounds']},d,0,true,exit),halfThreshold),false,'a verified door aperture cannot cut a different native wall');
 assert.equal(supportedWalkingPath(nativeWalkingRegion({...m,nativeHostRelations:[]},d,0,true,exit),halfThreshold),false,'a missing original host relation cannot authorize an aperture exception');
});

test('native stairexit continuation joins an isolated same-room arrival without bypassing its door',()=>{
 const stair={...record('stair',10.4,20,2),stair:true},outside=record('outside',0,9.6,1),exit={...node(stair,10.6),id:'door:2:30:1',kind:'portal' as const},entry={...node(outside,9.4),id:'door:2:30:0',kind:'portal' as const},arrival=node(stair,18);
 const door={id:'door:2:30',levelId:2,nativeElementId:30,pointFeet:[10,5] as [number,number],footprintFeet:rect(9.8,3,10.2,7),normalFeet:[1,0] as [number,number],roomKeys:[outside.key,stair.key],state:'connected' as const};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:0,topElevation:8}};
 const d={...data,records:[stair,outside],nodes:[exit,entry,arrival],doors:[door],edges:[{id:door.id,from:entry.id,to:exit.id,enabled:true,kind:'door'}]} as IndoorDataset,m={...model,elementBounds:[floor,wall] as ConvertResult['elementBounds']};
 const recovered=attachNativeCirculation(m,d);assert.equal(recovered.edges.length,1);assert.deepEqual(recovered.edges[0]!.roomKeys,[stair.key]);assert.ok(recovered.edges[0]!.pointsFeet.every(p=>p[0]>10));
});

test('a native landing on a floor edge leaves perpendicular to the edge before turning inward',()=>{
 const landing={...record('landing:ramp:30:lower',0,2,1),properties:{nativeFloorId:10,generatedLanding:true}},hall=record('hall',3,20,1),start={...node(landing,.01),pointFeet:[.01,2,0] as [number,number,number],kind:'connector' as const},end={...node(hall,8),pointFeet:[8,8,0] as [number,number,number]};
 const d={...data,records:[landing,hall],nodes:[start,end],edges:[]};const recovered=attachNativeCirculation(model,d);assert.equal(recovered.edges.length,1);assert.ok(recovered.edges[0]!.pointsFeet.length>=3);assert.equal(supportedWalkingPath(nativeWalkingRegion(model,d,0,true),recovered.edges[0]!.pointsFeet),true);
 const blocked={elementId:50,boundsFeet:{min:{x:2,y:1,z:.2},max:{x:10,y:9,z:2}},stairTreads:[rect(2,1,10,9).map(p=>[...p,2] as [number,number,number])]};
 assert.equal(attachNativeCirculation({...model,elementBounds:[...model.elementBounds,blocked] as ConvertResult['elementBounds']},d).edges.length,0);
});

test('member-proved curtain sections remove only the gross proxy while retaining real sill and column barriers',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/unbc-curtain-stair-door.json',import.meta.url),'utf8')),z=3.2808398950131235;
 const slab={elementId:10,categoryId:-2000032,boundsFeet:{min:{x:60,y:470,z:z-.5},max:{x:80,y:490,z}},loops:[rect(60,470,80,490).map(p=>[...p,z])]};
 const d={...data,nativeLevels:[{id:1487816,name:'Native floor',elevationFeet:z}],records:[],nodes:[],doors:[],edges:[]} as IndoorDataset;
 const m={...f.model,origin:{x:0,y:0,z:0},levels:[{levelId:1487816,elevation:z}],elementBounds:[...f.model.elementBounds,slab],nativeAssociatedLevelRelations:f.model.elementBounds.map((r:{elementId:number})=>({elementId:r.elementId,levelId:1487816,evidence:'persisted'}))} as ConvertResult;
 const approach:[number,number,number][]=[[65,479.5,z],[68,479.5,z]];
 assert.equal(supportedWalkingPath(nativeWalkingRegion(m,d,z,true),approach),true,'the unrelated floor approach is not blocked by the curtain container rectangle');
 assert.equal(supportedWalkingPath(nativeWalkingRegion(m,d,z,true),[[66.9,480.4,z],[66.9,481.7,z]]),false,'real sill and explicit door remain blocked');
 const incomplete={...m,elementBounds:m.elementBounds.filter(r=>r.elementId!==2018195)};
 assert.equal(supportedWalkingPath(nativeWalkingRegion(incomplete,d,z,true),approach),false,'unknown frame retains conservative gross host material');
 const column={elementId:500,categoryId:-2000100,boundsFeet:{min:{x:66,y:479,z},max:{x:67,y:480,z:z+8}},solid:{start:{x:66.5,y:479},end:{x:66.5,y:480},thickness:1,baseElevation:z,topElevation:z+8}};
 assert.equal(supportedWalkingPath(nativeWalkingRegion({...m,elementBounds:[...m.elementBounds,column] as ConvertResult['elementBounds']},d,z,true),approach),false,'native columns cannot be removed by curtain proof');
});

test('directory level aliases join only with a shared original slab and checked same native indoor face',async()=>{
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const d=structuredClone(data);d.nodes[1]!.levelId=2;d.records[1]!.levelId=2;
 const source={version:1 as const,sourceModelSha256:d.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 d.nativeIndoorEnvelopes={...source,geometrySha256:await nativeIndoorEnvelopeHash(source)};
 assert.equal(attachNativeCirculation(model,d).edges.length,1);
 assert.equal(attachNativeCirculation(model,{...d,nativeIndoorEnvelopes:undefined}).edges.length,0);
 const wrong=structuredClone(d);wrong.nativeIndoorEnvelopes!.levels[0]!.sourceElementIds=[99];
 assert.equal(attachNativeCirculation(model,wrong).edges.length,0);
 const split=structuredClone(d);split.nativeIndoorEnvelopes!.levels[0]!.partsFeet=[[rect(0,0,9,10)],[rect(11,0,20,10)]];
 assert.equal(attachNativeCirculation(model,split).edges.length,0);
});

test('a generated landing can meet an existing enabled door side without crossing its threshold',()=>{
 const landing={...record('landing:lower',0,9.6,1),properties:{nativeFloorId:10,generatedLanding:true}},outside=record('outside',0,9.6,1),insideRoom=record('inside',10.4,20,2);
 const start={...node(landing,2),id:'landing:arrival',kind:'connector' as const},entry={...node(outside,9.85),id:'door:2:30:0',kind:'portal' as const},exit={...node(insideRoom,10.6),id:'door:2:30:1',kind:'portal' as const};
 const door={id:'door:2:30',levelId:2,nativeElementId:30,pointFeet:[10,5] as [number,number],footprintFeet:rect(9.8,3,10.2,7),normalFeet:[1,0] as [number,number],roomKeys:[outside.key,insideRoom.key],state:'connected' as const};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:0,topElevation:8}};
 const d={...data,records:[landing,outside,insideRoom],nodes:[start,entry,exit],doors:[door],edges:[{id:door.id,from:entry.id,to:exit.id,kind:'door',enabled:true}]} as IndoorDataset,m={...model,elementBounds:[floor,wall] as ConvertResult['elementBounds']};
 const recovered=attachNativeCirculation(m,d);assert.equal(recovered.edges.length,1);
 assert.equal(recovered.edges[0]!.from,start.id);assert.equal(recovered.edges[0]!.to,entry.id);
 assert.ok(recovered.edges[0]!.pointsFeet.every(p=>p[0]<10));
 assert.equal(supportedWalkingPath(nativeWalkingRegion(m,d,0,true,entry),recovered.edges[0]!.pointsFeet),true);
 assert.equal(attachNativeCirculation(m,{...d,edges:[{...d.edges[0]!,enabled:false}]}).edges.length,0);
});

test('strict generated approaches inherit whole native face identities rather than touched old contour fringes',async()=>{
 const {nativeIndoorEnvelopeHash}=await import('../lib/reviter/native-indoor-envelopes.ts');
 const d=structuredClone(data);
 d.records.push({...record('fringe',9.9,10.1,1),circulation:false,access:'staff',ringsFeet:[rect(9.9,4.9,10.1,500)]});
 const source={version:1 as const,sourceModelSha256:d.source.modelSha256,levels:[{levelId:1,elevationFeet:0,partsFeet:[[rect(0,0,20,10)]],sourceElementIds:[10],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 d.nativeIndoorEnvelopes={...source,geometrySha256:await nativeIndoorEnvelopeHash(source)};
 const result=attachNativeCirculation(model,d);
 assert.equal(result.edges.length,1);
 assert.deepEqual(result.edges[0]!.roomKeys,['a','b']);
 assert.ok(result.edges[0]!.pointsFeet.some(p=>p[0]<10)&&result.edges[0]!.pointsFeet.some(p=>p[0]>10));
 d.records.at(-1)!.ringsFeet=[rect(9.7,4.7,10.3,5.3)];
 assert.equal(attachNativeCirculation(model,d).edges.length,0,'a fully contained restricted identity conservatively restricts its whole actual shared face');
 d.records.at(-1)!.ringsFeet=[rect(9.95,4.95,10.05,5.05)];
 assert.equal(attachNativeCirculation(model,d).edges.length,0,'a positive 0.01 square-foot restricted identity cannot be discarded before whole-face ownership checks');
});

test('immutable source portal queries reuse exact regions with bounded lifetime and invalidate a closed threshold',async()=>{
 const {createNativeWalkingRegionQuery}=await import('../lib/reviter/native-circulation-links.ts');
 const side={...record('stair',10.4,20,2),stair:true},outside=record('outside',0,9.6,1),exit={...node(side,10.6),id:'door:2:30:1',kind:'portal' as const};
 const door={id:'door:2:30',levelId:2,nativeElementId:30,pointFeet:[10,5] as [number,number],footprintFeet:rect(9.8,3,10.2,7),normalFeet:[1,0] as [number,number],roomKeys:[outside.key,side.key],state:'connected' as const};
 const wall={elementId:20,categoryId:-2000011,boundsFeet:{min:{x:9.8,y:0,z:0},max:{x:10.2,y:10,z:8}},solid:{start:{x:10,y:0},end:{x:10,y:10},thickness:.4,baseElevation:0,topElevation:8}};
 const d={...data,records:[side,outside],nodes:[exit],doors:[door],edges:[{id:door.id,kind:'door',enabled:true}]} as IndoorDataset,m={...model,elementBounds:[floor,wall] as ConvertResult['elementBounds']};
 const query=createNativeWalkingRegionQuery(m,d),first=query(0,true,exit);
 assert.equal(query(0,true,exit),first,'repeated candidates reuse the same fully checked portal geometry');
 assert.equal(supportedWalkingPath(first,[exit.pointFeet,[14,5,0]]),true);
 d.edges[0]!.enabled=false;
 const closed=query(0,true,exit);assert.notEqual(closed,first);assert.equal(supportedWalkingPath(closed,[[10.1,5,0],[14,5,0]]),false,'closing its physical door cannot reuse an open own-host exception');
 d.edges[0]!.enabled=true;assert.equal(query(0,true,exit),first);
 for(let i=0;i<33;i++)query(100+i,true);
 assert.notEqual(query(0,true,exit),first,'arbitrary queried heights cannot retain all portal regions indefinitely');
 const fresh=createNativeWalkingRegionQuery(m,d);assert.notEqual(fresh(0,true,exit),query(0,true,exit),'a new immutable authoring phase has independent bindings');
});
