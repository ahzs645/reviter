/**
 * What each element record turns out to be, and what geometry it gets.
 *
 * By this point the file has been read: every record that will exist exists,
 * and the native surfaces, placements, curves and parameters have been
 * collected and indexed by element. This stage is where those independent
 * readings are brought together onto the record itself — its category, its
 * solids, its faces, its arc, its oriented box, its boundary ring, its stair
 * treads, its rail path, its door leaf — and where readings that disagree are
 * reconciled against each other.
 *
 * It is a sequence of complete passes over `elementBounds` rather than one
 * loop, and the order is load-bearing:
 *
 *  1. the categories are resolved from the file's own tokens, because almost
 *     every rule below is scoped by category;
 *  2. each record collects the geometry attributed to its element id;
 *  3. records with no category take one from their native object class;
 *  4. a flat sketch record takes its category's modal thickness, which needs
 *     every record's thickness to have been attached first;
 *  5. rebuilt solids are clipped, extended and shrunk against their own
 *     record's envelope — two independent readings of one element;
 *  6. a stair part adopts the box its companion record carries;
 *  7. a facet-hull record narrows to the band its own faces bound;
 *  8. doors get a leaf, which needs every wall in the model to exist first.
 *
 * Each pass counts what it did, and those counts are the conversion's `stats`.
 * They are returned rather than accumulated in the caller so a pass cannot
 * quietly stop counting: a count that no pass produces will not compile.
 */
import { MIN_SOLID_SPAN_FEET } from "./bounds-records.ts";
import { curvedWallArcFromSketch } from "./curved-wall-sketch.ts";
import { doorLeafCorners, doorLeafFromShape, type WallRun } from "./door-leaf.ts";
import { noteLimit } from "./limit-census.ts";
import { facetElevationBand } from "./native-geometry.ts";
import {
  applyNativeCategories,
  categoryDisplayName,
  categoryFromNativeObjectEvidence,
} from "./native-categories.ts";
// `STAIR_COMPANION_CODE` is the record code of the companion record holding a
// stair run's own elevations. It lives in `record-codes.ts`, shared with
// `scene.ts`, so a re-measurement cannot correct one copy and miss the other.
import { STAIR_COMPANION_CODE } from "./record-codes.ts";
import {
  clipPolylinesToBand,
  completeFlatSketchRecord,
  modalSketchThickness,
} from "./recovered-extents.ts";
import {
  bandsMeet,
  boundaryLoopsFor,
  sketchCurveBounds,
} from "./sketch-curves.ts";
import {
  clipSolidBandToEnvelope,
  clipSolidToEnvelope,
  extendSolidToEnvelope,
  shrinkSolidIntoEnvelope,
  solidBelongsToEnvelope,
} from "./solid-clip.ts";
import {
  isMonumentalTerracedRun,
  recoverConnectedStairTreads,
  recoverFlattenedProfileStairTreads,
  recoverGuideChainStairTreads,
  recoverPairedGuideProfileStairTreads,
  recoverProfiledGuideStairTreads,
  recoverStraightStairTreads,
  respaceStraightStairTreads,
  snapTreadsToSketchRiserLines,
} from "./stair-treads.ts";
import { recoverWallJoinCorners } from "./wall-joins.ts";

import type { ElementOwnershipDecode } from "./element-relations.ts";
import type { InstancePlacement, LocalBounds } from "./instanced-geometry.ts";
import type { wallArcs, wallSolids, surfaceQuadsFor } from "./native-geometry.ts";
import type { CategoryToken } from "./native-categories.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "./revit-2027-stairs-aggregate.ts";
import type { Point3, SketchCurve } from "./sketch-curves.ts";
import type {
  Bounds3,
  ElementBoundsRecord,
  ElementParameter,
  NativeCategorySummary,
  RvtElementIndex,
} from "./types.ts";

type WallSolid = ReturnType<typeof wallSolids>[number];
type WallArc = ReturnType<typeof wallArcs>[number];
type SurfaceQuads = ReturnType<typeof surfaceQuadsFor>;

