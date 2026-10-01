import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {localBuildingConnections,type ReportedBuildingTransition} from '../lib/reviter/building-transitions.ts';
import {parseRoomDirectory,type DirectoryRoom,type RoomPoint} from '../lib/reviter/room-directory.ts';
import {directoryModelFloor,directoryRoomGroup,directoryFloorPlanes,withLocalBuildingContext} from '../app/studio/directory-model.ts';
import {directoryStairs} from '../lib/reviter/directory-navigation.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const rect=(x0:number,y0:number,x1:number,y1:number):RoomPoint[]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const lower:DirectoryRoom={key:'hall',number:'07-180',name:'Circulation Hall',levelId:1,confidence:1,polygonFeet:rect(0,0,4,10),labelPointFeet:[2,5]};
const upper:DirectoryRoom={...lower,key:'upper',number:'08-S101',name:'Stair',levelId:2,polygonFeet:rect(10,0,15,10),labelPointFeet:[12,5],stairAccess:'up-flight-only'};
const report:ReportedBuildingTransition={id:'07-08',kind:'local-steps',evidence:'user-reported',nativeStairId:100,floorElementIds:[11,12],endpoints:[{building:'07',levelId:1,point:[2,5],roomKey:'hall'},{building:'08',levelId:2,point:[8,5]}]};
const model={levels:[{levelId:1,elevation:0},{levelId:2,elevation:3}],elementBounds:[
 {elementId:11,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-.5},max:{x:4,y:10,z:0}},loops:[rect(0,0,4,10).map(p=>[...p,0])]},
 {elementId:12,categoryId:-2000032,boundsFeet:{min:{x:7,y:0,z:2.5},max:{x:15,y:10,z:3}},loops:[rect(7,0,15,10).map(p=>[...p,3])]},
 {elementId:101,boundsFeet:{min:{x:4,y:0,z:0},max:{x:7,y:10,z:3}},stairTreads:[0,1,2,3,4].map(i=>rect(4+i*.6,0,4+(i+1)*.6,10).map(p=>[...p,(i+1)*.5]))}
 ],nativeAssociatedLevelRelations:[{elementId:11,levelId:1},{elementId:12,levelId:2}],nativeStairAssemblies:[{stairElementId:100,runAndLandingIds:[101]}]} as unknown as ConvertResult;
