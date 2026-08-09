#!/usr/bin/env node

/**
 * For curved stair runs: fit the common centre the tread boundary planes
 * rotate around, then report each boundary's angle against a uniform angular
 * spacing between the first and last boundary — the polar analog of the
 * straight-run drift measurement. Also reports the run's sketch arcs (exact
 * persisted centre/angles) when present, which are the candidate respacing
 * anchor.
 *
 *   node --experimental-strip-types scripts/probe-riser-arc-angles.ts model.rvt 1801503 ...
 */
import { convertModel } from "./audit-coverage.ts";

type Point3 = [number, number, number];

const [rvtPath, ...idArguments] = process.argv.slice(2);
const focusIds = idArguments.map(Number).filter((id) => Number.isFinite(id));
if (!rvtPath || !focusIds.length) {
  throw new Error("usage: probe-riser-arc-angles.ts model.rvt <elementId...>");
}

const result = convertModel(rvtPath);
for (const elementId of focusIds) {
  const record = result.elementBounds.find((entry) => entry.elementId === elementId);
  const treads = record?.stairTreads as [Point3, Point3, Point3, Point3][] | undefined;
  console.log(`\nelement ${elementId}: treads=${treads?.length ?? 0}` +
    ` expectedRisers=${record?.stairExpectedRiserCount}` +
    ` begin=${record?.stairBeginWithRiser} end=${record?.stairEndWithRiser}`);
  if (!treads?.length) continue;

  // Boundary planes: group treads by elevation; each group's rear edges form
  // one boundary polyline; the top group's front edges form the last.
  const byElevation = new Map<string, [Point3, Point3, Point3, Point3][]>();
  for (const tread of treads) {
    const key = tread[0][2].toFixed(6);
    const group = byElevation.get(key) ?? [];
    group.push(tread);
    byElevation.set(key, group);
  }
  const elevationKeys = [...byElevation.keys()]
    .sort((left, right) => Number(left) - Number(right));
  type Boundary = { segments: Array<[Point3, Point3]> };
  const boundaries: Boundary[] = elevationKeys.map((key) => ({
    segments: byElevation.get(key)!.map((tread) => [tread[3], tread[0]] as [Point3, Point3]),
  }));
  const top = byElevation.get(elevationKeys.at(-1)!)!;
  boundaries.push({ segments: top.map((tread) => [tread[1], tread[2]] as [Point3, Point3]) });

  // Least-squares point minimizing distance to every boundary segment's line:
  // sum over lines of (n·p - n·a)^2 with unit normals n.
  let sxx = 0, sxy = 0, syy = 0, sxb = 0, syb = 0;
  let lines = 0;
  for (const boundary of boundaries) {
    for (const [a, b] of boundary.segments) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const offset = nx * a[0] + ny * a[1];
      sxx += nx * nx; sxy += nx * ny; syy += ny * ny;
      sxb += nx * offset; syb += ny * offset;
      lines += 1;
    }
  }
  const determinant = sxx * syy - sxy * sxy;
  if (Math.abs(determinant) < 1e-9) {
    console.log("  boundary lines are (near-)parallel; no centre");
    continue;
  }
  const centreX = (syy * sxb - sxy * syb) / determinant;
  const centreY = (sxx * syb - sxy * sxb) / determinant;

  // Residual of the fit: how far each boundary line passes from the centre,
  // relative to the boundary's own radius span. A radial-boundary run has
  // tiny residuals; anything else is not a concentric stair.
  let worstMiss = 0;
  const angles: number[] = [];
  for (const boundary of boundaries) {
    let angleSum = 0;
    let weight = 0;
    for (const [a, b] of boundary.segments) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const miss = Math.abs(nx * (centreX - a[0]) + ny * (centreY - a[1]));
      worstMiss = Math.max(worstMiss, miss);
      const midX = (a[0] + b[0]) / 2 - centreX;
      const midY = (a[1] + b[1]) / 2 - centreY;
      angleSum += Math.atan2(midY, midX) * length;
      weight += length;
    }
    angles.push(angleSum / weight);
  }
  console.log(`  fitted centre (${centreX.toFixed(2)}, ${centreY.toFixed(2)})` +
    ` from ${lines} boundary lines, worst line misses centre by ${worstMiss.toFixed(3)} ft`);
  const degrees = angles.map((angle) => angle * 180 / Math.PI);
  const first = degrees[0]!;
  const last = degrees.at(-1)!;
  const count = degrees.length - 1;
  console.log("  boundary angles vs uniform (deg):");
  for (const [index, angle] of degrees.entries()) {
    const uniform = first + (last - first) * (index / count);
    console.log(`    ${index}: ${angle.toFixed(2)} uniform=${uniform.toFixed(2)}` +
      ` drift=${(angle - uniform).toFixed(2)}`);
  }
  const radius = Math.hypot(
    treads[0]![0][0] - centreX,
    treads[0]![0][1] - centreY,
  );
  console.log(`  inner-corner radius ~${radius.toFixed(1)} ft;` +
    ` 1 deg of drift = ${(radius * Math.PI / 180).toFixed(2)} ft at that radius`);
}
