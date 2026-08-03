import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recoverConnectedStairTreads,
  recoverFlattenedProfileStairTreads,
  recoverGuideChainStairTreads,
  recoverProfiledGuideStairTreads,
  recoverStraightStairTreads,
} from "../lib/reviter/stair-treads.ts";
import { buildBoundsMeshes } from "../lib/reviter/scene.ts";
import type { Point3, SketchCurve } from "../lib/reviter/sketch-curves.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const line = (
  start: [number, number, number],
  end: [number, number, number],
): SketchCurve => ({ offset: 0, owner: 1, kind: "line", start, end, interior: [] });

function straightFlight(): SketchCurve[] {
  const curves: SketchCurve[] = [];
  // Four tread boundaries, each repeated as persisted face representations.
  for (let step = 0; step <= 3; step += 1) {
    for (let copy = 0; copy < 3; copy += 1) {
      curves.push(line([step, 0, 0], [step, 4, 0]));
    }
  }
  // Two rising walking lines validate the step count, direction, depth and rise.
  for (const y of [1, 3]) {
    for (let step = 0; step < 3; step += 1) {
      curves.push(line([step, y, step * 0.5], [step + 1, y, (step + 1) * 0.5]));
    }
  }
  return curves;
}

test("recovers individual treads from repeated plan lines and rising segments", () => {
  const result = recoverStraightStairTreads(straightFlight(), {
    min: { x: 0, y: 0, z: 10 },
    max: { x: 3, y: 4, z: 11.5 },
  });
  assert.ok(result);
  assert.equal(result.source, "native-stair-sketch");
  assert.equal(result.treads.length, 3);
  assert.equal(result.riserHeightFeet, 0.5);
  assert.equal(result.treadDepthFeet, 1);
  assert.deepEqual(result.treads.map((tread) => tread[0][2]), [10.5, 11, 11.5]);
  assert.deepEqual(result.treads[2]!.map(([x, y]) => [x, y]), [
    [2, 0], [3, 0], [3, 4], [2, 4],
  ]);
});

test("declines an ordinary repeated hatch with no rising stair evidence", () => {
  const curves = straightFlight().filter((curve) => curve.start[2] === curve.end[2]);
  assert.equal(recoverStraightStairTreads(curves, {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 3, y: 4, z: 1.5 },
  }), null);
});

test("declines a spiral or winder whose tread boundaries are not parallel", () => {
  const curves = straightFlight();
  curves.push(line([1, 0, 0], [3, 3, 0]));
  curves.push(line([1, 0, 0], [3, 3, 0]));
  curves.push(line([1, 0, 0], [3, 3, 0]));
  assert.equal(recoverStraightStairTreads(curves, {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 3, y: 4, z: 1.5 },
  }), null);
});

test("recovers winder treads through exact quarter-width guide adjacency", () => {
  const curves: SketchCurve[] = [];
  const boundaries = Array.from({ length: 4 }, (_, index) => {
    const angle = (index * Math.PI) / 18;
    const dx = Math.cos(angle) * 2;
    const dy = Math.sin(angle) * 2;
    return [
      [-dx, index - dy, 0],
      [dx, index + dy, 0],
    ] as const;
  });
  for (const boundary of boundaries) {
    for (let copy = 0; copy < 3; copy += 1) {
      curves.push(line([...boundary[0]], [...boundary[1]]));
    }
  }
  const quarter = (
    boundary: typeof boundaries[number],
    fraction: number,
    z: number,
  ): [number, number, number] => [
    boundary[0][0] + (boundary[1][0] - boundary[0][0]) * fraction,
    boundary[0][1] + (boundary[1][1] - boundary[0][1]) * fraction,
    z,
  ];
  for (let step = 0; step < boundaries.length - 1; step += 1) {
    for (const fraction of [0.25, 0.75]) {
      curves.push(line(
        quarter(boundaries[step]!, fraction, step * 0.5),
        quarter(boundaries[step + 1]!, fraction, (step + 1) * 0.5),
      ));
    }
  }
  const xs = boundaries.flatMap((boundary) =>
    boundary.flatMap((point) => point[0]));
  const ys = boundaries.flatMap((boundary) =>
    boundary.flatMap((point) => point[1]));
  const recovered = recoverConnectedStairTreads(curves, {
    min: { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: 1.5 },
  }, {
    actualRunWidthFeet: 4,
    maximumRiserCount: 3,
  });
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 3);
  assert.deepEqual(
    recovered.treads.map((tread) => tread[0][2]),
    [0.5, 1, 1.5],
  );
  assert.ok(
    recovered.treads.some((tread, index) =>
      index > 0 && tread[0][0] !== recovered.treads[0]![0][0]),
  );
});

