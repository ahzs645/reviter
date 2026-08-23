import assert from "node:assert/strict";
import test from "node:test";

import { makeArchitecturalFloorSvg } from "../lib/reviter/architectural-plan.ts";
import { rectifyForPlan, type RectifyPlanInput } from "../lib/reviter/rectify-plan.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const FEET = 0.3048;

/** A hull that is the half-plane x >= 0, written in metres. */
function wingTurningQuarter(shift: [number, number] = [0, 0]): RectifyPlanInput {
  return {
    wings: [{
      rotation_deg: 90,
      pivot_xy_m: [0, 0],
      shift_xy_m: shift,
      hull_half_planes: [[-1, 0, 0]],
    }],
    hull_margin_m: 0,
  };
}

function record(over: Partial<ElementBoundsRecord>): ElementBoundsRecord {
  return {
    elementId: 1, stream: "Partitions/1", chunkIndex: 0, rawOffset: 1, recordOffset: 1,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    ...over,
  } as ElementBoundsRecord;
}

function model(records: ElementBoundsRecord[]): ConvertResult {
  return { elementBounds: records, levels: [], meshes: [] } as unknown as ConvertResult;
}

test("a wall inside the wing turns about the pivot", () => {
  const wall = record({
    orientedBox: [[10, 0, 0], [20, 0, 0], [20, 2, 0], [10, 2, 0]],
    boundsFeet: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 2, z: 9 } },
  });
  const { result, report } = rectifyForPlan(model([wall]), wingTurningQuarter());
  assert.equal(report.moved, 1);
  assert.equal(report.straddling, 0);
  // 90 degrees about the origin sends (x, 0) to (0, x).
  const [x, y] = result.elementBounds[0]!.orientedBox![1]!;
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y - 20) < 1e-6, `got ${x}, ${y}`);
});

test("a wall moves by its LOCATION LINE, which is what the plan draws", () => {
  // The first version moved orientedBox, loops and boundsFeet and left `solid`
  // alone. The plan draws a wall from its location line and joined end
  // corners, so every floor moved and every wall stayed standing where it was.
  const wall = record({
    solid: {
      elementId: 1, start: { x: 10, y: 0 }, end: { x: 30, y: 0 },
      baseElevation: 0, topElevation: 9, thickness: 0.5,
      startCorners: [{ x: 10, y: -0.25 }, { x: 10, y: 0.25 }],
      endCorners: [{ x: 30, y: -0.25 }, { x: 30, y: 0.25 }],
    },
    boundsFeet: { min: { x: 10, y: -1, z: 0 }, max: { x: 30, y: 1, z: 9 } },
  });
  const { result, report } = rectifyForPlan(model([wall]), wingTurningQuarter());
  assert.equal(report.moved, 1);
  const moved = result.elementBounds[0]!.solid!;
  // 90 degrees about the origin sends (x, 0) to (0, x).
  assert.ok(Math.abs(moved.end.x) < 1e-6 && Math.abs(moved.end.y - 30) < 1e-6,
    `location line end: got ${moved.end.x}, ${moved.end.y}`);
  assert.ok(Math.abs(moved.startCorners![0]!.x - 0.25) < 1e-6,
    "the joined end corners travel with the line");
  assert.equal(moved.thickness, 0.5, "thickness is not a coordinate");
});

test("a curved wall keeps its sweep and turns its basis", () => {
  const curved = record({
    arcs: [{
      elementId: 1, centre: { x: 20, y: 0 }, radius: 10, thickness: 0.5,
      startAngle: 0, endAngle: 1, baseElevation: 0, topElevation: 9,
      xDir: { x: 1, y: 0 }, yDir: { x: 0, y: 1 },
    }],
  });
  const { result } = rectifyForPlan(model([curved]), wingTurningQuarter());
  const arc = result.elementBounds[0]!.arcs![0]!;
  assert.ok(Math.abs(arc.centre.x) < 1e-6 && Math.abs(arc.centre.y - 20) < 1e-6,
    `centre: got ${arc.centre.x}, ${arc.centre.y}`);
  assert.ok(Math.abs(arc.xDir.x) < 1e-6 && Math.abs(arc.xDir.y - 1) < 1e-6,
    "the basis rotates but does not translate");
  assert.equal(arc.radius, 10);
  assert.equal(arc.endAngle, 1, "the sweep is in the basis, so it does not change");
});

