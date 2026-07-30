import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeRevit2027OppositeBoundarySamples,
} from "../lib/reviter/revit-2027-ruled-helix-owner-mesh.ts";

test("merges unequal opposite-edge sampling without losing persisted parameters", () => {
  assert.deepEqual(
    mergeRevit2027OppositeBoundarySamples(
      [0, 1],
      [0, 0.25, 0.5, 0.75, 1],
      0,
      1,
    ),
    [0, 0.25, 0.5, 0.75, 1],
  );
});

test("deduplicates tolerance-equivalent samples and retains exact endpoints", () => {
  assert.deepEqual(
    mergeRevit2027OppositeBoundarySamples(
      [1, 0],
      [0 + 1e-11, 0.5, 1 - 1e-11],
      0,
      1,
    ),
    [0, 0.5, 1],
  );
});

test("declines samples outside the certified trim interval", () => {
  assert.equal(
    mergeRevit2027OppositeBoundarySamples(
      [0, 1],
      [-0.1, 0.5, 1],
      0,
      1,
    ),
    null,
  );
});