test("recovers switchback treads from a flattened plan and rising guide chains", () => {
  const boundaries = [
    [[0, 0, 12], [4, 0, 12]],
    [[0, 1, 12], [4, 1, 12]],
    [[0, 2, 12], [4, 2, 12]],
    [[0, 3, 12], [4, 3, 12]],
    [[-1, 4, 12], [-1, 8, 12]],
  ] as const;
  const curves: SketchCurve[] = boundaries.flatMap(([start, end]) => [
    line([...start], [...end]),
    // Revit can persist the same plan edge at the opposite vertical extent.
    line([start[0], start[1], 0], [end[0], end[1], 0]),
  ]);
  const quarter = (
    [start, end]: (typeof boundaries)[number],
    fraction: number,
    z: number,
  ): Point3 => [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
    z,
  ];
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    for (const fraction of [0.25, 0.75]) {
      curves.push(line(
        quarter(boundaries[index]!, fraction, index),
        quarter(boundaries[index + 1]!, fraction, index + 1),
      ));
    }
  }

  const recovered = recoverGuideChainStairTreads(
    curves,
    {
      min: { x: -1, y: 0, z: 0 },
      max: { x: 4, y: 8, z: 5 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 5 },
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 4);
  assert.deepEqual(
    recovered.treads.map((tread) => tread[0][2]),
    [1, 2, 3, 4],
  );
  assert.equal(recovered.riserHeightFeet, 1);
});

test("recovers repeated curved profiles from a complete rising guide chain", () => {
  const curves: SketchCurve[] = [];
  const profiles: SketchCurve[] = [];
  for (let index = 0; index < 4; index += 1) {
    const radius = 4 + index;
    const curve: SketchCurve = {
      offset: 0,
      owner: 1,
      kind: "arc",
      start: [radius, 0, 0],
      end: [0, radius, 0],
      interior: [[radius / Math.sqrt(2), radius / Math.sqrt(2), 0]],
    };
    profiles.push(curve);
    curves.push(curve, { ...curve });
  }
  for (let index = 0; index < 3; index += 1) {
    curves.push(line(
      [4 + index, 0, 0.5 + index * 0.5],
      [5 + index, 0, 1 + index * 0.5],
    ));
  }
  const recovered = recoverProfiledGuideStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 7, y: 7, z: 2 },
    },
    { actualRunWidthFeet: 3, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  assert.equal(recovered.riserHeightFeet, 0.5);
  assert.equal(recovered.treads.length, 6);
  assert.deepEqual(
    [...new Set(recovered.treads.map((tread) => tread[0][2]))],
    [0.5, 1, 1.5],
  );
});

test("orders flattened profiles from the independently persisted bottom profile", () => {
  const curves: SketchCurve[] = [];
  for (let step = 0; step < 4; step += 1) {
    const profile = line([step, 0, 2], [step, 4, 2]);
    curves.push(profile, { ...profile });
  }
  curves.push(line([0, 0, 0], [0, 4, 0]));
  const recovered = recoverFlattenedProfileStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 3, y: 4, z: 2 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 3);
  assert.deepEqual(
    recovered.treads.map((tread) => tread[0][2]),
    [0.5, 1, 1.5],
  );
  assert.equal(recovered.treadDepthFeet, 1);
});

test("keeps duplicated rotated profiles in an exact-count flattened run", () => {
  const curves: SketchCurve[] = [];
  const profiles = [
    line([0, 0, 2], [0, 10, 2]),
    line([1, 0, 2], [1, 10, 2]),
    line([2, 0, 2], [2.25, 10, 2]),
    line([3, 0, 2], [3.5, 10, 2]),
  ];
  for (const profile of profiles) curves.push(profile, { ...profile });
  // The duplicated base profile independently chooses the path endpoint.
  curves.push(line([0, 0, 0], [0, 10, 0]));
  // An exact-width drawing edge must not displace a complete duplicated
  // profile cohort merely because the last two profiles rotate.
  curves.push(line([0, 0, 2], [4, 0, 2]));

  const recovered = recoverFlattenedProfileStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 3.5, y: 10, z: 2 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 3);
  assert.deepEqual(
    recovered.treads.map((tread) => tread[0][2]),
    [0.5, 1, 1.5],
  );
});

test("the diagnostic scene draws every recovered tread instead of the run envelope", () => {
  const bounds = {
    min: { x: 0, y: 0, z: 10 },
    max: { x: 3, y: 4, z: 11.5 },
  };
  const recovered = recoverStraightStairTreads(straightFlight(), bounds);
  assert.ok(recovered);
  const record = {
    elementId: 1,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreads: recovered.treads,
    boundsFeet: bounds,
  } satisfies ElementBoundsRecord;
  const meshes = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0]!.positions.length, 3 * 8 * 3);
  assert.equal(meshes[0]!.indices.length, 36 * 3);
  assert.ok(meshes[0]!.elementIds?.every((elementId) => elementId === 1));
});

