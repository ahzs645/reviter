import test from 'node:test';import assert from 'node:assert/strict';
import {buildingConnections}from '../lib/reviter/building-connections.ts';
import {roomPortals,parseRoomDirectory,type DirectoryRoom,type DirectoryDoor}from '../lib/reviter/room-directory.ts';
import {directoryDoorReviews}from '../lib/reviter/directory-navigation.ts';
const rooms:DirectoryRoom[]=[{key:'alcove',number:'08-159',name:'Alcove',levelId:42,confidence:1,polygonFeet:[[0,0],[10,0],[10,10],[0,10]],labelPointFeet:[5,5]},{key:'vestibule',number:'10-1080',name:'Vestibule',levelId:42,confidence:1,polygonFeet:[[10.5,0],[20,0],[20,10],[10.5,10]],labelPointFeet:[15,5]}];
const door:DirectoryDoor={id:1501580,point:[10.25,5],normal:[1,0],halfWidth:.5,halfHeight:2,footprint:[[9.75,3],[10.75,3],[10.75,7],[9.75,7]]};
const elevations={alcove:{elevation:3.28},vestibule:{elevation:3.28}};
test('a precise doorway connects two building records without merging their identities',()=>{
 const copy=structuredClone(rooms),reviews=directoryDoorReviews(rooms,[door]),connections=buildingConnections(rooms,reviews,elevations);
 assert.equal(connections.length,1);assert.equal(connections[0]!.door.door.id,1501580);assert.ok(connections[0]!.route);assert.deepEqual(connections[0]!.route!.roomKeys,['alcove','vestibule']);assert.deepEqual(rooms,copy);
 const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'model.rvt'},annotations:rooms,navigation:{version:1,doorLinks:[{levelId:42,doorId:1501580,rooms:['alcove','vestibule']}]}};assert.deepEqual(parseRoomDirectory(JSON.stringify(data)),data);
});
test('missing precise evidence, different levels, voids and split heights cannot create a building crossing',()=>{
 const reviews=directoryDoorReviews(rooms,[door]);
 assert.equal(buildingConnections(rooms,[{...reviews[0]!,door:{...door,footprint:undefined}}],elevations).length,0);
 assert.equal(buildingConnections(rooms,[{...reviews[0]!,door:{...door,normal:undefined}}],elevations).length,0);
 assert.equal(buildingConnections(rooms.map(r=>r.key==='alcove'?{...r,walkability:'void'}:r),reviews,elevations).length,0);
 assert.equal(buildingConnections(rooms.map(r=>r.key==='alcove'?{...r,levelId:43}:r),reviews,elevations).length,0);
 assert.equal(buildingConnections(rooms,reviews,{...elevations,alcove:{elevation:6.56}}).length,0);
 assert.equal(buildingConnections(rooms,reviews,{}).length,0);
});
test('nearby objects with no matched opening do not become a building connection',()=>{
 assert.equal(buildingConnections(rooms,directoryDoorReviews(rooms,[]),elevations).length,0);
 assert.equal(buildingConnections(rooms.map(r=>({...r,number:`08-${r.key}`})),directoryDoorReviews(rooms,[door]),elevations).length,0);
 assert.equal(roomPortals(rooms,[]).length,0);
});

test('an overlapping reported void masks the local crossing even when a native door exists',()=>{
 const drop:DirectoryRoom={...rooms[0]!,key:'drop',number:'08-void',walkability:'void',polygonFeet:[[9,0],[12,0],[12,10],[9,10]],labelPointFeet:[10,5]};
 const connections=buildingConnections([...rooms,drop],directoryDoorReviews(rooms,[door]),elevations);
 assert.equal(connections.length,1);assert.equal(connections[0]!.route,null);
});

test('a local building crossing respects native walls and cannot route through a column at the door',()=>{
 const reviews=directoryDoorReviews(rooms,[door]);
 const wall={polygon:[[10,0],[10.5,0],[10.5,10],[10,10]] as [number,number][]};
 assert.ok(buildingConnections(rooms,reviews,elevations,{walls:[wall],columns:[]})[0]!.route);
 assert.equal(buildingConnections(rooms,reviews,elevations,{walls:[],columns:[wall]})[0]!.route,null);
 const remoteWall={polygon:[[13,0],[14,0],[14,10],[13,10]] as [number,number][]};
 assert.equal(buildingConnections(rooms,reviews,elevations,{walls:[remoteWall],columns:[]})[0]!.route,null);
});