const rooms=[lower,upper], derive=(m=model,r=rooms)=>localBuildingConnections(m,r,[report])[0]!;
const file={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations:rooms,buildingTransitions:[report]};
test('a native landing without a room outline can join two buildings at separate local heights',()=>{
 const c=derive();assert.equal(c.surfaceSupported,true);assert.equal(c.stepBands,5);assert.equal(c.endpoints[1].room,undefined);assert.equal(c.endpoints[1].roomKey,undefined);
 assert.deepEqual(c.warnings,[]);assert.equal(c.samples[0]!.elevation,0);assert.equal(c.samples.at(-1)!.elevation,3);
 assert.deepEqual(rooms,[lower,upper]);assert.deepEqual(directoryStairs(model,rooms),[]);
});
test('a native surface gap, missing stairs or wrong landing height prevents a supported crossing',()=>{
 const gap=structuredClone(model);gap.elementBounds[0]!.loops!.push(rect(2.5,4,3,6).map(p=>[...p,0]));assert.equal(derive(gap).surfaceSupported,false);
 assert.equal(derive({...model,nativeStairAssemblies:[]}).surfaceSupported,false);
 assert.equal(derive({...model,nativeAssociatedLevelRelations:[]}).surfaceSupported,false);
 const stale=derive(model,[{...lower,polygonFeet:rect(0,0,1,10)},upper]);assert.equal(stale.surfaceSupported,false);
 const height=structuredClone(model);height.elementBounds[1]!.boundsFeet.max.z=10;assert.equal(derive(height).surfaceSupported,false);
});
test('walls, private rooms and reported voids block the preview, and private/void masks are preserved in the native patch',()=>{
 const blocked={...lower,key:'blocked',number:'07-999',name:'Office',polygonFeet:rect(2.5,4,3.5,6),labelPointFeet:[3,5] as RoomPoint};
 for(const obstacle of [blocked,{...blocked,walkability:'void' as const}])assert.equal(derive(model,[...rooms,obstacle]).surfaceSupported,false);
 const wall={elementId:99,categoryId:-2000011,boundsFeet:{min:{x:2.5,y:4,z:0},max:{x:3.5,y:6,z:10}}};
 assert.equal(derive({...model,elementBounds:[...model.elementBounds,wall] as ConvertResult['elementBounds']}).surfaceSupported,false);
 assert.ok(derive(model,[...rooms,blocked]).surfaces[0]!.polygons.some(p=>p.length>1));
});
test('3D local surfaces retain their native height and the lower building stays within the upper floor section',()=>{
 const c=derive(),floor=withLocalBuildingContext(directoryModelFloor(model,[upper],2,null)!,[c]);assert.equal(floor.boundsFeet.min.z,-2);
 const group=directoryRoomGroup(floor,{x:0,y:0,z:0},null),native=group.children.filter(o=>o instanceof THREE.Mesh&&o.userData.nativeSurfaceElementId) as THREE.Mesh[];
 assert.deepEqual([...new Set(native.map(m=>m.position.z))].sort((a,b)=>a-b),[.06,.56,1.06,1.56,2.06,2.56,3.06]);
 assert.ok(native.every(m=>!m.userData.roomKey));assert.ok(native.every(m=>(m.material as THREE.MeshBasicMaterial).color.getHexString()==='d7eee3'));assert.ok(directoryFloorPlanes(floor,{x:0,y:0,z:0},4).every(p=>p.distanceToPoint(new THREE.Vector3(2,5,0))>=0));
});
test('import/export keeps native identities, separate levels and unassigned endpoints while rejecting malformed reports',()=>{
 const parsed=parseRoomDirectory(JSON.stringify(file));assert.deepEqual(parsed.buildingTransitions,[report]);assert.deepEqual(parsed.annotations,rooms);
 for(const invalid of [{...report,endpoints:[report.endpoints[0],{...report.endpoints[1],roomKey:'hall'}]},{...report,floorElementIds:[11]},{...report,endpoints:[report.endpoints[0],{...report.endpoints[1],point:[null,5]}]}])assert.throws(()=>parseRoomDirectory(JSON.stringify({...file,buildingTransitions:[invalid]})));
});

test('a raised area in the same building retains its directory level and explicit native slab height',()=>{
 const raised={...upper,number:'07-124',name:'Rotunda',levelId:1};
 const same:ReportedBuildingTransition={...report,id:'raised-rotunda',endpoints:[{...report.endpoints[0],elevationFeet:0},{building:'07',levelId:1,roomKey:'upper',point:[12,5],elevationFeet:3}]};
 const c=localBuildingConnections(model,[lower,raised],[same])[0]!;assert.equal(c.surfaceSupported,true);assert.equal(c.endpoints[1].levelId,1);assert.equal(c.endpoints[1].elevation,3);
 assert.deepEqual(parseRoomDirectory(JSON.stringify({...file,annotations:[lower,raised],buildingTransitions:[same]})).buildingTransitions,[same]);
 const wrong={...same,endpoints:[same.endpoints[0],{...same.endpoints[1],elevationFeet:6}] as ReportedBuildingTransition['endpoints']};assert.equal(localBuildingConnections(model,[lower,raised],[wrong])[0]!.surfaceSupported,false);
 for(const invalid of [{...same,endpoints:same.endpoints.map(({building,levelId,point,roomKey})=>({building,levelId,point,roomKey}))},{...same,endpoints:same.endpoints.map(e=>({...e,elevationFeet:0}))}])assert.throws(()=>parseRoomDirectory(JSON.stringify({...file,annotations:[lower,raised],buildingTransitions:[invalid]})));
});
