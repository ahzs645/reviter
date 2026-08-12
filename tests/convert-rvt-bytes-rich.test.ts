/**
 * The half of `convertRvtBytes` the minimal end-to-end fixture never runs.
 *
 * `tests/convert-rvt-bytes.test.ts` drives the whole pipeline over a container
 * whose partitions hold nothing but duplicated-bounds records and category
 * tokens. That proves the staging, and it is deliberately kept as it is — but
 * it means every rule downstream of the record decoder is asserted as *zero*:
 * no rebuilt solids, no placed instances, no sketch rings, no arcs, no door
 * leaves, no materials, no parameters, no relations. Those rules are the bulk
 * of the conversion, and a stage that stopped calling one of them would not
 * fail there.
 *
 * This file runs the same entry point over a container that does reach them.
 * The fixture is assembled in `tests/rich-rvt-fixture.ts` from the record
 * layouts the per-decoder tests already prove valid — the plane triple, the
 * cylinder triple, the 300-byte instance object, the 84-byte sketch edge, the
 * framed material record, the parameter table — laid out as whole inflated
 * pages inside a real CFB container with checksum-paged streams and gzip chunk
 * framing.
 *
 * ## What this pins, and why the numbers are what they are
 *
 * The counters below are pinned as a block rather than one by one. Each is
 * produced by a different pass, most of them are threshold rules, and a
 * partial assertion would let the unasserted half drift. Where a number looks
 * arbitrary it is the fixture's own population: one curved wall because one
 * cylinder triple is written, twelve unplaced records because twelve envelopes
 * are written on the project datum, and so on.
 *
 * Three thresholds only exist above a population a toy fixture does not have,
 * so the fixture carries 520 ordinary floor records to cross them: the robust
 * framing quantile and the datum-pile removal both need 500 records, and the
 * modal sketch thickness needs eight samples in one category.
 *
 * ## What this does NOT reach
 *
 * Recorded here rather than left to be discovered:
 *
 *  - the Revit 2027 native BRep/mesh bridge, the stairs-run aggregate and the
 *    split alternate-frame collector — `decoderCoverage.nativeMeshes` is 0;
 *  - family and family-symbol relations, geometry/element material assignments
 *    and compound-structure definitions, so `materialFidelity` stays
 *    `native-definitions-unassigned`;
 *  - `Global/History` native identity, `TransmissionData` and native profiles.
 *
 * Each of those has its own unit test; what is missing is a *container-level*
 * fixture for them, not a decoder.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { CATEGORY, richModel, richSpec, buildModel } from "./rich-rvt-fixture.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

function converted(bytes: Uint8Array, fileName = "rich.rvt"): ConvertResult {
  const outcome = convertRvtBytes(bytes, fileName);
  if (!outcome.ok) assert.fail(`expected a conversion, got: ${outcome.error}`);
  return outcome;
}

/** Element ids that carry each kind of recovered geometry, in record order. */
function idsWith(
  result: ConvertResult,
  predicate: (record: ConvertResult["elementBounds"][number]) => unknown,
): number[] {
  return result.elementBounds.filter((record) => predicate(record)).map((record) => record.elementId);
}

