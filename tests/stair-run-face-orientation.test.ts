import assert from "node:assert/strict";
import test from "node:test";

import { buildBoundsMeshes } from "../lib/reviter/scene.ts";
import type { ElementBoundsRecord, Point3 } from "../lib/reviter/types.ts";

/**
 * A reconstructed stair run is the one thing the studio draws front-face only
 * (`three-scene.ts`), because drawing its back faces exposes the underside of
 * a landing as a wall Autodesk's own render does not show. That makes the
 * winding load-bearing rather than cosmetic: a face pointing into the run is
 * not a shading artefact, it is a hole the building is visible through.
 *
 * These tests check the property that matters — the run's own material is
 * behind every face it draws — rather than a triangle count or an index order,
 * either of which can be met by a mesh that is inside out.
 */

type Prism = { ring: [number, number][]; z0: number; z1: number };

/** The blocks a run occupies: each tread cell extruded down to its own base. */
function runSolid(record: ElementBoundsRecord): Prism[] {
  const treads = record.stairTreads!;
  const baseZ = record.boundsFeet.min.z;
  const elevations = [...new Set(treads.map((tread) => tread[0][2]))]
    .sort((left, right) => left - right);
  const prisms: Prism[] = [];
  for (const tread of treads) {
    const topZ = tread[0][2];
    const bottomZ = record.stairMonumentalSolid
      ? elevations[elevations.indexOf(topZ) - 1] ?? baseZ
      : record.stairTreadThicknessFeet == null
        ? baseZ
        : Math.max(baseZ, topZ - record.stairTreadThicknessFeet);
    const ring: [number, number][] = [];
    for (const [x, y] of tread) {
      const last = ring.at(-1);
      if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-9) ring.push([x, y]);
    }
    const first = ring[0]!;
    const last = ring.at(-1)!;
    if (ring.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) {
      ring.pop();
    }
    if (ring.length >= 3) prisms.push({ ring, z0: bottomZ, z1: topZ });
  }
  return prisms;
}

function inside(prisms: Prism[], [x, y, z]: Point3): boolean {
  return prisms.some(({ ring, z0, z1 }) => {
    if (z <= z0 + 1e-9 || z >= z1 - 1e-9) return false;
    let hit = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [xi, yi] = ring[index]!;
      const [xj, yj] = ring[previous]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  });
}

/** Faces whose normal points into the run's own material — invisible holes. */
function invertedFaces(record: ElementBoundsRecord): number {
  const prisms = runSolid(record);
  let inverted = 0;
  for (const mesh of buildBoundsMeshes([record], { x: 0, y: 0, z: 0 })) {
    const { positions, indices } = mesh;
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const corners = [0, 1, 2].map((offset) => {
        const vertex = indices[triangle + offset]!;
        return [
          positions[vertex * 3]!,
          positions[vertex * 3 + 1]!,
          positions[vertex * 3 + 2]!,
        ] as Point3;
      });
      const [a, b, c] = corners as [Point3, Point3, Point3];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ];
      const length = Math.hypot(...normal);
      if (length < 1e-9) continue;
      const centre = [0, 1, 2].map((axis) => (a[axis]! + b[axis]! + c[axis]!) / 3);
      const step = (sign: number) => centre.map((value, axis) =>
        value + (sign * 0.002 * normal[axis]!) / length) as unknown as Point3;
      if (inside(prisms, step(1)) && !inside(prisms, step(-1))) inverted += 1;
    }
  }
  return inverted;
}

function runRecord(
  treads: [Point3, Point3, Point3, Point3][],
  extra: Partial<ElementBoundsRecord>,
): ElementBoundsRecord {
  const xs = treads.flat().map((point) => point[0]);
  const ys = treads.flat().map((point) => point[1]);
  const zs = treads.flat().map((point) => point[2]);
  return {
    elementId: 1_821_222,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 81,
    recordCount: 13,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    boundsFeet: {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    },
    stairTreads: treads,
    ...extra,
  };
}

/** `count` treads, each `depth` deep and `width` wide, rising by `rise`. */
function straightRun(
  count: number,
  { rise = 0.45, depth = 1, width = 6, clockwise = false } = {},
): [Point3, Point3, Point3, Point3][] {
  return Array.from({ length: count }, (_unused, step) => {
    const y0 = step * depth;
    const y1 = y0 + depth;
    const z = (step + 1) * rise;
    const anticlockwise: [Point3, Point3, Point3, Point3] = [
      [0, y0, z], [width, y0, z], [width, y1, z], [0, y1, z],
    ];
    return clockwise
      ? [...anticlockwise].reverse() as [Point3, Point3, Point3, Point3]
      : anticlockwise;
  });
}

test("a terraced run's risers face out of the stair, not into it", () => {
  // Run 1821222 in the supplied model: a 32-riser monumental flight whose
  // treads tile the plan, so consecutive cells share their riser edge exactly
  // and every riser is built from that shared edge. One winding was emitted
  // for the whole riser, which is right only below the shared elevation —
  // above it the upper block is the material behind the wall. Every exposed
  // riser therefore faced backwards and the 55.81 ft run drew as floating
  // treads with the building visible between every step.
  const record = runRecord(straightRun(8), {
    stairMonumentalSolid: true,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
  });
  assert.equal(invertedFaces(record), 0);
});

test("a slab run's riser and soffit faces survive an open riser gap", () => {
  // The thickness route splits the same edge into three: the lower slab's back
  // face, the air gap a closed riser fills, and the upper slab's riser.
  const record = runRecord(straightRun(8), {
    stairTreadThicknessFeet: 0.164,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
  });
  assert.equal(invertedFaces(record), 0);
});

test("clockwise tread cells are drawn the same way round as anticlockwise ones", () => {
  // The readers do not agree on a plan winding — the curved run 1460781
  // arrives as 521 clockwise quads and 36 anticlockwise triangles — and every
  // winding in the mesh is read off the cell's own corner order. Left alone, a
  // clockwise cell's caps and side walls all face into the stair.
  const clockwise = runRecord(straightRun(8, { clockwise: true }), {
    stairTreadThicknessFeet: 0.164,
  });
  assert.equal(invertedFaces(clockwise), 0);

  // Orientation is the only thing normalised: the run still draws the same
  // shape, with the same triangle budget, whichever way its cells were wound.
  const [anticlockwiseMesh] = buildBoundsMeshes(
    [runRecord(straightRun(8), { stairTreadThicknessFeet: 0.164 })],
    { x: 0, y: 0, z: 0 },
  );
  const [clockwiseMesh] = buildBoundsMeshes([clockwise], { x: 0, y: 0, z: 0 });
  assert.equal(clockwiseMesh!.indices.length, anticlockwiseMesh!.indices.length);
  assert.deepEqual(
    [...clockwiseMesh!.positions].sort((left, right) => left - right),
    [...anticlockwiseMesh!.positions].sort((left, right) => left - right),
  );
});
