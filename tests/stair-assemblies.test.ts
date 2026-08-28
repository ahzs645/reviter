import assert from "node:assert/strict";
import test from "node:test";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import {
  buildStairAssemblies,
  stairAssemblyParts,
} from "../lib/reviter/stair-assemblies.ts";
import type {
  Revit2027StairsElementAggregate,
  Revit2027StairsRunAndLandingAggregate,
} from "../lib/reviter/revit-2027-stairs-aggregate.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

function run(
  elementId: number,
  stairsId: number,
  stringerIds: readonly number[] = [],
): Revit2027StairsRunAndLandingAggregate {
  return {
    elementId,
    stairsId,
    triserSymbolId: null,
    baseRiserIndex: 0,
    isMirrored: false,
    stringerIds,
    supportPathCurveLoops: { spans: [] } as never,
    supportExistenceStatus: [],
    objectOffset: 0,
    objectLength: 0,
    stairsIdOffset: 0,
    staticSuffixEndOffset: 0,
    runProperties: null,
  };
}

/**
 * A run that carries run scalars, so it counts as a flight rather than a
 * landing.
 *
 * `run()` above leaves `runProperties` null, which is what a `StairsLanding`
 * decodes to. The shape rule turns on that distinction: a landing can neither
 * prove nor veto a spiral, and only a decoded *run* does either.
 */
function flightRun(
  elementId: number,
  stairsId: number,
  stringerIds: readonly number[] = [],
): Revit2027StairsRunAndLandingAggregate {
  return {
    ...run(elementId, stairsId, stringerIds),
    runProperties: {
      bottomElevationFeet: 0,
      topElevationFeet: 10,
      extendBelowBaseFeet: 0,
      extendBelowTreadBaseFeet: 0,
      actualRunWidthFeet: 3,
      leftStringerWidthFeet: 0.1,
      rightStringerWidthFeet: 0.1,
      topRiserIndex: 16,
      centerMarkVisible: true,
      beginWithRiser: true,
      endWithRiser: false,
    },
  };
}

/**
 * Only the three id lists this file cares about are settable.
 *
 * A `Partial<Revit2027StairsElementAggregate>` spread would be shorter and is
 * wrong under `exactOptionalPropertyTypes`: it can write `undefined` over an
 * optional field that the type says is either present or absent.
 */
function stairFrame(
  elementId: number,
  parts: {
    registeredRailingIds?: readonly number[];
    runAndLandingIds?: readonly number[];
    supportIds?: readonly number[];
  },
): Revit2027StairsElementAggregate {
  return {
    elementId,
    objectOffset: 0,
    objectLength: 0,
    staticBodyOffset: 0,
    staticEndOffset: 0,
    registeredRailingIds: parts.registeredRailingIds ?? [],
    runAndLandingIds: parts.runAndLandingIds ?? [],
    stairsBoundaryCurves2d: { spans: [] } as never,
    stairsRailingPaths: { spans: [] } as never,
    supportIds: parts.supportIds ?? [],
  };
}

test("a run's parent link alone builds an assembly", () => {
  const assemblies = buildStairAssemblies(
    new Map([[201, run(201, 200, [301, 302])], [202, run(202, 200)]]),
    undefined,
  );

  assert.equal(assemblies.length, 1);
  assert.equal(assemblies[0]!.stairElementId, 200);
  assert.deepEqual(assemblies[0]!.runAndLandingIds, [201, 202]);
  assert.deepEqual(assemblies[0]!.stringerIds, [301, 302]);
  assert.equal(assemblies[0]!.evidence, "runs");
});

test("the element frame contributes the parts no run mentions", () => {
  const assemblies = buildStairAssemblies(
    new Map([[201, run(201, 200)]]),
    new Map([[200, stairFrame(200, {
      registeredRailingIds: [401, 402],
      runAndLandingIds: [201, 203],
      supportIds: [501],
    })]]),
  );

  assert.equal(assemblies.length, 1);
  // 203 is a landing the run scan never reached; the frame is the only source.
  assert.deepEqual(assemblies[0]!.runAndLandingIds, [201, 203]);
  assert.deepEqual(assemblies[0]!.railingIds, [401, 402]);
  assert.deepEqual(assemblies[0]!.supportIds, [501]);
  assert.equal(assemblies[0]!.evidence, "runs-and-element-frame");
});

test("an orphan run does not invent a container", () => {
  // stairsId 0 means the parent did not decode. Manufacturing a stair for it
  // would be exactly the kind of guess the recovery refuses elsewhere.
  assert.deepEqual(buildStairAssemblies(new Map([[201, run(201, 0)]]), undefined), []);
});

