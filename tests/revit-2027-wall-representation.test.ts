import assert from "node:assert/strict";
import test from "node:test";
import { wallModelFaceTokens } from "../lib/reviter/revit-2027-wall-representation.ts";
import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT as G } from "../lib/reviter/revit-2027-grep-prefixes.ts";
import { REVIT_2027_GFILTER_SOURCE_CLASS_SLOT as F } from "../lib/reviter/revit-2027-gfilter.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT as B, type Revit2027GeometryStatic } from "../lib/reviter/revit-2027-geometry.ts";
import type { Revit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import type { Revit2027GRepReplay } from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture() {
  const gInfo = {gStyleElementId:0n,tag:0,controlCommand:0,flags:0};
  const extents = {minimum:[0,0,0] as const,maximum:[1,1,1] as const,valid:true};
  const root: Revit2027FramedGRepRoot = {frameOffset:0,frameEndOffset:984,dynamicPayloadOffset:100,dynamicPayloadEndOffset:1000,ownerElementId:1n,gInfo,localExtents:extents,worldExtents:extents,objectType:3,flags:0,
    children:[G,G,F,G,F,F,G,B].map((sourceClassSlot,i)=>({byteOffset:i*6,endOffset:i*6+6,token:i+3,sourceClassSlot}))};
  const paths = [[0,0],[1,0],[2,0,0],[3,0],[4,0,0],[5,0,0],[6,0],[7]];
  const collection = (count: number, start: number) => ({countOffset:0,entriesOffset:4,endOffset:4+count*6,count,entries:Array.from({length:count},(_,i)=>({byteOffset:4+i*6,endOffset:10+i*6,token:start+i,sourceClassSlot:B}))});
  const replay: Revit2027GRepReplay = {ownerElementId:1n,startOffset:100,endOffset:1000,initialTokenCount:3,finalTokenCount:100,descriptors:[],spans:paths.map((path,i)=>({replayIndex:i,queueSequence:i,ownerElementId:1n,path,parentPath:null,parentReplayIndex:null,propertyToken:i+3,propertySourceClassSlot:B,descriptorOffset:0,descriptorEndOffset:6,startOffset:100+i*60,endOffset:160+i*60,readerId:'Geometry',
    value:{byteOffset:100+i*60,endOffset:160+i*60,gInfo,faces:collection(i===7?6:1,i===7?50:20+i),edges:collection(i===7?12:4,100),sharedSurfaceInfo:collection(0,0),flags:0,geometryTag:0,tessEpsCntrl:{type:0,version:1},queuedProperties:[]} satisfies Revit2027GeometryStatic}))};
  return {root,replay};
}

test("wall view drawings do not join the model body's face set", () => {
  const {root,replay} = fixture();
  assert.deepEqual([...wallModelFaceTokens(root,replay)!],[50,51,52,53,54,55]);
  assert.equal(wallModelFaceTokens({...root,flags:2},replay),null);
  assert.equal(wallModelFaceTokens({...root,children:root.children.slice(1)},replay),null);
  assert.equal(wallModelFaceTokens(root,{...replay,endOffset:999}),null);
  (replay.spans[0]!.value as Revit2027GeometryStatic).faces.count=2;
  assert.equal(wallModelFaceTokens(root,replay),null,"a second solid cannot be dismissed as a single-face view drawing");
});
