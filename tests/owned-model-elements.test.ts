import assert from "node:assert/strict";
import test from "node:test";
import {
  appendOwnedNativeRecords,
  physicalModelCategory,
  heldNativeWrapperIds,
} from "../lib/reviter/owned-model-elements.ts";
import type { ElementBoundsRecord, MeshData } from "../lib/reviter/types.ts";

test("physical ownership requires both the model class and its own matching category", () => {
  assert.equal(physicalModelCategory(4298, -2001392), -2001392);
  assert.equal(physicalModelCategory(4298, -2000035), null);
  assert.equal(physicalModelCategory(123, -2001392), null);
  assert.equal(physicalModelCategory(4298, undefined), null);
});

test("a physical wall needs an owned facade child before its native body is hidden as a wrapper", () => {
  const record = (elementId: number, categoryId: number): ElementBoundsRecord => ({elementId,categoryId,stream:"test",chunkIndex:0,rawOffset:0,recordOffset:0,boundsFeet:{min:{x:0,y:0,z:0},max:{x:1,y:1,z:1}}});
  const wrappers = [record(1,-2000011),record(2,-2000011),record(3,-2000035)];
  const records = [...wrappers,record(4,-2000171),record(5,-2001040)];
  const held = heldNativeWrapperIds(wrappers,records,new Map([[1,-2000011],[2,-2000011]]),[{ownerId:1,elementId:5},{ownerId:2,elementId:4}]);
  assert.deepEqual([...held],[2,3]);
});
test("missing physical records are created only from their admitted triangle bounds", () => {
  const records: ElementBoundsRecord[] = [];
  const mesh: MeshData = {
    name: "native",
    materialIndex: 0,
    source: "native-brep",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 2, 999, 999, 999]),
    colors: new Float32Array(12),
    indices: new Uint32Array([0, 1, 2]),
    elementIds: new Uint32Array([7]),
  };
  const proof = new Map([
    [7, -2001392],
    [8, -2001392],
  ]);
  appendOwnedNativeRecords(records, [mesh], { x: 10, y: 20, z: 30 }, proof);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.elementId, 7);
  assert.equal(records[0]!.categoryName, "Slab Edges");
  assert.equal(records[0]!.boundsFromNativeMesh, true);
  assert.deepEqual(records[0]!.boundsFeet, {
    min: { x: 10, y: 20, z: 30 },
    max: { x: 11, y: 21, z: 32 },
  });
  appendOwnedNativeRecords(records, [mesh], { x: 0, y: 0, z: 0 }, proof);
  assert.equal(records.length, 1);
});
