import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeStairLandingContact} from '../lib/reviter/native-stair-landing-contact.ts';
import type {ArchitecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
import type {ConvertResult,ElementBoundsRecord} from '../lib/reviter/types.ts';
import type {DirectoryRoom,RoomPoint} from '../lib/reviter/room-directory.ts';
const box=(x:number,y:number,w:number,h:number):RoomPoint[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const landing:DirectoryRoom={key:'landing',number:'B-S101',name:'Stair',levelId:1,polygonFeet:box(-4,0,4,3),labelPointFeet:[-2,1.5],confidence:1,stairFlightIds:[100]};
const model={levels:[{levelId:1,elevation:0},{levelId:2,elevation:10}]} as ConvertResult;
const runs=[{elementId:101,stairTreads:[box(0,0,1,3).map(p=>[...p,.5]),box(1,0,1,3).map(p=>[...p,10])]}] as ElementBoundsRecord[];
const geometry:ArchitecturalPlanGeometry={walls:[],columns:[],doors:[],floors:[[box(-4,0,4,3)]],cutElevation:4};
test('explicit native landing can contact terminal cap without filling any tread or void',()=>{
 const before=JSON.stringify([model,landing,runs,geometry]);assert(nativeStairLandingContact(model,landing,100,runs,'bottom',geometry));assert.equal(JSON.stringify([model,landing,runs,geometry]),before);
 const upper={...landing,key:'upper',levelId:2,polygonFeet:box(2,0,4,3),labelPointFeet:[4,1.5] as RoomPoint};assert(nativeStairLandingContact(model,upper,100,runs,'top',{...geometry,floors:[[upper.polygonFeet]]}));
});
test('nearby metadata, wrong assembly, wrong tread side and insufficient cap width cannot certify contact',()=>{
 assert(!nativeStairLandingContact(model,{...landing,stairFlightIds:undefined},100,runs,'bottom',geometry));
 assert(!nativeStairLandingContact(model,landing,101,runs,'bottom',geometry));
 assert(!nativeStairLandingContact(model,{...landing,polygonFeet:box(-4,-3,5,3),labelPointFeet:[-2,-1.5]},100,runs,'bottom',{...geometry,floors:[[box(-4,-3,5,3)]]}));
 const small={...landing,polygonFeet:box(-4,0,4,.4),labelPointFeet:[-2,.2] as RoomPoint};assert(!nativeStairLandingContact(model,small,100,runs,'bottom',{...geometry,floors:[[small.polygonFeet]]}));
 const gap={...landing,polygonFeet:box(-4,0,3.99,3)};assert(!nativeStairLandingContact(model,gap,100,runs,'bottom',geometry));
});
test('source slab holes, barriers, outside seed and missing physical terminal remain blocked',()=>{
 assert(!nativeStairLandingContact(model,landing,100,runs,'bottom',{...geometry,floors:[[geometry.floors[0]![0]!,box(-3,1,1,1)]]}));
 for(const category of ['walls','columns'] as const)assert(!nativeStairLandingContact(model,landing,100,runs,'bottom',{...geometry,[category]:[{elementId:900,polygon:box(-3,0,1,3),approximate:false}]}));
 assert(!nativeStairLandingContact(model,{...landing,labelPointFeet:[8,8]},100,runs,'bottom',geometry));
 assert(!nativeStairLandingContact(model,landing,100,[{...runs[0]!,stairTreads:runs[0]!.stairTreads!.map(t=>t.map(p=>[p[0],p[1],p[2]+2])) as ElementBoundsRecord['stairTreads']}], 'bottom',geometry));
});

test('missing persisted level membership cannot certify a landing or throw during directory routing',()=>{
 const incomplete={...model,elementBounds:runs};assert.equal(nativeStairLandingContact(incomplete,landing,100,runs,'bottom'),false);
});
