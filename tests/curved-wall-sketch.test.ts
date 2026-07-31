import assert from "node:assert/strict";
import test from "node:test";

import { curvedWallArcFromSketch } from "../lib/reviter/curved-wall-sketch.ts";

test("recovers a curved wall from its location arc and compound thickness", () => {
  const radius = 10;
  const thickness = 0.5;
  const point = (angle: number): [number, number, number] => [
    radius * Math.cos(angle),
    radius * Math.sin(angle),
    3,
  ];
  const result = curvedWallArcFromSketch(
    42,
    [{
      offset: 0,
      owner: 42,
      kind: "arc",
      start: point(0),
      interior: [point(Math.PI / 4)],
      end: point(Math.PI / 2),
    }],
    thickness,
    {
      min: { x: -0.25, y: -0.25, z: 3 },
      max: { x: 10.25, y: 10.25, z: 12 },
    },
  );
  assert.ok(result);
  assert.equal(result.elementId, 42);
  assert.ok(Math.abs(result.radius - radius) < 1e-9);
  assert.equal(result.thickness, thickness);
  assert.equal(result.baseElevation, 3);
  assert.equal(result.topElevation, 12);
});

test("declines an arc whose reconstructed annulus disagrees with the envelope", () => {
  const result = curvedWallArcFromSketch(
    7,
    [{
      offset: 0,
      owner: 7,
      kind: "arc",
      start: [10, 0, 0],
      interior: [[Math.SQRT1_2 * 10, Math.SQRT1_2 * 10, 0]],
      end: [0, 10, 0],
    }],
    0.5,
    {
      min: { x: 100, y: 100, z: 0 },
      max: { x: 110, y: 110, z: 9 },
    },
  );
  assert.equal(result, null);
});
