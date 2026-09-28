import assert from "node:assert/strict";
import test from "node:test";

import {
  triangulateConstrainedRegion,
  type RegionPoint,
  type RegionSegment,
} from "../lib/reviter/constrained-region-triangulation.ts";

function ring(indices: readonly number[]): RegionSegment[] {
  return indices.map((a, index) => [a, indices[(index + 1) % indices.length]!] as const);
}

function coveredArea(points: readonly RegionPoint[], triangles: readonly [number, number, number][]): number {
  let area = 0;
  for (const [a, b, c] of triangles) {
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const [cx, cy] = points[c]!;
    const twice = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    assert.ok(twice > 0, "every triangle is counter-clockwise");
    area += twice / 2;
  }
  return area;
}

test("a face split by a full-height opening but kept as one loop becomes its two pieces", () => {
  // The loop walks the left piece, the right piece, and back along the top
  // over the opening, so the top is walked once each way between x 2 and 8.
  const points: RegionPoint[] = [
    [0, 0], [2, 0], [2, 8], [8, 8], [8, 0], [10, 0], [10, 8], [0, 8],
  ];
  const result = triangulateConstrainedRegion(points, ring([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(coveredArea(points, result.triangles), 2 * 8 + 2 * 8);
  const keys = new Set(result.segments.map(([a, b]) => `${a}>${b}`));
  assert.equal(keys.has("2>3"), false, "the zero-width strip is dropped");
  assert.equal(keys.has("6>3") && keys.has("2>7"), true, "the top is split where the pieces end");
});

test("holes whose bottoms lie on one line are cut out exactly", () => {
  const points: RegionPoint[] = [
    [0, 0], [10, 0], [10, 4], [0, 4],
    // Two holes, clockwise, both with their bottom edge on y = 1.
    [2, 1], [2, 3], [4, 3], [4, 1],
    [6, 1], [6, 3], [8, 3], [8, 1],
  ];
  const segments = [...ring([0, 1, 2, 3]), ...ring([4, 5, 6, 7]), ...ring([8, 9, 10, 11])];
  const result = triangulateConstrainedRegion(points, segments);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(coveredArea(points, result.triangles), 40 - 4 - 4);
  assert.equal(result.segments.length, 12);
});

test("two lobes that touch at one vertex are both covered", () => {
  // The loop passes through vertex 2 twice.
  const points: RegionPoint[] = [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
  const segments: RegionSegment[] = [[0, 1], [1, 2], [2, 4], [4, 3], [3, 2], [2, 0]];
  const result = triangulateConstrainedRegion(points, segments);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(coveredArea(points, result.triangles), 1 + 1);
});

test("a boundary that crosses itself or repeats a segment is not a region", () => {
  const bowTie: RegionPoint[] = [[0, 0], [2, 2], [2, 0], [0, 2]];
  assert.equal(triangulateConstrainedRegion(bowTie, ring([0, 1, 2, 3])).ok, false);
  const square: RegionPoint[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.equal(
    triangulateConstrainedRegion(square, [...ring([0, 1, 2, 3]), [0, 1]]).ok,
    false,
    "a segment walked twice the same way",
  );
  assert.equal(
    triangulateConstrainedRegion(square, [[0, 1], [1, 2], [2, 3]]).ok,
    false,
    "an open boundary",
  );
});
