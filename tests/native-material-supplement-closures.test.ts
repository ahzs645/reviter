import test from "node:test";
import assert from "node:assert/strict";
import { createNativeRoutingMaterialQuery } from "../lib/reviter/native-routing-material.ts";
import { nativeMaterialPlanExactWalls } from "../lib/reviter/native-material-plan.ts";
import { nativeMaterialSectionSupplementHash } from "../lib/reviter/native-material-section-supplement.ts";
import { nativeDerivedFrameHash } from "../lib/reviter/native-derived-frame-returns.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalMeasuredArea } from "../lib/reviter/native-exact-planar-topology.ts";

type P = [number, number];
const sha = "a".repeat(64);
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const HOST = 2;
type Section = {
  nativeElementId: number;
  categoryId: number;
  kind: "wall";
  partsFeet: P[][][];
  sourceAssemblyChildIds?: number[];
};
/** Level 7 at z 0, selection cut 4. Host #2 is a census omission supplied by the supplement;
 * a partition #3 ends at the host body face y = 1. */
function fixture(opts: {
  section: P[][][];
  body?: P[][];
  members?: Section[];
  doors?: { footprintFeet: P[]; normalFeet?: P }[];
}) {
  const sections: Section[] = [
    {
      nativeElementId: 3,
      categoryId: -2_000_011,
      kind: "wall",
      partsFeet: [[rect(4.9, 1, 5.1, 5)]],
    },
    ...(opts.members ?? []),
  ];
  const levels = [
    {
      levelId: 7,
      elevationFeet: 0,
      cutElevationFeet: 4,
      evidenceSha256: "0".repeat(64),
      sourceElementIds: sections.map((s) => s.nativeElementId),
      sections: sections.map((s) => ({
        ...s,
        baseElevationFeet: 0,
        topElevationFeet: 10,
      })),
    },
  ];
  const material = {
    version: 1 as const,
    sourceModelSha256: sha,
    geometrySha256: "",
    levels,
  };
  material.geometrySha256 = nativeDerivedFrameHash([
    material.version,
    material.sourceModelSha256,
    material.levels,
  ]);
  const body = {
    version: 1 as const,
    method: "production-native-mesh-barrier-cuts-v1" as const,
    sourceModelSha256: sha,
    sourceMaterialGeometrySha256: material.geometrySha256,
    levels: [
      {
        levelId: 7,
        elevationFeet: 0,
        cutElevationFeet: 4,
        sections: [
          {
            nativeElementId: HOST,
            categoryId: -2_000_011,
            kind: "wall" as const,
            baseElevationFeet: 0,
            topElevationFeet: 10,
            partsFeet: opts.section,
            provenance: {
              kind: "production-native-mesh-cutter" as const,
              reason: "census-omission" as const,
            },
          },
        ],
      },
    ],
  };
  return {
    source: { modelSha256: sha },
    nativeLevels: [{ id: 7, name: "L7", elevationFeet: 0 }],
    walls: [
      ...(opts.body
        ? [
            {
              levelId: 7,
              nativeElementId: HOST,
              kind: "wall" as const,
              ringsFeet: opts.body,
            },
          ]
        : []),
      {
        levelId: 7,
        nativeElementId: 3,
        kind: "wall" as const,
        ringsFeet: [rect(4.9, 1, 5.1, 5)],
      },
    ],
    doors: (opts.doors ?? []).map((d, i) => ({
      id: `d${i}`,
      levelId: 7,
      nativeElementId: 900 + i,
      pointFeet: [5, 0.5] as P,
      roomKeys: [],
      state: "connected" as const,
      ...d,
    })),
    nativeMaterialSections: material,
    nativeMaterialSectionSupplement: {
      ...body,
      geometrySha256: nativeMaterialSectionSupplementHash(body),
    },
  };
}
const exactWalls = (data: unknown) =>
  nativeMaterialPlanExactWalls(
    data as never,
    7,
    createNativeRoutingMaterialQuery(data as never),
  );
const hostMask = (walls: ReturnType<typeof exactWalls>) => {
  const parts = walls
    .filter((w) => w.nativeElementId === HOST)
    .flatMap((w) => w.exactParts);
  return parts.length > 0 ? nativeRationalOverlay("union", parts) : [];
};
/** Body area not covered by the host's selection material. */
const src = (w: unknown) => (w as { geometrySource?: string }).geometrySource;
const open = (walls: ReturnType<typeof exactWalls>, body: P[][]) => {
  const mask = hostMask(walls);
  return nativeRationalMeasuredArea(
    mask.length > 0
      ? nativeRationalOverlay("difference", [body], mask)
      : nativeRationalOverlay("union", [body]),
  );
};
/** Exact serialization (rational carriers by numerator/denominator). */
const bytes = (walls: ReturnType<typeof exactWalls>) =>
  JSON.stringify(
    walls.map(({ exactParts, ...w }) => [
      w,
      exactParts.map((part) =>
        part.map((ring) =>
          ring.map((p) => p.map((q) => [String(q.n), String(q.d)])),
        ),
      ),
    ]),
  );
