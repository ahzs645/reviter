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
test('floor profile holes are retained when constructing physical walking regions',()=>{
 const holed={...model,elementBounds:[{...floor,loops:[...floor.loops,rect(9,4,11,6).map(p=>[...p,0])]}]} as unknown as ConvertResult;
 assert.equal(nativeWalkingRegion(holed,data,0).floors[0]!.length,2);
 assert.equal(attachNativeCirculation(holed,data).edges.length,0);
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
