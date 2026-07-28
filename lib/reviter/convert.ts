/**
 * The conversion pipeline.
 *
 * This module orchestrates; it does not decode. It walks the container, hands
 * each inflated page to the record decoders, then assembles the result from the
 * scene and category modules:
 *
 *   `revit-container`  → OLE/CFB streams and truncated-gzip chunks
 *   `elem-table`       → the native element-id index
 *   `bounds-records`   → Revit 2027 duplicated-bounds element envelopes
 *   `native-categories`→ BuiltInCategory tokens and their element ownership
 *   `segment-scan`     → the diagnostic fallback for undecoded releases
 *   `scene`            → display selection, batching, and materials
 */
import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "./basic-file-info.ts";
import {
  boundsOfRecords,
  detectDuplicatedBoundsRecords,
  framingBoundsOfRecords,
  MIN_SOLID_SPAN_FEET,
  solidBounds,
} from "./bounds-records.ts";
import {
  chainElementObjects,
  dominantMarker,
  markerCategoryConsensus,
  markerObjectSeeds,
  scanFramedObjectClasses,
  scanObjectMarkers,
  type ElementObject,
} from "./element-objects.ts";
import { collectElementParameters } from "./element-parameters.ts";
import { doorLeafCorners, doorLeafFromShape, type WallRun } from "./door-leaf.ts";
import {
  clipSolidBandToEnvelope,
  clipSolidToEnvelope,
  extendSolidToEnvelope,
  shrinkSolidIntoEnvelope,
  solidBelongsToEnvelope,
} from "./solid-clip.ts";
import { collectTypeLinks } from "./element-types.ts";
import { collectOwnedSurfaces, type CylinderPatch, type PlanePatch } from "./surfaces.ts";
import {
  instanceCorners,
  readInstancePlacement,
  readLocalBounds,
  readLocalShape,
  SHAPE_OBJECT_MARKERS,
  type InstancePlacement,
  type LocalBounds,
} from "./instanced-geometry.ts";
import { facetElevationBand, surfaceQuadsFor, wallArcs, wallSolids } from "./native-geometry.ts";
import {
  bandsMeet,
  boundaryLoopsFor,
  collectSketchCurves,
  sketchCurveBounds,
  type CurveBounds,
  type Point3,
  type SketchCurve,
} from "./sketch-curves.ts";
import { parseElemTable } from "./elem-table.ts";
import {
  decodeElementOwnership,
  type ElementOwnershipDecode,
} from "./element-relations.ts";
import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
  type NativeIdentityDecode,
} from "./native-identity.ts";
import {
  applyNativeCategories,
  collectCategoryTokens,
  resolveElementCategories,
  type CategoryToken,
} from "./native-categories.ts";
import { decoderPlanForVersion } from "./native-decoder.ts";
import {
  clipPolylinesToBand,
  completeFlatSketchRecord,
  modalSketchThickness,
} from "./recovered-extents.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  leadingU32,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "./revit-container.ts";
import { summariseSchema } from "./schema.ts";
import { measureStream, summariseCoverage } from "./stream-coverage.ts";
import { parsePartitionNames } from "./partition-names.ts";
import { parsePartAtomXml } from "./part-atom.ts";
import { parseProjectInformationArchive } from "./project-information.ts";
import {
  buildBoundsMeshes,
  buildMeshes,
  boundsPlanSegments,
  displayMaterials,
  levelsForBounds,
  selectDisplayBounds,
} from "./scene.ts";
import {
  FAMILY_SEGMENT_SCALE,
  deduplicate,
  focusPrimaryCluster,
  levelsFor,
  rawBounds,
  sampleEvenly,
  scanSegments,
  segmentScaleFor,
  trimVerticalOutliers,
} from "./segment-scan.ts";

import type {
  Bounds3,
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ElementBoundsRecord,
  NativeProfileLocator,
  PartitionRecordLocator,
  ElementParameter,
  ProgressUpdate,
  Segment,
} from "./types";

const DEFAULT_MAX_SEGMENTS = 12_000;

/** Backstop so a pathological stream cannot turn category recovery quadratic. */
const MAX_CATEGORY_TOKENS = 400_000;

/** Same backstop for sketch edges, which are chained pairwise per element. */
const MAX_SKETCH_CURVES = 400_000;

/**
 * Categories whose element is a rail run rather than a volume.
 *
 * A railing is a path with a guard above it, and its axis-aligned envelope is
 * whatever rectangle that path happens to span — 23,877 sq ft in plan for the
 * largest here, drawn as a filled box lying over the floor. The path itself is
 * in the file as the element's own sketch curves.
 */
const RAIL_PATH_CATEGORIES = new Set([
  -2000126, // Stairs Railing
]);

/**
 * Where a railing's path is filed, as an offset from the railing's own id.
 *
 * A railing does not own its path under its own id — **not one** of the 165
 * drawn railings here does, and the curve scan finds zero edges filed under a
 * railing id. It sits one either side, and which side is a fact about the kind
 * of railing:
 *
 * | | n | path at | rise |
 * | --- | --- | --- | --- |
 * | record code `101/3`, a level railing | 92 | `id - 1` | 0.00 ft |
 * | record code `101/2`, a stair railing | 71 | `id + 1` | the stair's |
 *
 * `id + 1` is the same convention the stair companion record uses — a stair
 * part's companion sits one *above* it — and it is what the rule was missing:
 * looking only at `id - 1` reached 58 of the 71 stair railings' paths not at
 * all. The window is two ids wide because that is where the evidence is:
 * widening it to ±2 adds 3 railings, ±3 adds none, ±7 none, ±1001 none.
 */
const RAIL_PATH_OFFSETS = [-1, 1] as const;

/**
 * Plan agreement between a rail path and the element's own envelope, in feet.
 *
 * 105 of 165 railings own curves, but only two thirds of those are the
 * railing's own: the rest carry a neighbour's, and show it by spanning the
 * wrong rectangle. The same check the sketch rings get keeps them out. Shuffling
 * the railing envelopes among the railings drops the rule from 80 firings to
 * 0.3 over 20 trials, so plan agreement is not cheap to come by.
 */
const RAIL_PATH_PLAN_TOLERANCE_FEET = 0.5;

/**
 * How far a *sloped* path's base may sit from the envelope's floor, in feet.
 *
 * Without this test the arithmetic below cannot fail on a *level* railing: a
 * flat path has no rise, so "envelope height minus rise" returns the envelope's
 * height whatever z the curves are at, and a railing stacked identically on the
 * floor above matches in plan exactly. That admitted **21 of the 70 railings
 * this rule used to sweep**, each drawn a storey — 9.84 ft — from where it
 * belongs. Nothing caught it: `overlay-diff.ts` measures a railing by its
 * envelope, which stayed right while the geometry drawn from it went wrong.
 *
 * Measured against the export's own railing meshes, those 21 sit a median of
 * **8.04 ft from the nearest exported railing vertex, the best of them 3.78**.
 * The path bases that survive are 0.00 ft for a level railing and −0.38 to
 * −0.89 ft for a stair railing, whose path starts about a riser below the first
 * baluster; the next value up is −2.49 and then −3.7, −5.7, −9.8, −34.5. The
 * cut is a plateau rather than a knife edge: 0.75 ft through 3 ft all sweep
 * 78-81 railings with the same worst case, 5 ft admits 4 more errors and 10 ft
 * admits 8.
 *
 * It now applies only where the path's elevation says something. See
 * `RAIL_PATH_LEVEL_RISE_FEET`.
 */
const RAIL_PATH_BASE_TOLERANCE_FEET = 1;

/**
 * Below this rise a path is level, and its own elevation is discarded in favour
 * of the record's.
 *
 * The base tolerance above refused 46 railings whose neighbouring curve set fits
 * their plan but sits a storey or more away in z, on the reading that those are
 * the identical railing stacked on the floor above. For the 21 of them whose
 * path is **level** that reading is wrong, and the export says so: their own
 * record's z-band reproduces the exported railing's exactly — 46 of 46, to two
 * decimal places — while the neighbouring path's base lands within a foot of it
 * **0 of 46** times. So the path is a plan and the record is the elevation, and
 * the two are independent readings of one railing rather than two railings.
 *
 * Translating a level path onto the record's own base and taking the guard from
 * what is left, those 21 give a guard of **3.609 ft — every one of them, to
 * within 0.05 ft** — the same handrail height the other 80 give, on a population
 * it was not fitted on. Against the export's own railing meshes the ribbon sits
 * a median **0.76 ft** from the nearest exported vertex against the envelope's
 * 1.78, covers **100%** of the exported vertices against the box's 72%, and is
 * closer than the box for 19 of the 21. Scored against a *different* railing's
 * mesh the same ribbons are off the end of the search: recall 0%, closer than
 * the box 0 of 21.
 *
 * **A sloped path is not translated, and that is measured rather than assumed.**
 * Lifting every path instead of only level ones reaches exactly the same 101
 * railings and takes 19 of the guards off 3.609 — a stair path carries its rise,
 * so its elevation is information, and a base that disagrees means a different
 * run. 25 of the 46 are sloped and stay refused.
 *
 * The cut is a gap rather than a threshold: of the 129 plan-fitting neighbour
 * paths, **72 have a rise of exactly 0.000 ft and the smallest non-zero rise is
 * 2.734 ft**. Nothing lies between.
 */
const RAIL_PATH_LEVEL_RISE_FEET = 0.01;

/**
 * The band a guard height has to fall in for the path to be believed.
 *
 * A railing's envelope is its path plus the guard above it, so the guard is the
 * envelope's top minus the path's top. Across the railings whose path fits
 * their envelope it comes out at a median of **3.609 ft**, and every one of the
 * 80 lands within 0.05 ft of it — a handrail height, arrived at from the file
 * rather than assumed. A path that yields something outside this band is not
 * this railing's.
 *
 * The guard is taken from the *top* rather than as "envelope height minus the
 * path's rise". The two are equal only when the path lies on the envelope's
 * floor, which is true of a level railing and false of every stair railing in
 * this model: base-anchored, the 57 stair paths give guards from −30.9 to
 * +13.5 ft with 12 landing on 3.609, while top-anchored they give 52 of 57 on
 * 3.609 — the same handrail height the level railings gave, from a population
 * the figure was not fitted on.
 */
const RAIL_GUARD_MIN_FEET = 1.5;
const RAIL_GUARD_MAX_FEET = 5;

