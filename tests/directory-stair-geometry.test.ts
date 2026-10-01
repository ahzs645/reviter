import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {directoryStairFootprints,nativeStairAtPoint} from '../lib/reviter/directory-stair-geometry.ts';
import {directoryStairs,reviewedStairConnection,findBuildingRoute} from '../lib/reviter/directory-navigation.ts';
import {directoryModelFloor,directoryRoomGroup,directoryRoomColor} from '../app/studio/directory-model.ts';
import {isWalkable,findDirectoryRoute,parseRoomDirectory,type DirectoryRoom} from '../lib/reviter/room-directory.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const stair:DirectoryRoom={key:'lower',number:'08-S101',name:'Stair',levelId:1,confidence:1,polygonFeet:[[0,0],[10,0],[10,10],[0,10]],labelPointFeet:[5,5]};
const upper={...stair,key:'upper',number:'08-S201',levelId:2};
const model={levels:[{levelId:1,elevation:0},{levelId:2,elevation:10}],elementBounds:[{elementId:101,boundsFeet:{min:{x:0,y:0,z:0},max:{x:20,y:3,z:10}},stairTreads:[[[0,0,0],[1,0,0],[1,3,0],[0,3,0]],[[1,0,9],[2,0,9],[2,3,9],[1,3,9]],[[19,0,5],[20,0,5],[20,3,5],[19,3,5]]]}],nativeStairAssemblies:[{stairElementId:100,runAndLandingIds:[101]}]} as unknown as ConvertResult;
const data=(annotations:DirectoryRoom[])=>({format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations});
function meshArea(mesh:THREE.Mesh){const pos=mesh.geometry.getAttribute('position'),idx=mesh.geometry.index!;let area=0;for(let i=0;i<idx.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(pos,idx.getX(i)),b=new THREE.Vector3().fromBufferAttribute(pos,idx.getX(i+1)),c=new THREE.Vector3().fromBufferAttribute(pos,idx.getX(i+2));area+=b.sub(a).cross(c.sub(a)).length()/2;}return area;}
test('treads occupy their actual projection, not the room or run bounds, and preserve room holes',()=>{
 const f=directoryStairFootprints(model,[stair])[0]!;assert.equal(f.areaFeet,6);assert.equal(f.treads.length,2);assert.deepEqual(f.stairElementIds,[100]);assert.ok(f.marker[0]<=2&&f.marker[1]<=3);
 const holed:DirectoryRoom={...stair,holesFeet:[[[0,0],[1,0],[1,3],[0,3]]]};assert.equal(directoryStairFootprints(model,[holed])[0]!.areaFeet,3);
 assert.deepEqual(directoryStairFootprints({...model,nativeStairAssemblies:[]},[stair]),[]);
 assert.deepEqual(directoryStairFootprints(model,[{...stair,walkability:'void'}]),[]);
});
test('a room landing keeps its ordinary fill in 3D; only actual treads get stair color and native elevations',()=>{
 const floor=directoryModelFloor(model,[stair],1,null)!;assert.equal(directoryRoomColor(stair),'#dfe9f0');
 const group=directoryRoomGroup(floor,{x:0,y:0,z:0},null),meshes=group.children.filter(o=>o instanceof THREE.Mesh) as THREE.Mesh[];
 const landing=meshes.filter(m=>!m.userData.stairTreadElementId),steps=meshes.filter(m=>m.userData.stairTreadElementId);
 assert.equal(landing.reduce((s,m)=>s+meshArea(m),0),97);assert.equal(steps.reduce((s,m)=>s+meshArea(m),0),6);assert.deepEqual(steps.map(m=>m.position.z),[.15,9.15]);
 assert.ok(steps.every(m=>(m.material as THREE.MeshBasicMaterial).color.getHexString()==='bba6df'));
});
test('local-only review prevents native, explicit reviewed, and stale vertical links but retains steps and floor access',()=>{
 const pair=[stair,upper],native=directoryStairs(model,pair);assert.equal(native.length,1);
 const local={...stair,stairAccess:'local-only' as const,stairAccessNotes:'Local landing only.'},rooms=[local,upper];
 assert.equal(isWalkable(local),true);assert.equal(directoryStairFootprints(model,[local])[0]!.areaFeet,6);assert.ok(directoryStairFootprints(model,[local])[0]!.treads.every(t=>t.localToStorey));
 assert.deepEqual(directoryStairs(model,rooms,[{rooms:['lower','upper']}]),[]);assert.equal(reviewedStairConnection(model,rooms,{rooms:['lower','upper']}),null);
 assert.equal(findBuildingRoute(rooms,new Map(),native,'lower','upper'),null);
 const office={...stair,key:'office',name:'Office',polygonFeet:[[11,0],[15,0],[15,10],[11,10]] as [number,number][],labelPointFeet:[13,5] as [number,number]};
 assert.ok(findDirectoryRoute([local,office],[{rooms:['lower','office'],point:[10.5,5],from:[10,5],to:[11,5],halfWidth:.6,halfHeight:1.5}],'lower','office'));
 const saved=parseRoomDirectory(JSON.stringify(data(rooms)));assert.equal(saved.annotations[0]!.stairAccess,'local-only');assert.deepEqual(saved.annotations[0]!.polygonFeet,stair.polygonFeet);
 assert.throws(()=>parseRoomDirectory(JSON.stringify(data([{...local,stairAccess:'pretend'} as unknown as DirectoryRoom]))));
 assert.equal(reviewedStairConnection(model,[{...stair,walkability:'void'},upper],{rooms:['lower','upper']}),null);
});
test('flight-and-landing review preserves an actual native link without treating the whole room as flight',()=>{
 const confirmed={...stair,stairAccess:'flight-and-landing' as const};assert.equal(directoryStairs(model,[confirmed,upper]).length,1);assert.equal(directoryStairFootprints(model,[confirmed])[0]!.areaFeet,6);
});

