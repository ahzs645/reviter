/**
 * Walk the rectified model with this project's own first-person physics.
 *
 * The consumer downstream squares off-grid wings before it voxelizes, and it
 * measures the result on its own voxel lattice — vanilla Minecraft steps, a
 * one-block rise, a three-block drop. That is a fine measure of a Minecraft
 * world and a poor one of a building: it answers what a player can do in the
 * cubes, not what a person could do in the model.
 *
 * `WalkSurfaceIndex` and `WalkCollisionIndex` are what the studio's own walk
 * mode stands and steps on — real triangles, a 0.6 m step-up, a 1.8 m eye. This
 * builds them over the recovered geometry, optionally with the wing transforms
 * applied, and floods the walkable surface from a start. Same geometry, same
 * step rule, no lattice in between.
 */
import * as THREE from "three";

import { WalkCollisionIndex, WalkSurfaceIndex } from "../../app/studio/walk-surface.ts";
import { toFeet, wingAt, move, type RectifyPlanInput, type Wing } from "./rectify-plan.ts";
import type { ConvertResult } from "./types.ts";

/** The studio's own constants, in Revit feet. */
const FEET_PER_METRE = 1 / 0.3048;
export const EYE_HEIGHT_FEET = 1.8 * FEET_PER_METRE;
export const MAX_STEP_UP_FEET = 0.6 * FEET_PER_METRE;
/** A drop the walker takes rather than refuses. Falling is not a step. */
export const MAX_DROP_FEET = 4 * FEET_PER_METRE;

/**
 * The model's triangles as one flat, de-indexed position array, with each
 * triangle moved by the wing its own centroid falls in.
 *
 * De-indexed because assignment is per TRIANGLE: two triangles sharing a vertex
 * can belong to different wings, and one array position cannot hold both. An
 * element the hull claimed whole (`claimed`) overrides the per-triangle test,
 * so a mullion the hull never reached still travels with the wall it hangs on.
 */
export function rectifiedTriangles(
  result: ConvertResult,
  wings: Wing[] = [],
  claimed: ReadonlyMap<number, Wing> = new Map(),
): Float32Array {
  let triangles = 0;
  for (const mesh of result.meshes) triangles += Math.floor(mesh.indices.length / 3);
  const out = new Float32Array(triangles * 9);

  let write = 0;
  for (const mesh of result.meshes) {
    const { positions, indices } = mesh;
    for (let face = 0; face * 3 + 2 < indices.length; face += 1) {
      const ia = indices[face * 3]! * 3;
      const ib = indices[face * 3 + 1]! * 3;
      const ic = indices[face * 3 + 2]! * 3;
      const corners: [number, number, number][] = [
        [positions[ia]!, positions[ia + 1]!, positions[ia + 2]!],
        [positions[ib]!, positions[ib + 1]!, positions[ib + 2]!],
        [positions[ic]!, positions[ic + 1]!, positions[ic + 2]!],
      ];
      let wing: Wing | null = null;
      if (wings.length) {
        const elementId = mesh.elementIds?.[face];
        wing = (elementId == null ? null : claimed.get(elementId) ?? null)
          ?? wingAt(wings,
            (corners[0][0] + corners[1][0] + corners[2][0]) / 3,
            (corners[0][1] + corners[1][1] + corners[2][1]) / 3);
      }
      for (const corner of corners) {
        if (wing) {
          const [x, y] = move(wing, corner[0], corner[1]);
          out[write] = x; out[write + 1] = y; out[write + 2] = corner[2];
        } else {
          out[write] = corner[0]; out[write + 1] = corner[1]; out[write + 2] = corner[2];
        }
        write += 3;
      }
    }
  }
  return out;
}

export type WalkIndexes = {
  surface: WalkSurfaceIndex;
  collision: WalkCollisionIndex;
  triangles: number;
};

/**
 * The model is z-up in Revit's own frame, so the indexes are built z-up too —
 * the studio re-frames to y-up for the camera, and re-framing here as well
 * would only be a second chance to get it wrong.
 */
export function walkIndexes(triangles: Float32Array): WalkIndexes {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(triangles, 3));
  const identity = new THREE.Matrix4();
  const surface = new WalkSurfaceIndex({ up: "z", cellSize: 4 });
  const collision = new WalkCollisionIndex({ up: "z", cellSize: 4 });
  surface.addGeometry(geometry, identity);
  collision.addGeometry(geometry, identity);
  return { surface, collision, triangles: Math.floor(triangles.length / 9) };
}

export type WalkReport = {
  start: [number, number, number] | null;
  /** Plan cells the walker reached, on a `stride`-foot lattice. */
  reached: number;
  /** Those cells' bounding box, in feet. */
  bounds: [number, number, number, number] | null;
  /** Steps refused because the rise was more than one step. */
  blockedByRise: number;
  /** Steps refused because something solid stood in the way. */
  blockedByWall: number;
};

