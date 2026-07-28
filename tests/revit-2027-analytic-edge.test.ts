import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRevit2027AnalyticSurfacePoint,
  evaluateRevit2027GEdgeLineSegment,
} from "../lib/reviter/revit-2027-analytic-edge.ts";
import type { Revit2027GEdgeStatic } from "../lib/reviter/revit-2027-edge-1423.ts";
import type { Revit2027GArc } from "../lib/reviter/revit-2027-garc.ts";
import type {
  Revit2027AnalyticSurface,
  Revit2027SurfaceBase,
} from "../lib/reviter/revit-2027-surfaces.ts";

const base: Revit2027SurfaceBase = {
  envelope: { firstCorner: [0, 0], secondCorner: [10, 10] },
  orientFlag: true,
};

function common(sourceClassSlot: number) {
  return {
    byteOffset: 0,
    endOffset: 0,
    sourceClassSlot,
    surface: base,
    queuedProperties: [],
  };
}

const plane: Revit2027AnalyticSurface = {
  ...common(634),
  kind: "plane",
  sourceClassSlot: 634,
  origin: [10, 20, 30],
  xVector: [1, 0, 0],
  yVector: [0, 2, 0],
};

const cylinder: Revit2027AnalyticSurface = {
  ...common(1144),
  kind: "cylinder",
  sourceClassSlot: 1144,
  center: [1, 2, 3],
  xVector: [1, 0, 0],
  yVector: [0, 1, 0],
  zVector: [0, 0, 1],
  radius: 2,
};

const cone: Revit2027AnalyticSurface = {
  ...common(900),
  kind: "cone",
  sourceClassSlot: 900,
  center: [0, 0, 0],
  xVector: [1, 0, 0],
  yVector: [0, 1, 0],
  zVector: [0, 0, 1],
  halfAngle: Math.PI / 4,
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
  xDirection: [1, 0, 0],
  yDirection: [0, 0, 1],
  radius: 1,
  center: [2, 0, 0],
  isFilled: false,
};

const surfRev: Revit2027AnalyticSurface = {
  ...common(4283),
  kind: "surface-of-revolution",
  sourceClassSlot: 4283,
  center: [10, 20, 30],
  xVector: [1, 0, 0],
  yVector: [0, 1, 0],
  zVector: [0, 0, 1],
  profileCurve: {
    token: -1,
    sourceClassSlot: 2213,
    byteOffset: 0,
    endOffset: 6,
  },
};

test("evaluates all decoded Revit 2027 analytic surface kinds", () => {
  assert.deepEqual(
    evaluateRevit2027AnalyticSurfacePoint(plane, [2, 3]),
    { ok: true, point: [12, 26, 30] },
  );
  assert.deepEqual(
    evaluateRevit2027AnalyticSurfacePoint(cylinder, [0, 4]),
    { ok: true, point: [3, 2, 7] },
  );
  const conePoint = evaluateRevit2027AnalyticSurfacePoint(
    cone,
    [0, Math.SQRT2],
  );
  assert.equal(conePoint.ok, true);
  if (conePoint.ok) {
    assert.ok(Math.abs(conePoint.point[0] - 1) < 1e-12);
    assert.ok(Math.abs(conePoint.point[2] - 1) < 1e-12);
  }
  assert.deepEqual(
    evaluateRevit2027AnalyticSurfacePoint(surfRev, [Math.PI / 2, 0], profile),
    { ok: true, point: [10, 23, 30] },
  );
  assert.equal(
    evaluateRevit2027AnalyticSurfacePoint(surfRev, [0, 0]).ok,
    false,
  );
});

test("reconstructs a native two-point GEdge line without coedge reversal", () => {
  const point = (
    firstFaceUv: readonly [number, number],
  ) => ({
    firstFaceUv,
    secondFaceUv: [0, 0] as const,
  });
  const edge = {
    faceReferences: [7, 0],
    firstAndLastEdgePoints: [point([0, 0]), point([2, 3])],
    interiorEdgePoints: [],
    flags: 0x6,
  } as Pick<
    Revit2027GEdgeStatic,
    | "faceReferences"
    | "firstAndLastEdgePoints"
    | "interiorEdgePoints"
    | "flags"
  >;
  assert.deepEqual(
    evaluateRevit2027GEdgeLineSegment(edge, 7, 0, plane),
    {
      ok: true,
      start: [10, 20, 30],
      end: [12, 26, 30],
    },
  );
  assert.equal(
    evaluateRevit2027GEdgeLineSegment(edge, 8, 0, plane).ok,
    false,
  );
  assert.equal(
    evaluateRevit2027GEdgeLineSegment(
      { ...edge, interiorEdgePoints: [point([1, 1])] },
      7,
      0,
      plane,
    ).ok,
    false,
  );
});
