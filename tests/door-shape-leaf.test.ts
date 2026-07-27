import assert from "node:assert/strict";
import test from "node:test";

import { doorLeafFromShape } from "../lib/reviter/door-leaf.ts";
import type { InstancePlacement, LocalBounds } from "../lib/reviter/instanced-geometry.ts";

const placement = (basis: number[]): InstancePlacement => ({
  elementId: 976_725,
  basis,
  origin: [100, 200, 0],
  geometryId: 845_328,
});
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The swing, as a door's shared shape writes it: [-w/2, -R, 0] .. [w/2, t, H]. */
const swing = (width: number, radius: number, halfThickness: number, height: number): LocalBounds => ({
  elementId: 845_328,
  min: [-width / 2, -radius, 0],
  max: [width / 2, halfThickness, height],
});

test("folds the swing to the door's own thickness", () => {
  // A door's shared shape is the swing, not the leaf: over 1,046 doors the
  // median local box is 3.333 x 3.311 x 6.916 ft, square in plan. The arc
  // radius is about a leaf width on one side and the door's own half thickness
  // on the other, so folding that axis gives the leaf — with the thickness
  // taken from the door rather than from the wall it sits in.
  const corners = doorLeafFromShape(placement(IDENTITY), swing(3.5, 3.2, 0.279, 7.25));
  assert.ok(corners);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const zs = corners.map(([, , z]) => z);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3.5) < 1e-9, "kept the leaf width");
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.558) < 1e-9, "folded to twice the door's own t");
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 7.25) < 1e-9, "kept the shape's own height");
  // Centred on the placement origin across the fold, not on the swing.
  assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 200) < 1e-9);
});

test("finds the swing axis rather than assuming it", () => {
  // A mirrored family puts the radius on the other side, and a family whose
  // local x is the swing axis inverts which span is the width.
  const mirrored: LocalBounds = { elementId: 1, min: [-1.75, -0.28, 0], max: [1.75, 3.03, 7] };
  const flipped = doorLeafFromShape(placement(IDENTITY), mirrored);
  assert.ok(flipped);
  const ys = flipped.map(([, y]) => y);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.56) < 1e-9);

  const swingOnX: LocalBounds = { elementId: 2, min: [-3.2, -1.75, 0], max: [0.279, 1.75, 7] };
  const onX = doorLeafFromShape(placement(IDENTITY), swingOnX);
  assert.ok(onX);
  const xs = onX.map(([x]) => x);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.558) < 1e-9);
});

test("places the leaf through the door's own basis", () => {
  // A door in a wall at 45°: the leaf follows the wall, so its axis-aligned
  // extent is wider than the leaf itself.
  const c = Math.SQRT1_2;
  const rotated = doorLeafFromShape(placement([c, -c, 0, c, c, 0, 0, 0, 1]), swing(3.5, 3.2, 0.279, 7.25));
  assert.ok(rotated);
  const xs = rotated.map(([x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 2.8, "a 45° leaf spans more than its own thickness");
});

test("declines a shape that is not a swing", () => {
  assert.equal(doorLeafFromShape(placement(IDENTITY), { elementId: 3, min: [0, 0, 0], max: [0, 2, 7] }), null);
  // Symmetric in both plan axes: nothing to fold, so no leaf can be inferred.
  assert.equal(doorLeafFromShape(placement(IDENTITY), { elementId: 4, min: [-1, -1, 0], max: [1, 1, 7] }), null);
});

test("uses a shape flagged as the leaf without folding it", () => {
  // A door's B-rep read gives the leaf outright, and it is symmetric in plan —
  // exactly what the fold declines. Without the flag those 154 doors fell
  // through to the host wall and took the wall's thickness, 68.3% size
  // agreement against 99.5% for their own shape.
  const leaf: LocalBounds = {
    elementId: 5,
    min: [-1.75, -0.548, 0],
    max: [1.75, 0.548, 6.916],
    leaf: true,
  };
  const corners = doorLeafFromShape(placement(IDENTITY), leaf);
  assert.ok(corners);
  const ys = corners.map(([, y]) => y);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 1.096) < 1e-9, "kept its own thickness");
  const xs = corners.map(([x]) => x);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3.5) < 1e-9, "kept its own width");
});

test("declines a leaf with no extent", () => {
  // Six subnormal doubles read as a valid, ordered, finite box of zero size,
  // and five doors were being drawn to one: eight identical corners. The
  // element's own envelope reproduces the export exactly, so declining here is
  // what puts them back on it.
  const point: LocalBounds = { elementId: 6, min: [0, 0, 0], max: [1e-300, 1e-300, 1e-300], leaf: true };
  assert.equal(doorLeafFromShape(placement(IDENTITY), point), null);
  // The same guard on the folded route: a swing whose width and height are
  // subnormal folds to a point too.
  const flat: LocalBounds = { elementId: 7, min: [-1e-300, -3.2, 0], max: [1e-300, 0.279, 1e-300] };
  assert.equal(doorLeafFromShape(placement(IDENTITY), flat), null);
});
