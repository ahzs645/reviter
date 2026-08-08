#!/usr/bin/env node

/**
 * Why does a stair run with a complete recovered tread chain still miss riser
 * faces? Reproduces `stairTreadGeometry`'s side collection and successor
 * matching for named stair-run elements and reports, per consecutive
 * elevation-group pair, which closure path fired and which failed.
 *
 *   node --experimental-strip-types scripts/probe-riser-gaps.ts model.rvt 1779476 [ids...]
 */
import { convertModel } from "./audit-coverage.ts";

type Point3 = [number, number, number];

const [rvtPath, ...idArguments] = process.argv.slice(2);
const elementIds = idArguments.map(Number).filter((id) => Number.isFinite(id));
if (!rvtPath || !elementIds.length) {
  throw new Error("usage: probe-riser-gaps.ts model.rvt <elementId> [elementId...]");
}

const result = convertModel(rvtPath);
for (const elementId of elementIds) {
  const record = result.elementBounds.find((entry) => entry.elementId === elementId);
  if (!record) {
    console.log(`${elementId}: no record`);
    continue;
  }
  const treads = record.stairTreads as [Point3, Point3, Point3, Point3][] | undefined;
  console.log(`\nelement ${elementId}`);
  console.log(`  treads=${treads?.length ?? 0}` +
    ` thickness=${record.stairTreadThicknessFeet}` +
    ` begin=${record.stairBeginWithRiser} end=${record.stairEndWithRiser}` +
    ` expectedRisers=${record.stairExpectedRiserCount}`);
  if (!treads?.length) continue;

  const byElevation = new Map<string, [Point3, Point3, Point3, Point3][]>();
  for (const tread of treads) {
    const key = tread[0][2].toFixed(6);
    const group = byElevation.get(key) ?? [];
    group.push(tread);
    byElevation.set(key, group);
  }
  const elevations = [...byElevation.keys()]
    .sort((left, right) => Number(left) - Number(right));
  console.log(`  elevation groups=${elevations.length}` +
    ` cells/group=${elevations.map((key) => byElevation.get(key)!.length).join(",")}`);

  const pointKey = (point: Point3) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
  const edgeKey = (start: Point3, end: Point3) => {
    const a = pointKey(start);
    const b = pointKey(end);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const distancePointToSegment = (point: Point3, start: Point3, end: Point3) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const parameter = lengthSquared <= 1e-12
      ? 0
      : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    return Math.hypot(
      point[0] - (start[0] + dx * parameter),
      point[1] - (start[1] + dy * parameter),
    );
  };

  for (let index = 0; index + 1 < elevations.length; index += 1) {
    const lower = byElevation.get(elevations[index]!)!;
    const upper = byElevation.get(elevations[index + 1]!)!;
    const upperRearKeys = new Set(upper.map((tread) => edgeKey(tread[3], tread[0])));
    let exactJoins = 0;
    const successorDistances: number[] = [];
    for (const tread of lower) {
      const frontKey = edgeKey(tread[1], tread[2]);
      if (upperRearKeys.has(frontKey)) {
        exactJoins += 1;
        continue;
      }
      // nearSuccessorRearSide: max over front-edge start/mid/end of min
      // distance to any upper rear edge.
      const start = tread[1];
      const end = tread[2];
      const midpoint: Point3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, 0];
      const distance = Math.max(...[start, midpoint, end].map((point) =>
        Math.min(...upper.map((candidate) =>
          distancePointToSegment(point, candidate[3], candidate[0])))));
      successorDistances.push(distance);
    }
    const within = successorDistances.filter((distance) => distance <= 0.35).length;
    const sorted = [...successorDistances].sort((left, right) => left - right);
    const rise = Number(elevations[index + 1]!) - Number(elevations[index]!);
    console.log(`  gap ${index}: rise=${rise.toFixed(3)}` +
      ` lower=${lower.length} upper=${upper.length}` +
      ` exactJoins=${exactJoins}` +
      ` successorWithin0.35=${within}/${successorDistances.length}` +
      (sorted.length
        ? ` distances min=${sorted[0]!.toFixed(3)}` +
          ` median=${sorted[Math.floor(sorted.length / 2)]!.toFixed(3)}` +
          ` max=${sorted.at(-1)!.toFixed(3)}`
        : ""));
  }
}
