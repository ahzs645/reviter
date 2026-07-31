import type { NavigationMode } from "../../lib/reviter";
import type { GeometrySource } from "./types.ts";

export type ViewerTool =
  | NavigationMode
  | "firstPerson"
  | "measure"
  | "section"
  | "explode"
  /** Pin a 3D comment on the next surface that is clicked. */
  | "comment"
  /** Draw 2D annotation over the viewport. */
  | "markup";

export type MeasureMode = "distance" | "angle" | "calibrate" | "coordinates" | "laser";
export type MeasureUnit = "feet" | "metres";
export type SectionMode = "x" | "y" | "z" | "box";
/**
 * Markup is 2D annotation only. Pinning a 3D comment used to be one of these,
 * which meant the Comment tool raised the whole drawing toolbar alongside the
 * comment banner — two controls for the same act, stacked over the model.
 */
export type MarkupTool = "pencil" | "arrow" | "cloud" | "text" | "delete";
export type Point3Tuple = [number, number, number];

export type ModelViewpoint = {
  source: GeometrySource;
  position: Point3Tuple;
  target: Point3Tuple;
  up: Point3Tuple;
  fov: number;
};

export type ModelComment = {
  id: string;
  source: GeometrySource;
  /** Anchor in the source's rendered scene coordinates. */
  scenePosition: Point3Tuple;
  /** Canonical Revit/IFC point in feet when the source can be registered. */
  modelPositionFeet?: Point3Tuple;
  /**
   * The object the pin landed on, when the pick carried one. It is what lets a
   * comment row say "Curtain Panel 291044" instead of a coordinate; comments
   * saved before this existed simply have no target and say so.
   */
  elementId?: number;
  text: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
  viewpoint: ModelViewpoint;
};

export type NewModelComment = Omit<
  ModelComment,
  "id" | "text" | "status" | "createdAt" | "updatedAt"
>;

export function scenePointToModelFeet(
  point: Point3Tuple,
  source: GeometrySource,
  originFeet: Point3Tuple,
): Point3Tuple | undefined {
  if (source === "reference-model") return undefined;
  if (source === "reference") return point.map((value) => value / 0.3048) as Point3Tuple;
  return point.map((value, axis) => value + originFeet[axis]!) as Point3Tuple;
}

export function modelFeetToScenePoint(
  pointFeet: Point3Tuple,
  source: GeometrySource,
  originFeet: Point3Tuple,
): Point3Tuple | undefined {
  if (source === "reference-model") return undefined;
  if (source === "reference") return pointFeet.map((value) => value * 0.3048) as Point3Tuple;
  return pointFeet.map((value, axis) => value - originFeet[axis]!) as Point3Tuple;
}

export function navigationModeForTool(tool: ViewerTool): NavigationMode {
  return tool === "pan" || tool === "zoom" ? tool : "orbit";
}

export function formatMeasuredLength(feet: number, unit: MeasureUnit, calibration = 1): string {
  const calibratedFeet = feet * calibration;
  return unit === "metres"
    ? `${(calibratedFeet * 0.3048).toFixed(3)} m`
    : `${calibratedFeet.toFixed(3)} ft`;
}

export function measuredAngleDegrees(
  a: { x: number; y: number; z: number },
  vertex: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): number {
  const first = { x: a.x - vertex.x, y: a.y - vertex.y, z: a.z - vertex.z };
  const second = { x: c.x - vertex.x, y: c.y - vertex.y, z: c.z - vertex.z };
  const firstLength = Math.hypot(first.x, first.y, first.z);
  const secondLength = Math.hypot(second.x, second.y, second.z);
  if (!firstLength || !secondLength) return 0;
  const cosine = Math.max(-1, Math.min(1,
    (first.x * second.x + first.y * second.y + first.z * second.z) / (firstLength * secondLength),
  ));
  return Math.acos(cosine) * 180 / Math.PI;
}
