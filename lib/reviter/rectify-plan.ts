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
 * consumer reads; a `ConvertResult` is in Revit's internal FEET. The conversion
 * between the two is a scale AND A TRANSLATION, and assuming it was only a
 * scale is the mistake that cost this file a full round of wrong drawings.
 *
 * `export-ifc.ts` writes tessellated coordinates raw and puts the model's
 * `origin` on the shared placement, so a consumer reading the IFC with world
 * coordinates sees `feet * 0.3048 + origin`. On this model that origin is
 * (-0.46, +87.57, -2.2) m: a hull applied without subtracting it lands 87 m
 * north of the wing it was computed from, claims whatever happens to be there,
 * and squares it — which looks like a working rectification and is not one.
 */
import polygonClipping from "polygon-clipping";
import type { Ring } from "polygon-clipping";

import type { ConvertResult, ElementBoundsRecord, Point3 } from "./types.ts";

const METRES_PER_FOOT = 0.3048;
/** Close enough to count as joined, and how far from the hull a claim may sit.
 * The same two numbers the voxel pipeline uses, so both draw the same recipe. */
const TOUCH_METRES = 0.6;
const REACH_METRES = 6;

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

export type Wing = {
  pivotX: number; pivotY: number;
  cos: number; sin: number;
  shiftX: number; shiftY: number;
  planes: [number, number, number][];
  margin: number;
};

/**
 * Feet, in the model's own frame.
 *
 * `originFeet` is the model's `origin`, which the IFC export puts on the shared
 * placement — so an IFC world coordinate is `feet * 0.3048 + origin` and this
 * has to take it back off. Pass `result.origin`; there is no sensible default,
 * and defaulting it to zero is how the first version came to be wrong.
 */
export function toFeet(
  input: RectifyPlanInput, originFeet: readonly [number, number] = [0, 0],
): Wing[] {
  const margin = (input.hull_margin_m ?? 2.5) / METRES_PER_FOOT;
  const [ox, oy] = originFeet;
  return input.wings.map((wing) => {
    const radians = (wing.rotation_deg * Math.PI) / 180;
    const [shiftX, shiftY] = wing.shift_xy_m ?? [0, 0];
    return {
      pivotX: wing.pivot_xy_m[0] / METRES_PER_FOOT - ox,
      pivotY: wing.pivot_xy_m[1] / METRES_PER_FOOT - oy,
      cos: Math.cos(radians), sin: Math.sin(radians),
      // A shift is a translation: it has no origin term.
      shiftX: shiftX / METRES_PER_FOOT, shiftY: shiftY / METRES_PER_FOOT,
      // `a*x + b*y + c <= margin` in metres, with (a, b) a unit normal. In feet
      // about the model's origin the normal is unchanged and the offset picks
      // up the origin: c/0.3048 + a*ox + b*oy.
      planes: wing.hull_half_planes.map(([a, b, c]) =>
        [a, b, c / METRES_PER_FOOT + a * ox + b * oy] as [number, number, number]),
      margin,
    };
  });
}

export function wingAt(wings: Wing[], x: number, y: number): Wing | null {
  for (const wing of wings) {
    let inside = true;
    for (const [a, b, c] of wing.planes) {
      if (a * x + b * y + c > wing.margin) { inside = false; break; }
    }
    if (inside) return wing;
  }
  return null;
}

export function move(wing: Wing, x: number, y: number): [number, number] {
  const dx = x - wing.pivotX;
  const dy = y - wing.pivotY;
  return [
    wing.pivotX + wing.cos * dx - wing.sin * dy + wing.shiftX,
    wing.pivotY + wing.sin * dx + wing.cos * dy + wing.shiftY,
  ];
}

/**
 * The wing's hull as a polygon, by clipping a very large square against each
 * half-plane in turn. The hull is an intersection of half-planes, so it is
 * convex, and Sutherland-Hodgman is exact for a convex clip region.
 */
