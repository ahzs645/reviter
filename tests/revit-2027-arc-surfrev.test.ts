import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRevit2027ArcSurfRev,
  evaluateRevit2027GArc,
  tessellateRevit2027ArcSurfRev,
} from "../lib/reviter/revit-2027-arc-surfrev.ts";
import type { Revit2027GArc } from "../lib/reviter/revit-2027-garc.ts";
import type { Revit2027SurfaceOfRevolution } from "../lib/reviter/revit-2027-surfaces.ts";

const surface: Revit2027SurfaceOfRevolution = {
  kind: "surface-of-revolution",
  sourceClassSlot: 4283,
  byteOffset: 0,
  endOffset: 0,
  surface: {
    envelope: {
      firstCorner: [0, 0],
      secondCorner: [Math.PI / 2, Math.PI],
    },
    orientFlag: true,
  },
  center: [0, 0.03937007874015251, -0.20669291338583545],
  xVector: [0, -1, 0],
  yVector: [0, 0, -1],
  zVector: [1, 0, 0],
  profileCurve: {
    byteOffset: 0,
    endOffset: 0,
    token: 57,
    sourceClassSlot: 2213,
  },
  queuedProperties: [],
};

const profile: Revit2027GArc = {
  byteOffset: 0,
  endOffset: 117,
  gInfo: {
    gStyleElementId: 0n,
    tag: 0,
    controlCommand: 0,
    flags: 0,
  },
  endParameters: [0, Math.PI],
  xDirection: [0, 0, 1],
  yDirection: [-1, 0, 0],
  radius: 0.01968503937007874,
  center: [0.03937007874017287, 0, 0],
  isFilled: false,
};

function near(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-12,
): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= tolerance,
      `${actual[index]} differs from ${expected[index]}`,
    );
  }
}

test("evaluates the native GArc construction convention", () => {
  near(evaluateRevit2027GArc(profile, 0), [
    0.03937007874017287,
    0,
    0.01968503937007874,
  ]);
  near(evaluateRevit2027GArc(profile, Math.PI / 2), [
    0.01968503937009413,
    0,
    0,
  ]);
});

test("evaluates persisted SurfRev UV as revolution angle then profile parameter", () => {
  near(evaluateRevit2027ArcSurfRev(surface, profile, [0, 0]), [
    0.01968503937007874,
    -2.0365653607967715e-14,
    -0.20669291338583545,
  ]);
  near(
    evaluateRevit2027ArcSurfRev(surface, profile, [Math.PI / 2, 0]),
    [
      0.01968503937007874,
      0.039370078740152506,
      -0.24606299212600832,
    ],
  );
});

test("tessellates the certified rectangular circular-profile subset", () => {
  const result = tessellateRevit2027ArcSurfRev({
    surface,
    profile,
    minimumUv: [0, 0],
    maximumUv: [Math.PI / 2, Math.PI],
    revolutionSegments: 2,
    profileSegments: 12,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mesh.positions.length, 3 * 3 * 13);
  assert.equal(result.mesh.normals.length, 3 * 3 * 13);
  assert.equal(result.mesh.uvs.length, 2 * 3 * 13);
  assert.equal(result.mesh.indices.length, 2 * 12 * 6);
  for (let index = 0; index < result.mesh.normals.length; index += 3) {
    near(
      [Math.hypot(
        result.mesh.normals[index]!,
        result.mesh.normals[index + 1]!,
        result.mesh.normals[index + 2]!,
      )],
      [1],
    );
  }
});

test("fails closed when trim and persisted intervals disagree", () => {
  const result = tessellateRevit2027ArcSurfRev({
    surface,
    profile,
    minimumUv: [0, 0],
    maximumUv: [Math.PI / 2, Math.PI / 2],
    revolutionSegments: 2,
    profileSegments: 6,
  });
  assert.deepEqual(result, {
    ok: false,
    error: "certified trim does not match the persisted SurfRev envelope",
  });
});
