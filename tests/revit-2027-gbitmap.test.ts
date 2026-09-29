import assert from "node:assert/strict";
import test from "node:test";
import { decodeRevitGBitmap, REVIT_GBITMAP_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gbitmap.ts";
import { createRevit2027GRepReplayRegistry, replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";

test("bitmap display metadata advances the FIFO without queuing invented solid geometry", () => {
  const bytes = new Uint8Array(60), v = new DataView(bytes.buffer);
  [1.5,-2,3].forEach((x,i) => v.setFloat64(20+i*8,x,true));
  v.setInt32(44,16,true); v.setInt32(48,24,true); v.setInt32(52,3,true); v.setInt32(56,2,true);
  const decoded = decodeRevitGBitmap(bytes,0,60,2027);
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.value.point,[1.5,-2,3]);
  assert.deepEqual(decoded.value.size,[16,24]);
  assert.equal(decoded.value.bitmapType,3); assert.equal(decoded.value.alignment,2);
  assert.ok(createRevit2027GRepReplayRegistry().has(REVIT_GBITMAP_SOURCE_CLASS_SLOT));
  const framed = new Uint8Array(66); framed.set(bytes, 6);
  const replay = replayRevit2027GRepFifo(framed, {
    frameOffset: 0, frameEndOffset: 50, dynamicPayloadOffset: 6, dynamicPayloadEndOffset: 66,
    ownerElementId: 1n, gInfo: {gStyleElementId:0n,tag:0,controlCommand:0,flags:0},
    children: [{byteOffset:0,endOffset:6,token:3,sourceClassSlot:REVIT_GBITMAP_SOURCE_CLASS_SLOT}],
    localExtents:{minimum:[0,0,0],maximum:[1,1,1],valid:true},
    worldExtents:{minimum:[0,0,0],maximum:[1,1,1],valid:true},objectType:3,flags:0,
  });
  assert.ok(replay.ok); assert.equal(replay.value.endOffset,66);
  assert.equal(replay.value.spans.length,1);
});

test("bitmap rejects truncated, oversized, nonfinite and negative-size bodies", () => {
  const bytes = new Uint8Array(61), v = new DataView(bytes.buffer);
  for(const end of [59,61]) assert.equal(decodeRevitGBitmap(bytes,0,end,2027).ok,false);
  v.setFloat64(20,NaN,true); assert.equal(decodeRevitGBitmap(bytes,0,60,2027).ok,false);
  v.setFloat64(20,0,true); v.setInt32(48,-1,true); assert.equal(decodeRevitGBitmap(bytes,0,60,2027).ok,false);
});