/**
 * Flood the walkable surface from `start`, one stride at a time, four ways.
 *
 * Not a route and not a percentage: an area. Two builds of the same building
 * walked from the same door differ in how much of it a person can get to, and
 * that number does not need a lattice to be comparable.
 */
export function walkFrom(
  indexes: WalkIndexes,
  start: [number, number],
  { stride = 2, limit = 200_000, maxDrop = MAX_DROP_FEET }: {
    stride?: number; limit?: number; maxDrop?: number;
  } = {},
): WalkReport {
  const { surface, collision } = indexes;
  const probe = new THREE.Vector3();
  const floorAt = (x: number, y: number, from: number, drop = maxDrop): number | null => {
    probe.set(x, y, from);
    return surface.floorAt(probe, { maxDrop: drop });
  };

  const key = (i: number, j: number) => `${i},${j}`;
  const i0 = Math.round(start[0] / stride);
  const j0 = Math.round(start[1] / stride);
  // The first probe drops from far above with no limit: the walker has to find
  // the ground before it can be told how far it may fall from it.
  const base = floorAt(i0 * stride, j0 * stride, 1e6, Infinity);
  const report: WalkReport = {
    start: base == null ? null : [i0 * stride, j0 * stride, base],
    reached: 0, bounds: null, blockedByRise: 0, blockedByWall: 0,
  };
  if (base == null) return report;

  const heights = new Map<string, number>([[key(i0, j0), base]]);
  const queue: [number, number][] = [[i0, j0]];
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let minI = i0; let maxI = i0; let minJ = j0; let maxJ = j0;

  while (queue.length && heights.size < limit) {
    const [i, j] = queue.pop()!;
    const here = heights.get(key(i, j))!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di; const nj = j + dj;
      if (heights.has(key(ni, nj))) continue;
      const nx = ni * stride; const ny = nj * stride;
      // Something solid across the way, at knee height, stops the step.
      origin.set(i * stride, j * stride, here + MAX_STEP_UP_FEET);
      direction.set(di, dj, 0).normalize();
      const hit = collision.nearestHit(origin, direction, stride);
      if (hit != null && hit < stride) { report.blockedByWall += 1; continue; }
      const there = floorAt(nx, ny, here + EYE_HEIGHT_FEET);
      if (there == null) continue;
      if (there - here > MAX_STEP_UP_FEET) { report.blockedByRise += 1; continue; }
      heights.set(key(ni, nj), there);
      queue.push([ni, nj]);
      if (ni < minI) minI = ni; if (ni > maxI) maxI = ni;
      if (nj < minJ) minJ = nj; if (nj > maxJ) maxJ = nj;
    }
  }
  report.reached = heights.size;
  report.bounds = [minI * stride, minJ * stride, maxI * stride, maxJ * stride];
  return report;
}

/** The plan box the triangles occupy, in feet. */
export function triangleBounds(triangles: Float32Array): [number, number, number, number] {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i + 1 < triangles.length; i += 3) {
    const x = triangles[i]!; const y = triangles[i + 1]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * The nearest place to `want` that has a floor under it, searched outward.
 *
 * A start point given in the consumer's coordinates lands in mid-air often
 * enough — over a light well, off the edge of a plate, in the gap a wing move
 * opened — and a walk that reports zero because it started in the air says
 * nothing about the building.
 */
export function startNear(
  indexes: WalkIndexes, want: [number, number], step = 8, rings = 24,
): [number, number] | null {
  const probe = new THREE.Vector3();
  const hasFloor = (x: number, y: number) => {
    probe.set(x, y, 1e6);
    return indexes.surface.floorAt(probe, { maxDrop: Infinity }) != null;
  };
  if (hasFloor(want[0], want[1])) return want;
  for (let ring = 1; ring <= rings; ring += 1) {
    const r = ring * step;
    for (let k = -ring; k <= ring; k += 1) {
      const offsets: [number, number][] = [
        [k * step, -r], [k * step, r], [-r, k * step], [r, k * step],
      ];
      for (const [dx, dy] of offsets) {
        if (hasFloor(want[0] + dx, want[1] + dy)) return [want[0] + dx, want[1] + dy];
      }
    }
  }
  return null;
}

/**
 * Wings in the model's own frame, from the transforms the consumer publishes.
 *
 * `originFeet` is not optional in spirit: the consumer reads the IFC in world
 * coordinates, and the IFC export puts `result.origin` on the shared placement,
 * so its hulls are 87 m north of the geometry on this model. Pass
 * `result.origin`.
 */
export function wingsFor(
  input: RectifyPlanInput, originFeet: readonly [number, number] = [0, 0],
): Wing[] {
  return toFeet(input, originFeet);
}
