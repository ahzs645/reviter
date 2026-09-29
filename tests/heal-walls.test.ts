import assert from "node:assert/strict";
import test from "node:test";

import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";
import {
  analyseWallEnds,
  healConvertResult,
  healWalls,
  revertWallEdits,
  type HealWall,
  type WallEndReport,
} from "../lib/reviter/heal-walls.ts";

const wall = (id: string, start: [number, number], end: [number, number], thickness = 0.2, extra: Partial<HealWall> = {}): HealWall => ({
  id,
  levelId: 1,
  start: { x: start[0], y: start[1] },
  end: { x: end[0], y: end[1] },
  thickness,
  baseElevation: 0,
  topElevation: 3,
  ...extra,
});

const report = (reports: WallEndReport[], id: string, end: "start" | "end") =>
  reports.find((candidate) => candidate.wallId === id && candidate.end === end)!;

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("a T whose location line stops at the host's face is at-face and is extended to the centreline", () => {
  const walls = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, 0.1])];
  assert.equal(report(analyseWallEnds(walls), "B", "end").class, "at-face");
  const healed = healWalls(walls);
  assert.equal(healed.edits.length, 1);
  const [edit] = healed.edits;
  assert.equal(edit!.wallId, "B");
  assert.equal(edit!.end, "end");
  assert.equal(edit!.reason, "tee-extend");
  assert.equal(edit!.fromClass, "at-face");
  close(edit!.moved, 0.1);
  assert.deepEqual(healed.walls.find((w) => w.id === "B")!.end, { x: 5, y: 0 });
  assert.equal(report(healed.reportsAfter, "B", "end").class, "on-line");
  // The input is never mutated.
  assert.deepEqual(walls[1]!.end, { x: 5, y: 0.1 });
});

test("a real gap short of the host is measured body to body, and healed only within maxGap", () => {
  const walls = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, 0.15])];
  const gap = report(analyseWallEnds(walls), "B", "end");
  assert.equal(gap.class, "gap");
  assert.equal(gap.partnerId, "A");
  close(gap.distance, 0.05);
  close(gap.extension!, 0.15);
  assert.equal(healWalls(walls, { maxGap: 0.03 }).edits.length, 0);
  const healed = healWalls(walls, { maxGap: 0.1 });
  assert.equal(healed.edits.length, 1);
  assert.equal(healed.edits[0]!.fromClass, "gap");
  assert.equal(healed.after.lineOpen, healed.before.lineOpen - 1);
});

test("an L corner butt becomes a T onto the through-run by default, and a node with trimCorners", () => {
  const walls = [wall("A", [0, 0], [10.1, 0]), wall("B", [10, 5], [10, 0.1])];
  const before = analyseWallEnds(walls);
  assert.equal(report(before, "B", "end").class, "at-face");
  assert.ok(["corner-touch", "in-body"].includes(report(before, "A", "end").class));

  // Default: nothing is pulled back. B extends onto A's centreline; A still
  // runs to the outer face, so the plan body is exactly Revit's.
  const extendOnly = healWalls(walls);
  assert.equal(extendOnly.edits.length, 1);
  assert.equal(extendOnly.edits[0]!.wallId, "B");
  assert.equal(extendOnly.edits[0]!.reason, "tee-extend");
  assert.deepEqual(extendOnly.walls.find((w) => w.id === "A")!.end, { x: 10.1, y: 0 });
  assert.equal(report(extendOnly.reportsAfter, "B", "end").class, "on-line");

  const trimmed = healWalls(walls, { trimCorners: true });
  const a = trimmed.walls.find((w) => w.id === "A")!;
  const b = trimmed.walls.find((w) => w.id === "B")!;
  close(a.end.x, 10); close(a.end.y, 0);
  close(b.end.x, 10); close(b.end.y, 0);
  assert.equal(trimmed.edits.length, 2);
  assert.equal(report(trimmed.reportsAfter, "A", "end").class, "node");
  assert.equal(report(trimmed.reportsAfter, "B", "end").class, "node");
});

