/**
 * Completing or correcting a recovered extent from a *second* reading of the
 * same file.
 *
 * Both rules here follow the pattern `clipSolidToEnvelope` established: an
 * element is described twice in the partition stream, the two descriptions are
 * independent, and where they disagree the disagreement itself is the evidence.
 * Neither invents a dimension from nothing.
 *
 *  - `clipPolylinesToBand` trims a swept railing's path to the railing's own
 *    envelope, because a rail path runs a riser below the railing it carries.
 *  - `modalSketchThickness` gives a sketch-based element whose record is a hull
 *    over a single planar face the thickness its own category is written with
 *    everywhere else in the model.
 */

import type { Bounds3, ElementBoundsRecord, Point3 } from "./types.ts";

/**
 * Trim polylines to a z band, interpolating x and y where a segment crosses it.
 *
 * **Why a railing needs this.** The sweep draws a ribbon from the rail path up
 * by the guard height, and the guard is `envelope top − path top`, so the
 * ribbon's *top* reproduces the envelope's exactly by construction. Its *base*
 * is the path, and a stair railing's path in this model starts about one riser
 * below the railing — `RAIL_PATH_BASE_TOLERANCE_FEET` records the measured
 * spread as −0.38 to −0.89 ft. Measured against the paired export's own railing
 * meshes, **14 of 101 swept railings had their ribbon base up to 0.886 ft below
 * the exported railing's, and not one had its top wrong** (median top error
 * 0.000 ft, worst 0.000). The record's envelope base is the right answer for
 * them: it reproduces the export's base to a median of 0.000 ft.
 *
 * So the band is the element's own envelope, which is an independent reading of
 * the same railing, and trimming to it can only shorten the ribbon. Clipping
 * rather than clamping the vertex matters: clamping would lift the first tread
 * of the path onto the landing and flatten the bottom of the run, where clipping
 * interpolates the crossing and simply drops what lies below.
 *
 * A polyline that leaves the band and re-enters is returned as several
 * polylines, so a path is never silently bridged across a gap.
 */
export function clipPolylinesToBand(
  polylines: readonly Point3[][],
  minZ: number,
  maxZ: number,
): { polylines: Point3[][]; clipped: boolean } {
  const out: Point3[][] = [];
  let clipped = false;
  for (const polyline of polylines) {
    let run: Point3[] = [];
    const flush = () => {
      if (run.length >= 2) out.push(run);
      run = [];
    };
    for (let index = 0; index + 1 < polyline.length; index += 1) {
      const segment = clipSegment(polyline[index]!, polyline[index + 1]!, minZ, maxZ);
      if (!segment) {
        clipped = true;
        flush();
        continue;
      }
      const [from, to] = segment;
      if (from !== polyline[index] || to !== polyline[index + 1]) clipped = true;
      const previous = run[run.length - 1];
      // A run continues only where the clipped segment starts where the last one
      // ended; anywhere else the path left the band and came back, and bridging
      // the gap would draw a rail through it.
      if (previous && previous[0] === from[0] && previous[1] === from[1] && previous[2] === from[2]) {
        run.push(to);
      } else {
        flush();
        run = [from, to];
      }
    }
    flush();
  }
  // A path wholly outside the band is a disagreement to report rather than a
  // ribbon to delete, so the original survives — `clipSolidToEnvelope` declines
  // for the same reason. It cannot happen while the guard band holds, because
  // the guard is `maxZ − pathTop`, which puts the highest path point on `maxZ`.
  return { polylines: out.length ? out : polylines.map((line) => [...line]), clipped };
}

/** The part of `a → b` inside the band, or null when none of it is. */
function clipSegment(a: Point3, b: Point3, minZ: number, maxZ: number): [Point3, Point3] | null {
  const dz = b[2] - a[2];
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dz) < 1e-12) {
    if (a[2] < minZ || a[2] > maxZ) return null;
  } else {
    const first = (minZ - a[2]) / dz;
    const second = (maxZ - a[2]) / dz;
    t0 = Math.max(t0, Math.min(first, second));
    t1 = Math.min(t1, Math.max(first, second));
    if (t0 > t1) return null;
  }
  return [t0 === 0 ? a : along(a, b, t0), t1 === 1 ? b : along(a, b, t1)];
}