test("a part is claimed by one assembly only", () => {
  // IFC4: `IfcObjectDefinition.Decomposes` is SET [0:1]. A landing named by two
  // stairs -- the ordinary case between two flights -- would otherwise emit a
  // file that no conforming reader should accept.
  const assemblies = buildStairAssemblies(
    new Map([[201, run(201, 200)], [211, run(211, 210)]]),
    new Map([
      [200, stairFrame(200, { runAndLandingIds: [900] })],
      [210, stairFrame(210, { runAndLandingIds: [900] })],
    ]),
  );

  const claims = assemblies.flatMap((assembly) => stairAssemblyParts(assembly));
  assert.equal(new Set(claims).size, claims.length, "no id may appear in two assemblies");
  // Lower stair id wins, so the choice does not depend on scan order.
  assert.ok(assemblies[0]!.runAndLandingIds.includes(900));
  assert.ok(!assemblies[1]!.runAndLandingIds.includes(900));
});

test("a stair is never a part of another stair's assembly", () => {
  const assemblies = buildStairAssemblies(
    new Map([[201, run(201, 200)], [210, run(210, 200)]]),
    new Map([[210, stairFrame(210, { runAndLandingIds: [211] })]]),
  );

  const byId = new Map(assemblies.map((assembly) => [assembly.stairElementId, assembly]));
  assert.ok(byId.has(200));
  assert.ok(!stairAssemblyParts(byId.get(200)!).includes(210),
    "210 owns an assembly of its own, so it cannot also be a part of 200's");
});

// --------------------------------------------------------------------------
// The shape
// --------------------------------------------------------------------------

test("the helix replay's runs are what makes a stair spiral", () => {
  // The identity comes from `revit-2027-spiral-stair-mesh`, which recovers a
  // run only from two coaxial `GCylindricalHelix` guides exactly the run's own
  // width apart. Nothing weaker than that set may reach this field.
  const assemblies = buildStairAssemblies(
    new Map([[201, flightRun(201, 200, [301])]]),
    undefined,
    new Set([201]),
  );

  assert.equal(assemblies.length, 1);
  assert.deepEqual(assemblies[0]!.spiralRunIds, [201]);
  assert.equal(assemblies[0]!.shape, "spiral");
});

test("without the replay a stair has no shape, not a straight one", () => {
  const assemblies = buildStairAssemblies(
    new Map([[201, flightRun(201, 200)]]),
    undefined,
  );

  assert.deepEqual(assemblies[0]!.spiralRunIds, []);
  assert.equal(assemblies[0]!.shape, "undetermined",
    "absence of the helical reading is absence, never a claim of a straight run");
});

test("a landing neither proves nor vetoes the shape", () => {
  // A `StairsLanding` decodes with no run scalars. Letting it veto would make
  // every real spiral stair -- which lands between flights -- undeterminable.
  const assemblies = buildStairAssemblies(
    new Map([[201, flightRun(201, 200)], [202, run(202, 200)]]),
    undefined,
    new Set([201]),
  );

  assert.deepEqual(assemblies[0]!.runAndLandingIds, [201, 202]);
  assert.deepEqual(assemblies[0]!.spiralRunIds, [201]);
  assert.equal(assemblies[0]!.shape, "spiral");
});

test("a decoded run the replay declined vetoes the whole assembly", () => {
  // The consumer replaces *every* flight of a spiral stair with one synthesised
  // helix. A stair that mixes a proven helical run with a run of unknown shape
  // would have the unknown one deleted and redrawn as a helix, so the evidence
  // is kept and the conclusion is withheld.
  const assemblies = buildStairAssemblies(
    new Map([[201, flightRun(201, 200)], [202, flightRun(202, 200)]]),
    undefined,
    new Set([201]),
  );

  assert.deepEqual(assemblies[0]!.spiralRunIds, [201]);
  assert.equal(assemblies[0]!.shape, "undetermined");
});

test("spiral evidence follows the assembly that claimed the run", () => {
  // `runAndLandingIds` is the claimed set, and a part belongs to one assembly
  // only. Evidence for an id another stair claimed must not label this one.
  const assemblies = buildStairAssemblies(
    new Map([[201, flightRun(201, 200)], [211, flightRun(211, 210)]]),
    undefined,
    new Set([201]),
  );

  const byId = new Map(assemblies.map((assembly) => [assembly.stairElementId, assembly]));
  assert.equal(byId.get(200)!.shape, "spiral");
  assert.equal(byId.get(210)!.shape, "undetermined");
  assert.deepEqual(byId.get(210)!.spiralRunIds, []);
});

