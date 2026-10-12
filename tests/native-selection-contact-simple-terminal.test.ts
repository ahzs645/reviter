import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveNativeSelectionContactRepair as derive,
  nativeSelectionOriginalSimpleTerminalCapMask as direct,
  validateNativeSelectionContactRepairs,
} from "../lib/reviter/native-selection-contact-repairs.ts";
import { assertNativeSelectionContactPhysicalGuards as guard } from "../lib/reviter/native-selection-contact-guards.ts";
import { parseRoomDirectory } from "../lib/reviter/room-directory.ts";
import {
  nativeMaterialSectionsHash,
  verifyNativeMaterialSections,
} from "../lib/reviter/native-material-sections.ts";
import { nativeMaterialPlanExactWalls } from "../lib/reviter/native-material-plan.ts";
import { createNativeRoutingMaterialQuery } from "../lib/reviter/native-routing-material.ts";
import {
  Rational,
  nativeRationalOverlay,
} from "../lib/reviter/native-rational-overlay.ts";
import {
  nativeRationalArea,
  nativeRationalPoint,
} from "../lib/reviter/native-exact-planar-topology.ts";
// Compiler copy of the separate original-simple-terminal-cap family (04-128
// amendment). OpenIndoorMaps runs the same cases against both mirrors; here the
// compiler module is exercised alone, so runtime/compiler pairs use one module.
// Fixtures use loose typing because they construct malformed original bodies.
/* eslint-disable @typescript-eslint/no-explicit-any */
const compilerDerive = derive,
  compilerGuard = guard;
type P = [number, number];
const gap = 2 ** -45,
  model = "a".repeat(64);
