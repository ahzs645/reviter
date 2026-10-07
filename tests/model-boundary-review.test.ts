import assert from "node:assert/strict";
import test from "node:test";
import { sectionForModelBoundaryReview } from "../lib/reviter/model-boundary-review.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type {
  DirectoryRoom,
  RoomPoint,
} from "../lib/reviter/room-directory.ts";
import type {
  BoundaryReference,
  BoundarySection,
  BoundarySegment,
} from "../lib/reviter/room-boundaries.ts";
const MODEL = "a".repeat(64),
  SOURCE = "b".repeat(64);
function setup() {
  const outer: RoomPoint[] = [
      [-2, -4],
      [12, -4],
      [12, 6],
      [-2, 6],
    ],
    donor: RoomPoint[] = [
      [0, -3],
      [10, -3],
      [10, -0.5],
      [0, -0.5],
    ];
  const lines: BoundarySegment[] = [
    [
      [0, 0],
      [10, 0],
    ],
    [
      [0, 0.3],
      [10, 0.3],
    ],
    [
      [10, -4],
      [10, 6],
    ],
  ];
  const section = {
    sectionId: "test",
    levelId: 1,
    registrationErrorFeet: 0,
    wallSegments: lines,
    doorSegments: [],
  } as BoundarySection;
  const reference = {
    sourceSha256: SOURCE,
    sections: [section],
  } as BoundaryReference;
  const room = {
    key: "survivor",
    levelId: 1,
    polygonFeet: outer,
    labelPointFeet: [5, 3],
    dwg: { sectionId: "test", sha256: SOURCE },
    status: "active",
    manualBoundaryReview: {
      version: 1,
      kind: "merged-source-area-review",
      sourceModelSha256: MODEL,
      mergedSourceKeys: ["survivor", "donor"],
      mergedOriginalAreas: [{ key: "donor", ringsFeet: [donor] }],
    },
    modelBoundaryReview: {
      version: 1,
      kind: "native-model-overrides-registered-internal-divider",
      sourceModelSha256: MODEL,
      registeredSourceSha256: SOURCE,
      sectionId: "test",
      displayOnly: true,
      removedInternalDividerIndices: [0, 1],
      removedInternalDividerSegments: [
        { index: 0, segment: lines[0] },
        { index: 1, segment: lines[1] },
      ],
    },
  } as unknown as DirectoryRoom;
  const originalDonor = {
    key: "donor",
    levelId: 1,
    polygonFeet: donor,
    labelPointFeet: [5, -2],
    status: "deleted",
    mergedInto: "survivor",
  } as unknown as DirectoryRoom;
  const dataset = {
    source: { modelSha256: MODEL },
    records: [
      {
        key: "survivor",
        levelId: 1,
        elevationFeet: 0,
        circulation: false,
        stair: false,
        walkable: true,
      },
    ],
    walls: [
      {
        levelId: 1,
        nativeElementId: 1,
        approximate: false,
        ringsFeet: [
          [
            [-2, -4],
            [-1, -4],
            [-1, 6],
            [-2, 6],
          ],
        ],
      },
      {
        levelId: 1,
        nativeElementId: 2,
        approximate: false,
        ringsFeet: [
          [
            [11, -4],
            [12, -4],
            [12, 6],
            [11, 6],
          ],
        ],
      },
    ],
    walkingSupport: { floors: [{ elevationFeet: 0, ringsFeet: [outer] }] },
  } as unknown as IndoorDataset;
  return { dataset, annotations: [room, originalDonor], reference, section };
}
const run = (s: ReturnType<typeof setup>) =>
  sectionForModelBoundaryReview(
    s.dataset,
    s.annotations,
    s.reference,
    s.section,
  );
test("model-supported merged display removes only exact reviewed divider faces and preserves source", () => {
  const s = setup(),
    before = JSON.stringify(s),
    r = run(s);
  assert.equal(r.applied.length, 1);
  assert.deepEqual(r.section.wallSegments, [s.section.wallSegments[2]]);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(r.applied[0].donorKeys, ["donor"]);
});
for (const [name, mutate] of [
  [
    "different model",
    (s: ReturnType<typeof setup>) => {
      s.dataset.source.modelSha256 = "c".repeat(64);
    },
  ],
  [
    "different registered source",
    (s: ReturnType<typeof setup>) => {
      s.reference.sourceSha256 = "c".repeat(64);
    },
  ],
  [
    "stale segment index",
    (s: ReturnType<typeof setup>) => {
      s.section.wallSegments[0] = [
        [0, 0],
        [9, 0],
      ];
    },
  ],
  [
    "active donor",
    (s: ReturnType<typeof setup>) => {
      s.annotations[1].status = "active";
    },
  ],
  [
    "donor still in routing dataset",
    (s: ReturnType<typeof setup>) => {
      s.dataset.records.push({ ...s.dataset.records[0], key: "donor" });
    },
  ],
  [
    "unrelated deleted annotation",
    (s: ReturnType<typeof setup>) => {
      s.annotations[1].mergedInto = "other";
    },
  ],
  [
    "unverified source merge",
    (s: ReturnType<typeof setup>) => {
      delete s.annotations[0].manualBoundaryReview;
    },
  ],
  [
    "no native support",
    (s: ReturnType<typeof setup>) => {
      s.dataset.walls = [];
    },
  ],
  [
    "unsupported floor",
    (s: ReturnType<typeof setup>) => {
      s.dataset.walkingSupport!.floors = [];
    },
  ],
  [
    "real native partition",
    (s: ReturnType<typeof setup>) => {
      s.dataset.walls.push({
        levelId: 1,
        nativeElementId: 3,
        kind: "wall",
        approximate: false,
        ringsFeet: [
          [
            [4, -1],
            [5, -1],
            [5, 1],
            [4, 1],
          ],
        ],
      });
    },
  ],
  [
    "uncertain barrier",
    (s: ReturnType<typeof setup>) => {
      s.dataset.walls.push({
        levelId: 1,
        nativeElementId: 3,
        kind: "wall",
        approximate: true,
        ringsFeet: [
          [
            [4, -1],
            [5, -1],
            [5, 1],
            [4, 1],
          ],
        ],
      });
    },
  ],
] as const)
  test("retains original divider for " + name, () => {
    const s = setup();
    mutate(s);
    const r = run(s);
    assert.equal(r.applied.length, 0);
    assert.equal(r.section, s.section);
  });

test("retains source divider when merged donor lies in native floor aperture", () => {
  const s = setup();
  s.dataset.walkingSupport!.floors[0].ringsFeet.push([
    [4, -3],
    [6, -3],
    [6, -1],
    [4, -1],
  ]);
  assert.equal(run(s).applied.length, 0);
});
