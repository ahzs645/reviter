import test from 'node:test';import assert from 'node:assert/strict';
import {recoverModelWalkways,modelWalkwayCandidates}from '../lib/reviter/model-walkways.ts';
import {containsDirectoryRoomPoint,parseRoomDirectory,roomBuilding,type DirectoryRoom}from '../lib/reviter/room-directory.ts';
import type {ConvertResult,ElementBoundsRecord}from '../lib/reviter/types.ts';
const base={stream:'Partitions/1',chunkIndex:0,rawOffset:0,recordOffset:0};
const slab:ElementBoundsRecord={...base,elementId:1,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:13},max:{x:20,y:20,z:14}},loops:[[[0,0,14],[20,0,14],[20,20,14],[0,20,14]],[[5,5,14],[15,5,14],[15,15,14],[5,15,14]]]};
const model={levels:[{levelId:42,elevation:14,candidates:1}],elementBounds:[slab],nativeAssociatedLevelRelations:[{elementId:1,levelId:42}]} as unknown as ConvertResult;
const room:DirectoryRoom={key:'office',number:'10-100',levelId:42,name:'Office',confidence:1,polygonFeet:[[0,0],[4,0],[4,4],[0,4]],labelPointFeet:[2,2]};
test('recover selected native walkways without filling slab holes, overwriting rooms or inventing room numbers',()=>{
 const original=structuredClone(room),added=recoverModelWalkways(model,[room],{building:'10',levelId:42,elementIds:[1]});
 assert.ok(added.length);assert.deepEqual(room,original);assert.ok(added.every(r=>roomBuilding(r)==='10'&&r.number==null&&r.modelSurface?.elementId===1&&r.modelSurface.elevationFeet===14));
 assert.ok(added.every(r=>!containsDirectoryRoomPoint([10,10],r)&&!containsDirectoryRoomPoint([2,2],r)&&containsDirectoryRoomPoint(r.labelPointFeet,r)));
 const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:[room,...added]};assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
 assert.equal(recoverModelWalkways(model,[room,...added],{building:'10',levelId:42,elementIds:[1]}).length,0);
});
test('walkway recovery uses the requested native storey and keeps voids and wall barriers out',()=>{
 assert.deepEqual(recoverModelWalkways(model,[],{building:'10',levelId:43,elementIds:[1]}),[]);
 assert.deepEqual(recoverModelWalkways(model,[],{building:'10',levelId:42,elementIds:[999]}),[]);
 assert.deepEqual(recoverModelWalkways({...model,levels:[{levelId:42,elevation:30,candidates:1}]},[],{building:'10',levelId:42,elementIds:[1]}),[]);
 const wall:ElementBoundsRecord={...base,elementId:2,categoryId:-2000011,boundsFeet:{min:{x:8,y:0,z:14},max:{x:10,y:5,z:24}},solid:{elementId:2,start:{x:9,y:0},end:{x:9,y:5},thickness:2,baseElevation:14,topElevation:24}};
 const withWall={...model,elementBounds:[slab,wall],nativeAssociatedLevelRelations:[...model.nativeAssociatedLevelRelations!,{elementId:2,levelId:42}]} as unknown as ConvertResult;
 const voidRoom={...room,key:'void',name:'Rotunda',walkability:'void' as const};const added=recoverModelWalkways(withWall,[voidRoom],{building:'10',levelId:42,elementIds:[1]});
 assert.ok(added.length);assert.ok(added.every(r=>!containsDirectoryRoomPoint([9,2],r)&&!containsDirectoryRoomPoint([2,2],r)));
});

test('atrium context identifies a native slab without copying a reference storey’s walkable footprint',()=>{
 const reference={...room,key:'atrium-upper',name:'Atrium',levelId:43,polygonFeet:[[0,0],[20,0],[20,20],[0,20]] as [number,number][]};
 assert.deepEqual(modelWalkwayCandidates(model,[reference],'10',42),[1]);
 assert.deepEqual(modelWalkwayCandidates(model,[reference],'09',42),[]);
 assert.deepEqual(modelWalkwayCandidates(model,[reference],'10',43),[]);
 const recovered=recoverModelWalkways(model,[reference],{building:'10',levelId:42,elementIds:modelWalkwayCandidates(model,[reference],'10',42)});
 assert.ok(recovered.every(r=>r.levelId===42&&!containsDirectoryRoomPoint([10,10],r)));
});
