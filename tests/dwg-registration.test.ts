/**
 * Registering a DWG sheet onto model walls, on synthetic plans with a known
 * answer: a floor drawn in millimetres, placed into a metre-scale model with a
 * rotation, a reflection and a translation, among other buildings and with
 * clutter on the sheet that the model does not have.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applySimilarity,
  candidateRotations,
  coarseCandidates,
  convexHull,
  correlatePeaks,
  correlationTarget,
  distanceTransform,
  dominantBearings,
  fitStats,
  icpRefine,
  insideConvexHull,
  sampleSegments,
  SegmentIndex,
  similarityMatrix,
  thinPoints,
  transformSegments,
  wallRegions,
} from "../lib/reviter/dwg-registration.ts";
import type { Similarity } from "../lib/reviter/dwg-registration.ts";

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A floor of an office building in millimetres: a 60 × 24 m shell, a central
 * corridor, rooms of irregular widths either side, and an annex, so that no
 * rotation or reflection of it looks like itself.
 */
function officeFloor(seed: number): number[] {
  const next = random(seed);
  const segments: number[] = [];
  const rect = (x1: number, y1: number, x2: number, y2: number) =>
    segments.push(x1, y1, x2, y1, x2, y1, x2, y2, x2, y2, x1, y2, x1, y2, x1, y1);
  rect(0, 0, 60000, 24000);
  segments.push(0, 10500, 60000, 10500, 0, 13500, 60000, 13500);
  for (const [y1, y2] of [[0, 10500], [13500, 24000]] as const) {
    let x = 0;
    while (x < 56000) {
      x += 3000 + Math.floor(next() * 5) * 1000;
      if (x < 60000) segments.push(x, y1, x, y2);
    }
  }
  // Annex off the east end.
  segments.push(60000, 4000, 72000, 4000, 72000, 4000, 72000, 16000, 72000, 16000, 60000, 16000);
  return segments;
}

const TRUE: Similarity = { scale: 0.001, theta: (32 * Math.PI) / 180, tx: 41.7, ty: -23.2, mirror: true };

function scenario(seed = 7) {
  const sheet = Float64Array.from(officeFloor(seed));
  // The model: the same floor placed by TRUE, plus a different floor of a
  // neighbouring building 120 m away, square to the axes.
  const placed = transformSegments(TRUE, sheet);
  const neighbour = transformSegments({ scale: 0.001, theta: 0, tx: -150, ty: 60, mirror: false },
    Float64Array.from(officeFloor(seed + 1)));
  const model = Float64Array.from([...placed, ...neighbour]);
  // Sheet clutter the model does not have: door swings and furniture.
  const next = random(seed + 2);
  const clutter: number[] = [];
  for (let k = 0; k < 150; k += 1) {
    const x = next() * 60000;
    const y = next() * 24000;
    clutter.push(x, y, x + 600, y + 400);
  }
  return { sheet, sheetWithClutter: Float64Array.from([...sheet, ...clutter]), model };
}

test("similarity matrix agrees with applySimilarity, reflection included", () => {
  const m = similarityMatrix(TRUE);
  const [x, y] = applySimilarity(TRUE, 1000, 2000);
  assert.ok(Math.abs(m.a * 1000 + m.c * 2000 + m.e - x) < 1e-12);
  assert.ok(Math.abs(m.b * 1000 + m.d * 2000 + m.f - y) < 1e-12);
  // A reflection has a negative determinant.
  assert.ok(m.a * m.d - m.b * m.c < 0);
  assert.ok(Math.abs(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) - 0.001) < 1e-12);
});

test("dominant bearings fold to a quarter turn and find each building's grid", () => {
  const { model } = scenario();
  const bearings = dominantBearings(model).map((peak) => peak.degrees);
  // The placed floor runs at 32° (reflected: its x-axis at 180° − 32°... folded
  // to 58°, and its y-axis at 32°); the neighbour at 0°.
  assert.ok(bearings.some((d) => Math.abs(d - 32) < 0.5 || Math.abs(d - 58) < 0.5), `${bearings}`);
  assert.ok(bearings.some((d) => d < 0.5 || d > 89.5), `${bearings}`);
  const rotations = candidateRotations([0, 32], [0]).map((r) => (r * 180) / Math.PI);
  assert.equal(rotations.length, 8);
  assert.ok(rotations.some((d) => Math.abs(d - 212) < 1e-9));
});

test("distance transform measures Euclidean distance to the nearest set cell", () => {
  const width = 8;
  const height = 6;
  const grid = new Float64Array(width * height);
  grid[2 * width + 3] = 1;
  const d = distanceTransform(grid, width, height);
  assert.equal(d[2 * width + 3], 0);
  assert.equal(d[2 * width + 6], 9);
  assert.equal(d[5 * width + 7], 9 + 16);
});

