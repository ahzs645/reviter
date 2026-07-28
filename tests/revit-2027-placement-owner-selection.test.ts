import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRevit2027PlacementGeometryTargetIds,
  selectRevit2027PlacementGeometry,
} from "../scripts/revit-2027-placement-owner-selection.ts";

test("placement targets are unique, safe, and exclude completed direct owners", () => {
  const targets = collectRevit2027PlacementGeometryTargetIds(
    [
      { geometryId: 11 },
      { geometryId: 12 },
      { geometryId: 12 },
      { geometryId: Number.MAX_SAFE_INTEGER + 1 },
    ],
    new Set([11n]),
  );

  assert.deepEqual([...targets], [12]);
});

test("direct nested roots require a complete composition", () => {
  const selection = selectRevit2027PlacementGeometry(
    20,
    new Set([20]),
    new Map([[20, "unsafe-direct-fragment"]]),
    new Map<number, string>(),
    new Map([[20, "unsafe-referenced-fragment"]]),
  );

  assert.equal(selection, undefined);
});

test("selection distinguishes direct and complete referenced owners", () => {
  assert.deepEqual(
    selectRevit2027PlacementGeometry(
      30,
      new Set(),
      new Map([[30, "direct"]]),
      new Map(),
      new Map([[30, "referenced"]]),
    ),
    { geometry: "direct", source: "direct-owner" },
  );
  assert.deepEqual(
    selectRevit2027PlacementGeometry(
      31,
      new Set(),
      new Map(),
      new Map(),
      new Map([[31, "referenced"]]),
    ),
    { geometry: "referenced", source: "composed-referenced-owner" },
  );
});
