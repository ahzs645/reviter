/**
 * Apply a voxel pipeline's plan-rectification transforms to a recovered model,
 * so this project's own floor plan can draw what they do.
 *
 * The consumer downstream of this decoder squares off-grid wings before it
 * voxelizes: whole rigid sections of the building — a 32 degree annex, a 58
 * degree one — rotate onto the world grid about their seam with the spine.
 * That is a large, visible edit to the building, and until now the only way to
 * look at it was the consumer's own stick diagram of wall footprints. This
 * takes the transforms it publishes and applies them to a `ConvertResult`, so
 * `makeArchitecturalFloorSvg` draws the rectified building the same way it
 * draws any other: real wall poché, door swings, floor sketch boundaries.
 *
 * The transforms arrive in METRES, because that is the unit of the IFC the
 * consumer reads; a `ConvertResult` is in Revit's internal FEET. The only
 * conversion between the two is a scale, so a pivot divides by 0.3048 and an
 * angle is an angle.
 */
import type { ConvertResult, ElementBoundsRecord, Point3 } from "./types.ts";

const METRES_PER_FOOT = 0.3048;

/** One wing, exactly as the consumer publishes it. */
export type WingTransform = {
  rotation_deg: number;
  pivot_xy_m: [number, number];
  shift_xy_m?: [number, number];
  /** Half-planes `a*x + b*y + c <= margin`, in metres, that define the wing. */
  hull_half_planes: [number, number, number][];
};

export type RectifyPlanInput = {
  wings: WingTransform[];
  /** Slack on the hull test, in metres. Elements straddle the hull edge. */
  hull_margin_m?: number;
};

type Wing = {
  pivotX: number; pivotY: number;
  cos: number; sin: number;
  shiftX: number; shiftY: number;
  planes: [number, number, number][];
  margin: number;
};

/** Feet, since that is the frame every record is already in. */
function toFeet(input: RectifyPlanInput): Wing[] {
  const margin = (input.hull_margin_m ?? 2.5) / METRES_PER_FOOT;
  return input.wings.map((wing) => {
    const radians = (wing.rotation_deg * Math.PI) / 180;
    const [shiftX, shiftY] = wing.shift_xy_m ?? [0, 0];
    return {
      pivotX: wing.pivot_xy_m[0] / METRES_PER_FOOT,
      pivotY: wing.pivot_xy_m[1] / METRES_PER_FOOT,
      cos: Math.cos(radians), sin: Math.sin(radians),
      shiftX: shiftX / METRES_PER_FOOT, shiftY: shiftY / METRES_PER_FOOT,
      // c divides too: the plane is a*x + b*y + c <= margin with (a, b) a unit
      // normal, so c and the margin are both lengths.
      planes: wing.hull_half_planes.map(([a, b, c]) =>
        [a, b, c / METRES_PER_FOOT] as [number, number, number]),
      margin,
    };
  });
}

function wingAt(wings: Wing[], x: number, y: number): Wing | null {
  for (const wing of wings) {
    let inside = true;
    for (const [a, b, c] of wing.planes) {
      if (a * x + b * y + c > wing.margin) { inside = false; break; }
    }
    if (inside) return wing;
  }
  return null;
}

function move(wing: Wing, x: number, y: number): [number, number] {
  const dx = x - wing.pivotX;
  const dy = y - wing.pivotY;
  return [
    wing.pivotX + wing.cos * dx - wing.sin * dy + wing.shiftX,
    wing.pivotY + wing.sin * dx + wing.cos * dy + wing.shiftY,
  ];
}

/**
 * Densify a ring so a per-point transform cuts it at the hull instead of
 * shearing it.
 *
 * A rigid motion applied to a REGION has to cut whatever crosses the region's
 * boundary. The consumer does that on its triangles; a plan's polygons need the
 * same treatment, or a floor slab spanning the seam is drawn as one long
 * diagonal from a corner that moved to a corner that did not.
 */
function densify(ring: readonly Point3[], step: number): Point3[] {
  const out: Point3[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[(index + 1) % ring.length]!;
    out.push(from);
    const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const pieces = Math.floor(span / step);
    for (let piece = 1; piece < pieces; piece += 1) {
      const t = piece / pieces;
      out.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]);
    }
  }
  return out;
}

function movePoints<T extends readonly [number, number, number]>(
  points: readonly T[], wings: Wing[],
): T[] {
  return points.map((point) => {
    const wing = wingAt(wings, point[0], point[1]);
    if (!wing) return point as unknown as T;
    const [x, y] = move(wing, point[0], point[1]);
    return [x, y, point[2]] as unknown as T;
  });
}

/** The plan point a whole-element assignment is decided from. */
function planCentre(record: ElementBoundsRecord): [number, number] | null {
  // A wall's location line first: it is the thing the plan actually draws, and
  // a wall's axis-aligned box can sit well off the wall when the run is long
  // and diagonal.
  const solid = record.solid ?? record.solids?.[0];
  if (solid) return [(solid.start.x + solid.end.x) / 2, (solid.start.y + solid.end.y) / 2];
  const arc = record.arcs?.[0];
  if (arc) return [arc.centre.x, arc.centre.y];
  const points = record.orientedBox ?? record.loops?.[0];
  if (points?.length) {
    let x = 0; let y = 0;
    for (const point of points) { x += point[0]!; y += point[1]!; }
    return [x / points.length, y / points.length];
  }
  const box = record.boundsFeet;
  if (!box) return null;
  return [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2];
}