const rect = (a: number, b: number, c: number, d: number): P[] => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
];
const source: P[] = [
  [-10, 0],
  [-6, -2],
  [-2, -2],
  [0, 0],
  [0, 1],
  [-2, -1],
  [-6, -1],
  [-10, 1],
];
const target: P[] = [
  [gap, -2],
  [3, -2],
  [3, 3],
  [gap, 3],
  [gap, 2],
  [1, 2],
  [1, 1.5],
  [gap, 1.5],
];
const exact = (r: P[]) => [[r.map(nativeRationalPoint)]];
async function fixture(s = source, t = target) {
  const material: any = {
    version: 1,
    sourceModelSha256: model,
    levels: [
      {
        levelId: 311,
        elevationFeet: 0,
        cutElevationFeet: 4,
        evidenceSha256: "b".repeat(64),
        sourceElementIds: [1, 2],
        sections: [s, t].map((r, i) => ({
          nativeElementId: i + 1,
          kind: "wall",
          categoryId: -2000011,
          baseElevationFeet: 0,
          topElevationFeet: 8,
          partsFeet: [[r]],
        })),
      },
    ],
  };
  material.geometrySha256 = await nativeMaterialSectionsHash(material);
  const data: any = {
    source: { modelSha256: model },
    nativeLevels: [{ id: 311, elevationFeet: 0 }],
    walls: [],
    nativeMaterialSections: material,
    walkingSupport: {
      version: 1,
      sourceModelSha256: model,
      floors: [
        {
          nativeElementId: 10,
          elevationFeet: 0,
          ringsFeet: [rect(-20, -20, 20, 20)],
        },
      ],
    },
    records: [],
    doors: [],
    edges: [],
  };
  await verifyNativeMaterialSections(material, model);
  const current = nativeMaterialPlanExactWalls(
    data,
    311,
    createNativeRoutingMaterialQuery(data),
  );
  const repair: any = {
    id: "simple",
    sourceModelSha256: model,
    sourceMaterialGeometrySha256: material.geometrySha256,
    levelId: 311,
    elevationFeet: 0,
    status: "proposed",
    source: {
      nativeElementId: 1,
      ringsFeet: structuredClone(
        current.find((w: any) => w.nativeElementId === 1)!.ringsFeet,
      ),
      capFeet: [
        [0, 0],
        [0, 1],
      ],
    },
    target: {
      nativeElementId: 2,
      ringsFeet: structuredClone(
        current.find((w: any) => w.nativeElementId === 2)!.ringsFeet,
      ),
      faceFeet: [target[7], target[0]],
    },
    contactMode: "original-simple-terminal-cap",
    evidenceSha256: "c".repeat(64),
    notes: "Original complete curved strip, selection only, revisit.",
    assumption: {
      kind: "provisional-extracted-native-contact",
      revisitRequired: true,
    },
  };
  return { data, repair };
}
function normalize(p: any) {
  return p.map((p: any) =>
    p.map((r: any) =>
      r.map((p: any) => p.map((v: any) => new Rational(v.n, v.d))),
    ),
  );
}
function equal(a: any, b: any) {
  a = normalize(a);
  b = normalize(b);
  assert.equal(nativeRationalOverlay("difference", a, b).length, 0);
  assert.equal(nativeRationalOverlay("difference", b, a).length, 0);
}
test("separate production contract accepts a whole original curved strip and notched target; runtime/compiler derive and physical guards agree", async () => {
  const { data, repair } = await fixture(),
    before = structuredClone({ data, repair });
  const a = derive(data, repair),
    b = compilerDerive(data, repair);
  equal(a, b);
  assert(nativeRationalArea(a).n > 0n);
  guard(data, repair, a);
  compilerGuard(data, repair, b);
  assert.deepEqual({ data, repair }, before);
  assert.throws(
    () => derive(data, { ...repair, contactMode: "original-free-cap" }),
    /full actual original edge/,
  );
});
test("new source binding accepts only cyclic starts/reversed original profiles, never cropped/changed coordinates", async () => {
  const { data, repair } = await fixture(),
    a = derive(data, repair);
  for (const body of [repair.source, repair.target]) {
    const r = body.ringsFeet[0];
    if (JSON.stringify(r[0]) === JSON.stringify(r.at(-1))) r.pop();
    r.reverse();
    r.push(r.shift());
  }
  equal(a, derive(data, repair));
  repair.source.ringsFeet[0][0][0] += 0.00001;
  assert.throws(() => derive(data, repair), /changed, missing/);
});
test("new numerical family rejects simple short quads, long side edges, invented subcaps, hole-bearing and ambiguous original components", () => {
  const full = exact(source),
    t = exact(target),
    cap: [P, P] = [
      [0, 0],
      [0, 1],
    ],
    face: [P, P] = [target[7], target[0]];
  for (const [s, c] of [
    [exact(rect(-0.5, 0, 0, 1)), cap],
    [full, [source[0], source[1]]],
    [
      full,
      [
        [0, 0.2],
        [0, 0.8],
      ],
    ],
  ] as any[])
    assert.throws(() => direct(s, t, c, face));
  assert.throws(() =>
    direct(
      [
        [
          source.map(nativeRationalPoint),
          rect(-5, -1.8, -4, -1.5).map(nativeRationalPoint),
        ],
      ],
      t,
      cap,
      face,
    ),
  );
  assert.throws(
    () => direct([...full, ...full], t, cap, face),
    /unique entire/,
  );
});
test("all actual source terminal half-planes and both complete side chains are mandatory", () => {
  const s = structuredClone(source);
  s[1] = [-11, -2];
  assert.throws(
    () =>
      direct(
        exact(s),
        exact(target),
        [
          [0, 0],
          [0, 1],
        ],
        [target[7], target[0]],
      ),
    /half-plane|terminal/,
  );
  const short = structuredClone(source);
  short.splice(1, 0, [-9.9, -0.01]);
  assert.throws(
    () =>
      direct(
        exact(short),
        exact(target),
        [
          [0, 0],
          [0, 1],
        ],
        [target[7], target[0]],
      ),
    /terminal|side-chain/,
  );
});
test("simple complete source/target reject self-intersections, nonadjacent tangencies, repeated and inserted vertices", () => {
  const face: [P, P] = [target[7], target[0]],
    cap: [P, P] = [
      [0, 0],
      [0, 1],
    ];
  for (const change of [
    (s: P[]) => s.splice(1, 0, [...s[0]]),
    (s: P[]) => s.splice(1, 0, [-8, -1]),
    (s: P[]) => {
      s[2] = [-7, 2];
    },
  ]) {
    const s = structuredClone(source);
    change(s);
    assert.throws(() => direct(exact(s), exact(target), cap, face));
  }
  const t = structuredClone(target);
  t[2] = [-1, 0];
  assert.throws(() => direct(exact(source), exact(t), cap, face));
});
test("every positive original full-cap interval must meet actual first material; partial width and deep notch fail", () => {
  const cap: [P, P] = [
    [0, 0],
    [0, 1],
  ];
  const partial = rect(gap, -2, 3, 0.5);
  assert.throws(
    () => direct(exact(source), exact(partial), cap, [partial[3], partial[0]]),
    /unsupported original full-cap/,
  );
  const deep: P[] = [
    [gap, -2],
    [3, -2],
    [3, 3],
    [gap, 3],
    [gap, 0.6],
    [0.001, 0.6],
    [0.001, 0.4],
    [gap, 0.4],
  ];
  assert.throws(
    () => direct(exact(source), exact(deep), cap, [deep[7], deep[0]]),
    /non-numerical|first original material/,
  );
  assert.throws(
    () => direct(exact(source), exact(target), cap, [target[1], target[2]]),
    /non-first named/,
  );
});
test("same-owner sibling material is retained in exact overlap vetoes", () => {
  const overlap = exact(rect(gap / 4, 0.2, gap / 2, 0.8));
  assert.throws(
    () =>
      direct(
        [...exact(source), ...overlap],
        exact(target),
        [
          [0, 0],
          [0, 1],
        ],
        [target[7], target[0]],
      ),
    /sibling material/,
  );
});
test("actual full mask physical guards reject original holes even under an overlapping support slab, door, fixture, foreign material, exclusion and unsupported floor", async () => {
  for (const kind of [
    "hole",
    "door",
    "fixture",
    "foreign",
    "exclusion",
    "no-floor",
    "opening",
  ]) {
    const { data, repair } = await fixture(),
      mask = derive(data, repair),
      compilerMask = compilerDerive(data, repair),
      r = rect(gap / 4, 0.2, gap / 2, 0.8);
    if (kind === "hole") {
      data.walkingSupport.floors[0].ringsFeet.push(r);
      data.walkingSupport.floors.push({
        nativeElementId: 11,
        elevationFeet: 0,
        ringsFeet: [rect(-20, -20, 20, 20)],
      });
    }
    if (kind === "door") data.doors = [{ levelId: 311, footprintFeet: r }];
    if (kind === "fixture")
      data.circulationGeometry = {
        sourceModelSha256: model,
        fixtures: [{ levelIds: [311], elevationFeet: 0, ringsFeet: [r] }],
      };
    if (kind === "foreign") {
      data.nativeMaterialSections.levels[0].sections.push({
        nativeElementId: 3,
        kind: "wall",
        categoryId: -2000011,
        baseElevationFeet: 0,
        topElevationFeet: 8,
        partsFeet: [[r]],
      });
      data.nativeMaterialSections.levels[0].sourceElementIds.push(3);
      data.nativeMaterialSections.geometrySha256 =
        await nativeMaterialSectionsHash(data.nativeMaterialSections);
      repair.sourceMaterialGeometrySha256 =
        data.nativeMaterialSections.geometrySha256;
      await verifyNativeMaterialSections(data.nativeMaterialSections, model);
    }
    if (kind === "exclusion")
      data.indoorExclusions = {
        version: 1,
        sourceModelSha256: model,
        areas: [
          {
            id: "x",
            elevationFeet: 0,
            levelId: 311,
            label: "excluded lip",
            nativeFloorIds: [10],
            partsFeet: [[rect(0, 0.2, 1, 0.8)]],
            reason: "off-limits",
            notes: "x",
          },
        ],
      };
    if (kind === "no-floor") data.walkingSupport.floors = [];
    if (kind === "opening")
      data.records = [{ levelId: 311, properties: { floorOpeningsFeet: [r] } }];
    const expected: any = {
      hole: /original floor opening/,
      door: /physical doorway/,
      fixture: /physical fixture/,
      foreign: /foreign wall or column/,
      exclusion: /reviewed excluded footprint/,
      "no-floor": /unsupported original/,
      opening: /source floor or stair opening/,
    }[kind];
    assert.throws(() => guard(data, repair, mask), expected, kind);
    assert.throws(
      () => compilerGuard(data, repair, compilerMask),
      expected,
      kind,
    );
  }
});
test("independent original-mask reconstruction rejects serialized forged or truncated masks", async () => {
  const { data, repair } = await fixture(),
    mask = derive(data, repair);
  const forged = exact(rect(0, 0.2, gap, 0.4));
  assert.throws(() => guard(data, repair, forged), /differs from exact/);
  guard(data, repair, mask);
});
test("whole original cap remains protected from a source aperture that touches only the cap and not the positive gap", async () => {
  const { data, repair } = await fixture(),
    mask = derive(data, repair),
    compilerMask = compilerDerive(data, repair);
  data.records = [
    {
      levelId: 311,
      properties: { floorOpeningsFeet: [rect(-1, 0.2, 0, 0.8)] },
    },
  ];
  assert.throws(
    () => guard(data, repair, mask),
    /entire original simple terminal cap crosses a source/,
  );
  assert.throws(
    () => compilerGuard(data, repair, compilerMask),
    /entire original simple terminal cap crosses a source/,
  );
});
test("model/material/elevation/finite-evidence/explicit-assumption remain bound and schema round trip rejects unknown family", async () => {
  const { data, repair } = await fixture();
  const value = { version: 1, sourceModelSha256: model, repairs: [repair] };
  validateNativeSelectionContactRepairs(
    JSON.parse(JSON.stringify(value)),
    model,
  );
  for (const edit of [
    (r: any) => (r.sourceModelSha256 = "f".repeat(64)),
    (r: any) => (r.sourceMaterialGeometrySha256 = "f".repeat(64)),
    (r: any) => (r.elevationFeet = 0.1),
    (r: any) => (r.evidenceSha256 = "bad"),
    (r: any) => (r.assumption.revisitRequired = false),
    (r: any) => (r.contactMode = "made-up"),
  ]) {
    const r = structuredClone(repair);
    edit(r);
    assert.throws(() => derive(data, r));
  }
});
test("compiler original authoring parser retains the new proposed mode and rejects its stale assumption through the updated shared validator", async () => {
  const { repair } = await fixture(),
    directory: any = {
      format: "reviter-room-annotations",
      version: 1,
      coordinateSystem: "revit-model-feet",
      model: { fileName: "model.rvt" },
      annotations: [],
      nativeSelectionContactRepairs: {
        version: 1,
        sourceModelSha256: model,
        repairs: [repair],
      },
    };
  assert.deepEqual(
    parseRoomDirectory(JSON.stringify(directory)).nativeSelectionContactRepairs,
    directory.nativeSelectionContactRepairs,
  );
  directory.nativeSelectionContactRepairs.repairs[0].assumption.revisitRequired =
    false;
  assert.throws(() => parseRoomDirectory(JSON.stringify(directory)), /contact/);
});
test("a fresh operation rejects an in-place original body edit even if the declared geometry checksum was not updated", async () => {
  const { data, repair } = await fixture();
  derive(data, repair);
  data.nativeMaterialSections.levels[0].sections[0].partsFeet[0][0][1][0] += 0.01;
  assert.throws(() => derive(data, repair), /changed, missing/);
});
