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

/**
 * A tread whose 3→0 edge is its rear profile and 1→2 its forward one, which is
 * the ordering the riser and cap rules read corner roles from.
 */
function profiledTread(
  y0: number, y1: number, z: number, { x0 = 0, x1 = 6 } = {},
): [Point3, Point3, Point3, Point3] {
  return [[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]];
}

/** Vertical surface the mesh draws on one plan line, within a height band. */
function verticalSurfaceAt(
  record: ElementBoundsRecord,
  y: number,
  zLow: number,
  zHigh: number,
): number {
  let area = 0;
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
      if (!corners.every((corner) => Math.abs(corner[1] - y) < 1e-6)) continue;
      if (!corners.every((corner) =>
        corner[2] >= zLow - 1e-6 && corner[2] <= zHigh + 1e-6)) continue;
      const [a, b, c] = corners as [Point3, Point3, Point3];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      area += Math.hypot(
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ) / 2;
    }
  }
  return area;
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

test("a switchback's turn does not put its riser inside out", () => {
  // Two cells that share a plan edge normally sit on opposite sides of it, and
  // the rule above leans on that to decide which way the wall looks. A turn
  // breaks it: the tread above folds back over the ground the turn covers, so
  // both bodies end up on the same side and the wall faces away from both.
  // These three cells are run 2156103's 14th, 15th and 16th, translated to the
  // origin — a rectangle, the turn, and the rectangle that folds back over it.
  // The turn left one riser inverted on each of 14 runs in the supplied model.
  const depth = 0.9187;
  const treads: [Point3, Point3, Point3, Point3][] = [
    [[0, 0, 0.45], [0, depth, 0.45], [-4.5932, depth, 0.45], [-4.5932, 0, 0.45]],
    [[0, depth, 0.90], [-5.5774, 2 * depth, 0.90],
     [-10.1706, 2 * depth, 0.90], [-4.5932, depth, 0.90]],
    [[-10.1706, 2 * depth, 1.35], [-10.1706, depth, 1.35],
     [-5.5774, depth, 1.35], [-5.5774, 2 * depth, 1.35]],
  ];
  const record = runRecord(treads, {
    elementId: 2_156_103,
    stairTreadThicknessFeet: 0.164,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
  });
  // The turn is a real shared edge, so it must still be walled — just the
  // right way round.
  assert.ok(verticalSurfaceAt(record, 2 * depth, 0.45, 1.35) > 0);
  assert.equal(invertedFaces(record), 0);
});

test("a slab run closes the riser under a rear profile it does not share", () => {
  // Independently sampled profiles leave the tread above's rear edge unmatched
  // as readily as the tread below's forward edge — 201.7 ft against 234.1 ft on
  // run 1460781 — and only the forward one used to be closed. Under an
  // unmatched rear edge the slab's own side stops at the slab, so the run kept
  // an open slot at every step whose profiles were not sampled onto one line.
  const rise = 0.45;
  const thickness = 0.164;
  const gap = 0.05;
  const treads = Array.from({ length: 5 }, (_unused, step) =>
    profiledTread(step + gap, step + 1 - gap, (step + 1) * rise));
  const record = runRecord(treads, {
    elementId: 1_460_781,
    stairTreadThicknessFeet: thickness,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
  });

  // Tread 2 sits at z 0.90 with its underside at 0.736, and its rear edge at
  // y 1.05 shares no line with tread 1's forward edge at y 0.95. The air below
  // that edge, down to tread 1 at z 0.45, is the slot.
  const closure = verticalSurfaceAt(record, 1 + gap, rise, 2 * rise - thickness);
  assert.ok(
    closure > 6 * (rise - thickness) * 0.99,
    `expected the rear edge to be walled across the run, got ${closure} ft²`,
  );
  // The forward edge of the tread below keeps its own closure over the same
  // band, one plan line away.
  assert.ok(verticalSurfaceAt(record, 1 - gap, rise, 2 * rise - thickness) > 0);
  assert.equal(invertedFaces(record), 0);
});

test("the rear-profile closure stays out of a terraced run", () => {
  // A terraced block already reaches the tread below, so there is no air to
  // close and the rule must add nothing rather than a zero-height sliver.
  const treads = Array.from({ length: 5 }, (_unused, step) =>
    profiledTread(step + 0.05, step + 0.95, (step + 1) * 0.45));
  const terraced = runRecord(treads, {
    stairMonumentalSolid: true,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
  });
  const [mesh] = buildBoundsMeshes([terraced], { x: 0, y: 0, z: 0 });
  let degenerate = 0;
  for (let triangle = 0; triangle < mesh!.indices.length; triangle += 3) {
    const corners = [0, 1, 2].map((offset) => {
      const vertex = mesh!.indices[triangle + offset]!;
      return [
        mesh!.positions[vertex * 3]!,
        mesh!.positions[vertex * 3 + 1]!,
        mesh!.positions[vertex * 3 + 2]!,
      ] as Point3;
    });
    const [a, b, c] = corners as [Point3, Point3, Point3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    if (Math.hypot(
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ) < 1e-9) degenerate += 1;
  }
  assert.equal(degenerate, 0);
  assert.equal(invertedFaces(terraced), 0);
});
