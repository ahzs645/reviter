import test from 'node:test';
import assert from 'node:assert/strict';
import {applySemanticDoorLinks,supportedSemanticDoorLinks} from '../lib/reviter/semantic-door-links.ts';
import {parseRoomDirectory,type RoomDirectoryData} from '../lib/reviter/room-directory.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const sha='a'.repeat(64),box=(x:number,y:number,w:number,h:number)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]] as [number,number][];
const data:RoomDirectoryData={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations:[{key:'office',levelId:1,name:'Office',number:'01-1',labelPointFeet:[3,-3],polygonFeet:box(0,-5,6,3.5),confidence:1},{key:'hall',levelId:1,name:'Corridor',number:'01-2',labelPointFeet:[3,3],polygonFeet:box(0,1.5,6,3.5),confidence:1}]};
const boundsFeet={min:{x:-2,y:-2,z:0},max:{x:8,y:2,z:10}};
const model={levels:[{levelId:1,elevation:0}],elementBounds:[{elementId:1,categoryId:-2000023,boundsFeet,orientedBox:[[1,-.1,0],[5,-.1,0],[5,.1,0],[1,.1,0]]},{elementId:2,categoryId:-2000011,boundsFeet,solid:{start:{x:-2,y:0},end:{x:8,y:0},thickness:3,baseElevation:0,topElevation:10}}],nativeAssociatedLevelRelations:[{elementId:1,levelId:1}],nativeHostRelations:[{elementId:1,hostId:2}],nativeIdentity:{identities:[{elementId:1,uniqueId:'native-door'}]}} as unknown as ConvertResult;
const input={sourceModelSha256:sha,exporter:'Revit test',rooms:[{roomKey:'office',nativeRoomUniqueId:'native-office',phaseUniqueId:'phase',levelId:1},{roomKey:'hall',nativeRoomUniqueId:'native-hall',phaseUniqueId:'phase',levelId:1}],doors:[{doorId:1,nativeDoorUniqueId:'native-door',phaseUniqueId:'phase',levelId:1,fromRoomKey:'office',toRoomKey:'hall',fromNativeRoomUniqueId:'native-office',toNativeRoomUniqueId:'native-hall'}]};
test('phase-specific door evidence requires native identity and actual threshold, and persists on regeneration',()=>{
 const result=applySemanticDoorLinks(model,data,sha,input);assert.equal(result.accepted,1);assert.equal(result.diagnostics.length,0);
 const saved=parseRoomDirectory(JSON.stringify(result.data));assert.equal(supportedSemanticDoorLinks(model,saved,sha,saved.navigation!.doorLinks).links.length,1);assert.deepEqual(saved.navigation!.doorLinks[0]!.semanticEvidence?.nativeDoorUniqueId,'native-door');
});
test('stale model, wrong phase, wrong native unique id and missing precise threshold cannot create portals',()=>{
 assert.throws(()=>applySemanticDoorLinks(model,data,'b'.repeat(64),input));
 for(const changed of [{...input,doors:[{...input.doors[0]!,phaseUniqueId:'demolished-phase'}]},{...input,doors:[{...input.doors[0]!,nativeDoorUniqueId:'other-door'}]}])assert.equal(applySemanticDoorLinks(model,data,sha,changed).accepted,0);
 assert.equal(applySemanticDoorLinks({...model,nativeHostRelations:[]},data,sha,input).accepted,0);
 const saved=applySemanticDoorLinks(model,data,sha,input).data;assert.equal(supportedSemanticDoorLinks(model,saved,'b'.repeat(64),saved.navigation!.doorLinks).links.length,0);
});
test('duplicate door rows and semantic rooms remote from native opening remain unresolved',()=>{
 assert.equal(applySemanticDoorLinks(model,data,sha,{...input,doors:[...input.doors,...input.doors]}).accepted,0);
 const remote=structuredClone(data);remote.annotations[0]!.polygonFeet=box(50,50,6,3.5);assert.equal(applySemanticDoorLinks(model,remote,sha,input).accepted,0);
 assert.equal(applySemanticDoorLinks({...model,nativeAssociatedLevelRelations:[]},data,sha,input).accepted,0);
});

test('semantic statements cannot connect two rooms on the same threshold side',()=>{
 const sameSide=structuredClone(data);sameSide.annotations[1]!.polygonFeet=box(0,-5,6,3.5);
 assert.equal(applySemanticDoorLinks(model,sameSide,sha,input).accepted,0);
});

test('malformed door rows produce review diagnostics rather than accepting metadata',()=>{
 const result=applySemanticDoorLinks(model,data,sha,{...input,doors:[null,{doorId:1,levelId:1}]});
 assert.equal(result.accepted,0);assert.equal(result.diagnostics.length,2);
});
