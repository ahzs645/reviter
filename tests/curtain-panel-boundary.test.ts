import assert from "node:assert/strict";
import test from "node:test";

import { inferCurtainPanelBoundaries } from "../lib/reviter/curtain-panel-boundary.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

type Point3 = [number, number, number];

function add(...points: Point3[]): Point3 {
  return points.reduce<Point3>(
    (sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2],
    ],
    [0, 0, 0],
  );
}

function scale(point: Point3, factor: number): Point3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function box(
  center: Point3,
  xHalf: Point3,
  yHalf: Point3,
  zHalf: Point3,
): Point3[] {
  return [
    add(center, scale(xHalf, -1), scale(yHalf, -1), scale(zHalf, -1)),
    add(center, xHalf, scale(yHalf, -1), scale(zHalf, -1)),
    add(center, xHalf, yHalf, scale(zHalf, -1)),
    add(center, scale(xHalf, -1), yHalf, scale(zHalf, -1)),
    add(center, scale(xHalf, -1), scale(yHalf, -1), zHalf),
    add(center, xHalf, scale(yHalf, -1), zHalf),
    add(center, xHalf, yHalf, zHalf),
    add(center, scale(xHalf, -1), yHalf, zHalf),
  ];
}

function record(
  elementId: number,
  categoryId: number,
  orientedBox: Point3[],
): ElementBoundsRecord {
  const xs = orientedBox.map((point) => point[0]);
  const ys = orientedBox.map((point) => point[1]);
  const zs = orientedBox.map((point) => point[2]);
  return {
    elementId,
    categoryId,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    orientedBox,
    boundsFeet: {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    },
  };
}

test("clips the unused corner of a rectangular panel at a diagonal mullion", () => {
  const panel = record(
    10,
    -2000170,
    box([2, 0, 3], [2, 0, 0], [0, 0.05, 0], [0, 0, 3]),
  );
  // Long axis from the panel's top edge at x=1 to its bottom-right corner.
  const long = [1.5, 0, -3] satisfies Point3;
  const length = Math.hypot(...long);
  const profile = [0.08 * (3 / length), 0, 0.08 * (1.5 / length)] satisfies Point3;
  const mullion = record(
    20,
    -2000171,
    box([2.5, 0, 3], profile, [0, 0.1, 0], long),
  );

  const geometry = inferCurtainPanelBoundaries([panel, mullion]).get(panel.elementId);
  assert.ok(geometry);
  assert.ok(geometry.indices.length > 0);
  const points = Array.from(
    { length: geometry.positions.length / 3 },
    (_, index) => geometry.positions.slice(index * 3, index * 3 + 3),
  );
  assert.equal(
    points.some(([x, , z]) => x! > 3.9 && z! > 5.9),
    false,
    "the rectangular top-right corner beyond the diagonal is removed",
  );
  assert.ok(points.some(([x, , z]) => x! < 0.1 && z! > 5.9), "the larger panel side remains");
  assert.ok(points.some(([x, , z]) => x! > 3.9 && z! < 0.1), "the diagonal endpoint remains");
});

test("leaves an ordinary rectangular bay unchanged", () => {
  const panel = record(
    10,
    -2000170,
    box([2, 0, 3], [2, 0, 0], [0, 0.05, 0], [0, 0, 3]),
  );
  const verticalMullion = record(
    20,
    -2000171,
    box([4, 0, 3], [0.08, 0, 0], [0, 0.1, 0], [0, 0, 3]),
  );
  assert.equal(inferCurtainPanelBoundaries([panel, verticalMullion]).size, 0);
});
