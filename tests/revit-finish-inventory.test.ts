import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRevitFinishInventory } from '../lib/reviter/revit-finish-inventory.ts';
import type { RoomDirectoryData } from '../lib/reviter/room-directory.ts';
const rect = (x: number, y: number, width = 10): [number, number][] => [[x,y],[x+width,y],[x+width,y+width],[x,y+width]];
const setup = () => {
  const sha = 'a'.repeat(64);
  const directory = { annotations: [{key:'a',levelId:311,polygonFeet:rect(0,0),labelPointFeet:[5,5]}, {key:'b',levelId:311,polygonFeet:rect(10,0),labelPointFeet:[15,5]}] } as unknown as RoomDirectoryData;
  const inventory = { format:'reviter-revit-finish-inventory',version:1,sourceModelSha256:sha,units:'feet',coordinateSystem:'revit-internal',boundaryLocation:'finish',exporter:'Revit fixture',rooms:[
    {nativeRoomUniqueId:'native-a',phaseUniqueId:'phase',elevationFeet:0,ringsFeet:[rect(1,1,1),rect(0,0)],boundaryElementIds:[1,2,3,4]},
    {nativeRoomUniqueId:'native-b',phaseUniqueId:'phase',elevationFeet:0,ringsFeet:[rect(10,0)],boundaryElementIds:[5,6,7,8]}
  ],doors:[{doorId:10,nativeDoorUniqueId:'door-10',phaseUniqueId:'phase',fromNativeRoomUniqueId:'native-a',toNativeRoomUniqueId:'native-b'}] };
  const mapping = {version:1,sourceModelSha256:sha,rooms:[{roomKey:'a',nativeRoomUniqueId:'native-a',phaseUniqueId:'phase',levelId:311},{roomKey:'b',nativeRoomUniqueId:'native-b',phaseUniqueId:'phase',levelId:311}]};
  return {sha,directory,inventory,mapping};
};
test('explicit Finish inventory mapping preserves holes and phase-specific native door evidence without changing annotations', () => {
  const {sha,directory,inventory,mapping}=setup(),before=JSON.stringify(directory);
  const result=mapRevitFinishInventory(inventory,mapping,directory,sha);
  assert.equal(result.mappedRooms,2);assert.equal(result.mappedDoors,1);assert.equal(result.diagnostics.length,0);
  assert.deepEqual(result.input.rooms[0]!.ringsFeet,[rect(0,0),rect(1,1,1)]);
  assert.equal(result.input.doors[0]!.fromNativeRoomUniqueId,'native-a');assert.equal(JSON.stringify(directory),before);
});
test('wrong source digest or coordinate convention cannot create a semantic export', () => {
  const {sha,directory,inventory,mapping}=setup();
  for(const patch of [{sourceModelSha256:'b'.repeat(64)},{units:'metres'},{coordinateSystem:'shared'},{boundaryLocation:'center'}])assert.throws(()=>mapRevitFinishInventory({...inventory,...patch},mapping,directory,sha));
  assert.throws(()=>mapRevitFinishInventory(inventory,{...mapping,sourceModelSha256:'b'.repeat(64)},directory,sha));
});
test('duplicate room keys, phases and wrong floors never guess annotation mapping from room names', () => {
  const {sha,directory,inventory,mapping}=setup();
  for(const patch of [{phaseUniqueId:'other'},{levelId:999},{roomKey:'missing'}])assert.equal(mapRevitFinishInventory(inventory,{...mapping,rooms:[{...mapping.rooms[0]!,...patch}]},directory,sha).mappedRooms,0);
  assert.equal(mapRevitFinishInventory(inventory,{...mapping,rooms:[mapping.rooms[0]!,mapping.rooms[0]!]},directory,sha).mappedRooms,0);
});
test('disconnected and unenclosed native rooms are diagnosed rather than represented by boxes', () => {
  const {sha,directory,inventory,mapping}=setup();
  for(const ringsFeet of [[],[rect(0,0),rect(20,20)]]) {
    const input={...inventory,rooms:[{...inventory.rooms[0]!,ringsFeet}]};
    const result=mapRevitFinishInventory(input,{...mapping,rooms:[mapping.rooms[0]!]},directory,sha);
    assert.equal(result.mappedRooms,0);assert.ok(result.diagnostics.some(d=>d.code==='inventory-room-mapping'));
  }
});
test('exterior and wrong-phase doors remain unresolved and cannot infer room connections', () => {
  const {sha,directory,inventory,mapping}=setup();
  for(const patch of [{toNativeRoomUniqueId:null},{phaseUniqueId:'other'},{toNativeRoomUniqueId:'native-a'}])assert.equal(mapRevitFinishInventory({...inventory,doors:[{...inventory.doors[0]!,...patch}]},mapping,directory,sha).mappedDoors,0);
});