test("output is stable across equal inputs", () => {
  const build = () => buildStairAssemblies(
    new Map([[202, run(202, 200, [302, 301])], [201, run(201, 200, [301])]]),
    undefined,
  );
  assert.deepEqual(build(), build());
  assert.deepEqual(build()[0]!.stringerIds, [301, 302], "sorted, not insertion-ordered");
});

// --------------------------------------------------------------------------
// The export
// --------------------------------------------------------------------------

function boundsRecord(
  elementId: number,
  categoryId: number,
  categoryName: string,
): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: elementId,
    recordOffset: elementId,
    categoryId,
    categoryName,
    categorySource: "native-token",
    renderGeometryProvenance: "native",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 10 } },
  };
}

/** A scene with one stair flight and one stringer, and the assembly joining them. */
function stairFixture(): ConvertResult {
  const flight = 201;
  const stringer = 301;
  return {
    ok: true,
    fileName: "stair-fixture.rvt",
    byteLength: 64,
    meshes: [{
      name: "Recovered elements",
      positions: new Float32Array([
        0, 0, 0, 4, 0, 0, 0, 0, 3,
        1, 0, 0, 2, 0, 0, 1, 0, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array(18),
      elementIds: new Uint32Array([flight, stringer]),
      materialIndex: 0,
      source: "native-brep",
    }],
    materials: [{
      name: "Concrete",
      baseColorLinear: [0.5, 0.5, 0.5, 1],
      metallic: 0,
      roughness: 0.8,
      doubleSided: false,
      source: "rvt-material",
      assignedElements: 1,
    }],
    segments: [],
    elementBounds: [
      // OST_StairsRuns; the exporter maps it to IFCSTAIRFLIGHT. Using an id
      // that is not a real category would have the parts export as proxies and
      // the aggregate still "pass" while aggregating the wrong thing.
      boundsRecord(flight, -2_000_919, "Runs"),
      boundsRecord(stringer, -2_001_320, "Structural Framing"),
    ],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027,
      activeDecoders: [],
      nativeCurves: 0,
      nativeProfiles: 0,
      nativeMeshes: 1,
      nativeMaterialDefinitions: 0,
      nativeMaterialAssignments: 0,
      approximateSolids: 0,
      nativeCategorisedElements: 2,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned",
      semanticFidelity: "native-categories",
    },
    origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 10 } },
    levels: [{ elevation: 0, candidates: 2, levelId: 30, source: "assoc-level-id" }],
    stats: {
      streamCount: 1,
      partitionStreams: 1,
      gzipChunks: 1,
      inflatedBytes: 1,
      candidatesFound: 2,
      candidatesFocused: 2,
      candidatesUsed: 2,
      vertexCount: 6,
      triangleCount: 2,
      meshCount: 1,
      boundsRecordsFound: 2,
      solidBoundsRecords: 2,
      durationMs: 1,
    },
    warnings: [],
    method: "partition-bounds-recovery",
    nativeAssociatedLevelRelations: [flight, stringer].map((elementId) => ({
      elementId,
      levelId: 30,
      fieldOffset: 64 as const,
      recordOffset: elementId,
      objectLength: 200,
      objectMarker: 1,
      kind: "associated-level" as const,
      source: "Partitions/Element.m_assocLevelId" as const,
      evidence: "persisted" as const,
    })),
    nativeStairAssemblies: buildStairAssemblies(
      new Map([[flight, run(flight, 200, [stringer])]]),
      undefined,
    ),
  } as ConvertResult;
}

test("the export states that a flight and its stringer are one stair", () => {
  const ifc = makeIfc(stairFixture());

  const container = ifc.match(/#(\d+)=IFCSTAIR\(([^\n]*)\);/);
  assert.ok(container, "a stair with no recovered body still needs a container to aggregate onto");
  // ...,ObjectPlacement,Representation,Tag,PredefinedType -- the representation
  // slot is `$` because the parts already draw the stair.
  assert.match(container[2]!, /,#\d+,\$,'200',\.NOTDEFINED\.$/,
    "the container carries no representation and does not guess a stair shape");

  assert.match(ifc, /=IFCSTAIRFLIGHT\(/,
    "the run has to reach the file as a flight, or the aggregate joins proxies");

  const aggregate = ifc.match(/IFCRELAGGREGATES\([^)]*'Stair assembly'[^)]*\)/);
  assert.ok(aggregate, "the assembly relationship is what a consumer reads");
  assert.match(aggregate[0]!, new RegExp(`#${container[1]},\\(#\\d+,#\\d+\\)`),
    "the container relates to both parts");
});