test("a persisted tread thickness produces horizontal slabs instead of base-filled columns", () => {
  const record = {
    elementId: 2,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreadThicknessFeet: 0.16,
    stairTreads: [
      [[0, 0, 0.5], [1, 0, 0.5], [1, 3, 0.5], [0, 3, 0.5]],
      [[1, 0, 1], [2, 0, 1], [2, 3, 1], [1, 3, 1]],
    ],
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 3, z: 1 },
    },
  } satisfies ElementBoundsRecord;

  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  const roundedBottom = (start: number) =>
    [...mesh.positions.slice(start, start + 12)]
      .filter((_, index) => index % 3 === 2)
      .map((value) => Number(value.toFixed(2)));
  const firstBottom = roundedBottom(0);
  const secondBottom = roundedBottom(24);
  assert.deepEqual(firstBottom, [0.34, 0.34, 0.34, 0.34]);
  assert.deepEqual(secondBottom, [0.84, 0.84, 0.84, 0.84]);
  // The shared boundary retains the lower slab edge and continues it as one
  // riser. The upper slab's covered back face is not emitted on top of it.
  assert.equal(mesh.indices.length, 26 * 3);
  const sharedEdgeTriangles = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const vertexIndices = mesh.indices.slice(index, index + 3);
    const vertices = Array.from(vertexIndices, (vertexIndex) =>
      Array.from(mesh.positions.slice(vertexIndex * 3, vertexIndex * 3 + 3)));
    if (vertices.every(([x]) => Math.abs(x! - 1) < 1e-6)) {
      sharedEdgeTriangles.push([
        Math.min(...vertices.map(([, , z]) => z!)),
        Math.max(...vertices.map(([, , z]) => z!)),
      ]);
    }
  }
  assert.deepEqual(
    sharedEdgeTriangles.map(([min, max]) => [
      Number(min!.toFixed(2)),
      Number(max!.toFixed(2)),
    ]),
    [
      [0.34, 0.5], [0.34, 0.5],
      [0.5, 0.84], [0.5, 0.84],
      [0.84, 1], [0.84, 1],
    ],
  );
});

test("native run end conditions close the exposed first and last risers", () => {
  const record = {
    elementId: 1460781,
    stream: "Partitions/325",
    chunkIndex: 3_032,
    rawOffset: 0,
    recordOffset: 0x1d8b4,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreadThicknessFeet: 0.16,
    stairBeginWithRiser: true,
    stairEndWithRiser: true,
    stairTreads: [
      [[0, 0, 0.5], [1, 0, 0.5], [1, 3, 0.5], [0, 3, 0.5]],
      [[1, 0, 1], [2, 0, 1], [2, 3, 1], [1, 3, 1]],
    ],
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 3, z: 1.25 },
    },
  } satisfies ElementBoundsRecord;

  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  const trianglesAtX = (x: number) => {
    const bands: number[][] = [];
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const vertices = Array.from(
        mesh.indices.slice(offset, offset + 3),
        (index) => Array.from(mesh.positions.slice(index * 3, index * 3 + 3)),
      );
      if (!vertices.every((point) => Math.abs(point[0]! - x) < 1e-6)) continue;
      bands.push([
        Number(Math.min(...vertices.map((point) => point[2]!)).toFixed(2)),
        Number(Math.max(...vertices.map((point) => point[2]!)).toFixed(2)),
      ]);
    }
    return bands;
  };
  assert.deepEqual(trianglesAtX(0), [[0, 0.5], [0, 0.5]]);
  assert.deepEqual(trianglesAtX(2), [[0.84, 1.25], [0.84, 1.25]]);
  const elevations = [...mesh.positions].filter((_, index) => index % 3 === 2);
  assert.equal(Math.min(...elevations), 0);
  assert.equal(Math.max(...elevations), 1.25);
});

test("equal-height curved tread segments share one horizontal slab elevation", () => {
  const record = {
    elementId: 3,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreadThicknessFeet: 0.16,
    stairTreads: [
      [[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]],
      [[0, 1, 0.5], [1, 1, 0.5], [1, 2, 0.5], [0, 2, 0.5]],
      [[1, 0, 1], [2, 0, 1], [2, 1, 1], [1, 1, 1]],
      [[1, 1, 1], [2, 1, 1], [2, 2, 1], [1, 2, 1]],
    ],
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 2, z: 1 },
    },
  } satisfies ElementBoundsRecord;

  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  const bottomZ = (cellIndex: number) =>
    [...mesh.positions.slice(cellIndex * 24, cellIndex * 24 + 12)]
      .filter((_, index) => index % 3 === 2)
      .map((value) => Number(value.toFixed(2)));
  assert.deepEqual(bottomZ(0), [0.34, 0.34, 0.34, 0.34]);
  assert.deepEqual(bottomZ(1), [0.34, 0.34, 0.34, 0.34]);
  assert.deepEqual(bottomZ(2), [0.84, 0.84, 0.84, 0.84]);
  assert.deepEqual(bottomZ(3), [0.84, 0.84, 0.84, 0.84]);
});