export type ElementGeometryInput = {
  /** Every recovered record, real or synthesised. Mutated in place. */
  elementBounds: ElementBoundsRecord[];
  categoryTokens: CategoryToken[];
  elementIndex: RvtElementIndex | undefined;
  elementOwnership: ElementOwnershipDecode | undefined;
  elementParameters: Map<number, Map<number, ElementParameter>>;
  /** The longest solid an element owns: the body properties report from. */
  solidsByElement: Map<number, WallSolid>;
  solidGroups: Map<number, WallSolid[]>;
  /** Faces of elements with no rebuilt solid of their own. */
  quadsByElement: Map<number, SurfaceQuads>;
  /** Faces of every element that has them, solid or not. */
  allSurfaceQuadsByElement: Map<number, SurfaceQuads>;
  arcsByElement: Map<number, WallArc[]>;
  orientedBoxes: Map<number, [number, number, number][]>;
  /** Instances whose box came from their B-rep's bounding faces. */
  faceReadBoxes: Set<number>;
  typeReferences: Map<number, number>;
  typeNames: Map<number, string>;
  wallThicknessByType: Map<number, number>;
  curvesByOwner: Map<number, SketchCurve[]>;
  markerByElement: Map<number, number>;
  markersByElement: Map<number, Set<number>>;
  stairsRuns: ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate>;
  instancePlacements: Map<number, InstancePlacement>;
  localBounds: Map<number, LocalBounds>;
};

/** One number per rule, in the order the passes below produce them. */
export type ElementGeometryCounts = {
  namedTypeElements: number;
  sketchBoundaryElements: number;
  sketchBoundedFacetHulls: number;
  unnamedSketchElements: number;
  rejectedOrientedBoxes: number;
  sweptRailings: number;
  curvedWalls: number;
  completedFlatSketches: number;
  clippedSolids: number;
  disownedSolids: number;
  extendedSolids: number;
  shrunkSolids: number;
  narrowedSolidBands: number;
  recoveredWallJoinEnds: number;
  adoptedStairBoxes: number;
  narrowedFacetBands: number;
  doorLeaves: number;
  doorLeavesFromShape: number;
};

export type ElementGeometryResolution = {
  nativeCategories: NativeCategorySummary;
  counts: ElementGeometryCounts;
};

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