test("a stair that already has a body is not duplicated", () => {
  // When the wrapper survives into the scene it is already a product; emitting
  // a second IFCSTAIR for the same element would put two containers in the file
  // and leave the parts aggregated onto the one nobody references.
  const base = stairFixture();
  const withBody: ConvertResult = {
    ...base,
    elementBounds: [...base.elementBounds, boundsRecord(200, -2_000_120, "Stairs")],
    meshes: [{
      ...base.meshes[0]!,
      elementIds: new Uint32Array([201, 200]),
    }],
  };

  const ifc = makeIfc(withBody);
  const containers = ifc.match(/=IFCSTAIR\(/g) ?? [];
  assert.equal(containers.length, 1, `expected one IFCSTAIR, found ${containers.length}`);
});

test("the export states the spiral shape the helix replay proved", () => {
  // The consumer routes on this enum alone: `IfcStair.PredefinedType ==
  // SPIRAL_STAIR` sends the assembly's flights and stringers to a synthesised
  // helix, and anything else to the generic path. Carrying the replay's
  // identity this far is the whole point of the field.
  const base = stairFixture();
  const spiral: ConvertResult = {
    ...base,
    nativeStairAssemblies: buildStairAssemblies(
      new Map([[201, flightRun(201, 200, [301])]]),
      undefined,
      new Set([201]),
    ),
  };

  const ifc = makeIfc(spiral);

  const container = ifc.match(/#(\d+)=IFCSTAIR\(([^\n]*)\);/);
  assert.ok(container);
  assert.match(container[2]!, /,'200',\.SPIRAL_STAIR\.$/,
    "IfcStairTypeEnum spells the winding stair SPIRAL_STAIR");

  const flight = ifc.match(/=IFCSTAIRFLIGHT\(([^\n]*)\);/);
  assert.ok(flight);
  assert.match(flight[1]!, /,\$,\$,\$,\$,\.SPIRAL\.$/,
    "IfcStairFlightTypeEnum spells the same shape SPIRAL, and the run is what was proven");

  // The aggregate is still what joins them; the shape does not replace it.
  assert.match(ifc, /IFCRELAGGREGATES\([^)]*'Stair assembly'/);
});

test("a spiral stair that kept its own body is shaped on that product", () => {
  // The wrapper survives into the scene often enough that the container branch
  // is not the only place the enum has to be written; a stair emitted through
  // the ordinary manifest loop takes its shape from the same evidence.
  const base = stairFixture();
  const withBody: ConvertResult = {
    ...base,
    elementBounds: [...base.elementBounds, boundsRecord(200, -2_000_120, "Stairs")],
    meshes: [{ ...base.meshes[0]!, elementIds: new Uint32Array([201, 200]) }],
    nativeStairAssemblies: buildStairAssemblies(
      new Map([[201, flightRun(201, 200, [301])]]),
      undefined,
      new Set([201]),
    ),
  };

  const ifc = makeIfc(withBody);
  const stairs = ifc.match(/=IFCSTAIR\([^\n]*\);/g) ?? [];
  assert.equal(stairs.length, 1, `expected one IFCSTAIR, found ${stairs.length}`);
  assert.match(stairs[0]!, /,'200',\.SPIRAL_STAIR\.\);$/);
});

test("a stair the replay never recovered keeps its flight undeclared", () => {
  const ifc = makeIfc(stairFixture());
  const flight = ifc.match(/=IFCSTAIRFLIGHT\(([^\n]*)\);/);
  assert.ok(flight);
  assert.match(flight[1]!, /,\$,\$,\$,\$,\.NOTDEFINED\.$/,
    "no helical reading means no shape written, on the flight as on the stair");
});

test("an assembly whose parts never reached the file emits nothing", () => {
  const base = stairFixture();
  const orphaned: ConvertResult = {
    ...base,
    nativeStairAssemblies: buildStairAssemblies(
      new Map([[999, run(999, 998)]]),
      undefined,
    ),
  };

  const ifc = makeIfc(orphaned);
  assert.equal(ifc.match(/'Stair assembly'/g), null,
    "a container aggregating nothing is noise, not evidence");
});
