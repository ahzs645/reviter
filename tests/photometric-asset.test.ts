import assert from "node:assert/strict";
import test from "node:test";
import { addPhotometricAssetReaders } from "../lib/reviter/photometric-asset.ts";
import type { Revit2027GRepReplayReaderContext, Revit2027GRepReplayReaderRegistration } from "../lib/reviter/revit-2027-grep-replay.ts";

const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const string = (value: string) => Buffer.concat([u32(value.length), Buffer.from(value, "utf16le")]);
const nullRef = Buffer.alloc(4);
function context(end: number): Revit2027GRepReplayReaderContext {
  return { byteOffset: 0, replayEndOffset: end, revitVersion: 2027, ownerElementId: 1n, replayIndex: 0, queueSequence: 0, path: [], parentReplayIndex: null, propertyToken: -1, scopedSourceClassSlot: 425, descriptorOffset: 0, descriptorEndOffset: 6 };
}
function readers() { const result = new Map<number, Revit2027GRepReplayReaderRegistration>(); addPhotometricAssetReaders(result); return result; }

test("photometric asset keeps typed FIFO properties and respects the enclosing boundary", () => {
  const property = Buffer.alloc(6); property.writeInt32LE(-1); property.writeUInt16LE(44,4);
  const data = Buffer.concat([string("GenericPhotometricLight"),nullRef,u32(0),u32(1),property,string("assetlibrary_base.fbx"),string(""),nullRef,u32(3)]);
  const reader = readers().get(425)!;
  const result = reader.read(data,context(data.length));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) { assert.equal(result.endOffset,data.length); assert.equal(result.appendedProperties[1]!.sourceClassSlot,44); }
  assert.equal(reader.read(data,context(data.length-1)).ok,false);
  const bad = Buffer.from(data);bad.writeUInt32LE(9,bad.length-4);
  assert.equal(reader.read(bad,context(bad.length)).ok,false);
  const unknown = Buffer.concat([string("OtherAsset"),nullRef,u32(0)]);
  assert.equal(reader.read(unknown,context(unknown.length)).ok,false);
});

test("photometric scalar readers reject invalid values and connected references", () => {
  const data = Buffer.concat([string("on"),nullRef,u32(0),Buffer.from([1])]);
  const reader = readers().get(44)!;
  assert.equal(reader.read(data,context(data.length)).ok,true);
  data[data.length-1]=2;
  assert.equal(reader.read(data,context(data.length)).ok,false);
  data[data.length-1]=1;data.writeInt32LE(1,8);
  assert.equal(reader.read(data,context(data.length)).ok,false);
});
