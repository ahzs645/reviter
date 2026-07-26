/**
 * The footprint audit's geometry, on shapes whose answer is known by hand.
 *
 * The measure is deliberately not the one `overlay-diff.ts` uses. A wall at 45
 * degrees can have a perfect centre and a perfect size and still be drawn as a
 * rectangle several times its own area, so this asks how much of its own plan
 * box a footprint fills, and separates a curve from an angle by how much of its
 * own *minimum-area* rectangle it fills — a rectangle is a rectangle at any
 * rotation, and an arc is not, at any tessellation.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  drawnPlanPoints,
  drawnRoute,
  hull,
  planFill,
  rectFill,
  ringArea,
  type Point2,
} from "../scripts/footprint-audit.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  min: { x: minX, y: minY, z: 0 },
  max: { x: maxX, y: maxY, z: 10 },
});

function record(over: Partial<ElementBoundsRecord> = {}): ElementBoundsRecord {
  return {
    elementId: 1,
    recordOffset: 0,
    boundsFeet: bounds(0, 0, 10, 4),
    ...over,
  } as ElementBoundsRecord;
}

/** Points on a circle, as a tessellated arc would arrive from the exporter. */
function arcPoints(radius: number, from: number, to: number, steps: number): Point2[] {
  const points: Point2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

test("an axis-aligned rectangle fills its own plan box", () => {
  const { fill } = planFill([[0, 0], [10, 0], [10, 4], [0, 4]]);
  assert.ok(Math.abs(fill - 1) < 1e-9, `fill ${fill}`);
});

test("a quarter round fills pi/4 of it", () => {
  const points = arcPoints(10, 0, Math.PI / 2, 128);
  points.push([0, 0]);
  const { fill } = planFill(points);
  assert.ok(Math.abs(fill - Math.PI / 4) < 0.01, `fill ${fill}`);
});

test("a wall at 45 degrees fills almost none of it", () => {
  // 20 ft long, 1 ft thick, running diagonally.
  const half = Math.SQRT1_2 / 2;
  const { fill } = planFill([
    [0 + half, 0 - half], [20 + half, 20 - half], [20 - half, 20 + half], [0 - half, 0 + half],
  ]);
  assert.ok(fill < 0.1, `fill ${fill}`);
});

test("a rotated rectangle fills its own minimum-area rectangle exactly", () => {
  const half = Math.SQRT1_2 / 2;
  const ring = hull([
    [0 + half, 0 - half], [20 + half, 20 - half], [20 - half, 20 + half], [0 - half, 0 + half],
  ]);
  assert.ok(Math.abs(rectFill(ring) - 1) < 1e-9, `rectFill ${rectFill(ring)}`);
});

test("an arc does not, however finely it is tessellated", () => {
  // The corner-count metric this replaced read the 64-segment case as a
  // triangle, because every turn fell under its merge threshold.
  for (const steps of [8, 64, 512]) {
    const ring = hull([...arcPoints(10, 0, Math.PI / 2, steps), [0, 0]]);
    const fill = rectFill(ring);
    assert.ok(fill < 0.9, `${steps} segments gave rectFill ${fill}`);
  }
});

test("a half round fills half of its minimum-area rectangle", () => {
  const ring = hull(arcPoints(10, 0, Math.PI, 256));
  assert.ok(Math.abs(rectFill(ring) - Math.PI / 4) < 0.02, `rectFill ${rectFill(ring)}`);
});

test("the hull of a point set ignores interior points", () => {
  const ring = hull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7]]);
  assert.equal(ring.length, 4);
  assert.ok(Math.abs(ringArea(ring) - 100) < 1e-9);
});

test("a degenerate footprint reports a fill of 1 rather than dividing by zero", () => {
  const { fill, boxArea } = planFill([[3, 3], [3, 3]]);
  assert.equal(boxArea, 0);
  assert.equal(fill, 1);
});

test("the drawn route follows the viewer's own precedence", () => {
  assert.equal(drawnRoute(record()), "envelope");
  assert.equal(drawnRoute(record({ arcs: [] as never })), "envelope");
  assert.equal(
    drawnRoute(record({ solid: { elementId: 1, start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, baseElevation: 0, topElevation: 9, thickness: 1 } })),
    "rebuilt solid",
  );
  assert.equal(drawnRoute(record({ orientedBox: [] as never, solid: undefined })), "oriented box");
  assert.equal(drawnRoute(record({ loops: [[[0, 0, 0], [1, 0, 0], [1, 1, 0]]] })), "sketch ring");
});

test("an element with no oriented geometry measures as its envelope, so fill is 1", () => {
  const { fill } = planFill(drawnPlanPoints(record()));
  assert.ok(Math.abs(fill - 1) < 1e-9, `fill ${fill}`);
});

test("a rebuilt solid measures as the oriented rectangle, not its bounding box", () => {
  const diagonal = record({
    boundsFeet: bounds(0, 0, 20, 20),
    solid: {
      elementId: 1,
      start: { x: 0, y: 0 },
      end: { x: 20, y: 20 },
      baseElevation: 0,
      topElevation: 9,
      thickness: 1,
    },
  });
  const { fill } = planFill(drawnPlanPoints(diagonal));
  // The envelope would read 1.00; the solid is a thin sliver across it.
  assert.ok(fill < 0.1, `fill ${fill}`);
});

test("a curved wall arc measures as the annulus sector", () => {
  const curved = record({
    boundsFeet: bounds(-10, -10, 10, 10),
    arcs: [{
      elementId: 1,
      centre: { x: 0, y: 0 },
      radius: 10,
      thickness: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
      baseElevation: 0,
      topElevation: 9,
      xDir: { x: 1, y: 0 },
      yDir: { x: 0, y: 1 },
    }],
  });
  const points = drawnPlanPoints(curved);
  assert.ok(points.length > 8, `only ${points.length} points`);
  // Every point sits on one of the two faces, half a thickness either side.
  for (const [x, y] of points) {
    const radius = Math.hypot(x, y);
    assert.ok(Math.abs(radius - 9.5) < 1e-9 || Math.abs(radius - 10.5) < 1e-9, `radius ${radius}`);
  }
  const { fill } = planFill(points);
  assert.ok(fill < 0.92, `an arc should not fill its own box: ${fill}`);
});
