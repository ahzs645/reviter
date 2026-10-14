/** Optional IFC-only pipe reconstruction from measured native parameters.
 * This is a swept parameter reconstruction, never a certified native BRep. */
import { hypot } from "./deterministic-math.ts";
import type { NativeMepDimensions } from "./native-mep.ts";
import { pipeAxisFromBounds } from "./native-mep-dimensions.ts";

type Point = [number, number, number];
type Vec3 = { x: number; y: number; z: number };
type Writer = { add(expression: string): number };
export type NativePipeShapeContext = {
  bodyContext: number;
  /** Must identify the native PipeCurves category, not an IFC override. */
  categoryId: number | null;
  categorySource?: string;
  extrusionDirection?: number;
  styleId?: number;
  origin: Vec3;
  expectedBounds: { min: Vec3; max: Vec3 };
};
export type NativePipeShape = {
  shapeId: number;
  source: "native-connector-axis-and-pipe-diameters";
  provenance: "reconstructed";
  geometryExact: false;
  profileKind: "hollow-circle";
  lengthFeet: number;
  innerDiameterFeet: number;
  outerDiameterFeet: number;
};
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const real = (value: number): string => {
  const text = String(value === 0 ? 0 : value), [mantissa, exponent] = text.toUpperCase().split("E");
  return `${mantissa!.includes(".") ? mantissa : `${mantissa}.`}${exponent == null ? "" : `E${exponent}`}`;
};
const metric = (value: number) => real(value * .3048);

/** Returns null without writing entities when source gates or six-face bounds
 * checks fail. The caller decides whether an existing body may be replaced. */
export function emitNativePipeShape(writer: Writer, dimensions: NativeMepDimensions, context: NativePipeShapeContext): NativePipeShape | null {
  const axis = dimensions.pipeAxis, inner = dimensions.pipeInnerDiameterFeet, outer = dimensions.pipeOuterDiameterFeet;
  if (context.categoryId !== -2008044 || !["element-header", "native-token", "native-object"].includes(context.categorySource ?? "") || !Number.isSafeInteger(context.bodyContext) || context.bodyContext <= 0 || !axis || inner == null || outer == null) return null;
  if (!dimensions.sources.some((s) => s.decoder === "RE-131" && s.revitVersion === 2025) || !dimensions.sources.some((s) => s.decoder === "RE-157" && s.revitVersion === 2025)) return null;
  const { min, max } = context.expectedBounds;
  const box: [number, number, number, number, number, number] = [min.x, min.y, min.z, max.x, max.y, max.z];
  if (![...box, ...axis.startFeet, ...axis.endFeet, ...Object.values(context.origin), axis.radiusFeet, inner, outer].every((v) => Number.isFinite(v) && Math.abs(v) < 1e8)) return null;
  if (!(inner > 0 && inner < outer && outer < 10 && axis.radiusFeet > 0) || Math.abs(outer / 2 - axis.radiusFeet) > .002) return null;
  const proven = pipeAxisFromBounds(box, axis.startFeet, axis.endFeet);
  if (!proven || Math.abs(proven.radiusFeet - outer / 2) > .002 || Math.abs(proven.radiusFeet - axis.radiusFeet) > .002) return null;
  const start = axis.startFeet, end = axis.endFeet, delta: Point = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length = hypot(...delta);
  if (length < .001 || (dimensions.lengthFeet != null && (!Number.isFinite(dimensions.lengthFeet) || Math.abs(dimensions.lengthFeet - length) > .002))) return null;
  const z: Point = delta.map((v) => v / length) as Point;
  const least = z.reduce((best, v, k) => Math.abs(v) < Math.abs(z[best]!) ? k : best, 0);
  const reference: Point = [0, 0, 0]; reference[least] = 1;
  const perpendicular = cross(reference, z), norm = hypot(...perpendicular);
  if (norm < .1) return null;
  const x: Point = perpendicular.map((v) => v / norm) as Point;
  const outerRadius = outer / 2;
  const wallThickness = (outer - inner) / 2;
  if (!(wallThickness > 0 && wallThickness < outerRadius && wallThickness * .3048 > 0 && outerRadius * .3048 > 0)) return null;
  // Recheck using the radius actually emitted, rather than only the stored axis.
  for (let k = 0; k < 3; k++) {
    const centre = (start[k]! + end[k]!) / 2;
    const half = Math.abs(delta[k]!) / 2 + outerRadius * Math.sqrt(Math.max(0, 1 - z[k]! * z[k]!));
    if (Math.abs(centre - half - box[k]!) > .002 || Math.abs(centre + half - box[k + 3]!) > .002) return null;
  }
  if (context.extrusionDirection != null && (!Number.isSafeInteger(context.extrusionDirection) || context.extrusionDirection <= 0)) return null;
  if (context.styleId != null && (!Number.isSafeInteger(context.styleId) || context.styleId <= 0)) return null;
  const profileOrigin = writer.add("IFCCARTESIANPOINT((0.,0.))");
  const profilePosition = writer.add(`IFCAXIS2PLACEMENT2D(#${profileOrigin},$)`);
  const profile = writer.add(`IFCCIRCLEHOLLOWPROFILEDEF(.AREA.,$,#${profilePosition},${metric(outerRadius)},${metric(wallThickness)})`);
  const point = writer.add(`IFCCARTESIANPOINT((${metric(start[0] - context.origin.x)},${metric(start[1] - context.origin.y)},${metric(start[2] - context.origin.z)}))`);
  const direction = writer.add(`IFCDIRECTION((${z.map(real).join(",")}))`);
  const referenceDirection = writer.add(`IFCDIRECTION((${x.map(real).join(",")}))`);
  const placement = writer.add(`IFCAXIS2PLACEMENT3D(#${point},#${direction},#${referenceDirection})`);
  const extrusion = context.extrusionDirection ?? writer.add("IFCDIRECTION((0.,0.,1.))");
  const solid = writer.add(`IFCEXTRUDEDAREASOLID(#${profile},#${placement},#${extrusion},${metric(length)})`);
  if (context.styleId) writer.add(`IFCSTYLEDITEM(#${solid},(#${context.styleId}),$)`);
  const representation = writer.add(`IFCSHAPEREPRESENTATION(#${context.bodyContext},'Body','SweptSolid',(#${solid}))`);
  const shapeId = writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
  return { shapeId, source: "native-connector-axis-and-pipe-diameters", provenance: "reconstructed", geometryExact: false, profileKind: "hollow-circle", lengthFeet: length, innerDiameterFeet: inner, outerDiameterFeet: outer };
}
