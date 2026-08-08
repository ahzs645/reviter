import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  recoverConnectedStairTreads,
  recoverFlattenedProfileStairTreads,
  recoverGuideChainStairTreads,
  recoverPairedGuideProfileStairTreads,
  recoverProfiledGuideStairTreads,
  recoverStraightStairTreads,
  respaceStraightStairTreads,
} from "../lib/reviter/stair-treads.ts";
import { buildBoundsMeshes } from "../lib/reviter/scene.ts";
import type { Point3, SketchCurve } from "../lib/reviter/sketch-curves.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const line = (
  start: [number, number, number],
  end: [number, number, number],
): SketchCurve => ({ offset: 0, owner: 1, kind: "line", start, end, interior: [] });

const stair1821222Fixture = JSON.parse(readFileSync(
  new URL("./fixtures/stair-run-1821222.json", import.meta.url),
  "utf8",
)) as {
  elementId: number;
  bounds: ElementBoundsRecord["boundsFeet"];
  options: { actualRunWidthFeet: number; maximumRiserCount: number };
  curves: SketchCurve[];
};

const stair2075102Fixture = JSON.parse(readFileSync(
  new URL("./fixtures/stair-run-2075102.json", import.meta.url),
  "utf8",
)) as {
  elementId: number;
  bounds: ElementBoundsRecord["boundsFeet"];
  options: { actualRunWidthFeet: number; maximumRiserCount: number };
  profiles: Array<{ copies: number; start: Point3; end: Point3 }>;
  guides: Array<{ start: Point3; end: Point3 }>;
};

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

test("a curved tread may exceed four feet only when its local guide validates it", () => {
  const curves: SketchCurve[] = [];
  const radii = [10, 14.4, 18.8, 23.2];
  for (const radius of radii) {
    const profile: SketchCurve = {
      offset: 0,
      owner: 1,
      kind: "arc",
      start: [radius, 0, 0],
      end: [0, radius, 0],
      interior: [[radius / Math.sqrt(2), radius / Math.sqrt(2), 0]],
    };
    curves.push(profile, { ...profile });
  }
  for (let index = 0; index + 1 < radii.length; index += 1) {
    curves.push(line(
      [radii[index]!, 0, 0.5 + index * 0.5],
      [radii[index + 1]!, 0, 1 + index * 0.5],
    ));
  }
  const recovered = recoverProfiledGuideStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 23.2, y: 23.2, z: 2 },
    },
    { actualRunWidthFeet: 3.2, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 6);
  assert.deepEqual(
    [...new Set(recovered.treads.map((tread) => tread[0][2]))],
    [0.5, 1, 1.5],
  );
});

test("curved tessellation density cannot hide an unvalidated missing tread band", () => {
  const curves: SketchCurve[] = [];
  const radii = [10, 11, 20, 21];
  for (const radius of radii) {
    const profile: SketchCurve = {
      offset: 0,
      owner: 1,
      kind: "arc",
      start: [radius, 0, 0],
      end: [0, radius, 0],
      interior: [[radius / Math.sqrt(2), radius / Math.sqrt(2), 0]],
    };
    curves.push(profile, { ...profile });
  }
  for (let index = 0; index + 1 < radii.length; index += 1) {
    curves.push(line(
      [radii[index]!, 0, 0.5 + index * 0.5],
      [radii[index + 1]!, 0, 1 + index * 0.5],
    ));
  }
  assert.equal(recoverProfiledGuideStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 21, y: 21, z: 2 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 4 },
  ), null);
});

