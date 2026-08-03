import type { NavigationMode } from "../../lib/reviter";
import type { GeometrySource } from "./types.ts";

/**
 * How the camera is being driven. Exactly one of these is always in force.
 */
export type NavigationTool = NavigationMode | "firstPerson";

/**
 * What a click does, over and above navigating. At most one is armed, and it is
 * held separately from the navigation tool: reviewing a building means walking
 * it *and* commenting on it, and a single `activeTool` made those two things
 * take turns — arming Comment dropped you out of first person, which is exactly
 * where the comment needed to be placed from.
 */
export type ActionTool =
  | "measure"
  | "section"
  | "explode"
  /** Pin a 3D comment on the next surface that is clicked. */
  | "comment"
  /** Draw annotation anchored in the model's own space. */
  | "markup";

export type ViewerTool = NavigationTool | ActionTool;

export const NAVIGATION_TOOLS: readonly NavigationTool[] = ["orbit", "pan", "zoom", "firstPerson"];

/**
 * The three comparable model representations, in their keyboard order while
 * walking. Overlay is intentionally omitted: it is an audit view rather than
 * a source a reviewer can walk on its own.
 */
export const WALK_COMPARISON_SOURCES = [
  { source: "recovered", key: "1", code: "Digit1", label: "RVT" },
  { source: "reference", key: "2", code: "Digit2", label: "IFC" },
  { source: "reference-model", key: "3", code: "Digit3", label: "Autodesk GLB" },
] as const satisfies readonly {
  source: GeometrySource;
  key: string;
  code: string;
  label: string;
}[];

export type WalkComparisonSource = typeof WALK_COMPARISON_SOURCES[number]["source"];

/** Resolve a physical number-row key without making keyboard layout assumptions. */
export function walkComparisonSourceForCode(code: string): WalkComparisonSource | null {
  return WALK_COMPARISON_SOURCES.find((entry) => entry.code === code)?.source ?? null;
}

export function isNavigationTool(tool: ViewerTool): tool is NavigationTool {
  return (NAVIGATION_TOOLS as readonly string[]).includes(tool);
}

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

/**
 * Choose a stable First Person start on a selected reconstructed stair.
 *
 * A sky-down probe through a stair can hit the roof over it first. Native
 * tread quads already carry the precise walkable elevations, so use the centre
 * cell of the lowest tread band as a narrow fallback when no explicit
 * double-click or “Walk from here” point was supplied.
 */
export function selectedStairWalkStart(
  treads: readonly (readonly Point3Tuple[])[],
  source: GeometrySource,
  originFeet: Point3Tuple,
): Point3Tuple | undefined {
  const valid = treads.filter((tread) =>
    tread.length >= 4 &&
    tread.slice(0, 4).every((point) =>
      point.length === 3 && point.every(Number.isFinite)),
  );
  if (!valid.length) return undefined;
  const minimumElevation = Math.min(...valid.map((tread) => tread[0]![2]));
  const lowest = valid.filter((tread) =>
    Math.abs(tread[0]![2] - minimumElevation) <= 1e-4);
  const tread = lowest[Math.floor(lowest.length / 2)]!;
  const centre = tread.slice(0, 4).reduce<Point3Tuple>(
    (sum, point) => [
      sum[0] + point[0] / 4,
      sum[1] + point[1] / 4,
      sum[2] + point[2] / 4,
    ],
    [0, 0, 0],
  );
  return modelFeetToScenePoint(centre, source, originFeet);
}

export function navigationModeForTool(tool: NavigationTool): NavigationMode {
  return tool === "pan" || tool === "zoom" ? tool : "orbit";
}

/**
 * A stroke of markup, anchored in the model rather than on the glass.
 *
 * Markup used to be normalised screen coordinates in a 0–1000 viewBox, so it
 * stayed where it was drawn on the *display*: take one step and the cloud you
 * put round a door was over a window. Every point here is a scene position on
 * the stroke's own plane — set at the depth of whatever the first point landed
 * on, facing the camera that drew it — so the annotation belongs to the space
 * and is re-projected from wherever you look at it next.
 */
export type MarkupStroke = {
  id: string;
  source: GeometrySource;
  tool: Exclude<MarkupTool, "delete">;
  /** Anchors in the source's rendered scene coordinates. */
  points: Point3Tuple[];
  /** Canonical Revit/IFC anchors in feet, when the source can be registered. */
  pointsFeet?: Point3Tuple[];
  color: string;
  /**
   * Stroke width as a length in scene units, not pixels: the redline is a thing
   * in the room, so it grows as you walk up to it.
   */
  worldWeight: number;
  text?: string;
  createdAt: string;
};

export type NewMarkupStroke = Omit<MarkupStroke, "id" | "createdAt">;

/**
 * One reversible change to the markup on a model.
 *
 * `index` is where the stroke sat, so undoing a delete puts it back in order
 * rather than on the end — which matters once strokes overlap and the later one
 * draws on top.
 */
export type MarkupEdit =
  | { kind: "add"; stroke: MarkupStroke; index: number }
  | { kind: "delete"; stroke: MarkupStroke; index: number }
  | { kind: "clear"; strokes: MarkupStroke[]; index: number };

/**
 * Scene units covered by one screen pixel at `distance` from the camera.
 *
 * The one conversion both ends of the markup pipeline need: drawing turns a
 * pixel width into a world width with it, and rendering turns that world width
 * back into pixels from wherever the camera is now.
 */
export function sceneUnitsPerPixel(distance: number, fovDegrees: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return (2 * Math.abs(distance) * Math.tan((fovDegrees * Math.PI) / 360)) / viewportHeight;
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
