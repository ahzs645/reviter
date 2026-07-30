import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
  type Revit2027GCylindricalHelix,
} from "../lib/reviter/revit-2027-gcylindrical-helix.ts";
import type { Revit2027GRepReplay } from "../lib/reviter/revit-2027-grep-replay.ts";
import { meshRevit2027SpiralStairReplay } from "../lib/reviter/revit-2027-spiral-stair-mesh.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "../lib/reviter/revit-2027-stairs-aggregate.ts";

function helix(radius: number): Revit2027GCylindricalHelix {
  return {
    byteOffset: 0,
    endOffset: 148,
    gInfo: {
      gStyleElementId: -1n,
      tag: 0,
      controlCommand: 0,
      flags: 0,
    },
    endParameters: [0, Math.PI / 2],
    radius,
    pitchOver2Pi: 2 / Math.PI,
    basePoint: [0, 0, 1],
    xVector: [1, 0, 0],
    yVector: [0, 1, 0],
    zVector: [0, 0, 1],
  };
}

test("meshes exact-count annular treads from run scalars and helix guides", () => {
  const replay = {
    ownerElementId: 42n,
    spans: [helix(2), helix(5)].map((value, replayIndex) => ({
      replayIndex,
      parentReplayIndex: null,
      propertySourceClassSlot:
        REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
      value,
    })),
  } as unknown as Revit2027GRepReplay;
  const run = {
    elementId: 42,
    baseRiserIndex: 0,
    runProperties: {
      bottomElevationFeet: 0,
      topElevationFeet: 2,
      extendBelowBaseFeet: 0,
      extendBelowTreadBaseFeet: 0,
      actualRunWidthFeet: 3,
      leftStringerWidthFeet: 0.1,
      rightStringerWidthFeet: 0.1,
      topRiserIndex: 2,
      centerMarkVisible: true,
      beginWithRiser: true,
      endWithRiser: false,
    },
  } as Revit2027StairsRunAndLandingAggregate;

  const result = meshRevit2027SpiralStairReplay(replay, run);
  assert.ok(result);
  assert.equal(result.treadCount, 2);
  assert.equal(result.mesh.groups.length, 1);
  assert.ok(result.mesh.indices.length > 0);
  const elevations = Array.from(
    { length: result.mesh.positions.length / 3 },
    (_, index) => result.mesh.positions[index * 3 + 2]!,
  );
  assert.equal(Math.min(...elevations), 0);
  assert.equal(Math.max(...elevations), 2);
});

test("declines mismatched run width instead of inventing a spiral", () => {
  const replay = {
    ownerElementId: 42n,
    spans: [helix(2), helix(5)].map((value, replayIndex) => ({
      replayIndex,
      parentReplayIndex: null,
      propertySourceClassSlot:
        REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
      value,
    })),
  } as unknown as Revit2027GRepReplay;
  const run = {
    elementId: 42,
    baseRiserIndex: 0,
    runProperties: {
      bottomElevationFeet: 0,
      topElevationFeet: 2,
      actualRunWidthFeet: 4,
      topRiserIndex: 2,
    },
  } as Revit2027StairsRunAndLandingAggregate;
  assert.equal(meshRevit2027SpiralStairReplay(replay, run), null);
});
