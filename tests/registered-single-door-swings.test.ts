import assert from "node:assert/strict";
import test from "node:test";
import type { MultiPolygon } from "polygon-clipping";
import {
  registeredSingleDoorSwings,
  sectionWithClosedSingleDoorSwings,
} from "../lib/reviter/registered-single-door-swings.ts";
import type {
  BoundarySection,
  BoundarySegment,
} from "../lib/reviter/room-boundaries.ts";
const setup = (rotation = 0): BoundarySection => {
  const transform = ([x, y]: [number, number]): [number, number] => [
    100 + x * Math.cos(rotation) - y * Math.sin(rotation),
    700 + x * Math.sin(rotation) + y * Math.cos(rotation),
  ];
  const arc: BoundarySegment[] = Array.from({ length: 24 }, (_, i) => [
    [
      3 * Math.cos(((Math.PI / 2) * i) / 24),
      3 * Math.sin(((Math.PI / 2) * i) / 24),
    ],
    [
      3 * Math.cos(((Math.PI / 2) * (i + 1)) / 24),
      3 * Math.sin(((Math.PI / 2) * (i + 1)) / 24),
    ],
  ]);
  const segments: BoundarySegment[] = [
    ...arc,
    [
      [0, 0],
      [0, 3],
    ],
    [
      [-4, 0],
      [-0.1, 0],
    ],
    [
      [3.1, 0],
      [7, 0],
    ],
    [
      [-4, -0.4],
      [-0.1, -0.4],
    ],
    [
      [3.1, -0.4],
      [7, -0.4],
    ],
  ];
  return {
    sectionId: "survey",
    levelId: 311,
    registrationErrorFeet: 0.01,
    wallSegments: segments.map(
      (line) => line.map(transform) as BoundarySegment,
    ),
    doorSegments: [],
  };
};
test("a tessellated single door closes against both wall faces at arbitrary orientation without mutating the source", () => {
  for (const angle of [0, 0.28325, 1.2, -2.3]) {
    const section = setup(angle),
      before = JSON.stringify(section),
      result = sectionWithClosedSingleDoorSwings(section);
    assert.equal(result.swings.length, 1);
    assert.equal(result.swings[0]!.arcSegmentIndices.length, 24);
    assert.ok(Math.abs(result.swings[0]!.radiusFeet - 3) < 0.001);
    assert.equal(
      result.section.wallSegments.length,
      5,
      "only the swing arc is excluded; leaf and walls retained",
    );
    assert.equal(
      result.section.doorSegments.length,
      2,
      "both measured wall faces provide display thresholds",
    );
    assert.equal(JSON.stringify(section), before);
  }
});
test("an isolated quarter curve, missing leaf, or wall support on only one jamb side cannot become a closed door", () => {
  const s = setup();
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: s.wallSegments.slice(0, 24),
    }).length,
    0,
  );
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: s.wallSegments.filter((_, i) => i !== 24),
    }).length,
    0,
  );
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: s.wallSegments.filter((_, i) => i !== 27 && i !== 25),
    }).length,
    0,
  );
});
test("non-circular rounded architecture, half-circle arcs and oversized openings remain unchanged", () => {
  const s = setup();
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: s.wallSegments.map((line, i) =>
        i < 24
          ? (line.map(([x, y]) => [
              x,
              700 + (y - 700) * 1.2,
            ]) as BoundarySegment)
          : line,
      ),
    }).length,
    0,
  );
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: s.wallSegments.map(
        (line) =>
          line.map(([x, y]) => [
            100 + (x - 100) * 3,
            700 + (y - 700) * 3,
          ]) as BoundarySegment,
      ),
    }).length,
    0,
  );
  const semicircle = Array.from(
    { length: 48 },
    (_, i) =>
      [
        [
          100 + 3 * Math.cos((Math.PI * i) / 48),
          700 + 3 * Math.sin((Math.PI * i) / 48),
        ],
        [
          100 + 3 * Math.cos((Math.PI * (i + 1)) / 48),
          700 + 3 * Math.sin((Math.PI * (i + 1)) / 48),
        ],
      ] as BoundarySegment,
  );
  assert.equal(
    registeredSingleDoorSwings({
      ...s,
      wallSegments: [...semicircle, ...s.wallSegments.slice(24)],
    }).length,
    0,
  );
});

test("UNBC 05-170 and 08-129 regain their swing wedges without changing source, barriers or navigation", async () => {
  const { readFile } = await import("node:fs/promises");
  const { recoverRegisteredRoomInteriors } = await import(
    "../lib/reviter/registered-room-presentation.ts"
  );
  const { default: pc } = await import("polygon-clipping");
  const { roomArea } = await import("../lib/reviter/room-directory.ts");
  type RecoveryArgs = Parameters<typeof recoverRegisteredRoomInteriors>;
  type Fixture = {
    number: string;
    roomKey: string;
    annotations: RecoveryArgs[1];
    reference: NonNullable<RecoveryArgs[2]>;
    dataset: RecoveryArgs[0];
    geometry: import("../lib/reviter/architectural-plan.ts").ArchitecturalPlanGeometry;
    oldInterior: import("../lib/reviter/room-directory.ts").RoomPoint[][];
  };
  const fixtures = JSON.parse(
    await readFile(
      new URL("./fixtures/unbc-single-door-swings.json", import.meta.url),
      "utf8",
    ),
  ) as Fixture[];
  const area = (parts: MultiPolygon) =>
    parts.reduce(
      (sum, rings) =>
        sum +
        rings.reduce(
          (s, r, i) => s + (i ? -1 : 1) * roomArea(r as [number, number][]),
          0,
        ),
      0,
    );
  for (const f of fixtures) {
    const before = JSON.stringify(f),
      level = f.annotations.find((a) => a.key === f.roomKey)!.levelId;
    const result = recoverRegisteredRoomInteriors(
      f.dataset,
      f.annotations,
      f.reference,
      new Map([[level, f.geometry]]),
      new Set([f.roomKey]),
      new Map(f.dataset.records.map((r) => [r.key, f.geometry.floors])),
    );
    const recovered = result.rooms.find((r) => r.roomKey === f.roomKey);
    assert.ok(recovered, JSON.stringify(result.diagnostics));
    assert.equal(
      recovered.sourceProof.closedDoorSwings?.length,
      f.number === "05-170" ? 1 : 3,
    );
    assert.ok(
      area(pc.difference(recovered.ringsFeet, f.oldInterior)) >
        (f.number === "05-170" ? 6 : 30),
    );
    assert.ok(
      area(pc.difference(recovered.ringsFeet, ...f.geometry.floors)) < 0.002,
    );
    for (const wall of f.dataset.walls)
      assert.ok(
        area(pc.intersection(recovered.ringsFeet, wall.ringsFeet)) < 0.002,
        "native material remains excluded",
      );
    assert.equal(JSON.stringify(f), before);
  }
});