const BODY = [rect(0, 0, 10, 1)];
const WINDOWED: P[][][] = [[rect(0, 0, 3, 1)], [rect(7, 0, 10, 1)]];
// Curtain panel and mullions fill only the middle 0.2 ft of the 1 ft wall thickness.
const CURTAIN: Section[] = [
  {
    nativeElementId: 10,
    categoryId: -2_000_170,
    kind: "wall",
    partsFeet: [[rect(3.1, 0.4, 6.9, 0.6)]],
  },
  {
    nativeElementId: 11,
    categoryId: -2_000_171,
    kind: "wall",
    partsFeet: [[rect(3, 0.35, 3.1, 0.65)]],
  },
  {
    nativeElementId: 12,
    categoryId: -2_000_171,
    kind: "wall",
    partsFeet: [[rect(6.9, 0.35, 7, 0.65)]],
  },
];

test("a census-omission window host leaves no strip: the hosted opening closes across the native body", () => {
  const data = fixture({ section: WINDOWED, body: BODY, members: CURTAIN });
  const walls = exactWalls(data);
  assert.ok(
    open(walls, BODY) < 1e-12,
    "no floor strip inside the wall thickness",
  );
  assert.ok(
    walls.some((w) => src(w) === "native-supplement-hosted-opening-closure"),
  );
  // Without fenestration evidence the opening is not a hosted window opening and stays as cut.
  const bare = exactWalls(fixture({ section: WINDOWED, body: BODY }));
  assert.ok(Math.abs(open(bare, BODY) - 4) < 1e-9);
  // The closure never leaves the native body.
  const mask = hostMask(walls);
  assert.equal(
    nativeRationalMeasuredArea(
      nativeRationalOverlay("difference", mask, [BODY]),
    ),
    0,
  );
  // Routing/physical material read the unchanged supplement section.
  const q = createNativeRoutingMaterialQuery(data as never)(0, 4);
  assert.deepEqual(
    q.parts.filter((p) => p.nativeElementId === HOST).map((p) => p.rings),
    WINDOWED.map((p) => p),
  );
  assert.ok(
    q.censusOmissionSupplementIds.has(HOST) &&
      q.fenestrationIds.has(10) &&
      !q.fenestrationIds.has(3),
  );
});

test("a door opening of a supplement host stays open, also inside a curtain opening", () => {
  const door = {
    footprintFeet: rect(3.2, -0.3, 6.8, 1.3),
    normalFeet: [0, 1] as P,
  };
  const walls = exactWalls(
    fixture({ section: WINDOWED, body: BODY, doors: [door] }),
  );
  assert.ok(
    Math.abs(open(walls, BODY) - 4) < 1e-9,
    "plain door opening as cut",
  );
  const curtainDoor = exactWalls(
    fixture({ section: WINDOWED, body: BODY, members: CURTAIN, doors: [door] }),
  );
  // The door's own width (3.2..6.8) stays open across the whole wall; the rest of the curtain opening closes.
  assert.ok(Math.abs(open(curtainDoor, BODY) - 3.6) < 1e-9);
});

test("a section inset from the native body face still touches its neighbours", () => {
  const e = 2.2e-7;
  const inset: P[][][] = [[rect(e, e, 10 - e, 1 - e)]];
  const walls = exactWalls(fixture({ section: inset, body: BODY }));
  assert.equal(open(walls, BODY), 0, "body faces restored exactly");
  assert.ok(walls.some((w) => src(w) === "native-supplement-face-closure"));
  // The partition touching the face y = 1 now shares an edge with the host material.
  const mask = hostMask(walls);
  const touch = nativeRationalOverlay("intersection", mask, [
    [rect(4.9, 1 - 1e-9, 5.1, 1)],
  ]);
  assert.ok(nativeRationalMeasuredArea(touch) > 1.9e-10);
  // A real (thick) difference between section and body is not a face sliver.
  const short = exactWalls(
    fixture({ section: [[rect(0, 0, 9, 1)]], body: BODY }),
  );
  assert.ok(Math.abs(open(short, BODY) - 1) < 1e-9);
});

test("output is byte-identical for supplement walls without openings and for original walls", () => {
  const full = fixture({
    section: [[rect(0, 0, 10, 1)]],
    body: BODY,
    members: CURTAIN,
  });
  const noBody = fixture({ section: [[rect(0, 0, 10, 1)]], members: CURTAIN });
  assert.equal(bytes(exactWalls(full)), bytes(exactWalls(noBody)));
  // Same windowed host listed as an original section: no closure is added.
  const original = fixture({
    section: WINDOWED,
    body: BODY,
    members: CURTAIN,
  }) as unknown as {
    nativeMaterialSectionSupplement?: unknown;
    nativeMaterialSections: {
      geometrySha256: string;
      levels: { sections: unknown[]; sourceElementIds: number[] }[];
    };
  };
  original.nativeMaterialSectionSupplement = undefined;
  original.nativeMaterialSections.levels[0].sections.push({
    nativeElementId: HOST,
    categoryId: -2_000_011,
    kind: "wall",
    baseElevationFeet: 0,
    topElevationFeet: 10,
    partsFeet: WINDOWED,
  });
  original.nativeMaterialSections.levels[0].sourceElementIds.push(HOST);
  original.nativeMaterialSections.geometrySha256 = nativeDerivedFrameHash([
    1,
    sha,
    original.nativeMaterialSections.levels,
  ]);
  const walls = exactWalls(original);
  assert.ok(
    walls.every((w) => !String(src(w)).startsWith("native-supplement-")),
  );
  assert.ok(Math.abs(open(walls, BODY) - 4) < 1e-9);
});
