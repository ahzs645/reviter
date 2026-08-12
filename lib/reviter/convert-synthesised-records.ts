/**
 * Records for elements the file never wrote a bounds record for, and records
 * for things that are not elements at all.
 *
 * A duplicated-bounds record is the file's own statement of an element's
 * extent, and most elements that own geometry do not have one — 2,818 wall
 * records exist against 7,401 wall objects in the supplied project. The four
 * passes here settle which records the rest of the pipeline will see:
 *
 *  - an element with a rebuilt solid, a face hull or a placed box, and no
 *    record, gets one synthesised from that geometry;
 *  - a sketch-category element with a closed boundary ring and no record gets
 *    one synthesised from the ring;
 *  - a cached family shape, which carries the same bounds sub-record a real
 *    element does, is removed;
 *  - so is a record left in its family's local frame, which is why thousands of
 *    them pile up on the project datum.
 *
 * The synthesised record is not a claim that the hull or the box *is* the
 * element's shape. It is what lets a ring, a placement or a category attach to
 * the element later — the display gate decides separately whether the envelope
 * itself is worth drawing.
 */
import { boundsOfRecords, MIN_SOLID_SPAN_FEET } from "./bounds-records.ts";
import { sharedGeometryIdsForPlacements } from "./instanced-geometry.ts";
import { markerCategoryConsensus } from "./element-objects.ts";
import { resolveElementCategories } from "./native-categories.ts";
import { bandsMeet, boundaryLoopsFor, sketchCurveBounds } from "./sketch-curves.ts";
import { SKETCH_BOUNDARY_CATEGORIES } from "./convert-element-geometry.ts";

import type { ElementOwnershipDecode } from "./element-relations.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import type { CategoryToken } from "./native-categories.ts";
import type { CurveBounds, SketchCurve } from "./sketch-curves.ts";
import type { surfaceQuadsFor, wallSolids } from "./native-geometry.ts";
import type { Bounds3, ElementBoundsRecord, RvtElementIndex } from "./types";

type WallSolid = ReturnType<typeof wallSolids>[number];
type SurfaceQuads = ReturnType<typeof surfaceQuadsFor>;

/** Plan distance from the project datum inside which an envelope is unplaced. */
const DATUM_PILE_RADIUS_FEET = 1;

/** Below this a model is too small to tell a datum pile from real geometry. */
const DATUM_PILE_MIN_MODEL_SPAN_FEET = 50;

/** Records needed before a pile on the datum can be told apart from a few elements. */
const MIN_RECORDS_FOR_DATUM_PILE = 500;

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
 * Drop every record `shouldRemove` selects, in a single pass, **in place**.
 *
 * The array object itself has to survive: `elementBounds` is built once and then
 * read through dozens of later closures and helper calls, so a rebuild-and-
 * reassign would risk one of them holding the pre-removal array. Compacting the
 * survivors down and truncating gives every existing reference the same view
 * `splice` gave it, without the array identity ever changing.
 *
 * Removing one at a time with `splice` shifts on average half the array per
 * removal. The cached-shape and datum-pile passes drop thousands of records from
 * a ~74,000-element array, which is hundreds of millions of element moves for
 * work one filter pass does.
 *
 * Order among the survivors is unchanged, which matters: the reverse-index
 * `splice` loops this replaces preserved it too, and later passes read these
 * records in order.
 *
 * @returns how many records were removed.
 */
export function removeRecordsInPlace(
  records: ElementBoundsRecord[],
  shouldRemove: (record: ElementBoundsRecord) => boolean,
): number {
  let write = 0;
  for (let read = 0; read < records.length; read += 1) {
    const record = records[read]!;
    if (shouldRemove(record)) continue;
    records[write] = record;
    write += 1;
  }
  const removed = records.length - write;
  records.length = write;
  return removed;
}


/**
 * The axis-aligned hull over a run of points.
 *
 * `Math.min(...points)` reads better but passes one argument per point, and the
 * engine's argument limit is a hard ceiling in the low hundreds of thousands —
 * a facet hull is taken over four corners per plane patch and nothing caps how
 * many patches one element may own, so the spread form is a latent
 * `RangeError`, not merely a slow path. Empty input still yields the
 * `Infinity`/`-Infinity` pair `Math.min()`/`Math.max()` return, and a `NaN`
 * coordinate still poisons its axis exactly as the spread form did.
 *
 * Not yet wired into the two hulls below that still spread: the conversion
 * tests reach neither branch, so the substitution is left for a change that can
 * be measured rather than folded into a restructure.
 */
function boundsOfCornerPoints(
  points: Iterable<readonly [number, number, number]>,
): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const [x, y, z] of points) {
    min.x = Math.min(min.x, x); max.x = Math.max(max.x, x);
    min.y = Math.min(min.y, y); max.y = Math.max(max.y, y);
    min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
  }
  return { min, max };
}