test("object 2075102 accepts only its independently validated broad tread depth", () => {
  assert.equal(stair2075102Fixture.elementId, 2_075_102);
  const curves = [
    ...stair2075102Fixture.profiles.flatMap((profile) =>
      Array.from(
        { length: profile.copies },
        () => line(profile.start, profile.end),
      )
    ),
    ...stair2075102Fixture.guides.map((guide) =>
      line(guide.start, guide.end)
    ),
  ];
  const recovered = recoverProfiledGuideStairTreads(
    curves,
    stair2075102Fixture.bounds,
    stair2075102Fixture.options,
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 7);
  assert.deepEqual(
    [...new Set(recovered.treads.map((tread) => tread[0][2]))],
    stair2075102Fixture.guides.map((guide) => guide.start[2]),
  );
  assert.ok(Math.abs(recovered.riserHeightFeet - 0.8202099737532809) < 1e-9);
  assert.ok(recovered.treadDepthFeet > 4);
  assert.ok(recovered.treadDepthFeet < 4.141);
});

test("does not bridge opposing curved profiles across a stair core", () => {
  const curves: SketchCurve[] = [];
  const arc = (radius: number, upper: boolean): SketchCurve => ({
    offset: 0,
    owner: 1,
    kind: "arc",
    start: [radius, 0, 0],
    end: [-radius, 0, 0],
    interior: Array.from({ length: 7 }, (_, index) => {
      const angle = Math.PI * (index + 1) / 8;
      return [
        radius * Math.cos(angle),
        (upper ? 1 : -1) * radius * Math.sin(angle),
        0,
      ] as Point3;
    }),
  });
  const profiles = [arc(10, true), arc(9.5, false), arc(9, false), arc(8.5, false)];
  for (const profile of profiles) curves.push(profile, { ...profile });
  for (let index = 0; index < 3; index += 1) {
    curves.push(line(
      [10 - index * 0.5, 0, 0.5 + index * 0.5],
      [9.5 - index * 0.5, 0, 1 + index * 0.5],
    ));
  }

  const recovered = recoverProfiledGuideStairTreads(
    curves,
    {
      min: { x: -10, y: -10, z: 0 },
      max: { x: 10, y: 10, z: 2 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  assert.ok(recovered.treads.length >= 3);
  for (const tread of recovered.treads) {
    const connector = (first: Point3, second: Point3) =>
      Math.hypot(first[0] - second[0], first[1] - second[1]);
    assert.ok(
      connector(tread[0], tread[1]) <= 4 || connector(tread[3], tread[2]) <= 4,
      "every retained patch has a plausible walking-side depth",
    );
  }
});

test("recovers complementary curved profiles as a certified circular landing", () => {
  const curves: SketchCurve[] = [];
  const arc = (
    radius: number,
    startAngle: number,
    endAngle: number,
  ): SketchCurve => ({
    offset: 0,
    owner: 1,
    kind: "arc",
    start: [radius * Math.cos(startAngle), radius * Math.sin(startAngle), 0],
    end: [radius * Math.cos(endAngle), radius * Math.sin(endAngle), 0],
    interior: Array.from({ length: 15 }, (_, index) => {
      const angle = startAngle + (endAngle - startAngle) * (index + 1) / 16;
      return [
        radius * Math.cos(angle),
        radius * Math.sin(angle),
        0,
      ] as Point3;
    }),
  });
  const profiles = [
    arc(10, 0, Math.PI),
    arc(9.5, 0.02, Math.PI - 0.02),
    arc(9.5, Math.PI + 0.02, Math.PI * 2 - 0.02),
    arc(9, Math.PI, Math.PI * 2),
  ];
  for (const profile of profiles) curves.push(profile, { ...profile });
  curves.push(
    line([0, 10, 0.5], [0, 9.5, 1]),
    line([0, 9.5, 1], [0, -9.5, 1.5]),
    line([0, -9.5, 1.5], [0, -9, 2]),
  );

  const recovered = recoverProfiledGuideStairTreads(
    curves,
    {
      min: { x: -10, y: -10, z: 0 },
      max: { x: 10, y: 10, z: 2 },
    },
    { actualRunWidthFeet: 4, maximumRiserCount: 4 },
  );
  assert.ok(recovered);
  const landing = recovered.treads.filter(
    (tread) => Math.abs(tread[0][2] - 1) < 1e-6,
  );
  assert.ok(landing.length >= 24);
  const area = landing.reduce((total, tread) => {
    let twice = 0;
    for (let index = 0; index < tread.length; index += 1) {
      const point = tread[index]!;
      const next = tread[(index + 1) % tread.length]!;
      twice += point[0] * next[1] - next[0] * point[1];
    }
    return total + Math.abs(twice) / 2;
  }, 0);
  assert.ok(Math.abs(area - Math.PI * 9.5 ** 2) / area < 0.02);
});

test("object 1470909 recovers singleton widening profiles from paired native guides", () => {
  const profileExtents = [
    [-114.112460452448, 59.806328193506, 87.734414199814],
    [-115.031090328739, 60.567510254028, 86.815771465150],
    [-115.949720205031, 61.223678233031, 85.897128730141],
    [-116.868350081323, 61.748041135617, 84.978502035569],
    [-117.786980486868, 61.748041135617, 84.485009040453],
    [-118.705615657471, 61.748041135617, 84.485009040453],
    [-119.624250828075, 61.748041135617, 84.485009040453],
    [-120.542885998679, 61.748041135617, 84.485009040453],
    [-121.461521169282, 61.748041135617, 84.485009040453],
    [-122.380156339886, 61.748041135617, 84.485009040453],
    [-123.298791510490, 61.748041135617, 84.485009040453],
    [-124.217426681093, 61.748041135617, 84.485009040453],
  ] as const;
  const elevations = [
    10.225284339458, 10.608048993876, 10.990813648294,
    11.373578302712, 11.756342957130, 12.139107611549,
    12.521872265967, 12.904636920385, 13.287401574803,
    13.670166229221, 14.052930883640, 14.435695538058,
  ] as const;
  const southGuide = [
    [-114.112460452448, 65.516729110846],
    [-115.031090328739, 66.317269910717],
    [-115.949720205031, 67.039050149363],
    [-116.868350081323, 67.661980590805],
    [-117.786980486868, 67.432283111826],
    [-118.705615657471, 67.432283111826],
    [-119.624250828075, 67.432283111826],
    [-120.542885998679, 67.432283111826],
    [-121.461521169282, 67.432283111826],
    [-122.380156339886, 67.432283111826],
    [-123.298791510490, 67.432283111826],
    [-124.217426681093, 67.432283111826],
  ] as const;
  const northGuide = [
    [-114.112460452448, 82.449310203276],
    [-115.031090328739, 81.491308729262],
    [-115.949720205031, 80.507053734610],
    [-116.868350081323, 79.489859501182],
    [-117.786980486868, 78.800767064244],
    [-118.705615657471, 78.800767064244],
    [-119.624250828075, 78.800767064244],
    [-120.542885998679, 78.800767064244],
    [-121.461521169282, 78.800767064244],
    [-122.380156339886, 78.800767064244],
    [-123.298791510490, 78.800767064244],
    [-124.217426681093, 78.800767064244],
  ] as const;
  const curves: SketchCurve[] = profileExtents.map(([x, lowY, highY]) =>
    line([x, lowY, elevations.at(-1)!], [x, highY, elevations.at(-1)!])
  );
  for (const guide of [southGuide, northGuide]) {
    for (let index = 0; index + 1 < guide.length; index += 1) {
      curves.push(line(
        [guide[index]![0], guide[index]![1], elevations[index]!],
        [guide[index + 1]![0], guide[index + 1]![1], elevations[index + 1]!],
      ));
    }
  }

  const recovered = recoverPairedGuideProfileStairTreads(
    curves,
    {
      min: { x: -124.258437179781, y: 59.806328193506, z: 9.842519685039 },
      max: { x: -114.112460452448, y: 87.734414199814, z: 14.435695538058 },
    },
    { actualRunWidthFeet: 3.280839895013, maximumRiserCount: 12 },
  );
  assert.ok(recovered);
  assert.equal(recovered.treads.length, 11);
  assert.deepEqual(
    recovered.treads.map((tread) => Number(tread[0][2].toFixed(6))),
    elevations.slice(0, -1).map((elevation) => Number(elevation.toFixed(6))),
  );
  assert.ok(
    recovered.treads.every((tread) => {
      const width = Math.max(...tread.map((point) => point[1])) -
        Math.min(...tread.map((point) => point[1]));
      return width >= 22.7 && width <= 28;
    }),
    "every emitted tread is bounded by its two exact native profiles",
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

test("clips local flattened tread bands but leaves a long flight transition empty", () => {
  const curves: SketchCurve[] = [];
  const profiles = [0.5, 1.5, 2.5, 7.5, 8.5, 9.5].map((x) =>
    line([x, 0, 2], [x, 3, 2]));
  for (const profile of profiles) curves.push(profile, { ...profile });
  curves.push(line([0.5, 0, 0], [0.5, 3, 0]));

  // A U-shaped native plan ring. The middle profile pair crosses its open
  // court in plan; only the one-foot-deep top connector belongs to the run.
  const footprint: Point3[] = [
    [0, 0, 2], [3, 0, 2], [3, 2, 2], [7, 2, 2],
    [7, 0, 2], [10, 0, 2], [10, 3, 2], [0, 3, 2],
  ];
  for (let index = 0; index < footprint.length; index += 1) {
    curves.push(line(footprint[index]!, footprint[(index + 1) % footprint.length]!));
  }

  const recovered = recoverFlattenedProfileStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 3, z: 2 },
    },
    { actualRunWidthFeet: 1.5, maximumRiserCount: 6 },
  );
  assert.ok(recovered);
  assert.deepEqual(
    [...new Set(recovered.treads.map((tread) => Number(tread[0][2].toFixed(3))))],
    [0.333, 0.667, 1.333, 1.667],
  );
  assert.ok(
    recovered.treads.every((tread) => Math.abs(tread[0][2] - 1) > 1e-6),
    "the uncertain inter-flight connector is omitted instead of filled",
  );
});

test("object 1821222 recovers every independently closed native transition cell", () => {
  assert.equal(stair1821222Fixture.elementId, 1_821_222);
  const recovered = recoverFlattenedProfileStairTreads(
    stair1821222Fixture.curves,
    stair1821222Fixture.bounds,
    stair1821222Fixture.options,
  );
  assert.ok(recovered);

  const area = (tread: readonly Point3[]) => Math.abs(tread.reduce(
    (sum, point, index) => {
      const next = tread[(index + 1) % tread.length]!;
      return sum + point[0] * next[1] - next[0] * point[1];
    },
    0,
  )) / 2;
  const byElevation = new Map<number, number>();
  for (const tread of recovered.treads) {
    const elevation = Number(tread[0][2].toFixed(5));
    byElevation.set(elevation, (byElevation.get(elevation) ?? 0) + area(tread));
  }

  assert.equal(byElevation.size, 31);
  assert.ok(
    Math.abs(byElevation.get(7.21785)! - 32.75278) < 0.01,
    "the native five-sided lower transition is recovered without IFC input",
  );
  assert.ok(
    Math.abs(byElevation.get(7.66896)! - 101.48494) < 0.01,
    "the large but independently closed landing is not rejected as a tread fan",
  );
  assert.ok(byElevation.has(11.729));
  assert.ok(
    Math.abs(byElevation.get(11.729)! - 34.33026) < 0.01,
    "the native six-sided upper transition matches the tagged IFC surface area",
  );
  const upperWinderAreas = [
    [12.18012, 21.47188],
    [12.63123, 16.31151],
    [13.08235, 18.17103],
    [13.53346, 16.01854],
    [13.98458, 16.37179],
  ] as const;
  for (const [elevation, expectedArea] of upperWinderAreas) {
    assert.ok(
      Math.abs(byElevation.get(elevation)! - expectedArea) < 0.001,
      `the independently closed upper winder at ${elevation} ft is complete`,
    );
  }
  assert.ok(
    Math.abs(
      upperWinderAreas.reduce(
        (total, [elevation]) => total + byElevation.get(elevation)!,
        0,
      ) - 88.34474,
    ) < 0.001,
    "the five closed upper winders retain their complete native area",
  );
  assert.ok(
    [...byElevation.entries()].every(
      ([elevation, treadArea]) =>
        treadArea < 40 ||
        (elevation === 7.66896 && treadArea < 102),
    ),
    "only the exact closed landing may exceed the ordinary tread area limit",
  );
  assert.ok(Math.abs(recovered.treadDepthFeet - 1.312335958) < 1e-6);
});

test("declines a flattened profile path mostly outside its native footprint", () => {
  const curves: SketchCurve[] = [];
  for (const x of [0.5, 1.5, 8.5, 9.5]) {
    const profile = line([x, 0, 2], [x, 3, 2]);
    curves.push(profile, { ...profile });
  }
  curves.push(line([0.5, 0, 0], [0.5, 3, 0]));
  const footprint: Point3[] = [
    [0, 0, 2], [2, 0, 2], [2, 3, 2], [0, 3, 2],
  ];
  for (let index = 0; index < footprint.length; index += 1) {
    curves.push(line(footprint[index]!, footprint[(index + 1) % footprint.length]!));
  }
  assert.equal(recoverFlattenedProfileStairTreads(
    curves,
    {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 3, z: 2 },
    },
    { actualRunWidthFeet: 1.5, maximumRiserCount: 4 },
  ), null);
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

test("object 1821222 closes subdivided transition risers by native collinear overlap", () => {
  const recovered = recoverFlattenedProfileStairTreads(
    stair1821222Fixture.curves,
    stair1821222Fixture.bounds,
    stair1821222Fixture.options,
  );
  assert.ok(recovered);
  const treadThicknessFeet = 0.164041995;
  const record = {
    elementId: stair1821222Fixture.elementId,
    stream: "fixture",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreadThicknessFeet: treadThicknessFeet,
    stairTreads: recovered.treads,
    boundsFeet: stair1821222Fixture.bounds,
  } satisfies ElementBoundsRecord;
  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);

  const rise =
    (stair1821222Fixture.bounds.max.z - stair1821222Fixture.bounds.min.z) /
    stair1821222Fixture.options.maximumRiserCount;
  const verticalArea = (lowerZ: number, upperZ: number) => {
    const upperBottomZ = upperZ - treadThicknessFeet;
    let area = 0;
    let triangles = 0;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const points = Array.from(
        mesh.indices.slice(offset, offset + 3),
        (index) => Array.from(
          mesh.positions.slice(index * 3, index * 3 + 3),
        ),
      );
      const minimumZ = Math.min(...points.map((point) => point[2]!));
      const maximumZ = Math.max(...points.map((point) => point[2]!));
      if (
        Math.abs(minimumZ - lowerZ) > 1e-4 ||
        Math.abs(maximumZ - upperBottomZ) > 1e-4
      ) {
        continue;
      }
      const [first, second, third] = points;
      const ux = second![0]! - first![0]!;
      const uy = second![1]! - first![1]!;
      const uz = second![2]! - first![2]!;
      const vx = third![0]! - first![0]!;
      const vy = third![1]! - first![1]!;
      const vz = third![2]! - first![2]!;
      area += Math.hypot(
        uy * vz - uz * vy,
        uz * vx - ux * vz,
        ux * vy - uy * vx,
      ) / 2;
      triangles += 1;
    }
    return {
      triangles,
      coveredLength: area / (upperBottomZ - lowerZ),
    };
  };

  const spans = [
    { lower: 15, upper: 16, triangles: 2, length: 24.95762 },
    { lower: 17, upper: 18, triangles: 2, length: 13.55668 },
    { lower: 25, upper: 26, triangles: 2, length: 13.55668 },
  ] as const;
  for (const span of spans) {
    const closure = verticalArea(
      stair1821222Fixture.bounds.min.z + rise * span.lower,
      stair1821222Fixture.bounds.min.z + rise * span.upper,
    );
    assert.equal(closure.triangles, span.triangles);
    assert.ok(
      Math.abs(closure.coveredLength - span.length) < 0.001,
      `the ${span.lower}->${span.upper} transition closes its complete native profile`,
    );
  }
});

test("a lone partial collinear overlap cannot create an incidental stair wall", () => {
  const treadThicknessFeet = 0.16;
  const record = {
    elementId: 4,
    stream: "fixture",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    stairTreadThicknessFeet: treadThicknessFeet,
    stairTreads: [
      [[0, 0, 0.5], [3, 0, 0.5], [3, 1, 0.5], [0, 1, 0.5]],
      [[1, 0, 1], [4, 0, 1], [4, -1, 1], [1, -1, 1]],
    ],
    boundsFeet: {
      min: { x: 0, y: -1, z: 0 },
      max: { x: 4, y: 1, z: 1 },
    },
  } satisfies ElementBoundsRecord;
  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  let bridgingTriangles = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const elevations = Array.from(
      mesh.indices.slice(offset, offset + 3),
      (index) => mesh.positions[index * 3 + 2]!,
    );
    if (
      Math.abs(Math.min(...elevations) - 0.5) < 1e-6 &&
      Math.abs(Math.max(...elevations) - 0.84) < 1e-6
    ) {
      bridgingTriangles += 1;
    }
  }
  assert.equal(bridgingTriangles, 0);
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

test("a drifting straight lattice is respaced across the run's own envelope", () => {
  // Run 2075102 on the supplied model: 8 persisted risers over an envelope
  // agreeing with the paired export to the hundredth of a foot, but sketch
  // boundaries spaced 3.6-4.4 ft whose drift leaves the lattice 3.0 ft short.
  const bounds = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 31.3, y: 10, z: 6.56 },
  };
  const stops = [0, 4.45, 8.06, 11.69, 15.81, 19.95, 24.09, 28.3];
  const treads = stops.slice(0, -1).map((rear, index) => {
    const front = stops[index + 1]!;
    const z = 0.82 * (index + 1);
    return [
      [rear, 10, z],
      [front, 10, z],
      [front, 0, z],
      [rear, 0, z],
    ] as [Point3, Point3, Point3, Point3];
  });
  const respaced = respaceStraightStairTreads(treads, bounds, 8, true, true);
  assert.ok(respaced);
  const depth = 31.3 / 7;
  for (const [index, tread] of respaced.entries()) {
    assert.ok(Math.abs(tread[0][0] - index * depth) < 1e-9);
    assert.ok(Math.abs(tread[1][0] - (index + 1) * depth) < 1e-9);
    // Cross-run edges and elevations stay as recovered.
    assert.equal(tread[0][1], 10);
    assert.equal(tread[3][1], 0);
    assert.equal(tread[0][2], 0.82 * (index + 1));
  }

  // A run without both certified end risers keeps the recovered lattice.
  assert.equal(respaceStraightStairTreads(treads, bounds, 8, true, false), null);
  // A tread count that disagrees with the persisted riser count declines.
  assert.equal(respaceStraightStairTreads(treads, bounds, 9, true, true), null);
  // An envelope a whole tread depth longer than the lattice is a different
  // tread count, not drift.
  const oversized = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 28.3 + 2 * (31.3 / 7), y: 10, z: 6.56 },
  };
  assert.equal(respaceStraightStairTreads(treads, oversized, 8, true, true), null);
  // Multi-cell lattices (two cells at one elevation) are curved profiles and
  // stay untouched.
  const doubled = [...treads, treads[0]!.map((corner) =>
    [corner[0], corner[1] + 12, corner[2]] as Point3) as [Point3, Point3, Point3, Point3]];
  assert.equal(respaceStraightStairTreads(doubled, bounds, 9, true, true), null);
});