function hullRing(wing: Wing, reach = 1e6): Ring {
  let ring: [number, number][] = [
    [-reach, -reach], [reach, -reach], [reach, reach], [-reach, reach],
  ];
  for (const [a, b, c] of wing.planes) {
    const inside = (point: [number, number]) => a * point[0] + b * point[1] + c <= wing.margin;
    const cross = (from: [number, number], to: [number, number]): [number, number] => {
      const fromValue = a * from[0] + b * from[1] + c - wing.margin;
      const toValue = a * to[0] + b * to[1] + c - wing.margin;
      const t = fromValue / (fromValue - toValue);
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    };
    const out: [number, number][] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const from = ring[index]!;
      const to = ring[(index + 1) % ring.length]!;
      const fromIn = inside(from);
      const toIn = inside(to);
      if (fromIn) out.push(from);
      if (fromIn !== toIn) out.push(cross(from, to));
    }
    ring = out;
    if (!ring.length) break;
  }
  return [...ring, ring[0]!].filter(Boolean) as Ring;
}

/** An element's plan box, from whatever geometry the plan draws it by. */
function planBox(record: ElementBoundsRecord): [number, number, number, number] | null {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const solid of record.solids ?? (record.solid ? [record.solid] : [])) {
    eat(solid.start.x, solid.start.y);
    eat(solid.end.x, solid.end.y);
  }
  for (const point of record.orientedBox ?? []) eat(point[0], point[1]);
  for (const loop of record.loops ?? []) for (const point of loop) eat(point[0], point[1]);
  if (!Number.isFinite(minX) && record.boundsFeet) {
    eat(record.boundsFeet.min.x, record.boundsFeet.min.y);
    eat(record.boundsFeet.max.x, record.boundsFeet.max.y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/**
 * Elements the hull missed that are JOINED to elements it claimed.
 *
 * A wing's hull is the convex hull of its WALL placements, and a curtain wall
 * is not a wall: panels and mullions are their own elements hanging on the
 * facade. Audited floor by floor, the wall behind the glazing rotates and the
 * glazing stays, and that is 409 of 605 findings.
 *
 * Two bounds keep the claim from becoming a second, sloppier hull. An element
 * must TOUCH something already claimed, and ALL of it must sit within
 * `reachFeet` of the hull — the farthest corner, not the nearest, because
 * contact is tested on boxes and a forty-foot corridor wall that reaches the
 * wing at one end touches it by its box too. Claimed, the whole corridor would
 * swing away with the wing.
 */
export function contactClaims(
  records: readonly ElementBoundsRecord[], wings: Wing[],
  seeded: ReadonlyMap<number, Wing>, touchFeet: number, reachFeet: number, rounds = 3,
): Map<number, Wing> {
  const boxes = new Map<number, [number, number, number, number]>();
  for (const record of records) {
    const box = planBox(record);
    if (box) boxes.set(record.elementId, box);
  }
  const wholeBoxSlack = (box: [number, number, number, number]) => {
    let best = Infinity;
    for (const wing of wings) {
      let worst = -Infinity;
      for (const [a, b, c] of wing.planes) {
        let corner = -Infinity;
        for (const x of [box[0], box[2]]) {
          for (const y of [box[1], box[3]]) corner = Math.max(corner, a * x + b * y);
        }
        worst = Math.max(worst, corner + c);
      }
      best = Math.min(best, worst - wing.margin);
    }
    return best;
  };
  const candidates = new Map<number, [number, number, number, number]>();
  for (const [id, box] of boxes) {
    if (!seeded.has(id) && wholeBoxSlack(box) <= reachFeet) candidates.set(id, box);
  }
  const touches = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] - touchFeet <= b[2] && b[0] - touchFeet <= a[2]
    && a[1] - touchFeet <= b[3] && b[1] - touchFeet <= a[3];

  const claims = new Map<number, Wing>();
  let frontier = seeded;
  for (let round = 0; round < rounds && frontier.size && candidates.size; round += 1) {
    const won = new Map<number, Wing>();
    for (const [id, box] of candidates) {
      for (const [other, wing] of frontier) {
        const otherBox = boxes.get(other);
        if (otherBox && touches(box, otherBox)) { won.set(id, wing); break; }
      }
    }
    if (!won.size) break;
    for (const [id, wing] of won) { claims.set(id, wing); candidates.delete(id); }
    frontier = won;
  }
  return claims;
}

/** The plan point a whole-element assignment is decided from. */
export function planCentre(record: ElementBoundsRecord): [number, number] | null {
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
  /** Element ids a wing moved, so an audit can ask what was left behind. */
  movedIds: Set<number>;
  /** Elements the hull missed and contact claimed. */
  contactClaims: number;
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
): { result: ConvertResult; report: RectifyPlanReport } {
  const wings = toFeet(input, [result.origin?.x ?? 0, result.origin?.y ?? 0]);
  const report: RectifyPlanReport = {
    wings: wings.length, records: result.elementBounds.length, moved: 0, straddling: 0,
    movedIds: new Set<number>(), contactClaims: 0,
  };
  if (!wings.length) return { result, report };

  // Seed on the plan centre, then claim by contact what the hull did not reach.
  const seeded = new Map<number, Wing>();
  for (const record of result.elementBounds) {
    const centre = planCentre(record);
    if (!centre) continue;
    const wing = wingAt(wings, centre[0], centre[1]);
    if (wing) seeded.set(record.elementId, wing);
  }
  const claimed = contactClaims(
    result.elementBounds, wings, seeded,
    TOUCH_METRES / METRES_PER_FOOT, REACH_METRES / METRES_PER_FOOT);
  report.contactClaims = claimed.size;

  const elementBounds = result.elementBounds.map((record) => {
    const centre = planCentre(record);
    if (!centre) return record;
    const whole = wingAt(wings, centre[0], centre[1]) ?? claimed.get(record.elementId) ?? null;
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
    /**
     * Split a closed ring at the wing edges and move only the pieces inside.
     *
     * Relocating some of a ring's VERTICES does not cut it — the ring is still
     * one closed polygon, so it draws as the old shape with two long spikes
     * reaching across the building to wherever the moved vertices went. That is
     * what the first drawing showed, and it looked like a defect in the
     * rectification rather than in this. A ring has to be split into rings.
     */
    const splitRing = (points: readonly Point3[]): Point3[][] => {
      const z = points[0]?.[2] ?? 0;
      const closed: Ring = [...points.map((point) => [point[0], point[1]] as [number, number])];
      if (closed.length && (closed[0]![0] !== closed.at(-1)![0]
        || closed[0]![1] !== closed.at(-1)![1])) closed.push(closed[0]!);
      let rest: [number, number][][][] = [[closed]];
      const out: Point3[][] = [];
      for (const wing of wings) {
        if (!rest.length) break;
        const hull = [[hullRing(wing)]] as [number, number][][][];
        const inside = polygonClipping.intersection(rest as never, hull as never);
        for (const polygon of inside) {
          for (const ring of polygon) {
            inCount += ring.length;
            out.push(ring.map(([x, y]) => {
              const [mx, my] = move(wing, x, y);
              return [mx, my, z] as Point3;
            }));
          }
        }
        rest = polygonClipping.difference(rest as never, hull as never) as never;
      }
      for (const polygon of rest) {
        for (const ring of polygon) {
          outCount += ring.length;
          out.push(ring.map(([x, y]) => [x, y, z] as Point3));
        }
      }
      return out.length ? out : [rigidPoints(points)];
    };

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
    if (record.loops?.length) {
      next.loops = assignment === "element"
        ? record.loops.map(rigidPoints)
        : record.loops.flatMap(splitRing);
    }
    // A rail path is an open polyline, not a ring, so a per-point move is a
    // cut already: the run simply jumps where it crosses the wing edge.
    if (record.railPath?.polylines.length) {
      next.railPath = { ...record.railPath, polylines: record.railPath.polylines.map(rigidPoints) };
    }
    if (record.boundsFeet && whole) {
      const [minX, minY] = move(whole, record.boundsFeet.min.x, record.boundsFeet.min.y);
      const [maxX, maxY] = move(whole, record.boundsFeet.max.x, record.boundsFeet.max.y);
      next.boundsFeet = {
        min: { x: Math.min(minX, maxX), y: Math.min(minY, maxY), z: record.boundsFeet.min.z },
        max: { x: Math.max(minX, maxX), y: Math.max(minY, maxY), z: record.boundsFeet.max.z },
      };
    }

    if (inCount) { report.moved += 1; report.movedIds.add(record.elementId); }
    if (inCount && outCount) report.straddling += 1;
    return inCount ? next : record;
  });

  return { result: { ...result, elementBounds }, report };
}
