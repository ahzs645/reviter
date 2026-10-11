/** Minimal drawing-backed seal dataset: two finite native walls on one slab with a measured
 * joint and a registered drawing line across it (the openindoormaps drawing-backed fixture). */
import {
  nativeDerivedFrameHash,
  nativeDerivedFramePlacementHash,
} from "../../lib/reviter/native-derived-frame-returns.ts";
import {
  drawingBackedAssumptionFootprint,
  nativeProvisionalCornerSealsHash,
  verifyDrawingBackedDrawingEvidence,
} from "../../lib/reviter/native-provisional-corner-seals.ts";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";

export type P2 = [number, number];
export const rect = (a: number, b: number, c: number, d: number): P2[][][] => [
  [
    [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
    ],
  ],
];
const sha = "a".repeat(64);
const decisions = "9".repeat(64);
const noWallRepairs = undefined as Parameters<
  typeof nativeDerivedFramePlacementHash
>[0];
const noBoundaryReference = undefined as Parameters<
  typeof verifyDrawingBackedDrawingEvidence
>[1];
/** Two finite native walls on one slab with a 0.1 ft (30 mm) joint at x = 1..1.1; the registered
 * drawing draws the wall line continuously across it. */
export function drawingBackedSealFixture(
  options: {
    gap?: number;
    extraSection?: P2[][][];
    segment?: [P2, P2];
    kind?: "dwg-continuous-seal" | "exact-contact-closure";
  } = {},
) {
  const gap = options.gap ?? 0.1;
  const carrier = rect(0, -1, 1, 0),
    target = rect(1 + gap, -1, 2 + gap, 0),
    floor = rect(-1, -2, 4, 2);
  const foreign = [
    {
      nativeElementId: 1,
      boundsFeet: { min: [0, -1, 0], max: [1, 0, 4] },
      evidenceSha256: "b".repeat(64),
    },
    {
      nativeElementId: 2,
      boundsFeet: { min: [1 + gap, -1, 0], max: [2 + gap, 0, 4] },
      evidenceSha256: "c".repeat(64),
    },
    ...(options.extraSection
      ? [
          {
            nativeElementId: 4,
            boundsFeet: { min: [1, -1, 0], max: [1.1, 0, 4] },
            partsFeet: options.extraSection,
            evidenceSha256: "e".repeat(64),
          },
        ]
      : []),
  ];
  const finite = [
    {
      nativeElementId: 1,
      baseElevationFeet: 0,
      topElevationFeet: 4,
      partsFeet: carrier,
      evidenceSha256: "e".repeat(64),
    },
    {
      nativeElementId: 2,
      baseElevationFeet: 0,
      topElevationFeet: 4,
      partsFeet: target,
      evidenceSha256: "f".repeat(64),
    },
    ...(options.extraSection
      ? [
          {
            nativeElementId: 4,
            baseElevationFeet: 0,
            topElevationFeet: 4,
            partsFeet: options.extraSection,
            evidenceSha256: "d".repeat(64),
          },
        ]
      : []),
  ];
  const material = {
    version: 1,
    sourceModelSha256: sha,
    geometrySha256: "",
    levels: [
      {
        levelId: 1,
        elevationFeet: 0,
        cutElevationFeet: 0.1,
        evidenceSha256: "0".repeat(64),
        sourceElementIds: [1, 2],
        originalFiniteMaterialSections: finite,
        sections: finite.map((f) => ({
          nativeElementId: f.nativeElementId,
          kind: "wall",
          categoryId: 1,
          baseElevationFeet: 0,
          topElevationFeet: 4,
          partsFeet: f.partsFeet,
        })),
      },
    ],
  };
  material.geometrySha256 = nativeDerivedFrameHash([
    material.version,
    material.sourceModelSha256,
    material.levels,
  ]);
  const section = {
    sectionId: "08 Tea Lab LVL 1",
    levelId: 1,
    registrationErrorFeet: 0,
    wallSegments: [
      options.segment ?? [
        [0, -0.5],
        [3, -0.5],
      ],
    ],
    doorSegments: [],
  };
  const boundaryReference = {
    format: "reviter-boundary-reference",
    version: 1,
    coordinateSystem: "revit-model-feet",
    sourceSha256: "5".repeat(64),
    sections: [section],
  };
  const exact = options.kind === "exact-contact-closure";
  const construction = {
    kind: "bridge" as const,
    pointAFeet: [1, -0.5] as P2,
    pointBFeet: [1 + gap, -0.5] as P2,
    directionFeet: [1, 0] as P2,
    halfWidthFeet: exact ? 0.0001 : 0.02,
    overlapFeet: exact ? 0.0001 : 0.02,
  };
  const binding = [{ nativeElementId: 10, elevationFeet: 0, partsFeet: floor }];
  const drawingBacked = {
    version: 1 as const,
    kind: options.kind ?? ("dwg-continuous-seal" as const),
    decisionId: "2026-10-09-gap-review#q1a",
    decisionsSha256: decisions,
    nativeOwnerIds: [1, 2],
    measuredGapFeet: gap,
    ...(exact ? { numericalBoundFeet: 1.5e-5 } : {}),
    construction,
    dwg: {
      sourceDwgSha256: boundaryReference.sourceSha256,
      registrationSha256: nativeDerivedFrameHash([
        boundaryReference.sourceSha256,
        section,
      ]),
      sectionId: section.sectionId,
      toleranceFeet: 0.25,
      entities: [
        {
          kind: "wallSegments" as const,
          index: 0,
          segmentFeet: section.wallSegments[0]!,
        },
      ],
    },
    acknowledgedUnverifiedBodyIds: [] as number[],
  };
  const row = {
    id: "db:1:q1a:1-2",
    levelId: 1,
    elevationFeet: 0,
    baseElevationFeet: 0,
    topElevationFeet: 4,
    state: "applied",
    carrierContactNativeElementIds: [1],
    targetNativeElementId: 2,
    carrierContactFaceFeet: [construction.pointAFeet, construction.pointBFeet],
    nearestCarrierContactFeet: construction.pointAFeet,
    nearestTargetContactFeet: construction.pointBFeet,
    contactPaddingFeet: construction.overlapFeet,
    partsFeet: drawingBackedAssumptionFootprint(construction),
    sourceFloorIds: [10],
    sourceFloorBindings: binding,
    sourceFloorPartsSha256: nativeDerivedFrameHash(binding),
    drawingBacked,
    assumption: {
      kind: "drawing-backed",
      authorizationRecorded: true,
      authorizationEvidenceSha256: "1".repeat(64),
      revisitRequired: true,
      sourceVerified: false,
      evidenceSha256: nativeDerivedFrameHash(drawingBacked),
    },
    evidenceSha256: "3".repeat(64),
  };
  const seals = {
    version: 1,
    sourceModelSha256: sha,
    sourceMaterialGeometrySha256: material.geometrySha256,
    sourceWallPositionRepairsSha256:
      nativeDerivedFramePlacementHash(noWallRepairs),
    geometrySha256: "",
    completeOriginalPhysicalOwnerCensusSha256: nativeDerivedFrameHash(foreign),
    foreignBodies: foreign,
    rows: [row],
  };
  const data = {
    source: { modelSha256: sha },
    records: [],
    nodes: [],
    edges: [],
    doors: [],
    walls: [],
    stairs: [],
    nativeLevels: [{ id: 1, elevationFeet: 0 }],
    nativeMaterialSections: material,
    nativeProvisionalCornerSeals: seals,
    walkingSupport: {
      version: 1,
      sourceModelSha256: sha,
      floors: [
        {
          nativeElementId: 10,
          elevationFeet: 0,
          ringsFeet: floor[0],
          partsFeet: floor,
        },
      ],
    },
  } as unknown as IndoorDataset;
  return {
    data,
    boundaryReference,
    rehash: () => {
      seals.geometrySha256 = nativeProvisionalCornerSealsHash(seals as never);
      return data;
    },
  };
}