/** Native category of a stair run whose own curves may describe its treads. */
const STAIRS_RUN_CATEGORY = -2000919;

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
export const SKETCH_BOUNDARY_CATEGORIES = new Set([
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

/** Persisted Revit 2027 footprint-roof class marker in the supplied schema. */
const REVIT_2027_FOOTPRINT_ROOF_MARKER = 3392;

/** Arc sampling can miss the exact plan extremum by one 50 mm segment. */
const ROOF_SKETCH_PLAN_TOLERANCE_FEET = 0.2;

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

/**
 * Revit 2027 framed marker for the semantic floor/slab record that owns its
 * footprint curves without carrying a GElement geometry definition.
 *
 * The marker is schema evidence, not a model id. One valid floor in the UNBC
 * corpus carries a conflicting drawing subcategory, so its own category token
 * cannot be used as the geometry discriminator.
 */
const REVIT_2027_FLOOR_SKETCH_OWNER_MARKER = 0x0869;

/** Revit category of a door, whose record is its opening rather than its leaf. */
const DOOR_CATEGORY = -2000023;

/**
 * A facet band shorter than this is not narrowed to. Nothing in the supplied
 * project comes close — all 79 accepted bands are over half a foot tall and none
 * is flat — so this only stops a degenerate face set replacing a real extent.
 */
const MIN_FACET_BAND_FEET = 0.05;

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
  {
    verify,
    planToleranceFeet = SKETCH_PLAN_TOLERANCE_FEET,
  }: { verify: boolean; planToleranceFeet?: number },
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
    Math.abs(minX - min.x) <= planToleranceFeet &&
    Math.abs(minY - min.y) <= planToleranceFeet &&
    Math.abs(maxX - max.x) <= planToleranceFeet &&
    Math.abs(maxY - max.y) <= planToleranceFeet;
  return agrees ? loops : [];
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
 * Resolve every element record's identity and geometry, in the order the
 * passes below depend on each other.
 */
export function resolveElementGeometry(
  input: ElementGeometryInput,
): ElementGeometryResolution {
  const { elementBounds, categoryTokens, elementIndex, elementOwnership } = input;
  // The persisted ownership table lists every element in the document, not
  // only the drawable ones, which is what lets the category resolver tell a
  // token that fell through from an undrawn element apart from one that
  // genuinely belongs to the record claiming it.
  const nativeCategories = applyNativeCategories(
    elementBounds,
    categoryTokens,
    elementIndex?.uniqueElementIds,
    elementOwnership
      ? new Set(elementOwnership.records.map((record) => record.elementId))
      : undefined,
  );




  const attached = attachRecoveredGeometry(input);
  applyNativeObjectCategories(input);
  const completedFlatSketches = completeFlatSketchRecords(elementBounds);
  const solids = reconcileSolidsWithEnvelopes(elementBounds);
  // A non-square wall join cannot be represented by moving the location-line
  // endpoints: its two long faces end at different stations.  Recover those
  // two corners only where an adjacent native wall face and this wall's own
  // real joined-body envelope independently agree.  The analytic rule is
  // element-agnostic and leaves every centreline untouched.
  const recoveredWallJoinEnds = recoverWallJoinCorners(elementBounds);

  const stairs = adoptStairCompanionBoxes(elementBounds);
  const narrowedFacetBands = narrowFacetElevationBands(
    elementBounds,
    stairs.adoptedIds,
  );
  const doors = applyDoorLeaves(input);
  return {
    nativeCategories,
    counts: {
      ...attached,
      completedFlatSketches,
      ...solids,
      recoveredWallJoinEnds,
      adoptedStairBoxes: stairs.adoptedStairBoxes,
      narrowedFacetBands,
      ...doors,
    },
  };
}

/**
 * Attach to each record every independent reading of its element: parameters,
 * rebuilt solids, native faces, arcs, placed boxes, stair treads, rail paths
 * and boundary rings, each under the guard that reading needs.
 */
function attachRecoveredGeometry(input: ElementGeometryInput): {
  namedTypeElements: number;
  sketchBoundaryElements: number;
  sketchBoundedFacetHulls: number;
  unnamedSketchElements: number;
  rejectedOrientedBoxes: number;
  sweptRailings: number;
  curvedWalls: number;
} {
  const {
    elementBounds,
    elementParameters,
    solidsByElement,
    solidGroups,
    quadsByElement,
    allSurfaceQuadsByElement,
    arcsByElement,
    orientedBoxes,
    faceReadBoxes,
    typeReferences,
    typeNames,
    wallThicknessByType,
    curvesByOwner,
    markerByElement,
    stairsRuns,
  } = input;
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
    const panelQuads = allSurfaceQuadsByElement.get(record.elementId);
    if (record.categoryId === -2000170 && panelQuads?.length) {
      const tolerance = 1e-5;
      const { min, max } = record.boundsFeet;
      const inside = panelQuads.filter((quad) =>
        quad.corners.every(
          ([x, y, z]) =>
            x >= min.x - tolerance && x <= max.x + tolerance &&
            y >= min.y - tolerance && y <= max.y + tolerance &&
            z >= min.z - tolerance && z <= max.z + tolerance,
        ),
      );
      if (inside.length >= 2) record.curtainPanelSurfaceQuads = inside;
    }
    record.arcs = arcsByElement.get(record.elementId);
    if (!record.arcs?.length && record.categoryId === -2000011) {
      const typeId = typeReferences.get(record.elementId);
      const thickness = typeId == null ? undefined : wallThicknessByType.get(typeId);
      if (thickness != null) {
        const recoveredArc = curvedWallArcFromSketch(
          record.elementId,
          curvesByOwner.get(record.elementId) ?? [],
          thickness,
          record.boundsFeet,
        );
        if (recoveredArc) record.arcs = [recoveredArc];
      }
    }
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
    const nativeFloorSketchCarrier =
      markerByElement.get(record.elementId) ===
        REVIT_2027_FLOOR_SKETCH_OWNER_MARKER;
    const nativeFootprintRoof =
      markerByElement.get(record.elementId) ===
        REVIT_2027_FOOTPRINT_ROOF_MARKER &&
      parameters?.has(-1001705); // Maximum Ridge Height
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
    // The category token is not a reliable discriminator for run geometry:
    // 58 persisted StairsRun owners in the UNBC model carry a drawing-aid
    // subcategory on their display record. The framed StairsRun aggregate is
    // the stronger, schema-specific identity and lets their own repeated
    // tread lines take the exact reconstruction route as well.
    const nativeStairsRun = stairsRuns.get(record.elementId);
    if (nativeStairsRun) {
      // Stronger than a record-code vote: object 1821222 inherited
      // "Stairs Landings", while its framed StairsRun object and Autodesk's
      // export both identify it as a 31-tread stair flight.
      record.categoryId = STAIRS_RUN_CATEGORY;
      record.categoryName = categoryDisplayName(STAIRS_RUN_CATEGORY);
      record.categorySource = "native-object";
    }
    if (record.categoryId === STAIRS_RUN_CATEGORY || nativeStairsRun) {
      const curves = curvesByOwner.get(record.elementId) ?? [];
      const run = nativeStairsRun;
      const expectedRiserCount = run?.runProperties
        ? run.runProperties.topRiserIndex - run.baseRiserIndex
        : undefined;
      if (
        expectedRiserCount != null &&
        Number.isSafeInteger(expectedRiserCount) &&
        expectedRiserCount > 0
      ) {
        record.stairExpectedRiserCount = expectedRiserCount;
      }
      const stair =
        recoverStraightStairTreads(curves, record.boundsFeet) ??
        (run?.runProperties
          ? recoverConnectedStairTreads(curves, record.boundsFeet, {
              actualRunWidthFeet:
                run.runProperties.actualRunWidthFeet,
              maximumRiserCount:
                run.runProperties.topRiserIndex - run.baseRiserIndex,
            }) ??
            recoverGuideChainStairTreads(curves, record.boundsFeet, {
              actualRunWidthFeet:
                run.runProperties.actualRunWidthFeet,
              maximumRiserCount:
                run.runProperties.topRiserIndex - run.baseRiserIndex,
            }) ??
            recoverPairedGuideProfileStairTreads(curves, record.boundsFeet, {
              actualRunWidthFeet:
                run.runProperties.actualRunWidthFeet,
              maximumRiserCount:
                run.runProperties.topRiserIndex - run.baseRiserIndex,
            }) ??
            recoverProfiledGuideStairTreads(curves, record.boundsFeet, {
              actualRunWidthFeet:
                run.runProperties.actualRunWidthFeet,
              maximumRiserCount:
                run.runProperties.topRiserIndex - run.baseRiserIndex,
            }) ??
            recoverFlattenedProfileStairTreads(curves, record.boundsFeet, {
              actualRunWidthFeet:
                run.runProperties.actualRunWidthFeet,
              maximumRiserCount:
                run.runProperties.topRiserIndex - run.baseRiserIndex,
            })
          : null);
      if (stair) {
        record.stairTreads = stair.treads;
        if (run?.runProperties) {
          record.stairBeginWithRiser = run.runProperties.beginWithRiser;
          record.stairEndWithRiser = run.runProperties.endWithRiser;
          // The readers can assemble a sketched run's lattice one boundary
          // slot away from the sketch's own repeated riser lines; when the
          // line clusters match the boundaries one for one, they are the
          // riser planes and the lattice snaps onto them. Otherwise, for a
          // straight run, the persisted riser count plus the record's own
          // validated envelope determine the uniform spacing exactly.
          // The riser lines can live under the run's sketch companion one
          // id below, the same pairing sketchLoopsFor follows; the snap's
          // exact cluster-count gate keeps the merged set safe.
          const snapped = snapTreadsToSketchRiserLines(record.stairTreads, [
            ...curves,
            ...(curvesByOwner.get(record.elementId - 1) ?? []),
          ]);
          if (snapped) {
            record.stairTreads = snapped;
          } else if (expectedRiserCount != null) {
            const respaced = respaceStraightStairTreads(
              stair.treads,
              record.boundsFeet,
              expectedRiserCount,
              run.runProperties.beginWithRiser,
              run.runProperties.endWithRiser,
            );
            if (respaced) record.stairTreads = respaced;
          }
        }
        const left = run?.runProperties?.leftStringerWidthFeet;
        const right = run?.runProperties?.rightStringerWidthFeet;
        if (
          left != null &&
          right != null &&
          Number.isFinite(left) &&
          Number.isFinite(right) &&
          left > 0 &&
          right > 0 &&
          Math.abs(left - right) <= 0.01
        ) {
          // A monumental terraced run is a solid mass in both the paired
          // export and the Autodesk reference; leaving the thickness unset
          // lets the scene extrude each tread to the run's base the way a
          // thickness-less run already draws. The RVT itself persists no
          // monolithic flag anywhere (measured), so the tread geometry is
          // the gate — see isMonumentalTerracedRun.
          if (isMonumentalTerracedRun(record.stairTreads)) {
            record.stairMonumentalSolid = true;
            noteLimit("monumental-solid-treads");
          } else {
            record.stairTreadThicknessFeet = (left + right) / 2;
          }
        }
      }
    }
    if (
      knownSketchCategory ||
      nativeFloorSketchCarrier ||
      mayBeUnnamedSketch
    ) {
      const loops = sketchLoopsFor(record, curvesByOwner, {
        // A category conflict must pass the same independent envelope gate
        // as an unnamed sketch; the 0x0869 marker only establishes ownership.
        verify: !knownSketchCategory,
        ...(nativeFootprintRoof
          ? { planToleranceFeet: ROOF_SKETCH_PLAN_TOLERANCE_FEET }
          : {}),
      });
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

  return {
    namedTypeElements,
    sketchBoundaryElements,
    sketchBoundedFacetHulls,
    unnamedSketchElements,
    rejectedOrientedBoxes,
    sweptRailings,
    curvedWalls,
  };
}

function applyNativeObjectCategories(input: ElementGeometryInput): void {
  const { elementBounds, markersByElement } = input;
  // A handful of elements lose their BuiltInCategory token while retaining a
  // stronger class identity. Apply only the exact native-object rules: ramps,
  // top-rail definitions, resolved baluster instances, and footprint roofs
  // carrying their class-specific ridge-height parameter.
  for (const record of elementBounds) {
    if (record.categoryId != null || record.categoryName) continue;
    const categoryId = categoryFromNativeObjectEvidence(
      record,
      markersByElement.get(record.elementId),
    );
    if (categoryId == null) continue;
    record.categoryId = categoryId;
    record.categoryName = categoryDisplayName(categoryId);
    record.categorySource = "native-object";
  }

}

function completeFlatSketchRecords(
  elementBounds: ElementBoundsRecord[],
): number {
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

  return completedFlatSketches;
}

function reconcileSolidsWithEnvelopes(elementBounds: ElementBoundsRecord[]): {
  clippedSolids: number;
  disownedSolids: number;
  extendedSolids: number;
  shrunkSolids: number;
  narrowedSolidBands: number;
} {
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
  return {
    clippedSolids,
    disownedSolids,
    extendedSolids,
    shrunkSolids,
    narrowedSolidBands,
  };
}

function adoptStairCompanionBoxes(elementBounds: ElementBoundsRecord[]): {
  adoptedStairBoxes: number;
  /** Owners whose box is now a second reading, and must not be narrowed again. */
  adoptedIds: Set<number>;
} {
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

  return { adoptedStairBoxes, adoptedIds };
}

function narrowFacetElevationBands(
  elementBounds: ElementBoundsRecord[],
  adoptedIds: Set<number>,
): number {
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
    if (
      record.railPath ||
      record.stairTreads?.length ||
      record.loops?.length ||
      record.orientedBox
    ) continue;
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

  return narrowedFacetBands;
}

function applyDoorLeaves(input: ElementGeometryInput): {
  doorLeaves: number;
  doorLeavesFromShape: number;
} {
  const { elementBounds, instancePlacements, localBounds } = input;
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

  return { doorLeaves, doorLeavesFromShape };
}