test("a wall outside the wing is left exactly where it was", () => {
  const wall = record({ orientedBox: [[-20, 0, 0], [-10, 0, 0], [-10, 2, 0], [-20, 2, 0]] });
  const before = JSON.stringify(wall.orientedBox);
  const { result, report } = rectifyForPlan(model([wall]), wingTurningQuarter());
  assert.equal(report.moved, 0);
  assert.equal(JSON.stringify(result.elementBounds[0]!.orientedBox), before);
  assert.equal(result.elementBounds[0], wall, "an untouched record is not even copied");
});

test("a floor spanning the seam is SPLIT into two rings", () => {
  // One long slab from x = -40 to x = +40 ft. Its wing half must travel and its
  // spine half must not. Relocating some of the ring's vertices does not cut
  // it — the ring stays one closed polygon and draws as the old shape with two
  // long spikes reaching across the building, which is what the first drawing
  // showed and what it was mistaken for.
  const slab = record({
    categoryId: -2000032,
    loops: [[[-40, 0, 0], [40, 0, 0], [40, 20, 0], [-40, 20, 0]]],
  });
  const { result, report } = rectifyForPlan(model([slab]), wingTurningQuarter([0, 100]));
  assert.equal(report.straddling, 1);
  const loops = result.elementBounds[0]!.loops!;
  assert.equal(loops.length, 2, `expected two rings, got ${loops.length}`);
  const spans = loops.map((loop) => ({
    minX: Math.min(...loop.map((point) => point[0])),
    maxX: Math.max(...loop.map((point) => point[0])),
    minY: Math.min(...loop.map((point) => point[1])),
    maxY: Math.max(...loop.map((point) => point[1])),
  }));
  const spine = spans.find((span) => span.maxY <= 20.001);
  const wing = spans.find((span) => span.minY > 99);
  assert.ok(spine, "the spine half stays in the y = 0..20 band");
  assert.ok(wing, "the wing half travels 100 m north");
  assert.ok(Math.abs(spine!.minX + 40) < 1e-6 && Math.abs(spine!.maxX) < 1e-6,
    `the spine half spans x -40..0, got ${spine!.minX}..${spine!.maxX}`);
  // And neither ring reaches across the gap: no edge is longer than the slab.
  for (const loop of loops) {
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index]!;
      const to = loop[(index + 1) % loop.length]!;
      assert.ok(Math.hypot(to[0] - from[0], to[1] - from[1]) < 100,
        "no ring may span the gap the move opened");
    }
  }
});

test("the transform arrives in metres and is applied in feet", () => {
  // A pivot 30.48 m out is 100 ft out; a point at the pivot must not move.
  const at = record({ orientedBox: [[100, 0, 0], [101, 0, 0], [101, 1, 0], [100, 1, 0]] });
  const { result } = rectifyForPlan(model([at]), {
    wings: [{
      rotation_deg: 90,
      pivot_xy_m: [100 * FEET, 0],
      shift_xy_m: [0, 0],
      hull_half_planes: [[-1, 0, 100 * FEET]],
    }],
    hull_margin_m: 0,
  });
  const [x, y] = result.elementBounds[0]!.orientedBox![0]!;
  assert.ok(Math.abs(x - 100) < 1e-6 && Math.abs(y) < 1e-6,
    `a point on the pivot must not move, got ${x}, ${y}`);
});

test("no wings is a no-op that still reports the model size", () => {
  const wall = record({ orientedBox: [[1, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0]] });
  const { report } = rectifyForPlan(model([wall]), { wings: [] });
  assert.equal(report.wings, 0);
  assert.equal(report.records, 1);
  assert.equal(report.moved, 0);
});