export type RectifyPlanReport = {
  wings: number;
  records: number;
  /** Records with at least one point inside a wing. */
  moved: number;
  /** Records with points on BOTH sides — the ones the seam runs through. */
  straddling: number;
};

export type Assignment =
  /** Sketch boundaries are cut at the wing edge; everything else moves whole.
   * A floor plate spans the wing and the spine and has to be cut where the
   * wing ends; a wall is one small thing and half a wall is not a wall. */
  | "mixed"
  /** Everything moves whole, sketch boundaries included. */
  | "element";

/**
 * A COPY of the model with every plan-drawable coordinate rewritten.
 *
 * A new object, not a mutation, and that is not a style preference:
 * `architectural-plan.ts` caches records and finished SVGs in WeakMaps keyed on
 * the `ConvertResult` and on its `elementBounds` array. Rewriting coordinates
 * in place therefore draws the plan it drew before — the first run of this
 * produced a "before" and an "after" that were byte-identical.
 *
 * What moves is exactly what the plan reads: `solid` and `solids` (a wall is
 * drawn from its location line and joined end corners, NOT from its box —
 * missing these was why the first drawing moved the floors and left every wall
 * standing where it was), `arcs`, `orientedBox`, `stairTreads`, `loops`,
 * `railPath`, and the axis-aligned `boundsFeet` the plan falls back to. Meshes
 * are shared with the original untouched: this is a drawing of the rectified
 * building, not a rectified model.
 */
export function rectifyForPlan(
  result: ConvertResult,
  input: RectifyPlanInput,
  assignment: Assignment = "mixed",
  densifyFeet = 2,
): { result: ConvertResult; report: RectifyPlanReport } {
  const wings = toFeet(input);
  const report: RectifyPlanReport = {
    wings: wings.length, records: result.elementBounds.length, moved: 0, straddling: 0,
  };
  if (!wings.length) return { result, report };

  const elementBounds = result.elementBounds.map((record) => {
    const centre = planCentre(record);
    if (!centre) return record;
    const whole = wingAt(wings, centre[0], centre[1]);
    let inCount = whole ? 1 : 0;
    let outCount = whole ? 0 : 1;

    const rigid = (x: number, y: number): [number, number] =>
      whole ? move(whole, x, y) : [x, y];
    const rigidXY = <T extends { x: number; y: number }>(point: T): T => {
      const [x, y] = rigid(point.x, point.y);
      return { ...point, x, y };
    };
    /** A direction rotates but does not translate. */
    const spin = <T extends { x: number; y: number }>(direction: T): T => {
      if (!whole) return direction;
      return {
        ...direction,
        x: whole.cos * direction.x - whole.sin * direction.y,
        y: whole.sin * direction.x + whole.cos * direction.y,
      };
    };
    const rigidPoints = (points: readonly Point3[]): Point3[] =>
      points.map((point) => {
        const [x, y] = rigid(point[0], point[1]);
        return [x, y, point[2]] as Point3;
      });
    const cutPoints = (points: readonly Point3[]): Point3[] => {
      for (const point of points) {
        if (wingAt(wings, point[0], point[1])) inCount += 1; else outCount += 1;
      }
      return movePoints(densify(points, densifyFeet), wings);
    };
    const ring = assignment === "element" ? rigidPoints : cutPoints;

    const next: ElementBoundsRecord = { ...record };
    const moveSolid = (solid: NonNullable<ElementBoundsRecord["solid"]>) => ({
      ...solid,
      start: rigidXY(solid.start),
      end: rigidXY(solid.end),
      startCorners: solid.startCorners?.map(rigidXY) as typeof solid.startCorners,
      endCorners: solid.endCorners?.map(rigidXY) as typeof solid.endCorners,
    });
    if (record.solid) next.solid = moveSolid(record.solid);
    if (record.solids?.length) next.solids = record.solids.map(moveSolid);
    if (record.arcs?.length) {
      next.arcs = record.arcs.map((arc) => ({
        ...arc, centre: rigidXY(arc.centre), xDir: spin(arc.xDir), yDir: spin(arc.yDir),
      }));
    }
    if (record.orientedBox?.length) {
      next.orientedBox = rigidPoints(record.orientedBox) as [number, number, number][];
    }
    if (record.stairTreads?.length) {
      next.stairTreads = record.stairTreads.map((tread) =>
        rigidPoints(tread) as [Point3, Point3, Point3, Point3]);
    }
    if (record.loops?.length) next.loops = record.loops.map(ring);
    if (record.railPath?.polylines.length) {
      next.railPath = { ...record.railPath, polylines: record.railPath.polylines.map(ring) };
    }
    if (record.boundsFeet && whole) {
      const [minX, minY] = move(whole, record.boundsFeet.min.x, record.boundsFeet.min.y);
      const [maxX, maxY] = move(whole, record.boundsFeet.max.x, record.boundsFeet.max.y);
      next.boundsFeet = {
        min: { x: Math.min(minX, maxX), y: Math.min(minY, maxY), z: record.boundsFeet.min.z },
        max: { x: Math.max(minX, maxX), y: Math.max(minY, maxY), z: record.boundsFeet.max.z },
      };
    }

    if (inCount) report.moved += 1;
    if (inCount && outCount) report.straddling += 1;
    return inCount ? next : record;
  });

  return { result: { ...result, elementBounds }, report };
}
