import test from 'node:test';import assert from 'node:assert/strict';
import {directoryLocation}from '../lib/reviter/directory-location.ts';import type{DirectoryRoom}from '../lib/reviter/room-directory.ts';
const room:DirectoryRoom={key:'room',name:'Lounge',number:'10-1021',levelId:1,confidence:1,polygonFeet:[[0,0],[10,0],[10,10],[0,10]],holesFeet:[[[3,3],[7,3],[7,7],[3,7]]],labelPointFeet:[2,2]};
test('location selection respects holes, overlapping room masks and exact model coordinates',()=>{
  const hall={...room,key:'hall',name:'Hallway',holesFeet:[]},deleted={...room,key:'deleted',status:'deleted'};
  const hit=directoryLocation([hall,room,deleted],[{id:123,point:[2,2],halfWidth:1,halfHeight:1}],[2.25,2],.5);
  assert.deepEqual(hit.roomKeys,['room','hall']);assert.deepEqual(hit.point,[2.25,2]);assert.equal(hit.doorId,123);
  assert.deepEqual(directoryLocation([room],[],[5,5],1).roomKeys,[]);
  assert.deepEqual(directoryLocation([room],[],[50,50],1).roomKeys,[]);
  assert.equal(directoryLocation([room],[{id:123,point:[2,2],halfWidth:1,halfHeight:1}],[3,2],.5).doorId,undefined);
});