/**
 * Categories Revit models as a sketch extruded through a thickness. Boundary
 * recovery is limited to these because chaining is quadratic in the edges an
 * element owns, and because outside them a closed ring is not the element's
 * shape — a wall's edges bound its faces, not its footprint.
 *
 * **A stair landing is one of these and was missing.** The exporter agrees: it
 * writes every landing here as an `IfcSlab` with a single `SweptSolid` body,
 * which is a profile extruded through a thickness and nothing else. Without the
 * category the landing fell through to the rebuilt-solid route, and a plane
 * triple on a landing is not a location line — the 17 landings that own one are
 * drawn at **0.0% centre agreement, median 2.551 ft out**, four of them as
 * 0.2 × 0.2 × 1.0 ft stubs where the export has a 3.8 × 8.0 ft slab. The ring
 * is exact instead: over the 20 landings that own curves it reproduces the
 * export's own footprint to **0.00 ft at the worst corner, 20 of 20**.
 *
 * | landings with a ring, n=19 | centre within 0.5 ft | median centre error |
 * | --- | --- | --- |
 * | drawn from the rebuilt solid | 2 | 2.551 ft |
 * | drawn from the envelope | 13 | 0.000 ft |
 * | **drawn from the ring** | **17** | **0.000 ft** |
 * | control: another landing's ring | 0 | 243.612 ft |
 *
 * The two that stay wrong are the exporter's, not ours — both are multistorey
 * stairs written as one product per storey, so the union they are scored
 * against spans two floors. The gain over the envelope is in the five landings
 * that have no duplicated-bounds record at all, whose envelope is therefore
 * synthesised from that same bad solid — 1.00 ft thick where the export writes
 * 0.16: the ring fixes the plan for four of them and leaves 0.42 ft of z error.
 * The other 20 landings do carry a real record, and its 0.16 ft is the export's
 * slab to the digit.
 *
 * The curves are filed under the landing's own id, not under an `id - 1` Sketch
 * element — a stair part's companion sits one *above* it, which is the whole of
 * the 169671 rule below. Taking the union `boundaryLoopsFor` takes anyway costs
 * nothing measurable: it adds a second ring on 2 of the 26 landings and both
 * score identically either way, so the floor convention is left alone rather
 * than special-cased.
 *
 * **A stair run is one of these too, and the population that needed it is the
 * one with nothing else.** 12 of the export's stair flights reach a record whose
 * only geometry is a hull over the facets attributed to them, and every one of
 * those 12 owns **exactly one facet** — a single plane's trim rectangle, which
 * is right by luck for 6 of them and a fragment for the other 6, so all 12 are
 * held back by `isFaceHullOnly` or fail `solidBounds` outright. Each of them also
 * owns 39–119 sketch curves under its own id, and those curves close into
 * **exactly one ring of exactly four corners, 12 of 12**, whose plan reproduces
 * the export's own box:
 *
 * | the 12 stair runs the scene dropped | centre within 0.5 ft | median |
 * | --- | --- | --- |
 * | the facet hull, as shipped | 6 of 12 | 3.084 ft |
 * | **the curve set's own box** | **11 of 12** | **0.164 ft** |
 * | against the *nearest single* product | **12 of 12** | 0.164 ft |
 *
 * The one residual is 1500253, a run the exporter splits per storey; against the
 * nearest of its products it is 0.08 ft. Nulls: the curve box of the element one,
 * five or 12,345 places away lands within half a foot **0 of 6,877 times** where
 * the element's own lands 202 times, and the curve hull is worthless as a general
 * route — 2.9% of drawn records overall, ruining walls at 98.4% → 0.2% — so it is
 * scoped to the sketch categories and to a record that has nothing better, and
 * `sketchCurveBounds` states that scope.
 */
const SKETCH_BOUNDARY_CATEGORIES = new Set([
  -2000032, // Floors
  -2000035, // Roofs
  -2000038, // Ceilings
  -2000180, // Ramps
  -2000919, // StairsRuns
  -2000920, // StairsLandings
  -2001300, // StructuralFoundation
]);

/**
 * Curves an uncategorised element may own before boundary chaining is skipped.
 * Ring assembly is quadratic in the edges an element holds, and an element with
 * no category is a guess rather than a known slab, so it is not worth the cost.
 */
const MAX_UNNAMED_SKETCH_CURVES = 512;

/** Plan agreement required before an unnamed element's ring is trusted, in feet. */
const SKETCH_PLAN_TOLERANCE_FEET = 0.05;

/**
 * How far a placed instance's oriented box may sit from the element's own
 * duplicated-bounds record before the box is disbelieved, in feet.
 *
 * The two are independent readings of the same element, so their agreement is a
 * free check on both. Measured against the paired export they agree to 0.000 ft
 * for curtain-wall mullions and panels — 18,357 elements — and the placed box
 * is exact there. For doors they disagree by 7.15 ft, the box is wrong by that
 * same amount, and the bounds record is wrong by 2.75: the shared shape a door
 * instance points at is not the door's own extent. The box is worth more than
 * the record when they agree and worth nothing when they do not, so it is used
 * only in the first case.
 */
const ORIENTED_BOX_AGREEMENT_FEET = 1;

/** Record code of the companion record holding a stair run's own elevations. */
const STAIR_COMPANION_CODE = 169_671;

/** Revit category of a door, whose record is its opening rather than its leaf. */
const DOOR_CATEGORY = -2000023;

/** Plan distance from the project datum inside which an envelope is unplaced. */
const DATUM_PILE_RADIUS_FEET = 1;

/** Below this a model is too small to tell a datum pile from real geometry. */
const DATUM_PILE_MIN_MODEL_SPAN_FEET = 50;

/** Records needed before a pile on the datum can be told apart from a few elements. */
const MIN_RECORDS_FOR_DATUM_PILE = 500;

/**
 * A facet band shorter than this is not narrowed to. Nothing in the supplied
 * project comes close — all 79 accepted bands are over half a foot tall and none
 * is flat — so this only stops a degenerate face set replacing a real extent.
 */
const MIN_FACET_BAND_FEET = 0.05;

/** Pages sampled to learn which object markers this file uses. */
const MARKER_SAMPLE_PAGES = 12;

/** Objects a marker must head across the sample before it is seeded from. */
const MARKER_MIN_SUPPORT = 24;

/** Cap on marker scans per page, so seeding cost stays bounded. */
const MAX_OBJECT_MARKERS = 12;

type ProgressCallback = (update: ProgressUpdate) => void;

/** True when a placed oriented box lands on the element's own decoded envelope. */
function agreesWithBounds(corners: [number, number, number][], bounds: Bounds3): boolean {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of corners) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return (
    Math.abs(minX - bounds.min.x) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(minY - bounds.min.y) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(minZ - bounds.min.z) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxX - bounds.max.x) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxY - bounds.max.y) <= ORIENTED_BOX_AGREEMENT_FEET &&
    Math.abs(maxZ - bounds.max.z) <= ORIENTED_BOX_AGREEMENT_FEET
  );
}

/**
 * Boundary loops for one element.
 *
 * With `verify` the element's category is unknown, so the ring has to earn its
 * place: a floor, ceiling or ramp's sketch *is* its footprint, and must
 * therefore reproduce the plan extent of the envelope that the duplicated-bounds
 * record proved independently. An edge set that bounds something else — a wall's
 * faces, a stray blob — does not, and is discarded.
 */
function sketchLoopsFor(
  record: ElementBoundsRecord,
  curvesByOwner: Map<number, SketchCurve[]>,
  { verify }: { verify: boolean },
): Point3[][] {
  if (verify) {
    const owned =
      (curvesByOwner.get(record.elementId)?.length ?? 0) +
      (curvesByOwner.get(record.elementId - 1)?.length ?? 0);
    if (!owned || owned > MAX_UNNAMED_SKETCH_CURVES) return [];
  }

  const loops = boundaryLoopsFor(record.elementId, curvesByOwner);
  if (!loops.length || !verify) return loops;

  const outer = loops[0]!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const { min, max } = record.boundsFeet;
  const agrees =
    Math.abs(minX - min.x) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(minY - min.y) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(maxX - max.x) <= SKETCH_PLAN_TOLERANCE_FEET &&
    Math.abs(maxY - max.y) <= SKETCH_PLAN_TOLERANCE_FEET;
  return agrees ? loops : [];
}

/**
 * The elevations for a record synthesised from a boundary ring alone.
 *
 * A ring is a *plan* boundary, and a stair run's ring is **flat** — the run's
 * outline at its own base, z span 0.000 ft — so extruding it between its own
 * elevations draws the run as a sheet lying on the floor. `sketchCurveBounds`
 * already answers this from the tread and riser edges the ring did not consume,
 * but only for a run whose record is a facet hull; a run with no record at all
 * reaches the ring-synthesis block instead, and nothing there was asking.
 *
 * That is one element in the supplied model and it is measurable: **1842441,
 * `Assembled Stair:Stair:1842431 Run 1`**, drawn 16.90 × 17.06 × **0.00** ft
 * where the export writes 16.90 × 17.10 × **9.68**. Its plan is already exact to
 * 0.02 ft; its curve set spans 0.00–9.84 ft, which is the export's rise plus the
 * documented 0.16 ft by which boundary edges sit above the tread — centre error
 * 4.84 → 0.08 ft, size error 9.68 → 0.16 ft.
 *
 * The guards are the ones the facet-hull use already carries, for the same
 * reasons: the element's **own** curves only, so a neighbouring run's Sketch
 * companion cannot lend a storey of rise, and the two bands must meet, so a
 * stacked twin a floor away cannot lend any. The plan stays the **ring's** — the
 * ring is the reading verified in plan, and a curve set's extremes are a hull
 * rather than an outline.
 *
 * **Specificity, because a percentage cannot judge a rule that adds extent.**
 * This fires on **1 of the 38,960 records** here. The other two flat ring records
 * are ramps — 1586431 and 2081718 — whose whole curve neighbourhood is flat, so
 * the rule declines them and they are drawn exactly as before. Dropping the
 * flatness test and taking the curve band whenever it is thicker was measured
 * and not taken: it reaches the same one element on this model, and the ring's
 * own elevations are the element's own statement about itself wherever it has
 * them.
 */
export function ringRecordRise(ring: CurveBounds, curves: CurveBounds | null): CurveBounds {
  if (!curves) return ring;
  if (ring.max.z - ring.min.z > MIN_SOLID_SPAN_FEET) return ring;
  if (curves.max.z - curves.min.z <= MIN_SOLID_SPAN_FEET) return ring;
  if (!bandsMeet(curves, ring)) return ring;
  return {
    min: { x: ring.min.x, y: ring.min.y, z: curves.min.z },
    max: { x: ring.max.x, y: ring.max.y, z: curves.max.z },
  };
}

/**
 * True when all an element's record holds is a hull over its attributed facets.
 *
 * `scene.ts` holds such a record back from the display, because 37 of the 40 that
 * join an export product are over a foot out. It is repeated here rather than
 * shared because the two uses are different questions: there it decides what to
 * draw, here it decides whether the record is worth keeping when a boundary
 * sketch is available for the same element.
 */