test('upward-flight review keeps travel both ways through that flight but rejects separate lower-storey links',()=>{
 const confirmed={...stair,stairAccess:'up-flight-only' as const},basement={...stair,key:'basement',number:'08-S001',levelId:0};
 const lowerRun={...model.elementBounds[0]!,elementId:102,boundsFeet:{min:{x:0,y:0,z:-10},max:{x:20,y:3,z:0}},stairTreads:model.elementBounds[0]!.stairTreads!.map(t=>t.map(p=>[p[0],p[1],p[2]-9] as [number,number,number]))};
 const source={...model,levels:[{levelId:0,elevation:-10},...model.levels],elementBounds:[...model.elementBounds,lowerRun],nativeStairAssemblies:[...model.nativeStairAssemblies!,{...model.nativeStairAssemblies![0]!,stairElementId:99,runAndLandingIds:[102]}]} as ConvertResult;
 const originalRooms=[stair,upper,basement],rooms=[confirmed,upper,basement],native=directoryStairs(source,originalRooms),reviewed=directoryStairs(source,rooms);
 assert.equal(native.length,2);assert.equal(reviewed.length,1);assert.equal(reviewed[0]!.stairElementId,100);
 const footprint=directoryStairFootprints(source,[confirmed])[0]!;
 assert.ok(footprint.treads.filter(t=>t.elementId===102).every(t=>t.localToStorey));
 assert.ok(footprint.treads.filter(t=>t.elementId===101).every(t=>!t.localToStorey));
 const group=directoryRoomGroup(directoryModelFloor(source,[confirmed],1,null)!,{x:0,y:0,z:0},null);
 const meshes=group.children.filter(o=>o instanceof THREE.Mesh&&o.userData.stairTreadElementId) as THREE.Mesh[];
 assert.ok(meshes.filter(m=>m.userData.stairTreadElementId===102).every(m=>(m.material as THREE.MeshBasicMaterial).color.getHexString()==='d7eee3'));
 assert.ok(meshes.filter(m=>m.userData.stairTreadElementId===101).every(m=>(m.material as THREE.MeshBasicMaterial).color.getHexString()==='bba6df'));
 assert.ok(meshes.some(m=>m.userData.stairTreadElementId===102));

 assert.ok(findBuildingRoute(rooms,new Map(),reviewed,'lower','upper'));assert.ok(findBuildingRoute(rooms,new Map(),reviewed,'upper','lower'));
 assert.equal(findBuildingRoute(rooms,new Map(),native,'lower','basement'),null);
 assert.equal(reviewedStairConnection(source,rooms,{rooms:['lower','basement']}),null);assert.ok(reviewedStairConnection(source,rooms,{rooms:['lower','upper']}));
 assert.equal(parseRoomDirectory(JSON.stringify(data(rooms))).annotations[0]!.stairAccess,'up-flight-only');
});