export type SynthesisedGeometryInput = {
  elementBounds: ElementBoundsRecord[];
  quadsByElement: Map<number, SurfaceQuads>;
  solidGroups: Map<number, WallSolid[]>;
  orientedBoxes: Map<number, [number, number, number][]>;
  /** Stream a synthesised record is attributed to: the first partition. */
  solidStream: string;
};

export type SynthesisedGeometry = {
  /** Every element id that now has a record, synthesised or not. */
  boundedIds: Set<number>;
  solidOnlyElements: number;
  instanceOnlyElements: number;
};

/**
 * Give every element with native geometry and no record of its own a record
 * synthesised from that geometry.
 */
export function synthesiseGeometryRecords(
  input: SynthesisedGeometryInput,
): SynthesisedGeometry {
  const { elementBounds, quadsByElement, solidGroups, orientedBoxes, solidStream } =
    input;
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

  return { boundedIds, solidOnlyElements, instanceOnlyElements };
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
   * pass that resolves record categories. Only the candidates' answers are
   * read; no existing record's category is touched.
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
export function synthesiseSketchBoundaryRecords(input: {
  elementBounds: ElementBoundsRecord[];
  boundedIds: Set<number>;
  curvesByOwner: Map<number, SketchCurve[]>;
  categoryTokens: CategoryToken[];
  /** Ids the page walk proved are real elements, whatever else is known. */
  partitionRecordIds: Set<number>;
  markerByElement: Map<number, number>;
  elementIndex: RvtElementIndex | undefined;
  elementOwnership: ElementOwnershipDecode | undefined;
  solidStream: string;
}): void {
  const {
    elementBounds,
    boundedIds,
    curvesByOwner,
    categoryTokens,
    partitionRecordIds,
    markerByElement,
    elementIndex,
    elementOwnership,
    solidStream,
  } = input;
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

/**
 * Remove the cached family shapes, and report which local shape ids the
 * placements referenced.
 */
export function removeCachedShapeRecords(input: {
  elementBounds: ElementBoundsRecord[];
  categoryTokens: CategoryToken[];
  elementIndex: RvtElementIndex | undefined;
  instancePlacements: Map<number, InstancePlacement>;
}): { sharedGeometryIds: Set<number>; cachedShapeRecords: number } {
  const { elementBounds, categoryTokens, elementIndex, instancePlacements } = input;
  // A cached family shape is not a building element. Its object carries the
  // same bounds sub-record an element does, so it was being decoded into the
  // model as though it were one — and its box is in the family's own local
  // frame, so it landed at the model origin. In the supplied project 5,995 of
  // them were drawn that way, 97% of them stacked within 50 ft of the origin,
  // and only 7 corresponded to anything in the paired export.
  //
  // The file names them: an ordinary family instance's persisted symbol id
  // points at the local shape it uses, so the referenced set is read straight
  // out of the placements rather than guessed at from position.
  //
  // A stair assembly uses that same field for a run/stringer subelement,
  // which is independently drawable. Its own native category token makes the
  // distinction before cached records are removed.
  // Category-token ownership is resolved against the complete element table,
  // just as `applyNativeCategories` does when the records are categorised.
  // Restricting the known set to placements alone lets an earlier nearby
  // placement steal a stair token.
  const placementCategoryKnownIds = new Set<number>(elementBounds.map(
    (record) => record.elementId,
  ));
  for (const elementId of elementIndex?.uniqueElementIds ?? []) {
    placementCategoryKnownIds.add(elementId);
  }
  const placementCategories = resolveElementCategories(
    categoryTokens,
    placementCategoryKnownIds,
  );
  const sharedGeometryIds = sharedGeometryIdsForPlacements(
    instancePlacements.values(),
    placementCategories,
  );
  let cachedShapeRecords = 0;
  if (sharedGeometryIds.size) {
    cachedShapeRecords = removeRecordsInPlace(elementBounds, (record) =>
      sharedGeometryIds.has(record.elementId));
  }

  return { sharedGeometryIds, cachedShapeRecords };
}

/** @returns how many records were removed as unplaced. */
export function removeDatumPileRecords(
  elementBounds: ElementBoundsRecord[],
): number {
  // Elements whose envelope was never placed.
  //
  // A second pile sits on the project datum, and it is not the cached shapes
  // removed by the pass before this one — these are ordinary elements whose
  // bounds were read in their family's local frame, so every one of them is
  // centred on (0, 0) instead of where the element stands. In the supplied
  // project that is
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
      // The two guards keep their original sense — a record whose centre is
      // not *outside* the radius is removed — so a non-finite centre is
      // removed here exactly as it was before.
      unplacedRecords += removeRecordsInPlace(elementBounds, ({ boundsFeet }) => {
        const { min, max } = boundsFeet;
        if (Math.abs((min.x + max.x) / 2) > DATUM_PILE_RADIUS_FEET) return false;
        if (Math.abs((min.y + max.y) / 2) > DATUM_PILE_RADIUS_FEET) return false;
        return true;
      });
    }
  }

  return unplacedRecords;
}
