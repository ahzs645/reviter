import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { inspectOriginalStairLocalMaterialCells } from "../lib/reviter/native-source-stair-local-material.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import type { Revit2027PlaneSurface } from "../lib/reviter/revit-2027-surfaces.ts";
const fixture = readFileSync(
  new URL("./fixtures/native-planar-landing-1514133.bin", import.meta.url),
);
function replay() {
  const root = decodeRevit2027FramedGRepRoot(
    fixture,
    {
      offset: 0,
      elementId: 1514133,
      marker: 2246,
      objectLength: fixture.length - 20,
      typeCode: fixture.readUInt32LE(18),
    },
    2027,
  );
  assert.ok(root.ok);
  const r = replayRevit2027GRepFifo(fixture, root.value);
  assert.ok(r.ok);
  return r.value;
}
test("all original cap and side source domains remain in explicit height-localized cells", () => {
  const source = replay(),
    r = inspectOriginalStairLocalMaterialCells(source);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.allOriginalFaceDomainsEnclosed, true);
  assert.equal(r.cells.filter((c) => c.role === "cap-bounded-core").length, 1);
  assert.equal(r.cells.flatMap((c) => c.originalFaceTokens).length, 9);
  assert.equal(r.exactPhysicalBodyApproved, false);
  assert.equal(r.routeApproved, false);
});
test("positive high side-UV residual stays in its boundary cell and never raises the entire cap core", () => {
  const source = replay(),
    base = inspectOriginalStairLocalMaterialCells(source),
    core = base.cells.find((c) => c.role === "cap-bounded-core")!,
    top = core.originalFaceTokens[1]!;
  const edge = source.spans.find(
    (s) =>
      s.readerId === "Revit2027GEdge" &&
      (s.value as { faceReferences: number[] }).faceReferences.includes(top),
  )!.value as {
    faceReferences: number[];
    firstAndLastEdgePoints: { firstFaceUv: number[]; secondFaceUv: number[] }[];
  };
  const sideIndex = edge.faceReferences[0] === top ? 1 : 0,
    sideFace = edge.faceReferences[sideIndex]!,
    planeSpan = source.spans.find(
      (s) =>
        s.readerId === "Revit2027AnalyticSurface:634" &&
        s.parentReplayIndex !== null &&
        source.spans[s.parentReplayIndex]?.propertyToken === sideFace,
    )!,
    plane = planeSpan.value as Revit2027PlaneSurface;
  const axis = plane.xVector[2] !== 0 ? 0 : 1,
    endpoint = edge.firstAndLastEdgePoints[0]!,
    uv = sideIndex === 0 ? endpoint.firstFaceUv : endpoint.secondFaceUv;
  uv[axis]! +=
    (plane.xVector[2] || plane.yVector[2]) > 0 ? 2 ** -20 : -(2 ** -20);
  const r = inspectOriginalStairLocalMaterialCells(source);
  assert.deepEqual(r.blockers, []);
  const newCore = r.cells.find((c) => c.role === "cap-bounded-core")!;
  assert.deepEqual(newCore.maximumElevationFeet, core.maximumElevationFeet);
  assert.ok(
    r.cells.some(
      (c) =>
        c.role === "original-boundary-domain" &&
        c.maximumElevationFeet.n * core.maximumElevationFeet.d >
          core.maximumElevationFeet.n * c.maximumElevationFeet.d,
    ),
  );
});
test("unsupported branches, degenerate bases and omitted side operands cannot localize material", () => {
  for (const mutation of ["branch", "basis", "missing"] as const) {
    const source = replay();
    if (mutation === "branch") source.spans[0]!.readerId = "Revit2027GArc";
    if (mutation === "missing")
      (source.spans as Array<(typeof source.spans)[number]>).splice(1, 1);
    if (mutation === "basis") {
      const p = source.spans.find(
        (s) =>
          s.readerId === "Revit2027AnalyticSurface:634" &&
          ((s.value as Revit2027PlaneSurface).xVector[2] !== 0 ||
            (s.value as Revit2027PlaneSurface).yVector[2] !== 0),
      )!.value as Revit2027PlaneSurface;
      if (p.xVector[2] === 0) p.xVector = [0, 0, 0];
      else p.yVector = [0, 0, 0];
    }
    const r = inspectOriginalStairLocalMaterialCells(source);
    assert.equal(r.allOriginalFaceDomainsEnclosed, false, mutation);
    assert.ok(r.blockers.length);
  }
});
