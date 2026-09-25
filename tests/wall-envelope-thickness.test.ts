import assert from "node:assert/strict";
import test from "node:test";

import type { WallSolid } from "../lib/reviter/native-geometry.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import { widenWallsToEnvelope } from "../lib/reviter/wall-envelope-thickness.ts";

function wall(
  solids: WallSolid[],
  bounds: { min: [number, number]; max: [number, number] },
  over: Partial<ElementBoundsRecord> = {},
): ElementBoundsRecord {
  return {
    elementId: solids[0]!.elementId,
    stream: "Partitions/15",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000011,
    boundsFeet: {
      min: { x: bounds.min[0], y: bounds.min[1], z: 0 },
      max: { x: bounds.max[0], y: bounds.max[1], z: 12.47 },
    },
    solids,
    solid: solids[0],
    ...over,
  };
}

const run = (start: [number, number], end: [number, number], thickness: number): WallSolid => ({
  elementId: 143858,
  start: { x: start[0], y: start[1] },
  end: { x: end[0], y: end[1] },
  baseElevation: 0,
  topElevation: 12.47,
  thickness,
});

test("a layered wall takes its whole thickness from its own envelope", () => {
  // Wall 143858 in the 2025 technical school: the triple is the 0.302 ft core,
  // off-centre in a 0.454 ft wall, which is what Autodesk draws.
  const record = wall([run([10.05, 0], [10.05, 26.69], 0.302)], { min: [9.85, 0], max: [10.304, 26.69] });
  assert.equal(widenWallsToEnvelope([record]), 1);
  assert.ok(Math.abs(record.solid!.thickness - 0.454) < 1e-9);
  assert.ok(Math.abs(record.solid!.start.x - 10.077) < 1e-9);
  assert.ok(Math.abs(record.solid!.end.x - 10.077) < 1e-9);
  // Along the wall nothing moves.
  assert.equal(record.solid!.start.y, 0);
  assert.equal(record.solid!.end.y, 26.69);
});

test("a wall whose envelope cannot be read as its thickness keeps the triple", () => {
  // At an angle, the envelope mixes the wall's length into its depth.
  const angled = wall([run([0, 0], [10, 10], 0.3)], { min: [-0.2, -0.2], max: [10.2, 10.2] });
  // Two parallel runs on different lines: the envelope spans both.
  const offset = wall(
    [run([0, 0], [10, 0], 0.3), run([12, 3], [20, 3], 0.3)],
    { min: [0, -0.15], max: [20, 3.15] },
  );
  // A synthesised envelope is built from the solid it would correct.
  const synthesised = wall([run([0, 0], [10, 0], 0.3)], { min: [0, -0.4], max: [10, 0.4] }, { recordOffset: -1 });
  // A triple reaching outside the envelope is not this envelope's wall.
  const outside = wall([run([0, 1], [10, 1], 0.3)], { min: [0, -0.4], max: [10, 0.4] });
  assert.equal(widenWallsToEnvelope([angled, offset, synthesised, outside]), 0);
  for (const record of [angled, offset, synthesised, outside]) {
    assert.ok(record.solids!.every((solid) => solid.thickness === 0.3));
  }
});
