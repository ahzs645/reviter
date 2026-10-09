import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {nativeFloorDifference,setNativeOverlayPrecisionRecorder} from '../lib/reviter/native-circulation-clearance.ts';
import {containsRoomPoint,type RoomPoint} from '../lib/reviter/room-directory.ts';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/native-overlay-machine-contact.json',import.meta.url),'utf8'));
const rect=(a:number,b:number,c:number,d:number):RoomPoint[]=>[[a,b],[c,b],[c,d],[a,d]];
const contains=(p:RoomPoint,parts:RoomPoint[][][])=>parts.some(g=>containsRoomPoint(p,g[0]!)&&!g.slice(1).some(h=>containsRoomPoint(p,h)));
test('the actual dual-engine native contact retries only bounded analytical noding and preserves original input coordinates',()=>{
 const before=JSON.stringify(fixture),events:number[]=[];const restore=setNativeOverlayPrecisionRecorder(e=>{if(e.gridFeet)events.push(e.gridFeet);});
 try{const result=nativeFloorDifference(fixture.subject,fixture.parts);assert.ok(result.length);assert.deepEqual(events,[1e-12]);assert.equal(JSON.stringify(fixture),before);assert.equal(contains([74,238],result),true);}finally{setNativeOverlayPrecisionRecorder(restore);}
});
test('analytical retry preserves a real narrow gap and a native hole while leaving the original point unsupported',()=>{
 const subject=structuredClone(fixture.subject),parts=structuredClone(fixture.parts);
 // The original replay has native free floor around this point. These two
 // independent additions ensure numerical noding cannot invent solid material.
 const gap=1e-10;parts.push([rect(73.2,237.2,74-gap/2,238.8)],[rect(74+gap/2,237.2,74.8,238.8)]);
 const result=nativeFloorDifference(subject,parts);assert.equal(contains([74,238],result),true);assert.equal(contains([73.5,238],result),false);
 const hole=rect(75-1e-6,238-1e-6,75+1e-6,238+1e-6);subject.push(hole);
 const withHole=nativeFloorDifference(subject,fixture.parts);assert.equal(contains([75,238],withHole),false);
 assert.deepEqual(subject.at(-1),hole);
});