test("the enriched container reaches every geometry rule the pipeline has", () => {
  const result = converted(richModel());
  assert.equal(result.method, "partition-bounds-recovery");

  // Named one by one first: a counter falling back to zero is the regression
  // this file exists to catch, and the block assertion below would report it
  // as one large diff rather than as the rule that stopped firing.
  const zeroed = Object.entries({
    nativeSolids: result.stats.nativeSolids,
    faceOnlyElements: result.stats.faceOnlyElements,
    solidOnlyElements: result.stats.solidOnlyElements,
    placedInstances: result.stats.placedInstances,
    instanceOnlyElements: result.stats.instanceOnlyElements,
    rejectedOrientedBoxes: result.stats.rejectedOrientedBoxes,
    cachedShapeRecords: result.stats.cachedShapeRecords,
    unplacedRecords: result.stats.unplacedRecords,
    sketchCurves: result.stats.sketchCurves,
    sketchBoundaryElements: result.stats.sketchBoundaryElements,
    sketchBoundedFacetHulls: result.stats.sketchBoundedFacetHulls,
    unnamedSketchElements: result.stats.unnamedSketchElements,
    completedFlatSketches: result.stats.completedFlatSketches,
    curvedWalls: result.stats.curvedWalls,
    sweptRailings: result.stats.sweptRailings,
    inferredCurtainPanels: result.stats.inferredCurtainPanels,
    doorLeaves: result.stats.doorLeaves,
    doorLeavesFromShape: result.stats.doorLeavesFromShape,
    adoptedStairBoxes: result.stats.adoptedStairBoxes,
    clippedSolids: result.stats.clippedSolids,
    extendedSolids: result.stats.extendedSolids,
    shrunkSolids: result.stats.shrunkSolids,
    narrowedSolidBands: result.stats.narrowedSolidBands,
    disownedSolids: result.stats.disownedSolids,
    narrowedFacetBands: result.stats.narrowedFacetBands,
    recoveredWallJoinEnds: result.stats.recoveredWallJoinEnds,
    elementObjects: result.stats.elementObjects,
    parameterElements: result.stats.parameterElements,
    typedElements: result.stats.typedElements,
    namedTypeElements: result.stats.namedTypeElements,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  assert.deepEqual(zeroed, [], "these rules stopped firing on the enriched fixture");
  assert.ok(result.stats.fittedLimitsReached?.length, "the limit census recorded nothing");
});

test("the enriched counters are what the fixture's populations say they are", () => {
  const result = converted(richModel());

  // Pinned as a whole: every one of these is produced by a separate pass and
  // read hundreds of lines later, which is exactly what a stage boundary has
  // to carry intact.
  // `durationMs` is a wall-clock reading and is dropped rather than asserted
  // on: a bound below which it must not fall is a flake waiting for a slow
  // machine, and it says nothing about what the conversion decoded.
  const counters: Record<string, unknown> = { ...result.stats };
  delete counters.durationMs;
  assert.deepEqual(counters, {
    streamCount: 9,
    partitionStreams: 2,
    gzipChunks: 16,
    inflatedBytes: 106_962,
    candidatesFound: 552,
    candidatesFocused: 549,
    candidatesUsed: 549,
    vertexCount: 4_510,
    triangleCount: 6_786,
    meshCount: 11,
    boundsRecordsFound: 552,
    solidBoundsRecords: 550,
    // Six framed shapes and instances, plus the four framed relation carriers
    // the chain reaches from them.
    elementObjects: 10,
    parameterElements: 2,
    surfaces: { planes: 33, cylinders: 3, verticalPlanes: 29 },
    // Seven plane triples are written; one is 25 ft thick and is refused, so
    // the census below records the refusal instead of a solid.
    nativeSolids: 8,
    faceOnlyElements: 5,
    placedInstances: 5,
    rejectedOrientedBoxes: 1,
    cachedShapeRecords: 5,
    unplacedRecords: 12,
    sketchBoundaryElements: 5,
    sketchBoundedFacetHulls: 1,
    completedFlatSketches: 1,
    sweptRailings: 1,
    curvedWalls: 1,
    inferredCurtainPanels: 1,
    doorLeaves: 1,
    doorLeavesFromShape: 1,
    adoptedStairBoxes: 1,
    clippedSolids: 2,
    extendedSolids: 3,
    recoveredWallJoinEnds: 1,
    shrunkSolids: 1,
    narrowedSolidBands: 1,
    disownedSolids: 1,
    narrowedFacetBands: 1,
    unnamedSketchElements: 2,
    sketchCurves: 55,
    solidOnlyElements: 4,
    instanceOnlyElements: 3,
    unclassifiedElements: 2,
    typedElements: 3,
    namedTypeElements: 3,
    elementObjectMarker: 0x08c6,
    fittedLimitsReached: [{
      limit: "max-half-thickness-feet",
      rejections: 1,
      description: "plane pairs further apart than the accepted wall thickness",
    }],
  });
});

test("each recovered geometry kind lands on the element that owns it", () => {
  const result = converted(richModel());

  // Not just "some record has a solid": the rule has to attach it to the
  // element whose blob the surfaces were written under.
  assert.deepEqual(
    idsWith(result, (record) => record.solids?.length).sort((a, b) => a - b),
    [1_049, 30_001, 61_000, 62_000, 64_000, 66_000, 67_000],
  );
  assert.deepEqual(
    idsWith(result, (record) => record.orientedBox).sort((a, b) => a - b),
    [40_002, 41_000, 44_000, 65_000, 70_000, 71_000],
  );
  assert.deepEqual(
    idsWith(result, (record) => record.loops?.length).sort((a, b) => a - b),
    [50_001, 53_000, 55_000, 55_001, 58_000],
  );
  assert.deepEqual(idsWith(result, (record) => record.arcs?.length), [30_003]);
  assert.deepEqual(idsWith(result, (record) => record.stairTreads?.length), [56_000]);
  assert.deepEqual(idsWith(result, (record) => record.railPath), [57_000]);
  assert.deepEqual(
    idsWith(result, (record) => record.inferredCurtainPanelGeometry),
    [70_000],
  );
  assert.deepEqual(
    idsWith(result, (record) => record.curtainPanelSurfaceQuads?.length),
    [72_000],
  );
  assert.deepEqual(
    idsWith(result, (record) => record.solids?.some((solid) => solid.startCorners || solid.endCorners)),
    [66_000],
  );
  // Both door routes, and which one each door took.
  assert.deepEqual(idsWith(result, (record) => record.doorLeafSource === "wall"), [65_000]);
  assert.deepEqual(idsWith(result, (record) => record.doorLeafSource === "shape"), [41_000]);
  assert.deepEqual(idsWith(result, (record) => record.parameters?.length), [1_049, 4_096]);
  assert.deepEqual(idsWith(result, (record) => record.typeName), [1_049, 2_048, 4_096]);
  // Records the file never wrote: two face hulls, two solids and three placements.
  assert.equal(idsWith(result, (record) => record.recordOffset < 0).length, 7);
});

test("the rebuilt geometry carries the numbers the fixture wrote", () => {
  const result = converted(richModel());
  const byId = new Map(result.elementBounds.map((record) => [record.elementId, record]));

  // A wall rebuilt from its own plane triple: the location line, the height
  // and the thickness are the trim range and the face separation, not a box.
  const wall = byId.get(30_001)!;
  const solid = wall.solid!;
  assert.deepEqual(solid.start, { x: 0, y: 100 });
  assert.deepEqual(solid.end, { x: 25, y: 100 });
  assert.equal(solid.baseElevation, 0);
  assert.equal(solid.topElevation, 10);
  assert.ok(Math.abs(solid.thickness - 1) < 1e-9, `thickness ${solid.thickness}`);
  // No record was written for it, so its envelope is the solid's own, padded
  // by half a thickness along the run's normal and nothing along the run.
  assert.equal(wall.recordOffset, -1);
  assert.deepEqual(wall.boundsFeet, {
    min: { x: 0, y: 99.5, z: 0 },
    max: { x: 25, y: 100.5, z: 10 },
  });

  // The curved wall's arc: the centre radius, the thickness as the face
  // separation, and the sweep the cylinder's own trim range describes.
  const arc = byId.get(30_003)!.arcs![0]!;
  assert.deepEqual(arc.centre, { x: 60, y: 30 });
  assert.equal(arc.radius, 10);
  assert.ok(Math.abs(arc.thickness - 0.66) < 1e-9, `thickness ${arc.thickness}`);
  assert.equal(arc.startAngle, 0);
  assert.ok(Math.abs(arc.endAngle - Math.PI / 2) < 1e-12);

  // A placed instance: the shared shape put through the instance's own rigid
  // transform, so a quarter turn about z sends local +x to world +y.
  const placed = byId.get(40_002)!;
  assert.deepEqual(placed.orientedBox![0], [100.5, 39, 0]);
  assert.deepEqual(placed.orientedBox![6], [99.5, 41, 4]);

  // The floor's ring is its own sketch boundary, in ring order.
  const floor = byId.get(50_001)!;
  assert.equal(floor.loops!.length, 1);
  assert.deepEqual(
    floor.loops![0]!.map(([x, y]) => `${x},${y}`).sort(),
    ["0,0", "0,12", "20,0", "20,12"],
  );

  // Five treads, recovered from six repeated riser lines and the five short
  // rising segments between them.
  assert.equal(byId.get(56_000)!.stairTreads!.length, 5);

  // The mitred end: two corners at different stations along the run, which a
  // perpendicular end cannot produce.
  const mitred = byId.get(66_000)!.solid!;
  assert.ok(mitred.endCorners, "the join was not recovered");
  assert.ok(
    Math.abs(mitred.endCorners![0]!.x - mitred.endCorners![1]!.x) > 1,
    "the recovered corners are square, not mitred",
  );
});

test("the file's own storeys outrank the elevation histogram", () => {
  const result = converted(richModel());

  // Twenty-five elements name the same level object; only the level with at
  // least twenty members is reported, and its elevation is its members' median
  // base rather than a rounded z band.
  assert.equal(result.nativeAssociatedLevelRelations?.length, 25);
  assert.deepEqual(result.levels, [{
    elevation: 0,
    candidates: 24,
    levelId: 47_000,
    source: "assoc-level-id",
  }]);
});

test("decoder coverage names every decoder the enriched container fed", () => {
  const result = converted(richModel());
  const coverage = result.decoderCoverage;

  assert.equal(coverage.revitVersion, 2027);
  assert.deepEqual([...coverage.activeDecoders].sort(), [
    "revit-2024-2027-elem-table-ownership-v1",
    "revit-2027-associated-level-id-v1",
    "revit-2027-duplicated-bounds-v1",
    "revit-2027-insertable-host-id-v1",
    "revit-2027-material-element-name-v1",
    "revit-builtin-category-token-v1",
  ]);
  assert.equal(coverage.nativeMaterialDefinitions, 2);
  assert.equal(coverage.nativeHostRelations, 1);
  assert.equal(coverage.nativeAssociatedLevelRelations, 25);
  assert.equal(coverage.geometryFidelity, "native-bounds-envelope");
  assert.equal(coverage.semanticFidelity, "native-categories-and-ownership");
  assert.equal(coverage.materialFidelity, "native-definitions-unassigned");

  // The gaps, asserted rather than assumed. Each of these has a decoder and a
  // unit test; what the fixture cannot build is a container that feeds it.
  assert.equal(coverage.nativeMeshes, 0);
  assert.equal(coverage.nativeCurves, 0);
  assert.equal(coverage.nativeProfiles, 0);
  assert.equal(coverage.nativeMaterialAssignments, 0);
  assert.equal(coverage.nativeFamilyRelations, 0);
  assert.equal(coverage.nativeUniqueIds, 0);
  assert.equal(result.nativeIdentity, undefined);
  assert.equal(result.transmissionData, undefined);
  assert.deepEqual(result.nativeProfiles, []);
});

test("the optional container streams reach the result", () => {
  const result = converted(richModel());

  assert.equal(result.partAtom?.title, "SYN-1");
  assert.equal(result.partAtom?.entryTitle, "Synthetic Family");
  // A retained DWG name is reported as a name and never as a payload.
  assert.deepEqual(result.persistedCadFileNames, [
    {
      fileName: "Building 10 - Teaching Centre - L3.DWG",
      occurrences: 1,
      evidence: "partition-utf16-file-name",
      rawDwgPayloadAvailable: false,
    },
    {
      fileName: "site-plan.dwg",
      occurrences: 1,
      evidence: "partition-utf16-file-name",
      rawDwgPayloadAvailable: false,
    },
  ]);
  assert.deepEqual(result.nativeMaterialDefinitions?.map((entry) => entry.name), [
    "Paint - Sienna",
    "Concrete - Cast In Situ",
  ]);
});

test("the fixture's populations are what drive the counters", () => {
  // The model is a set of populations, not a byte layout, so removing one
  // removes exactly the rule it feeds. Two of them, to prove the counters are
  // reading the file rather than being constants of the pipeline.
  const withoutCurves = buildModel({ ...richSpec(), rings: [] });
  const noCurves = converted(withoutCurves);
  assert.equal(noCurves.stats.sketchCurves, 0);
  assert.equal(noCurves.stats.sketchBoundaryElements, 0);
  assert.equal(noCurves.stats.sweptRailings, 0);
  // The flat face-hull record is still completed from its category's modal
  // thickness: that rule reads the records, not the curves.
  assert.equal(noCurves.stats.completedFlatSketches, 1);
  // The plane triples are untouched, so the solid rules still fire.
  assert.equal(noCurves.stats.nativeSolids, 8);

  const withoutPlacements = buildModel({ ...richSpec(), placements: [] });
  const noPlacements = converted(withoutPlacements);
  assert.equal(noPlacements.stats.placedInstances, 0);
  assert.equal(noPlacements.stats.instanceOnlyElements, 0);
  assert.equal(noPlacements.stats.doorLeavesFromShape, 0);
  assert.equal(noPlacements.stats.inferredCurtainPanels, 0);
  // A shape nothing points at is no longer a cached shape to remove.
  assert.equal(noPlacements.stats.cachedShapeRecords, 0);
});

test("the enriched categories are the ones the tokens name", () => {
  const result = converted(richModel());
  const counts = new Map(
    result.nativeCategories!.categories.map((entry) => [entry.categoryId, entry.elements]),
  );
  assert.equal(counts.get(CATEGORY.floors), 522);
  assert.equal(counts.get(CATEGORY.walls), 9);
  assert.equal(counts.get(CATEGORY.doors), 2);
  assert.equal(counts.get(CATEGORY.stairsRuns), 2);
  assert.equal(counts.get(CATEGORY.railings), 1);
  assert.equal(counts.get(CATEGORY.curtainPanels), 3);
  assert.equal(counts.get(-2_000_171), 1); // Curtain Wall Mullions
  // Twelve tokens name the datum-pile records, which are removed as unplaced
  // before the categories are resolved, so those twelve have no owner left.
  assert.equal(
    result.nativeCategories!.tokensFound - result.nativeCategories!.directElements,
    result.stats.unplacedRecords,
  );
  assert.equal(result.nativeCategories!.inheritedElements, 0);
});
