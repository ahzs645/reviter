/** Original planar Face bit 2 reverses its source surface orientation. This
 * bounded consumer supports that bit on vertical sides only; it never promotes
 * a reversed horizontal plane to walking support or certifies a sewn body. */
import { rational, Rational } from "./native-rational-overlay.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";

export function originalStairPlanarFaceReversal(
  faceFlags: number,
  plane: Revit2027PlaneSurface,
): 1 | -1 | undefined {
  if (![4, 6].includes(faceFlags) || typeof plane.surface.orientFlag !== "boolean" ||
    [...plane.origin, ...plane.xVector, ...plane.yVector].some(v => !Number.isFinite(v))) return undefined;
  if (faceFlags === 4) return 1;
  const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
    sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
    x = plane.xVector.map(rational), y = plane.yVector.map(rational),
    normal = [[1, 2], [2, 0], [0, 1]].map(([i, j]) => sub(mul(x[i!]!, y[j!]!), mul(x[j!]!, y[i!]!)));
  return normal[2]!.n === 0n && normal.some(q => q.n !== 0n) ? -1 : undefined;
}
