#!/usr/bin/env node

/**
 * Structure of a piecewise-straight (dog-leg / winder) stair run's recovered
 * boundaries: consecutive tread boundaries are clustered by direction into
 * straight segments; within each segment the perpendicular spacing between
 * consecutive boundaries is printed, plus what a uniform respacing between the
 * segment's own end boundaries would change.
 *
 *   node --experimental-strip-types scripts/probe-dogleg-segments.ts model.rvt 1801503 ...
 */
import { convertModel } from "./audit-coverage.ts";

type Point3 = [number, number, number];

const [rvtPath, ...idArguments] = process.argv.slice(2);
const focusIds = idArguments.map(Number).filter((id) => Number.isFinite(id));
if (!rvtPath || !focusIds.length) {
  throw new Error("usage: probe-dogleg-segments.ts model.rvt <elementId...>");
}

const result = convertModel(rvtPath);
for (const elementId of focusIds) {
  const record = result.elementBounds.find((entry) => entry.elementId === elementId);
  const treads = record?.stairTreads as [Point3, Point3, Point3, Point3][] | undefined;
  console.log(`\nelement ${elementId}: treads=${treads?.length ?? 0}` +
    ` expectedRisers=${record?.stairExpectedRiserCount}`);
  if (!treads?.length) continue;

  const byElevation = new Map<string, [Point3, Point3, Point3, Point3][]>();
  for (const tread of treads) {
    const key = tread[0][2].toFixed(6);
    const group = byElevation.get(key) ?? [];
    group.push(tread);
    byElevation.set(key, group);
  }
  const keys = [...byElevation.keys()].sort((a, b) => Number(a) - Number(b));
  // Boundary k = rear edges of elevation group k, boundary N = front of last.
  type Boundary = { angle: number; centroid: [number, number]; length: number };
  const boundaries: Boundary[] = [];
  const describe = (edges: Array<[Point3, Point3]>): Boundary => {
    let sumX = 0, sumY = 0, weight = 0, dirX = 0, dirY = 0;
    for (const [a, b] of edges) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      sumX += (a[0] + b[0]) / 2 * length;
      sumY += (a[1] + b[1]) / 2 * length;
      // Fold direction into half-circle before averaging.
      let dx = b[0] - a[0], dy = b[1] - a[1];
      if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
      dirX += dx; dirY += dy;
      weight += length;
    }
    return {
      angle: Math.atan2(dirY, dirX) * 180 / Math.PI,
      centroid: [sumX / weight, sumY / weight],
      length: weight,
    };
  };
  for (const key of keys) {
    boundaries.push(describe(byElevation.get(key)!.map((t) => [t[3], t[0]])));
  }
  boundaries.push(describe(byElevation.get(keys.at(-1)!)!.map((t) => [t[1], t[2]])));

  // Cluster consecutive parallel boundaries into straight segments.
  let segmentStart = 0;
  const segments: Array<{ start: number; end: number }> = [];
  for (let index = 1; index <= boundaries.length; index += 1) {
    const parallel = index < boundaries.length &&
      Math.abs(((boundaries[index]!.angle - boundaries[segmentStart]!.angle) + 90) % 180 - 90) < 2;
    if (!parallel) {
      segments.push({ start: segmentStart, end: index - 1 });
      segmentStart = index;
    }
  }
  for (const segment of segments) {
    const count = segment.end - segment.start + 1;
    if (count < 2) {
      console.log(`  segment [${segment.start}..${segment.end}]` +
        ` angle=${boundaries[segment.start]!.angle.toFixed(1)} single boundary (winder?)`);
      continue;
    }
    const angle = boundaries[segment.start]!.angle * Math.PI / 180;
    const normal: [number, number] = [-Math.sin(angle), Math.cos(angle)];
    const stops: number[] = [];
    for (let index = segment.start; index <= segment.end; index += 1) {
      const [cx, cy] = boundaries[index]!.centroid;
      stops.push(cx * normal[0] + cy * normal[1]);
    }
    const spacings = stops.slice(1).map((stop, i) => stop - stops[i]!);
    const span = stops.at(-1)! - stops[0]!;
    const uniform = span / (stops.length - 1);
    const worstShift = Math.max(...stops.map((stop, i) =>
      Math.abs(stop - (stops[0]! + i * uniform))));
    console.log(`  segment [${segment.start}..${segment.end}]` +
      ` angle=${boundaries[segment.start]!.angle.toFixed(1)}` +
      ` spacings=${spacings.map((s) => s.toFixed(2)).join(",")}` +
      ` uniform=${uniform.toFixed(2)} worstShiftIfRespaced=${worstShift.toFixed(2)}`);
  }
}
