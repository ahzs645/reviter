import assert from "node:assert/strict";
import test from "node:test";

import { doorLeafCorners, type WallRun } from "../lib/reviter/door-leaf.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

/** A door record: the opening, plus the arc its leaf sweeps through. */
function doorRecord(bounds: {
  minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number;
}): ElementBoundsRecord {
  return {
    elementId: 1504062,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000023,
    categoryName: "Doors",
    boundsFeet: {
      min: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
      max: { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
    },
  };
}

const wall = (over: Partial<WallRun> = {}): WallRun => ({
  x0: -20, y0: 0, x1: 20, y1: 0, thickness: 0.56, minZ: 0, maxZ: 10, ...over,
});

test("cuts the swing off a door, keeping its width and its wall's thickness", () => {
  // Measured against the paired export a door's record is right along the wall
  // — ratio 1.022 — and 5.1× too big across it, because the box covers the
  // quarter circle the leaf swings through.
  const record = doorRecord({ minX: -1.75, minY: -1.74, maxX: 1.75, maxY: 1.74, minZ: 0, maxZ: 7.25 });
  const corners = doorLeafCorners(record, [wall()]);
  assert.ok(corners);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const zs = corners.map(([, , z]) => z);
  // The leaf keeps the record's 3.5 ft width along the wall...
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - 3.5) < 1e-9);
  // ...and takes the wall's thickness across it, instead of 3.48 ft of swing.
  assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) - 0.56) < 1e-9);
  // Centred on the wall's own centreline, not on the middle of the swing.
  assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2) < 1e-9);
  // Height is untouched: the record is right about that.
  assert.equal(Math.min(...zs), 0);
  assert.equal(Math.max(...zs), 7.25);
});

test("follows the wall's direction rather than the world axes", () => {
  const record = doorRecord({ minX: -2.5, minY: -2.5, maxX: 2.5, maxY: 2.5, minZ: 0, maxZ: 7 });
  const diagonal = wall({ x0: -20, y0: -20, x1: 20, y1: 20 });
  const corners = doorLeafCorners(record, [diagonal]);
  assert.ok(corners);
  // A door in a wall at 45° is a box at 45°: its own axis-aligned extent is
  // wider than the leaf, which is the whole reason the corners are kept.
  const xs = corners.map(([x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 3.5);
  // Every corner sits within half a thickness of the wall line y = x.
  for (const [x, y] of corners) {
    assert.ok(Math.abs(y - x) / Math.SQRT2 <= 0.56 / 2 + 1e-9);
  }
});

test("leaves a door alone when no wall can be its host", () => {
  const record = doorRecord({ minX: -1.75, minY: -1.74, maxX: 1.75, maxY: 1.74, minZ: 0, maxZ: 7.25 });
  // Far away in plan.
  assert.equal(doorLeafCorners(record, [wall({ y0: 40, y1: 40 })]), null);
  // Right place, wrong storey.
  assert.equal(doorLeafCorners(record, [wall({ minZ: 40, maxZ: 50 })]), null);
  // Nothing to host it at all.
  assert.equal(doorLeafCorners(record, []), null);
});

test("prefers the wall the door actually sits in", () => {
  const record = doorRecord({ minX: -1.75, minY: -1.74, maxX: 1.75, maxY: 1.74, minZ: 0, maxZ: 7.25 });
  const near = wall({ y0: 0.1, y1: 0.1, thickness: 0.5 });
  const far = wall({ y0: -1.6, y1: -1.6, thickness: 2 });
  const corners = doorLeafCorners(record, [far, near]);
  assert.ok(corners);
  const ys = corners.map(([, y]) => y);
  assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) - 0.5) < 1e-9, "took the nearer wall's thickness");
});