test('the plan cut excludes overhead flight treads while retaining reviewed local downward steps',async()=>{
 const {stairTreadVisibleInPlan}=await import('../lib/reviter/directory-stair-geometry.ts');
 const footprint=directoryStairFootprints(model,[stair])[0]!;
 assert.ok(stairTreadVisibleInPlan(footprint.treads[0]!,0));
 assert.equal(stairTreadVisibleInPlan(footprint.treads[1]!,0),false);
 assert.ok(stairTreadVisibleInPlan({...footprint.treads[1]!,localToStorey:true},0));
});

test('reviewed native flight coverage extends only actual treads and retains source holes and boundaries',()=>{
 const reviewed={...stair,stairFlightIds:[100]},copy=structuredClone(reviewed);
 const footprint=directoryStairFootprints(model,[reviewed])[0]!;
 assert.equal(footprint.areaFeet,9);assert.equal(footprint.treads.length,3);
 assert.deepEqual(reviewed,copy);
 assert.equal(directoryStairFootprints(model,[{...reviewed,holesFeet:[[[19,0],[20,0],[20,3],[19,3]]]}])[0]!.areaFeet,6);
 assert.equal(directoryStairFootprints(model,[{...reviewed,stairFlightIds:[999]}])[0]!.areaFeet,6);
 assert.deepEqual(directoryStairFootprints(model,[{...reviewed,polygonFeet:[[30,0],[40,0],[40,10],[30,10]]}]),[]);
 assert.deepEqual(directoryStairFootprints(model,[{...reviewed,levelId:3}]),[]);
 assert.deepEqual(directoryStairs(model,[reviewed]),[]);
 assert.deepEqual(parseRoomDirectory(JSON.stringify(data([reviewed]))).annotations[0]!.stairFlightIds,[100]);
 for(const ids of [[100,100],[-1],[1.5],['100']])assert.throws(()=>parseRoomDirectory(JSON.stringify(data([{...reviewed,stairFlightIds:ids} as unknown as DirectoryRoom]))));
 const group=directoryRoomGroup(directoryModelFloor(model,[reviewed],1,null)!,{x:0,y:0,z:0},null);
 assert.ok(group.children.some(m=>m.userData.stairTreadElementId===101&&m.position.z===5.15));
});

test('a pin outside a source outline identifies a physical overhead tread without inventing floor or a vertical route',()=>{
 const hit=nativeStairAtPoint(model,1,[19.5,1])!;
 assert.equal(hit.stairElementId,100);assert.equal(hit.runId,101);assert.equal(hit.elevation,5);
 assert.equal(hit.lowLevelId,1);assert.equal(hit.highLevelId,2);assert.equal(hit.overhead,true);
 assert.equal(nativeStairAtPoint(model,1,[15,1]),null);
 assert.equal(nativeStairAtPoint({...model,levels:[...model.levels,{levelId:3,elevation:5}]} as ConvertResult,3,[19.5,1]),null);
});