test("an open L corner whose runs both stop short is closed by extending both to the corner", () => {
  const walls = [wall("A", [0, 0], [9.95, 0]), wall("B", [10, 5], [10, 0.05])];
  const healed = healWalls(walls);
  assert.equal(healed.edits.length, 2);
  assert.ok(healed.edits.every((edit) => edit.reason === "corner"));
  assert.deepEqual(healed.walls.find((w) => w.id === "A")!.end, { x: 10, y: 0 });
  assert.deepEqual(healed.walls.find((w) => w.id === "B")!.end, { x: 10, y: 0 });
});

test("a move that would pull an end off a wall it touches is refused", () => {
  // C is teed into B's end zone; closing the A/B corner by trimming B would
  // leave C dangling, so with trimCorners the corner is still not closed that way.
  const walls = [wall("A", [0, 0], [10.1, 0]), wall("B", [10, 5], [10, 0.1]), wall("C", [10.1, -3], [10.1, -0.1])];
  const healed = healWalls(walls, { trimCorners: true });
  assert.ok(!healed.edits.some((edit) => edit.wallId === "A" && edit.end === "end"));
  assert.notEqual(report(healed.reportsAfter, "C", "end").class, "gap");
});

test("collinear runs a few millimetres out of line snap to one node", () => {
  const walls = [wall("A", [0, 0], [5, 0]), wall("B", [5, 0.005], [10, 0.005])];
  assert.equal(report(analyseWallEnds(walls), "A", "end").class, "collinear-offset");
  const healed = healWalls(walls);
  assert.ok(healed.edits.every((edit) => edit.reason === "collinear-snap"));
  const a = healed.walls.find((w) => w.id === "A")!;
  const b = healed.walls.find((w) => w.id === "B")!;
  assert.deepEqual(a.end, b.start);
  assert.ok(healed.edits.every((edit) => edit.moved <= 0.0026));
});

test("an end that passes out of the far face is trimmed back to the centreline", () => {
  const walls = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, -0.14])];
  const overshoot = report(analyseWallEnds(walls), "B", "end");
  assert.equal(overshoot.class, "overshoot");
  close(overshoot.distance, 0.04);
  const healed = healWalls(walls);
  assert.equal(healed.edits[0]!.reason, "tee-trim");
  assert.deepEqual(healed.walls.find((w) => w.id === "B")!.end, { x: 5, y: 0 });
});

test("nothing moves further than maxMove, fixed walls never move, free ends stay free", () => {
  const far = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, 0.6])];
  assert.equal(healWalls(far, { maxGap: 1, maxMove: 0.35 }).edits.length, 0);

  const pinned = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, 0.1], 0.2, { fixed: true })];
  assert.equal(healWalls(pinned).edits.length, 0);
  assert.equal(analyseWallEnds(pinned).length, 2, "fixed walls are partners, not subjects");

  const lonely = [wall("A", [0, 0], [10, 0])];
  const healed = healWalls(lonely);
  assert.equal(healed.edits.length, 0);
  assert.equal(healed.before.free, 2);
});

test("walls that do not overlap in height are not partners", () => {
  const walls = [wall("A", [0, 0], [10, 0]), wall("B", [5, 5], [5, 0.1], 0.2, { baseElevation: 4, topElevation: 7 })];
  assert.equal(report(analyseWallEnds(walls), "B", "end").class, "free");
});

