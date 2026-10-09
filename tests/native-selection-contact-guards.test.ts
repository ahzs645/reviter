import assert from "node:assert/strict";
import test from "node:test";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import {
  nativeMaterialSectionsHash,
  verifyNativeMaterialSections,
} from "../lib/reviter/native-material-sections.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import {
  assertNativeSelectionContactPhysicalGuards,
  assertNativeSelectionContactRepairsPhysicalGuards,
  createNativeSelectionContactPhysicalGuard,
} from "../lib/reviter/native-selection-contact-guards.ts";

type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[][] => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
];
async function fixture(gap = 1e-9) {
  const source = rect(0, 0, 5, 1),
    target = rect(-1, -1, -gap, 2),
    model = "a".repeat(64);
  const material = {
    version: 1 as const,
    sourceModelSha256: model,
    levels: [
      {
        levelId: 311,
        elevationFeet: 0,
        cutElevationFeet: 4,
        evidenceSha256: "b".repeat(64),
        sourceElementIds: [1, 2],
        sections: [source, target].map((rings, n) => ({
          nativeElementId: n + 1,
          kind: "wall" as const,
          categoryId: -2000011,
          baseElevationFeet: 0,
          topElevationFeet: 8,
          partsFeet: [rings],
        })),
      },
    ],
  };
  const data = {
    source: { modelSha256: model },
    nativeLevels: [{ id: 311, name: "Floor 1", elevationFeet: 0 }],
    nativeMaterialSections: {
      ...material,
      geometrySha256: await nativeMaterialSectionsHash(material),
    },
    walls: [source, target].map((rings, n) => ({
      levelId: 311,
      nativeElementId: n + 1,
      kind: "wall" as const,
      ringsFeet: rings,
    })),
    walkingSupport: {
      version: 1,
      sourceModelSha256: model,
      floors: [
        {
          nativeElementId: 10,
          elevationFeet: 0,
          ringsFeet: rect(-2, -2, 6, 3),
        },
      ],
    },
    records: [],
    doors: [],
    edges: [],
  } as unknown as IndoorDataset;
  await verifyNativeMaterialSections(data.nativeMaterialSections, model);
  const repair = {
    sourceModelSha256: model,
    sourceMaterialGeometrySha256: data.nativeMaterialSections!.geometrySha256,
    levelId: 311,
    elevationFeet: 0,
    source: {
      nativeElementId: 1,
      capFeet: [
        [0, 0],
        [0, 1],
      ] as Point[],
    },
    target: { nativeElementId: 2 },
  };
  const mask = nativeRationalOverlay("union", [rect(-gap, 0, 0, 1)]);
  return { data, repair, mask };
}

test("a source-bound exact positive gap has full original floor and current contacts without source mutation", async () => {
  const { data, repair, mask } = await fixture(),
    before = JSON.stringify(data);
  assert.doesNotThrow(() =>
    assertNativeSelectionContactPhysicalGuards(data, repair, mask),
  );
  assert.equal(JSON.stringify(data), before);
});

test("empty gap, wrong model/material/native elevation and absent original support fail", async () => {
  const { data, repair, mask } = await fixture();
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, []),
    /positive exact/,
  );
  for (const field of [
    "sourceModelSha256",
    "sourceMaterialGeometrySha256",
  ] as const)
    assert.throws(
      () =>
        assertNativeSelectionContactPhysicalGuards(
          data,
          { ...repair, [field]: "c".repeat(64) },
          mask,
        ),
      /stale/,
    );
  assert.throws(
    () =>
      assertNativeSelectionContactPhysicalGuards(
        data,
        { ...repair, elevationFeet: 1e-12 },
        mask,
      ),
    /stale/,
  );
  assert.throws(
    () =>
      assertNativeSelectionContactPhysicalGuards(
        data,
        { ...repair, source: { ...repair.source, nativeElementId: 999 } },
        mask,
      ),
    /current retained/,
  );
});

test("less than 1e-15sqft doorway and fixture intersection vetoes the exact mask", async () => {
  for (const kind of ["door", "fixture"]) {
    const { data, repair, mask } = await fixture();
    const tiny = rect(-5e-10, 0.25, 0, 0.250001);
    if (kind === "door")
      data.doors = [
        {
          id: "door",
          nativeElementId: 3,
          levelId: 311,
          pointFeet: [0, 0.25],
          normalFeet: [1, 0],
          footprintFeet: tiny[0],
          roomKeys: [],
          state: "unmatched",
        },
      ];
    else
      data.circulationGeometry = {
        version: 1,
        sourceModelSha256: data.source.modelSha256,
        sourceGeometryKey: "checked",
        cells: [],
        fixtures: [
          {
            id: "fixture",
            nativeElementId: 3,
            levelIds: [311],
            elevationFeet: 0,
            heightFeet: 1,
            ringsFeet: tiny,
          },
        ],
      };
    assert.throws(
      () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
      new RegExp("physical " + (kind === "door" ? "doorway" : "fixture")),
    );
  }
});

