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
