import assert from "node:assert/strict";
import test from "node:test";

import type {
  Revit2027TopRailCurveLoop,
  Revit2027TopRailCurveSegment,
  Revit2027TopRailTypeCurves,
} from "../lib/reviter/revit-2027-baluster-instances.ts";
import {
  meshRevit2027MeasuredSquareTopRail,
  REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET,
} from "../lib/reviter/revit-2027-top-rail-mesh.ts";

type Point3 = readonly [number, number, number];

function line(start: Point3, end: Point3): Revit2027TopRailCurveSegment {
  return {
    curve: {} as Revit2027TopRailCurveSegment["curve"],
    kind: "GLine",
    start,
    end,
  };
}

function loop(
  segments: readonly Revit2027TopRailCurveSegment[],
  persistedBoolean: boolean,
): Revit2027TopRailCurveLoop {
  return {
    curveLoopDescriptorOffset: 0,
    heightsOffset: 0,
    curveLoopBodyOffset: 0,
    persistedBoolean,
    segments,
  };
}

function curves(
  width = REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET,
  slope = 0,
): Revit2027TopRailTypeCurves {
  const top = 5;
  const end = top + slope;
  return {
    ownerElementId: 30,
    owningTopRailElementId: 29,
    curveLoopCount: 2,
    curveLoopSourceClassSlot: 3444,
    frameOffset: 0,
    frameEndOffset: 0,
    objectLength: 0,
    loops: [
      loop([
        line([0, 0, top], [10, 0, end]),
        line([10, 0, end], [10, width, end]),
      ], true),
      loop([
        line([0, 0, top], [0, width, top]),
        line([0, width, top], [10, width, end]),
      ], false),
    ],
    curveCount: 4,
    source: "TopRailType.m_curveLoopData.curves",
  };
}

test("closes a persisted edge pair with the measured square-section height", () => {
  const result = meshRevit2027MeasuredSquareTopRail(curves());
  assert.ok(result);
  assert.equal(result.boundarySegments, 4);
  assert.equal(result.triangles, 12);
  assert.equal(
    result.sectionWidthFeet,
    REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET,
  );
  assert.equal(result.sectionHeightFeet, result.sectionWidthFeet);
  assert.equal(result.mesh.indices.length, 36);
  assert.equal(Math.max(...result.mesh.positions), 10);
  const z = [...result.mesh.positions].filter((_, index) => index % 3 === 2);
  assert.equal(Math.max(...z), 5);
  assert.equal(
    Math.min(...z),
    5 - REVIT_2027_MEASURED_SQUARE_TOP_RAIL_SECTION_FEET,
  );
});

test("fails closed outside the measured flat GLine section family", () => {
  assert.equal(meshRevit2027MeasuredSquareTopRail(curves(0.2)), null);
  assert.equal(meshRevit2027MeasuredSquareTopRail(curves(undefined, 1)), null);
  const unsupported = curves();
  const first = unsupported.loops[0].segments[0]!;
  (first as { kind: string }).kind = "GArc";
  assert.equal(meshRevit2027MeasuredSquareTopRail(unsupported), null);
});