function isFacetHullRecord(
  record: ElementBoundsRecord,
  quadsByElement: Map<number, unknown>,
  solidGroups: Map<number, unknown>,
  orientedBoxes: Map<number, unknown>,
): boolean {
  return (
    record.recordOffset < 0 &&
    quadsByElement.has(record.elementId) &&
    !solidGroups.has(record.elementId) &&
    !orientedBoxes.has(record.elementId)
  );
}

/**
 * A railing's rail path, when the curves really are this railing's.
 *
 * Each curve becomes one polyline — arcs keep their interior points — so the
 * sweep follows a stair's rise instead of flattening it. The path is the curve
 * set filed one id either side of the railing that reproduces the railing's
 * envelope in plan, within `RAIL_PATH_PLAN_TOLERANCE_FEET`, and yields a guard
 * between the path's top and the envelope's top that is a handrail height.
 * Swept, that is the envelope's own z-band reproduced from an independent
 * reading — which is the point, since the envelope is what the path replaces.
 *
 * Where the elevation comes from depends on what the path is. A **sloped** path
 * carries its own rise, so it is swept where it lies and its base has to agree
 * with the record's within `RAIL_PATH_BASE_TOLERANCE_FEET`. A **level** path is
 * a plan and nothing more, so it is translated onto the record's own base; see
 * `RAIL_PATH_LEVEL_RISE_FEET` for the 21 railings that buys and the export
 * measurement behind it.
 *
 * Each candidate is judged on its own rather than unioned with its neighbour.
 * The union was safe while only `id - 1` was read, but a stair railing has both
 * its real path at `id + 1` and a flat plan projection of that path three ids
 * up; mixing two owners' curves gives a set that is neither.
 *
 * **Verified against the export's railing meshes, per element.** A railing is
 * the one class a bounding box cannot settle — the export's box and the record
 * agree to 0.00 ft whether the railing is a swept path or a filled plate — but
 * `IfcRailing` is written as real swept geometry, so "is what we draw where the
 * railing is" has a per-element answer. Over the 80 railings this sweeps, the
 * median sample of the drawn ribbon lies **0.76 ft** from the nearest exported
 * railing vertex against **1.65 ft** for the envelope it replaces, worst 3.86
 * against that railing's own 4.90, and it is closer than the box for 75 of 80.
 * The exported vertices it covers rise from a median 60% to **100%**, worst 88%
 * against the box's 2%. Measured against a *different* railing's mesh the same
 * ribbons are off the end of the search entirely.
 */
function railPathFor(
  record: ElementBoundsRecord,
  curvesByOwner: Map<number, SketchCurve[]>,
): { polylines: Point3[][]; guardHeightFeet: number } | null {
  const { min, max } = record.boundsFeet;
  let best: { polylines: Point3[][]; guardHeightFeet: number; rise: number; shiftZ: number } | null = null;

  for (const offset of RAIL_PATH_OFFSETS) {
    const curves = curvesByOwner.get(record.elementId + offset);
    if (!curves?.length) continue;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const polylines: Point3[][] = [];
    for (const curve of curves) {
      const points: Point3[] = [curve.start, ...curve.interior, curve.end];
      for (const [x, y, z] of points) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      polylines.push(points);
    }

    const fitsPlan =
      Math.abs(minX - min.x) <= RAIL_PATH_PLAN_TOLERANCE_FEET &&
      Math.abs(minY - min.y) <= RAIL_PATH_PLAN_TOLERANCE_FEET &&
      Math.abs(maxX - max.x) <= RAIL_PATH_PLAN_TOLERANCE_FEET &&
      Math.abs(maxY - max.y) <= RAIL_PATH_PLAN_TOLERANCE_FEET;
    if (!fitsPlan) continue;

    // A level path is a plan and nothing else, so the record supplies the
    // elevation; a sloped one carries its rise, so its base has to agree.
    const rise = maxZ - minZ;
    const baseGap = minZ - min.z;
    const level = rise <= RAIL_PATH_LEVEL_RISE_FEET;
    if (!level && Math.abs(baseGap) > RAIL_PATH_BASE_TOLERANCE_FEET) continue;
    const shiftZ = level ? -baseGap : 0;

    const guardHeightFeet = max.z - (maxZ + shiftZ);
    if (guardHeightFeet < RAIL_GUARD_MIN_FEET || guardHeightFeet > RAIL_GUARD_MAX_FEET) continue;
    // Both sides can pass on a railing that owns a flat projection as well as
    // its path; the one carrying the rise is the railing's own run, and the
    // projection is what the sweep exists to avoid drawing.
    if (!best || rise > best.rise) best = { polylines, guardHeightFeet, rise, shiftZ };
  }

  if (!best) return null;
  const { shiftZ } = best;
  const lifted = shiftZ === 0
    ? best.polylines
    : best.polylines.map((line) => line.map(([x, y, z]): Point3 => [x, y, z + shiftZ]));
  // The ribbon's top is the envelope's top by construction — the guard is the
  // difference — but its base is the path, and a stair railing's path runs about
  // one riser below the railing it carries. Against the export's own railing
  // meshes that cost 14 of 101 swept railings up to 0.886 ft of extra height at
  // the bottom, with **not one** wrong at the top. The envelope base is a second
  // reading of the same railing and is right for them to 0.000 ft, so the path
  // is trimmed to it. See `clipPolylinesToBand`.
  const { polylines } = clipPolylinesToBand(lifted, min.z, max.z);
  return { polylines, guardHeightFeet: best.guardHeightFeet };
}


/**
 * Inflate the first chunk of a named stream and hand it to `decode`. Returns
 * `undefined` when the stream is absent or does not decompress, so an optional
 * stream never fails the conversion.
 */
function readStreamSummary<T>(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
  decode: (data: Uint8Array) => T,
): T | undefined {
  const entry = cfb.FileIndex
    .map((candidate, index) => ({ entry: candidate, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry: candidate, path }) => candidate.size > 0 && pattern.test(path));
  if (!entry) return undefined;
  const bytes = stripRevitPageChecksums(asBytes(entry.entry.content));
  const offset = gzipOffsets(bytes, 1)[0];
  const inflated = offset == null ? null : inflateRevitChunk(bytes, offset);
  return inflated ? decode(inflated) : undefined;
}