test("correlation finds a pure translation", () => {
  const { sheet } = scenario();
  const metres = transformSegments({ scale: 0.001, theta: 0, tx: 0, ty: 0, mirror: false }, sheet);
  const target = correlationTarget(transformSegments({ scale: 1, theta: 0, tx: 17, ty: -9, mirror: false }, metres), { cell: 1, maxSheetSize: 90 });
  const [best] = correlatePeaks(target, metres, { peaks: 3 });
  assert.ok(best);
  assert.ok(Math.abs(best.tx - 17) <= 1 && Math.abs(best.ty + 9) <= 1, JSON.stringify(best));
  // High-passed: a placement scores what it gains over its neighbourhood.
  assert.ok(best.score > 0.3, `${best.score}`);
});

test("coarse search then ICP recovers a rotated, reflected, translated sheet", () => {
  const { sheetWithClutter, model } = scenario();
  const target = correlationTarget(model, { cell: 1, sigma: 1, maxSheetSize: 90 });
  const thetas = candidateRotations(dominantBearings(model, { minShare: 0.05 }).map((p) => p.degrees),
    dominantBearings(sheetWithClutter, { minShare: 0.15 }).map((p) => p.degrees));
  const candidates = coarseCandidates(target, sheetWithClutter, { scale: 0.001, thetas, tryMirror: true, peaksPerRotation: 2 });
  const index = new SegmentIndex(model, 0.5);
  const points = thinPoints(sampleSegments(sheetWithClutter, 250), 150, 3000);
  let best: { transform: Similarity; ratio: number } | null = null;
  for (const candidate of candidates.slice(0, 6)) {
    const transform = icpRefine(index, points, candidate.transform, { schedule: [2, 1, 0.5, 0.25, 0.1] });
    const { inlierRatio } = fitStats(index, points, transform, 0.05);
    if (!best || inlierRatio > best.ratio) best = { transform, ratio: inlierRatio };
  }
  assert.ok(best);
  const { transform } = best;
  assert.equal(transform.mirror, true);
  const dTheta = Math.atan2(Math.sin(transform.theta - TRUE.theta), Math.cos(transform.theta - TRUE.theta));
  assert.ok(Math.abs(dTheta) < 1e-4, `theta off by ${dTheta}`);
  assert.ok(Math.hypot(transform.tx - TRUE.tx, transform.ty - TRUE.ty) < 0.01, JSON.stringify(transform));
  // Clutter is about a fifth of the samples; the walls all land.
  assert.ok(best.ratio > 0.7, `inlier ratio ${best.ratio}`);
});

test("ICP with free scale recovers a scale that is not quite millimetres", () => {
  const { sheet } = scenario(11);
  const truth: Similarity = { ...TRUE, scale: 0.001003 };
  const model = transformSegments(truth, sheet);
  const index = new SegmentIndex(model, 0.5);
  const points = thinPoints(sampleSegments(sheet, 250), 150);
  const start: Similarity = { ...TRUE, theta: TRUE.theta + 0.01, tx: TRUE.tx + 0.4, ty: TRUE.ty - 0.3 };
  const fitted = icpRefine(index, points, start, { schedule: [2, 1, 0.5, 0.2, 0.1], fitScale: true, iterationsPerStage: 15 });
  assert.ok(Math.abs(fitted.scale / truth.scale - 1) < 1e-4, `scale ${fitted.scale}`);
  assert.ok(Math.abs(fitted.theta - truth.theta) < 1e-4);
});

test("the level whose walls match scores higher than a level with another layout", () => {
  const sheet = Float64Array.from(officeFloor(21));
  const right = transformSegments(TRUE, sheet);
  const wrong = transformSegments(TRUE, Float64Array.from(officeFloor(22)));
  const points = thinPoints(sampleSegments(sheet, 250), 150);
  const good = fitStats(new SegmentIndex(right, 0.5), points, TRUE, 0.15);
  const bad = fitStats(new SegmentIndex(wrong, 0.5), points, TRUE, 0.15);
  assert.ok(good.inlierRatio > 0.99);
  assert.ok(good.rms < 1e-6);
  // Shell and corridor coincide; the room partitions do not.
  assert.ok(bad.inlierRatio < good.inlierRatio - 0.1, `${bad.inlierRatio}`);
});

test("hull and wall regions place labels in rooms", () => {
  const walls = Float64Array.from(officeFloor(3).map((v) => v / 1000));
  const hull = convexHull(walls);
  assert.ok(insideConvexHull(hull, 30, 12));
  assert.ok(!insideConvexHull(hull, -5, 12));
  const { region, open } = wallRegions(walls, [[1, 1], [1.5, 2], [30, 12], [80, 12]], {
    bounds: { minX: -2, minY: -2, maxX: 82, maxY: 26 },
  });
  assert.equal(region[0], region[1]);
  assert.notEqual(region[0], region[2]);
  assert.equal(open[region[0]!], false);
  assert.equal(open[region[3]!], true);
});

test("a sheet with two floors side by side splits into two parts", async () => {
  const { splitParts } = await import("../lib/reviter/dwg-registration.ts");
  const a = officeFloor(5);
  const b = officeFloor(6).map((v, i) => (i % 2 === 0 ? v + 90000 : v));
  // A scale bar below the first floor: too little linework to be a part.
  const bar = [0, -8000, 8000, -8000];
  const parts = splitParts(Float64Array.from([...a, ...b, ...bar]), { cell: 500, gap: 3000, minShare: 0.1 });
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.length + parts[1]!.length, a.length + b.length);
});