test("edits are deterministic in input order and fully reversible", () => {
  const walls = [
    wall("A", [0, 0], [10.1, 0]),
    wall("B", [10, 5], [10, 0.1]),
    wall("C", [5, 5], [5, 0.15]),
    wall("D", [0, 5], [4.998, 5.004]),
    wall("E", [5, 5.004], [10, 5.004]),
  ];
  const forward = healWalls(walls, { maxGap: 0.1 });
  const backward = healWalls([...walls].reverse(), { maxGap: 0.1 });
  const key = (edits: typeof forward.edits) => edits.map((e) => `${e.wallId}:${e.end}:${e.reason}:${e.after.x.toFixed(9)},${e.after.y.toFixed(9)}`).sort();
  assert.deepEqual(key(forward.edits), key(backward.edits));
  assert.ok(forward.edits.length >= 4);
  const restored = revertWallEdits(forward.walls, forward.edits);
  for (const original of walls) {
    const back = restored.find((w) => w.id === original.id)!;
    assert.deepEqual(back.start, original.start);
    assert.deepEqual(back.end, original.end);
  }
});

test("optional merge joins collinear fragments at a two-wall node, and reverts", () => {
  const walls = [wall("A", [0, 0], [5, 0]), wall("B", [5, 0], [10, 0])];
  assert.equal(healWalls(walls).walls.length, 2);
  const merged = healWalls(walls, { mergeCollinear: true });
  assert.equal(merged.walls.length, 1);
  assert.deepEqual(merged.walls[0]!.end, { x: 10, y: 0 });
  assert.equal(merged.edits[0]!.reason, "merge");
  assert.equal(merged.edits[0]!.mergedWallId, "B");
  const restored = revertWallEdits(merged.walls, merged.edits);
  assert.equal(restored.length, 2);
  assert.deepEqual(restored.find((w) => w.id === "A")!.end, { x: 5, y: 0 });

  // A third wall teeing into the node blocks the merge.
  const tee = [...walls, wall("C", [5, 5], [5, 0])];
  assert.equal(healWalls(tee, { mergeCollinear: true }).walls.length, 3);
});

test("tolerances scale with unitsPerMetre", () => {
  const feet = 1 / 0.3048;
  const walls = [wall("A", [0, 0], [10 * feet, 0], 0.2 * feet), wall("B", [5 * feet, 5 * feet], [5 * feet, 0.15 * feet], 0.2 * feet)];
  const gap = report(analyseWallEnds(walls, { unitsPerMetre: feet }), "B", "end");
  assert.equal(gap.class, "gap");
  close(gap.distance / feet, 0.05);
  assert.equal(healWalls(walls, { unitsPerMetre: feet, maxGap: 0.03 }).edits.length, 0);
  assert.equal(healWalls(walls, { unitsPerMetre: feet, maxGap: 0.1 }).edits.length, 1);
});

test("healConvertResult rewrites only the moved solids and leaves the input untouched", () => {
  const feet = 1 / 0.3048;
  const record = (elementId: number, start: [number, number], end: [number, number]): ElementBoundsRecord => {
    const solid = { elementId, start: { x: start[0] * feet, y: start[1] * feet }, end: { x: end[0] * feet, y: end[1] * feet }, thickness: 0.2 * feet, baseElevation: 0, topElevation: 10 };
    return { elementId, stream: "Partitions/1", chunkIndex: 0, rawOffset: 0, recordOffset: 1, categoryId: -2_000_011, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 10 } }, solid, solids: [solid] };
  };
  const host = record(1, [0, 0], [10, 0]);
  const tee = record(2, [5, 5], [5, 0.1]);
  const input = {
    elementBounds: [host, tee],
    meshes: [{ elementIds: [1, 2] }],
    nativeAssociatedLevelRelations: [{ elementId: 1, levelId: 7 }, { elementId: 2, levelId: 7 }],
  } as unknown as ConvertResult;
  const healed = healConvertResult(input);
  assert.equal(healed.edits.length, 1);
  assert.equal(healed.edits[0]!.wallId, "2");
  assert.equal(healed.result.elementBounds[0], host, "unmoved records are shared, not copied");
  const moved = healed.result.elementBounds[1]!;
  close(moved.solids![0]!.end.y, 0);
  assert.equal(moved.solid, moved.solids![0]);
  close(tee.solids![0]!.end.y, 0.1 * feet);
});
