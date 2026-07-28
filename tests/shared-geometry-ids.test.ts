import assert from "node:assert/strict";
import test from "node:test";

import {
  sharedGeometryIdsForPlacements,
  type InstancePlacement,
} from "../lib/reviter/instanced-geometry.ts";

function placement(elementId: number, geometryId: number): InstancePlacement {
  return {
    elementId,
    geometryId,
    symbolId: geometryId,
    basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    origin: [0, 0, 0],
  };
}

test("ordinary placement symbol ids remain reusable geometry ids", () => {
  const ids = sharedGeometryIdsForPlacements(
    [placement(100, 200), placement(101, 200), placement(102, 201)],
    new Map([[100, -2_000_023]]),
  );
  assert.deepEqual([...ids].sort((a, b) => a - b), [200, 201]);
});

test("a stair assembly's symbol id remains a drawable subelement", () => {
  const ids = sharedGeometryIdsForPlacements(
    [placement(1_271_877, 1_272_040), placement(1_280_525, 1_280_585)],
    new Map([
      [1_271_877, -2_000_120],
      [1_280_525, -2_000_120],
    ]),
  );
  assert.deepEqual([...ids], []);
});