export function convertRvtBytes(
  input: ArrayBuffer | Uint8Array,
  fileName = "model.rvt",
  options: ConvertOptions = {},
  onProgress?: ProgressCallback,
): ConvertOutcome {
  const started = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  let decoderPlan = decoderPlanForVersion(options.revitVersion);
  const segmentScale = segmentScaleFor(fileName, options.geometryScale);
  const familyScale = segmentScale === FAMILY_SEGMENT_SCALE;

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const cfb = CFB.read(bytes, { type: "buffer" });
    const partAtomEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/PartAtom$/i.test(path));
    let partAtom = partAtomEntry
      ? parsePartAtomXml(new TextDecoder().decode(asBytes(partAtomEntry.entry.content)))
      : undefined;
    if (!partAtom) {
      const projectInformationEntry = cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .find(({ entry, path }) => entry.size > 0 && /\/ProjectInformation$/i.test(path));
      if (projectInformationEntry) {
        partAtom = parseProjectInformationArchive(
          asBytes(projectInformationEntry.entry.content),
        );
      }
    }
    if (!Number.isInteger(options.revitVersion)) {
      const basicFileInfo = cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
      if (basicFileInfo) {
        decoderPlan = decoderPlanForVersion(
          revitVersionFromBasicFileInfo(asBytes(basicFileInfo.entry.content)) ?? undefined,
        );
      }
    }
    const elemTableEntry = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
    let elementIndex;
    let elementOwnership: ElementOwnershipDecode | undefined;
    let elementTableData: Uint8Array | undefined;
    if (elemTableEntry) {
      const elemTableBytes = stripRevitPageChecksums(asBytes(elemTableEntry.entry.content));
      const offset = gzipOffsets(elemTableBytes, 1)[0];
      const inflated = offset == null ? null : inflateRevitChunk(elemTableBytes, offset);
      if (inflated) {
        elementTableData = inflated;
        elementIndex = parseElemTable(inflated) ?? undefined;
        const ownership = decodeElementOwnership(inflated);
        if (ownership.format !== "unsupported") elementOwnership = ownership;
      }
    }
    let nativeIdentity: NativeIdentityDecode | undefined;
    if (elementTableData && decoderPlan.revitVersion != null) {
      const history = readStreamSummary(cfb, /\/Global\/History$/i, (data) =>
        decodeRevitDocumentHistory(data, decoderPlan.revitVersion!));
      if (history && history.format !== "unsupported") {
        const identity = decodeRevitNativeIdentities(
          elementTableData,
          history,
          decoderPlan.revitVersion,
        );
        if (identity.format !== "unsupported") nativeIdentity = identity;
      }
    }
    const coverage = summariseCoverage(
      cfb.FileIndex
        .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
        .filter(({ entry }) => entry.size > 0)
        .map(({ entry, path }) =>
          measureStream(path.replace(/^Root Entry\//, ""), asBytes(entry.content)),
        ),
    );

    const schema = readStreamSummary(cfb, /\/Formats\/Latest$/i, summariseSchema);
    const partitionNames = readStreamSummary(cfb, /\/Global\/PartitionTable$/i, parsePartitionNames) ?? [];

    const partitions = cfb.FileIndex
      .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
      .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

    if (!partitions.length) throw new Error("No Revit partition stream was found.");

    // Learn which object markers this file actually uses, from a sample of its
    // pages, so seeding is not limited to the one class the bounds decoder
    // happens to look for. Calibrating on a sample keeps the byte-by-byte scan
    // off the other 3,300 pages.
    const objectMarkers: number[] = [];
    if (decoderPlan.elementBoundsDecoder) {
      const sampleCounts = new Map<number, number>();
      const samplePartition = partitions[0]!;
      const sampleData = stripRevitPageChecksums(asBytes(samplePartition.entry.content));
      const sampleOffsets = gzipOffsets(sampleData);
      const stride = Math.max(1, Math.floor(sampleOffsets.length / MARKER_SAMPLE_PAGES));
      for (let index = 0; index < sampleOffsets.length; index += stride) {
        const page = inflateRevitChunk(sampleData, sampleOffsets[index]!, sampleOffsets[index + 1]);
        if (!page) continue;
        for (const [marker, count] of scanObjectMarkers(page)) {
          sampleCounts.set(marker, (sampleCounts.get(marker) ?? 0) + count);
        }
      }
      objectMarkers.push(
        ...[...sampleCounts]
          .filter(([, count]) => count >= MARKER_MIN_SUPPORT)
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_OBJECT_MARKERS)
          .map(([marker]) => marker),
      );
    }

    const candidates: Segment[] = [];
    const categoryTokens: CategoryToken[] = [];
    const elementBounds: ElementBoundsRecord[] = [];
    const elementObjects: ElementObject[] = [];
    const instancePlacements = new Map<number, InstancePlacement>();
    const localBounds = new Map<number, LocalBounds>();
    const elementParameters = new Map<number, Map<number, ElementParameter>>();
    const surfaceCounts = { planes: 0, cylinders: 0, verticalPlanes: 0 };
    const planesByElement = new Map<number, PlanePatch[]>();
    const cylindersByElement = new Map<number, CylinderPatch[]>();
    const curvesByOwner = new Map<number, SketchCurve[]>();
    let sketchCurves = 0;
    const typeReferences = new Map<number, number>();
    const typeNames = new Map<number, string>();
    const nativeProfiles: NativeProfileLocator[] = [];
    const boundedElementIds = new Set<number>();
    const partitionRecords: PartitionRecordLocator[] = [];
    const partitionRecordIds = new Set<number>();
    const locatedPartitionIds = new Set<number>();
    // `element id -> object marker`, read from every framed object rather than
    // only the chained ones. Used solely as a class key for the ring-synthesis
    // gate below; no object, placement or record is added from it.
    const markerByElement = new Map<number, number>();
    let gzipChunks = 0;
    let inflatedBytes = 0;
    const scanLimit = Math.max(maxSegments * 4, 40_000);

    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      const partition = partitions[partitionIndex]!;
      const data = stripRevitPageChecksums(asBytes(partition.entry.content));
      const offsets = gzipOffsets(data);
      const stride = offsets.length > 900 ? Math.ceil(offsets.length / 700) : 1;

      // Carried so a chunk with back-references past its own start can be read
      // against the window the writer left behind; see `inflateRevitChunk`.
      let window: Uint8Array | null = null;
      for (let index = 0; index < offsets.length; index += 1) {
        // A chunk that desyncs partway is still read up to that point, and the
        // prefix is not allowed to seed the next chunk's window because it is
        // short of that chunk's true trailing 32 KiB; see `salvageRevitChunk`.
        const read = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
        const inflated = read ?? salvageRevitChunk(data, offsets[index]!, offsets[index + 1], window);
        if (!inflated) continue;
        if (read) window = revitWindowTail(read);
        gzipChunks += 1;
        inflatedBytes += inflated.byteLength;
        const elementId = leadingU32(inflated);
        if (elementId && elementId !== 0xffffffff) {
          partitionRecordIds.add(elementId);
          if (!locatedPartitionIds.has(elementId)) {
            locatedPartitionIds.add(elementId);
            partitionRecords.push({
              elementId,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              rawOffset: revitStoredPageOffset(offsets[index]!),
              inflatedBytes: inflated.byteLength,
            });
          }
        }
        const typeLinks = collectTypeLinks(inflated);
        for (const reference of typeLinks.references) {
          if (!typeReferences.has(reference.elementId)) {
            typeReferences.set(reference.elementId, reference.typeId);
          }
        }
        for (const entry of typeLinks.names) {
          if (!typeNames.has(entry.typeId)) typeNames.set(entry.typeId, entry.name);
        }
        for (const { owner, surface } of collectOwnedSurfaces(inflated)) {
          if (surface.kind === "cylinder") {
            surfaceCounts.cylinders += 1;
            // A curved wall is written as a cylinder triple exactly as a
            // straight one is written as a plane triple, so these are kept
            // rather than counted and dropped.
            const owned = cylindersByElement.get(owner);
            if (owned) owned.push(surface);
            else cylindersByElement.set(owner, [surface]);
            continue;
          }
          surfaceCounts.planes += 1;
          if (Math.abs(Math.abs(surface.vDir.z) - 1) <= 1e-9) surfaceCounts.verticalPlanes += 1;
          const planes = planesByElement.get(owner);
          if (planes) planes.push(surface);
          else planesByElement.set(owner, [surface]);
        }
        if (sketchCurves < MAX_SKETCH_CURVES) {
          for (const curve of collectSketchCurves(inflated)) {
            sketchCurves += 1;
            const owned = curvesByOwner.get(curve.owner);
            if (owned) owned.push(curve);
            else curvesByOwner.set(curve.owner, [curve]);
          }
        }
        for (const table of collectElementParameters(inflated)) {
          const existing = elementParameters.get(table.elementId);
          if (existing) for (const parameter of table.parameters) existing.set(parameter.parameterId, parameter);
          else elementParameters.set(
            table.elementId,
            new Map(table.parameters.map((parameter) => [parameter.parameterId, parameter])),
          );
        }
        if (categoryTokens.length < MAX_CATEGORY_TOKENS) {
          for (const token of collectCategoryTokens(inflated)) categoryTokens.push(token);
        }
        const detectedBoundsRecords = decoderPlan.elementBoundsDecoder
          ? detectDuplicatedBoundsRecords(inflated)
          : [];
        if (decoderPlan.elementBoundsDecoder) {
          for (const [elementId, marker] of scanFramedObjectClasses(inflated)) {
            if (!markerByElement.has(elementId)) markerByElement.set(elementId, marker);
          }
        }
        // Seed the object chain from every validated object marker on the page,
        // not only from the bounds records.
        //
        // Chaining walks until an object fails to verify, and about one record
        // in two hundred does, so a chain grown from a handful of seeds loses
        // everything downstream of its first break. Marker seeds are already
        // self-validating — each candidate has to echo its own length — so
        // seeding from all of them makes a break local instead of terminal, and
        // reaches pages that carry no bounds record at all.
        const chainSeeds: number[] = [];
        for (const marker of objectMarkers) {
          for (const seed of markerObjectSeeds(inflated, marker)) chainSeeds.push(seed);
        }
        // A shared shape's marker is too rare to survive the calibration above.
        // There are 250 door B-reps in this file against 51,455 objects under
        // `0x08c6`, so `0x0810` never clears the support floor and the chain
        // reaches one only when it happens to sit beside a seeded neighbour:
        // 20 of the 27 door shapes the placements point at and no pass reads
        // are isolated `0x0810` objects, and they are the shape for 500 doors.
        // Seeding the shape markers directly is what finds them; every
        // candidate still has to echo its own length to be kept.
        for (const marker of SHAPE_OBJECT_MARKERS) {
          if (objectMarkers.includes(marker)) continue;
          for (const seed of markerObjectSeeds(inflated, marker)) chainSeeds.push(seed);
        }
        for (const record of detectedBoundsRecords) chainSeeds.push(record.recordOffset);
        if (chainSeeds.length) {
          for (const object of chainElementObjects(inflated, chainSeeds)) {
            elementObjects.push(object);
            partitionRecordIds.add(object.elementId);
            const placement = readInstancePlacement(inflated, object);
            if (placement) instancePlacements.set(placement.elementId, placement);
            else {
              // A shape object with no bounds sub-record at all still describes
              // its shape, as parameters or as trimmed planes.
              const local = readLocalBounds(inflated, object) ?? readLocalShape(inflated, object);
              if (local) localBounds.set(local.elementId, local);
            }
            if (!locatedPartitionIds.has(object.elementId)) {
              locatedPartitionIds.add(object.elementId);
              partitionRecords.push({
                elementId: object.elementId,
                stream: partition.path.replace(/^Root Entry\//, ""),
                chunkIndex: index,
                rawOffset: offsets[index]!,
                inflatedBytes: inflated.byteLength,
              });
            }
          }
        }
        for (const detectedBounds of detectedBoundsRecords) {
          partitionRecordIds.add(detectedBounds.elementId);
          if (!locatedPartitionIds.has(detectedBounds.elementId)) {
            locatedPartitionIds.add(detectedBounds.elementId);
            partitionRecords.push({
              elementId: detectedBounds.elementId,
              stream: partition.path.replace(/^Root Entry\//, ""),
              chunkIndex: index,
              rawOffset: offsets[index]!,
              inflatedBytes: inflated.byteLength,
            });
          }
          if (boundedElementIds.has(detectedBounds.elementId)) continue;
          boundedElementIds.add(detectedBounds.elementId);
          elementBounds.push({
            elementId: detectedBounds.elementId,
            stream: partition.path.replace(/^Root Entry\//, ""),
            chunkIndex: index,
            rawOffset: offsets[index]!,
            recordOffset: detectedBounds.recordOffset,
            boundsOffset: detectedBounds.boundsOffset,
            recordCode: detectedBounds.recordCode,
            recordCount: detectedBounds.recordCount,
            boundsFeet: detectedBounds.boundsFeet,
          });
        }
        if (
          !decoderPlan.elementBoundsDecoder &&
          inflated.byteLength >= 48 &&
          index % stride === 0 &&
          candidates.length < scanLimit
        ) {
          scanSegments(inflated, candidates, scanLimit, segmentScale);
        }
        if (gzipChunks % 36 === 0) {
          onProgress?.({
            ratio: Math.min(0.82, 0.12 + (index / Math.max(1, offsets.length)) * 0.68),
            message: `Reading partition geometry · ${elementBounds.length.toLocaleString()} exact element bounds`,
          });
        }
      }
    }

    const solidStream = partitions[0]!.path.replace(/^Root Entry\//, "");
    // An element can own more than one solid — a wall built from several
    // segments. All of them are kept and all of them are drawn; the longest is
    // singled out only as the body that properties and picking report, which is
    // what one-record-per-element requires.
    const allSolids = wallSolids(planesByElement);
    const solidGroups = new Map<number, ReturnType<typeof wallSolids>>();
    const solidsByElement = new Map<number, ReturnType<typeof wallSolids>[number]>();
    const solidLength = (candidate: (typeof allSolids)[number]) =>
      Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);
    for (const solid of allSolids) {
      const group = solidGroups.get(solid.elementId);
      if (group) group.push(solid);
      else solidGroups.set(solid.elementId, [solid]);
      const existing = solidsByElement.get(solid.elementId);
      if (!existing || solidLength(solid) > solidLength(existing)) {
        solidsByElement.set(solid.elementId, solid);
      }
    }

    // A curved wall has no straight location line, so `wallSolidsFor` cannot
    // see it and it falls back to the rectangle enclosing the whole arc.
    const arcsByElement = new Map<number, ReturnType<typeof wallArcs>>();
    for (const arc of wallArcs(cylindersByElement)) {
      const group = arcsByElement.get(arc.elementId);
      if (group) group.push(arc);
      else arcsByElement.set(arc.elementId, [arc]);
    }

    // Loadable families are placed rather than written out: each instance holds
    // a rigid transform and points at a shared shape. Resolving the pair gives
    // the instance its true orientation instead of an axis-aligned envelope.
    const orientedBoxes = new Map<number, [number, number, number][]>();
    // Elements whose box was read from the bounding faces of their own B-rep.
    // The agreement check further down assumes the box and the element's own
    // bounds record are readings of the same thing, and for a casement window
    // they are not — see `LocalBounds.faceRead`.
    const faceReadBoxes = new Set<number>();
    for (const [elementId, placement] of instancePlacements) {
      const shape = localBounds.get(placement.geometryId);
      if (!shape) continue;
      if (shape.faceRead) faceReadBoxes.add(elementId);
      orientedBoxes.set(elementId, instanceCorners(placement, shape));
    }

    // Elements with surfaces that do not form a wall triple still have real
    // faces; drawing those beats falling back to a bounding box.
    const quadsByElement = new Map<number, ReturnType<typeof surfaceQuadsFor>>();
    for (const [elementId, planes] of planesByElement) {
      if (solidsByElement.has(elementId)) continue;
      const quads = surfaceQuadsFor(elementId, planes);
      if (quads.length) quadsByElement.set(elementId, quads);
    }

    // Most elements that own native geometry have no duplicated-bounds record —
    // 2,818 wall records exist against 7,401 wall objects — so building the
    // scene only from bounds records drops the majority of the walls. Elements
    // with a rebuilt solid and no bounds record get a record synthesised from
    // the solid itself, so they reach the scene as the geometry they are.
    const boundedIds = new Set(elementBounds.map((record) => record.elementId));
    let solidOnlyElements = 0;
    // An element with faces and no record of its own still gets a record
    // synthesised from the hull over those faces — not because the hull is its
    // shape, but because the record is what lets a sketch ring or a placement
    // attach to it later. Removing the synthesis outright cost 15 of the 38
    // drawn coverings and 13 slabs, all of which were being drawn correctly
    // from rings they only received because the record existed. The hull itself
    // is held back at the display gate instead; see `isSheet` in `scene.ts`.
    for (const [elementId, quads] of quadsByElement) {
      if (boundedIds.has(elementId)) continue;
      const xs = quads.flatMap((quad) => quad.corners.map((corner) => corner[0]));
      const ys = quads.flatMap((quad) => quad.corners.map((corner) => corner[1]));
      const zs = quads.flatMap((quad) => quad.corners.map((corner) => corner[2]));
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        },
      });
      boundedIds.add(elementId);
      solidOnlyElements += 1;
    }
    for (const [elementId, group] of solidGroups) {
      if (boundedIds.has(elementId)) continue;
      // The envelope spans every segment the element was rebuilt from, not just
      // the one that happens to be longest.
      //
      // **Half a thickness goes along the run's own normal, not along both plan
      // axes.** A solid is drawn as an *oriented* box, and padding x and y alike
      // gives an axis-aligned wall a box a full thickness too long: over the 627
      // axis-aligned walls with a synthesised envelope, the slack between the
      // drawn box and this envelope was exactly 1.000 × the wall's own thickness
      // for **627 of 627**. Nothing on screen changed — the solid outranks the
      // envelope everywhere it is drawn — but the envelope is what the rest of
      // the pipeline treats as a second, independent reading of the element, and
      // a reading inflated by a thickness is not one. It is the same error
      // `overlay-diff.ts` was measuring solids with before it was corrected.
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const solid of group) {
        const dx = solid.end.x - solid.start.x;
        const dy = solid.end.y - solid.start.y;
        const length = Math.hypot(dx, dy) || 1;
        const normalX = (-dy / length) * solid.thickness * 0.5;
        const normalY = (dx / length) * solid.thickness * 0.5;
        for (const end of [solid.start, solid.end]) {
          for (const sign of [1, -1]) {
            min.x = Math.min(min.x, end.x + normalX * sign);
            min.y = Math.min(min.y, end.y + normalY * sign);
            max.x = Math.max(max.x, end.x + normalX * sign);
            max.y = Math.max(max.y, end.y + normalY * sign);
          }
        }
        min.z = Math.min(min.z, solid.baseElevation);
        max.z = Math.max(max.z, solid.topElevation);
      }
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: { min, max },
      });
      boundedIds.add(elementId);
      solidOnlyElements += 1;
    }

    // A placed family instance carries no bounds record of its own — its shape
    // lives once in a shared geometry object and the instance only points at it
    // with a transform. Those pairs were being resolved and then thrown away
    // unless the element happened to reach the scene some other way, which took
    // most of the model's doors, columns, panels and railings out of the view.
    let instanceOnlyElements = 0;
    for (const [elementId, corners] of orientedBoxes) {
      if (boundedIds.has(elementId)) continue;
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      const zs = corners.map((corner) => corner[2]);
      elementBounds.push({
        elementId,
        stream: solidStream,
        chunkIndex: -1,
        rawOffset: -1,
        recordOffset: -1,
        boundsFeet: {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
        },
      });
      boundedIds.add(elementId);
      instanceOnlyElements += 1;
    }

    /*
     * A sketch-based element whose only geometry is its own boundary ring.
     *
     * The ring route runs over `elementBounds`, so an element that never reaches
     * a record is invisible to it however good its curves are — and **7 of this
     * building's 12 ramps are exactly that**. Every one of them owns 4 edges
     * under its Sketch companion and 8 under the id above, and assembled those
     * edges reproduce the export's own footprint to **0.000 ft at the worst
     * corner, 7 of 7**. They were never drawn because no duplicated-bounds
     * record exists for them: 5 ramps carry a second `0x08c6` object holding one
     * and the other 7 simply do not.
     *
     * So a record is synthesised from the ring, exactly as one is above from a
     * rebuilt solid, a face hull or a placement — the record is what lets the
     * rest of the pipeline attach to the element.
     *
     * **The gate is the category, and it is the one the ring route already
     * uses.** Over the whole model 2,891 elements the scan proves real have no
     * record and do own a closed ring, and the export names only 14 of them —
     * synthesising for all of them would be 2,877 records of sketch companions,
     * cached shapes and stray edge sets. Requiring the element's own decoded
     * category to be a `SKETCH_BOUNDARY_CATEGORIES` member cuts that to a
     * population the export names **100%** of, with the ring's plan reproducing
     * the export's box to a median 0.000 ft and a shuffled pairing scoring 0.
     * On this model that is the 2 ramps whose category token survives; the other
     * 25 elements it selects already have a record by another route.
     *
     * Categories are resolved here against the record ids *plus* the candidates,
     * because a candidate has no record yet and so cannot own a token under the
     * pass below. Only the candidates' answers are read; no existing record's
     * category is touched.
     *
     * **The five ramps that used to stay missing are reached by the marker
     * instead.** The file writes exactly **8** `Ramps` category tokens and those
     * five are not among them, so their own category is not in the file to be
     * found — but the object marker at `+16` is a class key they do have, and
     * the members of their class that *do* carry a token can speak for them.
     * That is `markerCategoryConsensus`, and this gate is its whole scope: used
     * as a general category decoder it disagrees with the export 265 times,
     * while used here it selects **42 record-less ring owners of which the
     * export names 42**, out of 843 candidates of which it names 67. Null
     * control, permuting which marker holds which consensus category over ten
     * shifts: 23.1 selected per trial, 8.0 named.
     *
     * A candidate qualifies on having a marker rather than a partition-record
     * id, because the chain is seeded from the markers a *sample* of pages says
     * are common and a twelve-member class never clears that floor: all five
     * ramps have a framed `0x0d7b` object that no chain reaches.
     *
     * **What this still does not reach, recorded rather than papered over.** Of
     * the 67 named candidates, 25 are declined: 13 under `0x0feb`, whose
     * consensus is `Stairs` — an assembly rather than a sketch category; 7 under
     * `0x0f3b`, whose 6,993 members are unanimously `Walls`; 4 under `0x0d40`,
     * whose 20 members carry **no category token at all**, so there is no
     * consensus to read; and 1 under `0x07ef`, at purity 0.35.
     */
    {
      const ringCandidates = new Set<number>();
      for (const owner of curvesByOwner.keys()) {
        // A slab's edges are filed under its Sketch companion at `id - 1`, so a
        // curve owner proposes itself and the element above it.
        for (const elementId of [owner, owner + 1]) {
          if (boundedIds.has(elementId)) continue;
          if (partitionRecordIds.has(elementId) || markerByElement.has(elementId)) {
            ringCandidates.add(elementId);
          }
        }
      }
      if (ringCandidates.size) {
        const known = new Set<number>(boundedIds);
        for (const elementId of ringCandidates) known.add(elementId);
        for (const elementId of markerByElement.keys()) known.add(elementId);
        for (const elementId of elementIndex?.uniqueElementIds ?? []) known.add(elementId);
        for (const record of elementOwnership?.records ?? []) known.add(record.elementId);
        const candidateCategories = resolveElementCategories(categoryTokens, known);
        const markerCategories = markerCategoryConsensus(markerByElement, candidateCategories);
        for (const elementId of ringCandidates) {
          const categoryId =
            candidateCategories.get(elementId) ??
            markerCategories.get(markerByElement.get(elementId) ?? -1);
          if (categoryId == null || !SKETCH_BOUNDARY_CATEGORIES.has(categoryId)) continue;
          const loops = boundaryLoopsFor(elementId, curvesByOwner);
          if (!loops.length) continue;
          const min = { x: Infinity, y: Infinity, z: Infinity };
          const max = { x: -Infinity, y: -Infinity, z: -Infinity };
          for (const loop of loops) {
            for (const [x, y, z] of loop) {
              min.x = Math.min(min.x, x); max.x = Math.max(max.x, x);
              min.y = Math.min(min.y, y); max.y = Math.max(max.y, y);
              min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
            }
          }
          elementBounds.push({
            elementId,
            stream: solidStream,
            chunkIndex: -1,
            rawOffset: -1,
            recordOffset: -1,
            boundsFeet: ringRecordRise({ min, max }, sketchCurveBounds(elementId, curvesByOwner)),
          });
          boundedIds.add(elementId);
        }
      }
    }

    // A cached family shape is not a building element. Its object carries the
    // same bounds sub-record an element does, so it was being decoded into the
    // model as though it were one — and its box is in the family's own local
    // frame, so it landed at the model origin. In the supplied project 5,995 of
    // them were drawn that way, 97% of them stacked within 50 ft of the origin,
    // and only 7 corresponded to anything in the paired export.
    //
    // The file names them: an instance's trailer points at the shape it uses, so
    // the referenced set is read straight out of the placements rather than
    // guessed at from position. No id is both a shape and an instance in this
    // model, so removing them cannot take an element with them.
    const sharedGeometryIds = new Set<number>();
    for (const placement of instancePlacements.values()) sharedGeometryIds.add(placement.geometryId);
    let cachedShapeRecords = 0;
    if (sharedGeometryIds.size) {
      for (let index = elementBounds.length - 1; index >= 0; index -= 1) {
        if (!sharedGeometryIds.has(elementBounds[index]!.elementId)) continue;
        elementBounds.splice(index, 1);
        cachedShapeRecords += 1;
      }
    }

    // Elements whose envelope was never placed.
    //
    // A second pile sits on the project datum, and it is not the cached shapes
    // removed above — these are ordinary elements whose bounds were read in
    // their family's local frame, so every one of them is centred on (0, 0)
    // instead of where the element stands. In the supplied project that is
    // 3,238 records — 2,012 balusters, 373 mullions, 309 panels — and the
    // paired export has *nothing* within two feet of the datum, against 85.4%
    // of recovered records matching it everywhere else. Real geometry does not
    // stack thousands of elements on a single point.
    let unplacedRecords = 0;
    if (elementBounds.length > MIN_RECORDS_FOR_DATUM_PILE) {
      const spread = boundsOfRecords(elementBounds);
      const wide = Math.max(spread.max.x - spread.min.x, spread.max.y - spread.min.y);
      // A component-scale file legitimately sits on its own origin; a building
      // does not.
      if (wide > DATUM_PILE_MIN_MODEL_SPAN_FEET) {
        for (let index = elementBounds.length - 1; index >= 0; index -= 1) {
          const { min, max } = elementBounds[index]!.boundsFeet;
          if (Math.abs((min.x + max.x) / 2) > DATUM_PILE_RADIUS_FEET) continue;
          if (Math.abs((min.y + max.y) / 2) > DATUM_PILE_RADIUS_FEET) continue;
          elementBounds.splice(index, 1);
          unplacedRecords += 1;
        }
      }
    }

    onProgress?.({ ratio: 0.84, message: "Resolving native Revit categories" });
    const nativeCategories = applyNativeCategories(
      elementBounds,
      categoryTokens,
      elementIndex?.uniqueElementIds,
    );



    let namedTypeElements = 0;
    let sketchBoundaryElements = 0;
    let sketchBoundedFacetHulls = 0;
    let unnamedSketchElements = 0;
    let rejectedOrientedBoxes = 0;
    let sweptRailings = 0;
    let curvedWalls = 0;
    for (const record of elementBounds) {
      const parameters = elementParameters.get(record.elementId);
      if (parameters?.size) record.parameters = [...parameters.values()];
      record.solid = solidsByElement.get(record.elementId);
      record.solids = solidGroups.get(record.elementId);
      record.quads = quadsByElement.get(record.elementId);
      record.arcs = arcsByElement.get(record.elementId);
      if (record.arcs?.length) curvedWalls += 1;
      const orientedBox = orientedBoxes.get(record.elementId);
      // A record synthesised from the instance itself has nothing to check
      // against; one that also carries a bounds record does.
      if (
        orientedBox &&
        (record.recordOffset < 0 ||
          faceReadBoxes.has(record.elementId) ||
          agreesWithBounds(orientedBox, record.boundsFeet))
      ) {
        record.orientedBox = orientedBox;
      } else if (orientedBox) {
        rejectedOrientedBoxes += 1;
      }
      const knownSketchCategory =
        record.categoryId != null && SKETCH_BOUNDARY_CATEGORIES.has(record.categoryId);
      // Boundary recovery used to require the category to have decoded first,
      // which is backwards for exactly the elements that need it: ceilings and
      // ramps are the smallest populations in the model and so the likeliest to
      // fail category recovery, and a sketch loop is the only thing that gives
      // them a shape rather than a box. An element with no category and no
      // other geometry is therefore also tried — and its ring is kept only if
      // it agrees with the envelope decoded independently from the file.
      const mayBeUnnamedSketch =
        record.categoryId == null &&
        !record.solid &&
        !record.quads?.length &&
        !record.orientedBox;
      if (record.categoryId != null && RAIL_PATH_CATEGORIES.has(record.categoryId)) {
        const railPath = railPathFor(record, curvesByOwner);
        if (railPath) {
          record.railPath = railPath;
          sweptRailings += 1;
        }
      }
      if (knownSketchCategory || mayBeUnnamedSketch) {
        const loops = sketchLoopsFor(record, curvesByOwner, { verify: !knownSketchCategory });
        if (loops.length) {
          record.loops = loops;
          sketchBoundaryElements += 1;
          if (!knownSketchCategory) unnamedSketchElements += 1;
          // A boundary sketch outranks a facet hull, and where the record *is*
          // that hull the ring has no elevations to be extruded between. Both
          // then come from the curve set — but only when the two readings are
          // talking about the same element: see `bandsMeet`.
          if (
            knownSketchCategory &&
            isFacetHullRecord(record, quadsByElement, solidGroups, orientedBoxes)
          ) {
            const bounds = sketchCurveBounds(record.elementId, curvesByOwner);
            if (bounds && bandsMeet(bounds, record.boundsFeet)) {
              record.boundsFeet = bounds;
              sketchBoundedFacetHulls += 1;
            }
          }
        }
      }
      const typeId = typeReferences.get(record.elementId);
      if (typeId == null) continue;
      record.typeId = typeId;
      const typeName = typeNames.get(typeId);
      if (typeName) {
        record.typeName = typeName;
        namedTypeElements += 1;
      }
    }

    /*
     * A sketch-based element with no thickness at all takes its category's.
     *
     * A record synthesised as a hull over the native faces attributed to an
     * element is flat in z whenever exactly one face is attributed, which for a
     * floor or a ceiling is the usual case: **24 records in the supplied project
     * read as zero-thickness sheets**, and the paired export names every one of
     * them. A floor drawn that way is 0.656 ft short and a ceiling 0.171 ft, and
     * a ceiling is dropped from the scene outright, because the display gate
     * wants extent on all three axes and a sheet has none.
     *
     * The thickness is in the file, in the category itself: a sketch-based
     * element is a profile extruded through a thickness, so every floor in a
     * model shares one. **54 of this model's 55 floors measure 0.6562 ft and 21
     * of its 26 ceilings measure 0.1706** — 200 mm and 52 mm, the round figures a
     * real building has — and hanging that below the flat record reproduces the
     * export's own slab exactly: thickness error 0.656/0.171 ft → **0.000 for 22
     * of 22**, base error **0.000 for 22 of 22**, nothing made worse.
     *
     * Two clauses do the work, and both are measured rather than chosen. The
     * support floor in `modalSketchThickness` keeps the rule off `Ramps`, whose
     * five records have five different spans because a ramp's record height is
     * its rise — and those are exactly the two the rule would have got wrong,
     * since a ramp's flat record is its *bottom* rather than its top. And only a
     * synthesised record is completed: a real duplicated-bounds record that reads
     * flat is the element's own statement about itself.
     *
     * Null control: giving each record another sketch category's mode instead of
     * its own reproduces the export's thickness for **13 of 72** pairings.
     */
    let completedFlatSketches = 0;
    {
      const thicknessByCategory = modalSketchThickness(
        elementBounds,
        SKETCH_BOUNDARY_CATEGORIES,
        MIN_SOLID_SPAN_FEET,
      );
      if (thicknessByCategory.size) {
        for (const record of elementBounds) {
          const thickness = record.categoryId == null
            ? undefined
            : thicknessByCategory.get(record.categoryId);
          if (thickness == null) continue;
          if (completeFlatSketchRecord(record, thickness, MIN_SOLID_SPAN_FEET)) {
            completedFlatSketches += 1;
          }
        }
      }
    }

    /*
     * A rebuilt solid, clipped to the element's own envelope.
     *
     * A wall's rebuilt solid comes from the trim range of its native centre
     * plane, which is the wall **as modelled**, before Revit's join trimming.
     * The duplicated-bounds record is the wall **as built**, and it is exact:
     * for the 106 `IfcWall` and 6,045 `IfcWallStandardCase` records that carry a
     * real one, the envelope reproduces the export's box corner for corner —
     * within 0.001 ft for 100.0% and 99.4% of them. The solid is what the viewer
     * draws over it, and 33 of 110 `IfcWall` solids run longer than the wall's
     * own location line, by a median of 6.07 ft and a worst of 26.99.
     *
     * Two independent readings of one element, so the shorter is not a guess:
     * the solid's centreline is clipped to the envelope's plan extent. It can
     * only shrink, so no element gains geometry it did not have and nothing can
     * be pushed outside the building.
     *
     * | | shipped | clipped |
     * | --- | --- | --- |
     * | `IfcWallStandardCase` centre / size | 96.8% / 83.4% | 98.5% / 92.2% |
     * | `IfcWall` centre / size | 68.5% / 59.1% | 91.3% / 77.2% |
     *
     * Clipping to a **shuffled** envelope fixes 0 and breaks 7; clipping to the
     * envelope of the element one id below — a genuinely nearby box — is +421
     * against −944 on `IfcWallStandardCase`. The gain needs the element's own
     * envelope, which is what makes it a second reading rather than a fudge.
     *
     * Falling back to the envelope outright wherever a clipped solid still
     * disagrees by over half a foot scores better again — `IfcWall` 92.9% /
     * 88.2% — but it costs 269 of 6,527 solid-drawn records their orientation,
     * and an angled wall drawn as its axis-aligned box is a visible error the
     * metric cannot see, because the export's box is axis-aligned too. Measured
     * and not taken, for the same reason the railings are swept rather than
     * boxed.
     */
    let clippedSolids = 0;
    let disownedSolids = 0;
    let extendedSolids = 0;
    let shrunkSolids = 0;
    let narrowedSolidBands = 0;
    for (const record of elementBounds) {
      const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
      if (!solids.length || record.recordOffset < 0) continue;
      // A solid that shares no point with the element's own envelope is not the
      // element's solid, and clipping cannot help: it only shortens a run that
      // overlaps. 11 of the 5,360 solids on drawn records with a real bounds
      // block are like this, and dropping them takes the elements drawn over
      // 10 ft past their own export box from 35 to 29 and the worst single case
      // from 260.3 ft to 19.8. See `solidBelongsToEnvelope` for the evidence
      // that the solid rather than the record is the wrong reading.
      const own = solids.filter((solid) => solidBelongsToEnvelope(solid, record.boundsFeet));
      if (own.length !== solids.length) {
        disownedSolids += solids.length - own.length;
        record.solids = own.length ? own : undefined;
        record.solid = own[0];
      }
      for (const solid of own) {
        if (clipSolidToEnvelope(solid, record.boundsFeet)) clippedSolids += 1;
        // And the other direction, which is the larger of the two effects. The
        // trim range is the wall as modelled and Revit extends a wall's body at a
        // join without moving its location line, so the drawn wall stops *short*
        // of the exported one — by half the thickness of the wall it meets, which
        // over the 4,008 axis-aligned solid-drawn walls spikes at 45, 50, 60, 75,
        // 100, 120, 150 and 200 mm: exactly half of this model's wall types. The
        // envelope is the joined extent and already holds it. This loop skips
        // records with no real bounds block, which is the premise the rule needs
        // — see `extendSolidToEnvelope` for the null controls and for why feeding
        // it a synthesised envelope scores *below* doing nothing.
        if (extendSolidToEnvelope(solid, record.boundsFeet)) extendedSolids += 1;
        // The same argument on the axis nothing was checking. Of the 5,312
        // solid-drawn records with a real bounds block, exactly **3** have a
        // solid reaching outside the record in z, and all three are wrong by
        // 6.6–9.2 ft: 1192647's record and its export box both read 0.66 ft tall
        // against a solid drawn 9.84. All three go to 0.000 ft and nothing else
        // moves. Nulls in `clipSolidBandToEnvelope`.
        if (clipSolidBandToEnvelope(solid, record.boundsFeet)) narrowedSolidBands += 1;
      }
      // And the shrink the centreline clip above cannot reach: it clips the
      // *centreline* to the envelope, while what is drawn is a box half a
      // thickness either side of it, so a wall at 32° or 45° — 1,888 of this
      // model's runs — is left with two corners outside its own envelope. Only
      // where the envelope solves as this one slab's own box, and only for a
      // record carrying a single solid, because cutting one part of a multi-body
      // wall down to the union of its parts is how the unguarded form loses
      // ground. See `shrinkSolidIntoEnvelope`.
      if (own.length === 1 && shrinkSolidIntoEnvelope(own[0]!, record.boundsFeet)) {
        shrunkSolids += 1;
      }
      if (record.solids?.length && record.solid) {
        // `solid` is the longest of the group and properties report from it.
        record.solid = record.solids.reduce((longest, candidate) =>
          Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y) >
          Math.hypot(longest.end.x - longest.start.x, longest.end.y - longest.start.y)
            ? candidate
            : longest);
      }
    }

    /*
     * A stair run's own box, from the companion record filed beside it.
     *
     * A run's duplicated-bounds record holds the run's plan — exact to 0.000 ft
     * in both centre and size — and the *whole stair's* storey z-band. On a
     * straight stair that band is the run's rise and the record looks right by
     * coincidence; on a switchback there are two runs and a landing inside one
     * band, so each run is drawn to the full storey while occupying half of it.
     * That is the whole of the bimodal error: of 49 flights over a foot out, 31
     * occupy under 70% of the record they are drawn to.
     *
     * The run's own elevations are in the file, in an ordinary duplicated-bounds
     * record — same `0x08c6` tag, same family word — filed under the run's
     * element id **+ 1**, which is its Sketch element, and carrying record code
     * `169671` with one field. The decoder was already reading all 111 of them
     * and drawing each as an anonymous element beside its oversized parent. The
     * export names none of them, and the id below each is a stair run, landing,
     * stringer or stair sketch line in 95 of the 97 cases.
     *
     * So the owner adopts its companion's box and the companion is held back —
     * see `isStairCompanion` in `scene.ts`. Stair flights go from 44.3% to
     * **84.8%** within half a foot, median centre error 1.895 ft to **0.000**,
     * and stair landings take `IfcSlab` from 75.5% to **90.2%** because the
     * exporter writes a landing as a slab. No other class adopts anything: for
     * walls, doors, plates, members, columns, railings, windows, coverings,
     * roofs and ramps the count is zero.
     *
     * What is left is 11 flights the exporter splits into one product per storey
     * for a multistorey stair. Their corrected box matches the nearest single
     * product to within 0.08 ft and scores badly only against the union of all
     * of them; drawing one run per storey needs a replication rule, not a better
     * box.
     *
     * **The adoption was not the reason the landings were wrong.** Holding out
     * by storey put this rule at 95.2% on Floor 1 against 55.2% and 65.0% on
     * Floors 2 and 3, and 13 of the 24 owners over half a foot out were the
     * landings the exporter writes as slabs. The adopted box was right for 11
     * of those 13 — it was never drawn, because `record.solid` outranks the
     * envelope and a landing's plane triple is not a location line. They are
     * drawn from their own sketch ring now; see `SKETCH_BOUNDARY_CATEGORIES`.
     * Adoption goes to **87.5% of 104**, and every one of the 12 owners still
     * over half a foot matches the *nearest single* export product to within
     * **0.02 ft** — so what is left of this rule's storey split is entirely the
     * exporter splitting a stair per storey, which no box can answer.
     */
    const recordsById = new Map(elementBounds.map((record) => [record.elementId, record]));
    let adoptedStairBoxes = 0;
    const adoptedIds = new Set<number>();
    for (const companion of elementBounds) {
      if (companion.recordCode !== STAIR_COMPANION_CODE || companion.recordCount !== 1) continue;
      const owner = recordsById.get(companion.elementId - 1);
      if (!owner) continue;
      owner.boundsFeet = companion.boundsFeet;
      adoptedIds.add(owner.elementId);
      adoptedStairBoxes += 1;
    }

    /*
     * The other stair sub-component with the assembly's z band, and it has no
     * companion record.
     *
     * The rule above gives a stair run and a landing their own box, from a record
     * the file files beside them. A stringer carriage has no such record — of the
     * 263 that join an export product, a nearby record reproduces the stringer's
     * own z band for **33, of which 18 are records that are already right**,
     * against 2 under a shuffled pairing, and the offsets that do hit are spread
     * over -1, -2 and -3 across three record codes. There is no companion to
     * adopt. Nor is the band in the parameter table: **0 of the 263 stringers
     * carry a parameter table at all.**
     *
     * What a stringer does own, when it owns anything, is its own faces, and
     * `facetElevationBand` narrows the envelope to them where they bound the
     * element in z. The band can only shrink the box, so nothing gains extent.
     *
     * A record whose box came from the stair companion above is excluded: that is
     * already a verified second reading, and narrowing the one stair run this
     * would otherwise reach took it from 0.00 ft to 2.20 ft out. The narrowing is
     * also confined to records the envelope is what gets *drawn* for — an element
     * with a ring, a rail path, a placed box, a solid or an arc is drawn from that
     * instead, and its record's z band is not what the viewer shows.
     */
    let narrowedFacetBands = 0;
    for (const record of elementBounds) {
      if (!record.quads?.length || adoptedIds.has(record.elementId)) continue;
      if (record.railPath || record.loops?.length || record.orientedBox) continue;
      if (record.solids?.length || record.solid || record.arcs?.length) continue;
      const band = facetElevationBand(record.quads);
      if (!band) continue;
      const min = Math.max(band.min, record.boundsFeet.min.z);
      const max = Math.min(band.max, record.boundsFeet.max.z);
      if (max - min < MIN_FACET_BAND_FEET) continue;
      if (min - record.boundsFeet.min.z < 0.01 && record.boundsFeet.max.z - max < 0.01) continue;
      record.boundsFeet = {
        min: { ...record.boundsFeet.min, z: min },
        max: { ...record.boundsFeet.max, z: max },
      };
      narrowedFacetBands += 1;
    }

    // Doors need every wall in the model, so they are a second pass rather than
    // part of the loop that builds the walls.
    const wallRuns: WallRun[] = [];
    for (const record of elementBounds) {
      const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
      for (const solid of solids) {
        wallRuns.push({
          x0: solid.start.x,
          y0: solid.start.y,
          x1: solid.end.x,
          y1: solid.end.y,
          thickness: solid.thickness,
          minZ: record.boundsFeet.min.z,
          maxZ: record.boundsFeet.max.z,
        });
      }
    }
    /*
     * A door whose category did not decode is still a door, and the file says
     * so: it points at a shared shape that doors point at.
     *
     * 96 of the 1,642 recovered doors carry no `-2000023` token — 85 carry no
     * category at all, 10 come out as `Walls` and one as a baluster — and
     * gating the leaf on the category alone left every one of them drawn as the
     * raw swing, 2.1% within half a foot of the export against 99.5% for the
     * doors the gate does admit. The shape is the evidence that is left: a
     * cached family shape is shared, so a shape a *categorised* door uses is a
     * door's shape whoever else points at it.
     *
     * **It opens the shape route only, never the wall route.** The shape route
     * carries its own evidence — `doorLeafFromShape` declines anything that is
     * not a swing or a leaf, so a mullion's symmetric shape falls straight
     * through — while the wall route carries none: it takes any element within
     * a wall's thickness of a centreline and rebuilds it as a leaf. Opening
     * both put a door leaf on **862 curtain-wall mullions**, whose size
     * agreement went to 78.4% from the 98.8% their placed box already had. The
     * category decode is what let them in: it labels a cluster of mullions
     * `Doors` by record-code consensus, and their shape id then poisons the
     * set. Scoped to the shape route the widened gate admits **144 elements the
     * category misses and the export names every one of them `IfcDoor`** — 134
     * with no category at all, 9 read as `Walls`, one as a baluster — at 100.0%
     * on both centre and size.
     */
    const doorShapeIds = new Set<number>();
    for (const record of elementBounds) {
      if (record.categoryId !== DOOR_CATEGORY) continue;
      const placement = instancePlacements.get(record.elementId);
      if (placement) doorShapeIds.add(placement.geometryId);
    }
    let doorLeaves = 0;
    let doorLeavesFromShape = 0;
    for (const record of elementBounds) {
      const placement = instancePlacements.get(record.elementId);
      const categorySaysDoor = record.categoryId === DOOR_CATEGORY;
      const shapeSaysDoor = placement != null && doorShapeIds.has(placement.geometryId);
      if (!categorySaysDoor && !shapeSaysDoor) continue;
      // The door's own shared shape is either the swing, which folds to the
      // leaf, or the leaf outright where the B-rep could be read. Where neither
      // is available the host wall's thickness is the fallback, which is what
      // every door used before.
      const shape = placement ? localBounds.get(placement.geometryId) : undefined;
      const fromShape = placement && shape ? doorLeafFromShape(placement, shape) : null;
      if (fromShape) {
        record.orientedBox = fromShape;
        record.doorLeafSource = "shape";
        doorLeavesFromShape += 1;
        continue;
      }
      if (!categorySaysDoor || !wallRuns.length) continue;
      const corners = doorLeafCorners(record, wallRuns);
      if (!corners) continue;
      record.orientedBox = corners;
      record.doorLeafSource = "wall";
      doorLeaves += 1;
    }

    onProgress?.({ ratio: 0.86, message: "Removing duplicates and spatial noise" });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
    const categorisedElements = nativeCategories.directElements + nativeCategories.inheritedElements;
    // An element needs a volume to be worth drawing, with one exception: a
    // sketch-bounded element is a plan boundary plus a thickness, and Revit can
    // record that thickness as zero. `prismGeometry` already substitutes a
    // minimum depth for exactly that case, so gating on a three-axis extent
    // beforehand only threw away flat ceilings and ramp landings that had a
    // perfectly good recovered outline.
    const boundedSolids = elementBounds.filter(
      (record) => solidBounds(record) || (record.loops?.length ?? 0) > 0,
    );
    if (boundedSolids.length) {
      const displaySelection = selectDisplayBounds(boundedSolids);
      const displayBounds = displaySelection.records;
      // Framed to the building rather than to the outermost record, so a few
      // misparsed envelopes cannot throw the camera off the model.
      const bounds = framingBoundsOfRecords(displayBounds);
      const origin = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: bounds.min.z,
      };
      const meshes = buildBoundsMeshes(displayBounds, origin);
      const segments = boundsPlanSegments(displayBounds);
      const relativeBounds = {
        min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
        max: {
          x: bounds.max.x - origin.x,
          y: bounds.max.y - origin.y,
          z: bounds.max.z - origin.z,
        },
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes,
        materials: displayMaterials(),
        segments,
        elementBounds,
        nativeProfiles,
        nativeCategories,
        schema,
        partitionNames,
        partAtom,
        coverage,
        decoderCoverage: {
          revitVersion: decoderPlan.revitVersion,
          activeDecoders: [
            "revit-2027-duplicated-bounds-v1",
            ...(nativeCategories.tokensFound ? ["revit-builtin-category-token-v1"] : []),
            ...(elementOwnership ? ["revit-2024-2027-elem-table-ownership-v1"] : []),
            ...(nativeIdentity ? ["revit-2027-native-identity-v1"] : []),
          ],
          nativeCurves: 0,
          nativeProfiles: 0,
          nativeMeshes: 0,
          nativeMaterialDefinitions: 0,
          nativeMaterialAssignments: 0,
          nativeUniqueIds: nativeIdentity?.decodedIdentityCount ?? 0,
          nativeOwnershipRecords: elementOwnership?.decodedRecordCount ?? 0,
          nativeOwnershipRelations: elementOwnership?.relations.length ?? 0,
          approximateSolids: displayBounds.length,
          nativeCategorisedElements: categorisedElements,
          geometryFidelity: "native-bounds-envelope",
          materialFidelity: "display-fallback",
          semanticFidelity: categorisedElements
            ? (elementOwnership ? "native-categories-and-ownership" : "native-categories")
            : (elementOwnership ? "native-ownership" : "record-code-heuristic"),
        },
        origin,
        bbox: relativeBounds,
        levels: levelsForBounds(displayBounds),
        method: "partition-bounds-recovery",
        elementIndex: elementIndex
          ? {
              ...elementIndex,
              partitionRecordIds: Uint32Array.from([...partitionRecordIds].sort((a, b) => a - b)),
              partitionRecords,
            }
          : undefined,
        elementOwnership,
        nativeIdentity,
        warnings: [
          `${boundedSolids.length.toLocaleString()} native element records supplied duplicated, validated 3D bounds.`,
          ...(categorisedElements
            ? [`${categorisedElements.toLocaleString()} elements carry a Revit category decoded from the file itself (${nativeCategories.directElements.toLocaleString()} from their own category token, ${nativeCategories.inheritedElements.toLocaleString()} inherited from a record-code consensus).`]
            : ["No native Revit category tokens were decoded, so element display falls back to record-code clusters."]),
          ...(elementOwnership
            ? [`${elementOwnership.relations.length.toLocaleString()} persisted element ownership relationships were decoded from Global/ElemTable for the client model tree.`]
            : []),
          ...(nativeIdentity
            ? [`${nativeIdentity.decodedIdentityCount.toLocaleString()} native Revit UniqueIds were decoded from Global/History and Global/ElemTable.`]
            : []),
          ...(displaySelection.omittedContainerCount
            ? ["One dominant container-like envelope remains in audit and IFC output but is omitted from the default scene so it cannot hide the building."]
            : []),
          ...(displaySelection.omittedWrapperCount
            ? [`${displaySelection.omittedWrapperCount.toLocaleString()} curtain-wall/opening wrapper envelopes are hidden by default so their detailed child elements remain visible.`]
            : []),
          ...(displaySelection.unclassifiedCount
            ? [`${displaySelection.unclassifiedCount.toLocaleString()} element envelopes are drawn without a decoded Revit category, grouped as uncategorised elements.`]
            : []),
          ...(displaySelection.omittedSheetCount
            ? [`${displaySelection.omittedSheetCount.toLocaleString()} sheets are held back from the scene: a floor's own boundary sketch, which Revit stores as its own element and which would otherwise be extruded into a second slab, storey-sized plates that no category claims, and uncategorised records written under the "no class" record code, which the paired export gives geometry to in none of 304 cases.`]
            : []),
          "Geometry uses exact RVT axis-aligned element envelopes; curved profiles, openings, materials, and parameters are not decoded yet.",
        ],
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: elementBounds.length,
          candidatesFocused: displayBounds.length,
          candidatesUsed: displayBounds.length,
          // Counted from the batches themselves: a drawn item is no longer
          // always an eight-vertex box.
          vertexCount: meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0),
          triangleCount: meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0),
          meshCount: meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          elementObjects: elementObjects.length,
          parameterElements: elementParameters.size,
          surfaces: surfaceCounts,
          nativeSolids: solidsByElement.size,
          faceOnlyElements: quadsByElement.size,
          placedInstances: orientedBoxes.size,
          rejectedOrientedBoxes,
          cachedShapeRecords,
          unplacedRecords,
          sketchBoundaryElements,
          sketchBoundedFacetHulls,
          completedFlatSketches,
          sweptRailings,
          curvedWalls,
          doorLeaves,
          doorLeavesFromShape,
          adoptedStairBoxes,
          clippedSolids,
          extendedSolids,
          shrunkSolids,
          narrowedSolidBands,
          disownedSolids,
          narrowedFacetBands,
          unnamedSketchElements,
          sketchCurves,
          solidOnlyElements,
          instanceOnlyElements,
          unclassifiedElements: displaySelection.unclassifiedCount,
          typedElements: typeReferences.size,
          namedTypeElements,
          elementObjectMarker: dominantMarker(elementObjects) ?? undefined,
          durationMs: performance.now() - started,
        },
      };
      onProgress?.({ ratio: 1, message: "Ready" });
      return result;
    }
    if (!used.length) throw new Error("The file opened, but no plausible geometry was recovered.");

    const bounds = rawBounds(used);
    const origin = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: bounds.min.z,
    };
    // The diagnostic scan recovers curves, not solids, so each candidate is
    // extruded only to make it visible. At family scale a 10 ft extrusion would
    // bury the component, so the defaults follow the recovered extent instead.
    const diagonal = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    const extrusionHeight = options.wallHeight ?? (familyScale ? Math.max(0.05, diagonal * 0.04) : 10);
    const extrusionThickness = options.wallThickness ?? (familyScale ? Math.max(0.01, diagonal * 0.004) : 0.5);
    const meshes = buildMeshes(used, origin, extrusionThickness, extrusionHeight);
    const relativeBounds = {
      min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
      max: {
        x: bounds.max.x - origin.x,
        y: bounds.max.y - origin.y,
        z: bounds.max.z - origin.z + extrusionHeight,
      },
    };

    const result: ConvertResult = {
      ok: true,
      fileName,
      byteLength: bytes.byteLength,
      meshes,
      materials: displayMaterials(),
      segments: used,
      elementBounds,
      nativeProfiles,
      nativeCategories,
      schema,
      partitionNames,
      partAtom,
      coverage,
      decoderCoverage: {
        revitVersion: decoderPlan.revitVersion,
        activeDecoders: [
          ...(nativeCategories.tokensFound ? ["revit-builtin-category-token-v1"] : []),
          ...(elementOwnership ? ["revit-2024-2027-elem-table-ownership-v1"] : []),
          ...(nativeIdentity ? ["revit-2027-native-identity-v1"] : []),
        ],
        nativeCurves: 0,
        nativeProfiles: 0,
        nativeMeshes: 0,
        nativeMaterialDefinitions: 0,
        nativeMaterialAssignments: 0,
        nativeUniqueIds: nativeIdentity?.decodedIdentityCount ?? 0,
        nativeOwnershipRecords: elementOwnership?.decodedRecordCount ?? 0,
        nativeOwnershipRelations: elementOwnership?.relations.length ?? 0,
        approximateSolids: used.length,
        nativeCategorisedElements: categorisedElements,
        geometryFidelity: "diagnostic-only",
        materialFidelity: "display-fallback",
        semanticFidelity: categorisedElements
          ? (elementOwnership ? "native-categories-and-ownership" : "native-categories")
          : (elementOwnership ? "native-ownership" : "none"),
      },
      origin,
      bbox: relativeBounds,
      levels: levelsFor(used),
      method: "partition-coordinate-recovery",
      elementIndex: elementIndex
        ? {
            ...elementIndex,
            partitionRecordIds: Uint32Array.from(
              [...partitionRecordIds].sort((a, b) => a - b),
            ),
            partitionRecords,
          }
        : undefined,
      elementOwnership,
      nativeIdentity,
      warnings: [
        ...(decoderPlan.revitVersion == null
          ? ["No Revit release was supplied, so release-specific native record decoders were safely disabled."]
          : []),
        familyScale
          ? "Family file: geometry is inferred from component-scale coordinate-like partition records and is not a native Revit element model."
          : "Geometry is inferred from coordinate-like partition records and is not a native Revit element model.",
        ...(elementOwnership
          ? [`${elementOwnership.relations.length.toLocaleString()} persisted element ownership relationships were decoded from Global/ElemTable for the client model tree.`]
          : []),
        ...(nativeIdentity
          ? [`${nativeIdentity.decodedIdentityCount.toLocaleString()} native Revit UniqueIds were decoded from Global/History and Global/ElemTable.`]
          : []),
        focused.length < unique.length
          ? `Focused on the primary spatial cluster and omitted ${(unique.length - focused.length).toLocaleString()} isolated candidates.`
          : "No isolated spatial cluster was removed.",
      ],
      stats: {
        streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
        partitionStreams: partitions.length,
        gzipChunks,
        inflatedBytes,
        candidatesFound: unique.length,
        candidatesFocused: focused.length,
        candidatesUsed: used.length,
        vertexCount: used.length * 8,
        triangleCount: used.length * 12,
        meshCount: meshes.length,
        boundsRecordsFound: elementBounds.length,
        solidBoundsRecords: boundedSolids.length,
        elementObjects: elementObjects.length,
        durationMs: performance.now() - started,
      },
    };
    onProgress?.({ ratio: 1, message: "Ready" });
    return result;
  } catch (error) {
    return {
      ok: false,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