test("foreign original wall or column with sub-epsilon overlap remains a physical veto", async () => {
  for (const kind of ["wall", "column"] as const) {
    const { data, repair, mask } = await fixture();
    data.walls.push({
      nativeElementId: 3,
      levelId: 311,
      kind,
      ringsFeet: rect(-5e-10, 0.25, 0, 0.250001),
    });
    assert.throws(
      () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
      /foreign wall or column/,
    );
  }
});

test("any positive unsupported gap and original hole stay excluded even when another slab covers the hole", async () => {
  const { data, repair, mask } = await fixture();
  data.walkingSupport!.floors[0].ringsFeet = rect(-5e-10, -2, 6, 3);
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
    /unsupported/,
  );
  const other = await fixture();
  other.data.walkingSupport!.floors[0].ringsFeet.push(
    rect(-5e-10, 0.25, 0, 0.250001)[0],
  );
  other.data.walkingSupport!.floors.push({
    nativeElementId: 11,
    elevationFeet: 0,
    ringsFeet: rect(-2, -2, 6, 3),
  });
  assert.throws(
    () =>
      assertNativeSelectionContactPhysicalGuards(
        other.data,
        other.repair,
        other.mask,
      ),
    /original floor opening/,
  );
});

test("reviewed exclusions and source stair opening metadata retain positive intersection vetoes", async () => {
  const { data, repair, mask } = await fixture();
  data.indoorExclusions = {
    version: 1,
    sourceModelSha256: data.source.modelSha256,
    areas: [
      {
        id: "outside",
        levelId: 311,
        elevationFeet: 0,
        label: "Checked excluded footprint",
        nativeFloorIds: [10],
        partsFeet: [rect(-2, 0.25, 0, 0.250001)],
      },
    ],
  };
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
    /excluded footprint/,
  );
  const q = await fixture();
  q.data.records = [
    {
      levelId: 311,
      properties: { floorOpeningsFeet: [rect(-5e-10, 0.25, 0, 0.250001)[0]] },
    } as unknown as IndoorDataset["records"][number],
  ];
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(q.data, q.repair, q.mask),
    /floor or stair opening/,
  );
});

test("a changed retained source contact and mask overlapping original supports cannot pass", async () => {
  const { data, repair, mask } = await fixture();
  data.nativeMaterialSections!.levels[0].sections[0].partsFeet = [
    rect(0, 0.1, 5, 1),
  ];
  data.nativeMaterialSections!.geometrySha256 =
    await nativeMaterialSectionsHash(data.nativeMaterialSections!);
  repair.sourceMaterialGeometrySha256 =
    data.nativeMaterialSections!.geometrySha256;
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
    /current retained/,
  );
  const q = await fixture();
  const overlap = nativeRationalOverlay("union", [rect(-1e-9, 0, 1e-12, 1)]);
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(q.data, q.repair, overlap),
    /overlap inside/,
  );
});

test("same-height peer-level doors are protected; another native floor's door is not imposed", async () => {
  const { data, repair, mask } = await fixture();
  data.nativeLevels.push({ id: 999, name: "Peer height", elevationFeet: 0 });
  data.doors = [
    {
      id: "peer",
      nativeElementId: 3,
      levelId: 999,
      pointFeet: [0, 0.25],
      normalFeet: [1, 0],
      footprintFeet: rect(-5e-10, 0.25, 0, 0.250001)[0],
      roomKeys: [],
      state: "unmatched",
    },
  ];
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
    /physical doorway/,
  );
  data.nativeLevels[1].elevationFeet = 10;
  assert.doesNotThrow(() =>
    assertNativeSelectionContactPhysicalGuards(data, repair, mask),
  );
});

test("fresh batched replay checks every mask, rejects mismatched inventory and binds its native level", async () => {
  const { data, repair, mask } = await fixture();
  assert.doesNotThrow(() =>
    assertNativeSelectionContactRepairsPhysicalGuards(
      data,
      [repair, repair],
      [mask, mask],
    ),
  );
  assert.throws(
    () => assertNativeSelectionContactRepairsPhysicalGuards(data, [repair], []),
    /inventory/,
  );
  assert.throws(
    () =>
      assertNativeSelectionContactRepairsPhysicalGuards(
        data,
        [repair, repair],
        [mask, []],
      ),
    /positive exact/,
  );
  const guard = createNativeSelectionContactPhysicalGuard(data, repair.levelId);
  assert.throws(() => guard({ ...repair, levelId: 999 }, mask), /stale/);
  data.nativeMaterialSections!.geometrySha256 = "c".repeat(64);
  assert.throws(() => guard(repair, mask), /stale/);
});

test("a tagged foreign repair sharing a supporting owner is never waived as original material", async () => {
  const { data, repair, mask } = await fixture();
  data.walls.push({
    nativeElementId: 1,
    levelId: 311,
    kind: "wall",
    reviewPatchId: "older-derived",
    ringsFeet: rect(-5e-10, 0.25, 0, 0.250001),
  });
  assert.throws(
    () => assertNativeSelectionContactPhysicalGuards(data, repair, mask),
    /foreign wall or column/,
  );
});
