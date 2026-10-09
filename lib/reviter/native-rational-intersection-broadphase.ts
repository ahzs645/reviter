import {
  rational,
  type Rational,
  type NativeRationalOverlayInput,
} from "./native-rational-overlay.ts";

type Ring = NativeRationalOverlayInput[number][number];
type Box = { minX: Rational; maxX: Rational; minY: Rational; maxY: Rational };
const frozenBounds = new WeakMap<Ring, Box>();
// Integer cross-products preserve every rational bit without constructing or
// reducing an intermediate fraction, and never convert a bound to IEEE.
const compare = (a: Rational, b: Rational): number => {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
};
function bounds(ring: Ring): Box | undefined {
  if (!ring.length) return;
  const saved = frozenBounds.get(ring);
  if (saved) return saved;
  let minX = rational(ring[0]![0]),
    maxX = minX;
  let minY = rational(ring[0]![1]),
    maxY = minY;
  for (const point of ring) {
    const x = rational(point[0]),
      y = rational(point[1]);
    if (compare(x, minX) < 0) minX = x;
    if (compare(x, maxX) > 0) maxX = x;
    if (compare(y, minY) < 0) minY = y;
    if (compare(y, maxY) > 0) maxY = y;
  }
  const box = { minX, maxX, minY, maxY };
  // A frozen array alone does not make its coordinate payload immutable.
  if (
    Object.isFrozen(ring) &&
    ring.every(
      (point) =>
        Object.isFrozen(point) &&
        point.every(
          (value) => typeof value === "number" || Object.isFrozen(value),
        ),
    )
  ) {
    frozenBounds.set(ring, box);
  }
  return box;
}
const disjoint = (a: Box, b: Box): boolean =>
  compare(a.maxX, b.minX) < 0 ||
  compare(b.maxX, a.minX) < 0 ||
  compare(a.maxY, b.minY) < 0 ||
  compare(b.maxY, a.minY) < 0;

/** Localize only an intersection operand. Components and holes are omitted
 * only when their exact bounds are strictly disjoint from EVERY subject shell.
 * Touching bounds remain. Retained rings are the original references/bytes;
 * this is not clipping, simplification or a source-geometry mutation. The
 * ordinary exact overlay must still perform the resulting intersection.
 * Inputs must be valid polygons (as required by the exact overlay itself).
 */
export function nativeRationalIntersectionOperand(
  subject: NativeRationalOverlayInput,
  operand: NativeRationalOverlayInput,
): NativeRationalOverlayInput {
  const shells = subject.map((part) => (part[0] ? bounds(part[0]) : undefined));
  // Unknown/empty shells cannot prove disjointness; defer them to the kernel.
  if (!shells.length || shells.some((box) => !box)) return operand;
  const outside = (ring: Ring): boolean => {
    const box = bounds(ring);
    return !!box && shells.every((shell) => disjoint(box, shell!));
  };
  const selected: NativeRationalOverlayInput = [];
  for (const part of operand) {
    if (!part[0] || outside(part[0])) {
      if (!part[0]) selected.push(part);
      continue;
    }
    const holes = part.slice(1).filter((hole) => !outside(hole));
    selected.push(
      holes.length === part.length - 1 ? part : [part[0], ...holes],
    );
  }
  return selected;
}