/** The point a fraction `t` along `a → b`. */
function along(a: Point3, b: Point3, t: number): Point3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Records a category needs before its thickness mode is believed.
 *
 * Below this a "mode" is one or two elements agreeing with themselves. Every
 * category the rule fires on in the supplied project clears it several times
 * over — Floors 55, Ceilings 26, Stairs Landings 25.
 */
const MIN_THICKNESS_SAMPLES = 8;

/**
 * Share of a category's records that must carry the modal thickness.
 *
 * This is the clause that keeps the rule off ramps, and it is a wide plateau
 * rather than a fitted edge. In the supplied project the modal z-span is carried
 * by **98% of 55 floors, 81% of 26 ceilings and 76% of 25 stair landings**,
 * while `Ramps` has five records with five different spans and a modal support
 * of **20%** — a ramp's record height is its rise, not a thickness, so there is
 * nothing for a mode to find. Any cut from 0.25 to 0.76 selects exactly the same
 * three categories, and the two ramps the floor excludes are the two the rule
 * would have got wrong: their flat record is the ramp's *bottom* rather than its
 * top, so hanging a thickness below it lands 3.28 ft out where the other 22 land
 * at 0.000.
 */
const MIN_THICKNESS_SUPPORT = 0.5;

/** Thicknesses are compared at this resolution, in feet — a hair under 1/32". */
const THICKNESS_QUANTUM = 1e-4;

/**
 * The thickness each sketch category is written with in this file.
 *
 * A sketch-based element is a profile extruded through a thickness, so its
 * category has one dimension every member of it shares. That is measured here
 * from the records that carry a real z extent, and it is what completes the
 * records that do not.
 */
export function modalSketchThickness(
  records: readonly ElementBoundsRecord[],
  categories: ReadonlySet<number>,
  minimumSpan: number,
): Map<number, number> {
  const spans = new Map<number, Map<number, number>>();
  for (const record of records) {
    const categoryId = record.categoryId;
    if (categoryId == null || !categories.has(categoryId)) continue;
    const span = record.boundsFeet.max.z - record.boundsFeet.min.z;
    if (span <= minimumSpan) continue;
    const key = Math.round(span / THICKNESS_QUANTUM);
    const histogram = spans.get(categoryId) ?? new Map<number, number>();
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
    spans.set(categoryId, histogram);
  }
  const modes = new Map<number, number>();
  for (const [categoryId, histogram] of spans) {
    let total = 0;
    let best = 0;
    let support = 0;
    for (const [key, count] of histogram) {
      total += count;
      if (count > support) {
        support = count;
        best = key;
      }
    }
    if (total < MIN_THICKNESS_SAMPLES) continue;
    if (support / total < MIN_THICKNESS_SUPPORT) continue;
    modes.set(categoryId, best * THICKNESS_QUANTUM);
  }
  return modes;
}

/**
 * Hang a category's own thickness below a record that has none.
 *
 * **Why the thickness goes downward.** These records are hulls over the native
 * faces attributed to the element, and for a sketch-based element exactly one
 * face is attributed — so the hull is a plane, flat in z. That plane is the
 * element's **top**: hanging the category's thickness below it reproduces the
 * paired export's own base elevation to **0.000 ft for 22 of 22** records the
 * rule fires on, where the record as decoded is a zero-thickness sheet 0.171 ft
 * (a ceiling) or 0.656 ft (a floor) short of the exported slab.
 *
 * The two figures come from the file: 0.6562 ft is what 54 of this model's 55
 * floors measure and 0.1706 ft what 21 of its 26 ceilings measure. Nothing is
 * fitted — a model whose floors have several thicknesses fails
 * `MIN_THICKNESS_SUPPORT` and keeps its flat records flat.
 *
 * Only a *synthesised* record is completed. A real duplicated-bounds record that
 * reads flat is the element's own statement about itself and is left alone.
 */
export function completeFlatSketchRecord(
  record: ElementBoundsRecord,
  thickness: number,
  minimumSpan: number,
): boolean {
  if (record.recordOffset >= 0) return false;
  const bounds: Bounds3 = record.boundsFeet;
  if (bounds.max.z - bounds.min.z > minimumSpan) return false;
  record.boundsFeet = {
    min: { x: bounds.min.x, y: bounds.min.y, z: bounds.max.z - thickness },
    max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
  };
  return true;
}