test("the drawn plan actually changes — the caches are keyed on the result", () => {
  // The bug this guards: `architectural-plan.ts` caches records and finished
  // SVGs in WeakMaps keyed on the ConvertResult and on its elementBounds array.
  // The first version of `rectifyForPlan` rewrote coordinates IN PLACE, so the
  // "after" plan came back from the cache and the two SVGs were byte-identical.
  const FLOORS = -2_000_032;
  const WALL = -2_000_011;
  const levelId = 311;
  const floor = record({
    elementId: 10, categoryId: FLOORS,
    loops: [[[-40, 0, 0], [40, 0, 0], [40, 40, 0], [-40, 40, 0]]],
    boundsFeet: { min: { x: -40, y: 0, z: 0 }, max: { x: 40, y: 40, z: 1 } },
  });
  const wall = record({
    elementId: 11, categoryId: WALL,
    orientedBox: [[10, 2, 0], [30, 2, 0], [30, 3, 0], [10, 3, 0],
                  [10, 2, 9], [30, 2, 9], [30, 3, 9], [10, 3, 9]],
    boundsFeet: { min: { x: 10, y: 2, z: 0 }, max: { x: 30, y: 3, z: 9 } },
  });
  const base = {
    ...model([floor, wall]),
    levels: [{ elevation: 0, candidates: 1, levelId, source: "assoc-level-id" }],
    nativeAssociatedLevelRelations: [
      { elementId: 10, levelId }, { elementId: 11, levelId },
    ],
  } as unknown as ConvertResult;

  const before = makeArchitecturalFloorSvg(base, levelId);
  const { result } = rectifyForPlan(base, wingTurningQuarter([0, 100]));
  const after = makeArchitecturalFloorSvg(result, levelId);
  assert.notEqual(after, before, "the rectified plan must not be the cached one");
  // And the original is still drawable, unchanged: this returns a copy.
  assert.equal(makeArchitecturalFloorSvg(base, levelId), before);
});

test("a mullion the hull missed travels with the wall it hangs on", () => {
  // The measured defect: a wing's hull is built from wall placements, so
  // curtain panels and mullions on its facade fall outside it. The wall behind
  // the glazing rotates and the glazing stays, driven through the rooms that
  // moved — 409 of 605 findings on the real model.
  const inside = record({ elementId: 1, categoryId: -2_000_011,
    solid: { elementId: 1, start: { x: 1, y: 0 }, end: { x: 20, y: 0 },
             baseElevation: 0, topElevation: 9, thickness: 0.5 } });
  const mullion = record({ elementId: 2, categoryId: -2_000_171,
    solid: { elementId: 2, start: { x: -0.4, y: 0 }, end: { x: -0.2, y: 0 },
             baseElevation: 0, topElevation: 9, thickness: 0.3 } });
  const far = record({ elementId: 3, categoryId: -2_000_171,
    solid: { elementId: 3, start: { x: -0.4, y: 90 }, end: { x: -0.2, y: 90 },
             baseElevation: 0, topElevation: 9, thickness: 0.3 } });
  const { result, report } = rectifyForPlan(
    model([inside, mullion, far]), wingTurningQuarter([0, 100]));
  assert.equal(report.contactClaims, 1, "one mullion touches the wall, one does not");
  const moved = result.elementBounds[1]!.solid!;
  assert.ok(moved.start.y > 99, `the mullion should travel with its wall, got ${moved.start.y}`);
  assert.equal(result.elementBounds[2]!.solid!.start.y, 90, "the far one stays");
});

test("a long wall that merely reaches the wing is not dragged into it", () => {
  // Contact is tested on boxes, so a corridor wall touching a wing at one end
  // touches it by its box too. Claimed, the whole corridor swings away: on the
  // voxel side that opened 138 see-through cells in a building that had none.
  const inside = record({ elementId: 1, categoryId: -2_000_011,
    solid: { elementId: 1, start: { x: 1, y: 0 }, end: { x: 20, y: 0 },
             baseElevation: 0, topElevation: 9, thickness: 0.5 } });
  const corridor = record({ elementId: 2, categoryId: -2_000_011,
    solid: { elementId: 2, start: { x: -300, y: 0 }, end: { x: -0.2, y: 0 },
             baseElevation: 0, topElevation: 9, thickness: 0.5 } });
  const { result, report } = rectifyForPlan(
    model([inside, corridor]), wingTurningQuarter([0, 100]));
  assert.equal(report.contactClaims, 0);
  assert.equal(result.elementBounds[1]!.solid!.start.x, -300, "the corridor stays put");
});
