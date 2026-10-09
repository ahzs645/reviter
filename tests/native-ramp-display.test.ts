import test from "node:test";
import assert from "node:assert/strict";
import { prepareNativeRampDisplay } from "../lib/reviter/native-ramp-display.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
test("exact owner-tagged ramps survive regeneration without authorizing a route or including helpers", () => {
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    elementBounds: [
      {
        elementId: 100,
        categoryId: -2000180,
        renderGeometryProvenance: "native",
      },
      {
        elementId: 101,
        categoryId: -2000180,
        renderGeometryProvenance: "not-rendered-helper",
      },
    ],
    meshes: [
      {
        source: "native-brep",
        elementIds: [100],
        positions: [0, 0, 0, 10, 0, 3, 10, 4, 3],
        indices: [0, 1, 2],
      },
    ],
  } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: "a".repeat(64) },
    nativeLevels: [
      { id: 1, elevationFeet: 0 },
      { id: 2, elevationFeet: 3 },
    ],
    records: [],
    nodes: [],
    edges: [],
  } as unknown as IndoorDataset;
  prepareNativeRampDisplay(model, data);
  assert.equal(data.rampDisplay!.ramps.length, 1);
  assert.equal(data.rampDisplay!.ramps[0]!.nativeElementId, 100);
  assert.equal(data.rampDisplay!.ramps[0]!.displayOnly, true);
  assert.deepEqual(data.rampDisplay!.ramps[0]!.levelIds, [1, 2]);
  assert.equal(data.nodes.length, 0);
  assert.equal(data.edges.length, 0);
  prepareNativeRampDisplay(model, data);
  assert.equal(data.rampDisplay!.ramps.length, 1);
});

test("display wall clipping preserves reviewed original face inventory and indices", () => {
  const original: [number,number,number][][] = [[[0,0,0],[10,0,3],[10,4,3]]];
  const model = {origin:{x:0,y:0,z:0},elementBounds:[
    {elementId:100,categoryId:-2000180,renderGeometryProvenance:"native"},
    {elementId:200,categoryId:-2000011,boundsFeet:{min:{x:4,y:-1,z:0},max:{x:6,y:5,z:4}},solid:{elementId:200,start:{x:5,y:-1},end:{x:5,y:5},thickness:2,baseElevation:0,topElevation:4}},
  ],meshes:[{source:"native-brep",elementIds:[100],positions:original.flat(2),indices:[0,1,2]}]} as unknown as ConvertResult;
  const data={source:{modelSha256:"a".repeat(64)},nativeLevels:[{id:1,elevationFeet:0},{id:2,elevationFeet:3}],records:[],nodes:[],edges:[],rampDisplay:{version:1,sourceModelSha256:"a".repeat(64),ramps:[{edgeId:"ramp:100",nativeElementId:100,levelIds:[1,2],anchorPointFeet:[5,2,1.5],trianglesFeet:structuredClone(original)}]}} as unknown as IndoorDataset;
  prepareNativeRampDisplay(model,data);
  const ramp=data.rampDisplay!.ramps[0]!;
  assert.deepEqual(ramp.trianglesFeet,original);
  assert.ok(ramp.displayTrianglesFeet?.length);
  assert.notDeepEqual(ramp.displayTrianglesFeet,original);
  assert.equal(data.edges.length,0);
});