test('an unrecovered stair retains its review outline without painting a flat floor across the shaft',()=>{
 const unresolvedModel={...model,nativeStairAssemblies:[]};
 const floor=directoryModelFloor(unresolvedModel,[stair],1,null)!;
 const group=directoryRoomGroup(floor,{x:0,y:0,z:0},stair.key);
 assert.equal(group.children.filter(o=>o instanceof THREE.Mesh).length,0);
 assert.ok(group.children.some(o=>o.userData.flightUnrecovered&&o.userData.roomKey===stair.key));
 assert.deepEqual(floor.rooms[0]!.polygonFeet,stair.polygonFeet);
 assert.equal(isWalkable(stair),true);assert.deepEqual(directoryStairs(unresolvedModel,[stair,upper]),[]);
 const local=directoryRoomGroup(directoryModelFloor(unresolvedModel,[{...stair,stairAccess:'local-only'}],1,null)!,{x:0,y:0,z:0},null);
 assert.ok(local.children.some(o=>o instanceof THREE.Mesh));
});

test('a native slab opening preserves the source label but routes to its supported landing and keeps the shaft empty',()=>{
 const opening:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[6,0],[6,10],[0,10]];
 const reviewed={...stair,floorOpeningsFeet:[opening],routePointFeet:[8,5] as [number,number]};
 const saved=parseRoomDirectory(JSON.stringify(data([reviewed]))).annotations[0]!;
 assert.deepEqual(saved.labelPointFeet,stair.labelPointFeet);assert.deepEqual(saved.polygonFeet,stair.polygonFeet);
 assert.deepEqual(saved.routePointFeet,[8,5]);assert.deepEqual(saved.floorOpeningsFeet,[opening]);
 assert.throws(()=>parseRoomDirectory(JSON.stringify(data([{...reviewed,routePointFeet:[5,5]}]))));
 assert.throws(()=>parseRoomDirectory(JSON.stringify(data([{...reviewed,floorOpeningsFeet:[[[0,0],[1,1]]]} as unknown as DirectoryRoom]))));
 const unresolved={...model,nativeStairAssemblies:[]},floor=directoryModelFloor(unresolved,[reviewed],1,null)!;
 assert.equal(floor.areas[0]!.areaFeet,40);
 const meshes=directoryRoomGroup(floor,{x:0,y:0,z:0},null).children.filter(o=>o instanceof THREE.Mesh) as THREE.Mesh[];
 assert.equal(meshes.reduce((sum,m)=>sum+meshArea(m),0),40);
 const corridor={...stair,key:'corridor',name:'Corridor',polygonFeet:[[10.5,0],[15,0],[15,10],[10.5,10]] as [number,number][],labelPointFeet:[13,5] as [number,number]};
 const portal={rooms:['lower','corridor'] as [string,string],point:[10.25,5] as [number,number],from:[10,5] as [number,number],to:[10.5,5] as [number,number],halfWidth:.6,halfHeight:2};
 assert.ok(findDirectoryRoute([reviewed,corridor],[portal],'corridor','lower'));
 assert.equal(findDirectoryRoute([{...reviewed,routePointFeet:undefined},corridor],[portal],'corridor','lower'),null);
 assert.equal(findDirectoryRoute([{...reviewed,routePointFeet:undefined}],[],'lower','lower'),null);
});

test('a native opening masks overlapping source fills and blocks a thin gap even between raster centres',async()=>{
 const {directoryAreas}=await import('../lib/reviter/directory-areas.ts');
 const left={...stair,key:'left',name:'Corridor',polygonFeet:[[0,0],[10,0],[10,10],[0,10]] as [number,number][],labelPointFeet:[2,5] as [number,number],floorOpeningsFeet:[[[4.95,0],[5.05,0],[5.05,10],[4.95,10]] as [number,number][]]};
 const right={...left,key:'right',labelPointFeet:[8,5] as [number,number],floorOpeningsFeet:undefined};
 assert.equal(findDirectoryRoute([left,right],[],'left','right'),null);
 assert.equal(directoryAreas([left,right])[0]!.areaFeet,99);
});
