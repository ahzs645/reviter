import type { Bounds3, ElementBoundsRecord, Vec3 } from "./types.ts";

/**
 * The orientations a CAD user already has names for.
 *
 * Three faces of a view cube and a separate 3D/Plan switch made the viewer hold
 * the same idea in two places, and neither of them was the vocabulary anyone
 * arrives with. These are the six orthographic views and four isometrics every
 * drawing package names identically.
 */
export type CameraPreset =
  | "top" | "bottom" | "front" | "back" | "left" | "right"
  | "swIso" | "seIso" | "neIso" | "nwIso";

export type NavigationMode = "orbit" | "pan" | "zoom";
export type RenderMode = "technical" | "xray";

/** Menu order and labels, so the studio and the menu cannot disagree. */
export const CAMERA_PRESETS: { preset: CameraPreset; label: string }[] = [
  { preset: "top", label: "Top" },
  { preset: "bottom", label: "Bottom" },
  { preset: "front", label: "Front" },
  { preset: "back", label: "Back" },
  { preset: "left", label: "Left" },
  { preset: "right", label: "Right" },
  { preset: "swIso", label: "SW isometric" },
  { preset: "seIso", label: "SE isometric" },
  { preset: "neIso", label: "NE isometric" },
  { preset: "nwIso", label: "NW isometric" },
];

/** The isometric the viewer opens on, and what Reset returns to. */
export const DEFAULT_CAMERA_PRESET: CameraPreset = "seIso";

export type CameraPose = {
  position: Vec3;
  up: Vec3;
};

/** Unit eye direction per preset, in the model's own z-up frame. */
const PRESET_DIRECTION: Record<CameraPreset, Vec3> = {
  top: { x: 0, y: 0, z: 1 },
  bottom: { x: 0, y: 0, z: -1 },
  front: { x: 0, y: -1, z: 0.06 },
  back: { x: 0, y: 1, z: 0.06 },
  left: { x: -1, y: 0, z: 0.06 },
  right: { x: 1, y: 0, z: 0.06 },
  swIso: { x: -0.62, y: -0.62, z: 0.48 },
  seIso: { x: 0.62, y: -0.62, z: 0.48 },
  neIso: { x: 0.62, y: 0.62, z: 0.48 },
  nwIso: { x: -0.62, y: 0.62, z: 0.48 },
};

/** True when the preset looks straight down an axis, so the camera is planar. */
export function isPlanPreset(preset: CameraPreset): boolean {
  return preset === "top" || preset === "bottom";
}

export function cameraPoseForPreset(
  center: Vec3,
  radius: number,
  preset: CameraPreset,
): CameraPose {
  const distance = Math.max(1, radius) * (isPlanPreset(preset) ? 2.25 : 2.05);
  const direction = PRESET_DIRECTION[preset];
  return {
    position: {
      x: center.x + direction.x * distance,
      y: center.y + direction.y * distance,
      z: center.z + direction.z * distance,
    },
    // Looking straight down an axis leaves "up" undefined along it; north is
    // the convention every plan view uses.
    up: isPlanPreset(preset) ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 },
  };
}

export function solidElementBounds(records: ElementBoundsRecord[]): ElementBoundsRecord[] {
  return records.filter(({ boundsFeet: { min, max } }) =>
    max.x - min.x > 0.001 && max.y - min.y > 0.001 && max.z - min.z > 0.001,
  );
}

export function boundsDimensions(bounds: Bounds3): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
}

/** The only unit conversion between the recovered model and a paired export. */
export const FEET_PER_METRE = 3.280839895;

/**
 * How the paired export is placed into the recovered model's frame.
 *
 * The two are not in different worlds. Both are z-up and both are written
 * around the project's datum; the export is in metres, and the recovered scene
 * is drawn with its own origin subtracted so a building far from the datum
 * still renders near zero. Scale then translate is the whole of it, which is
 * why the two can be shown together at all.
 */
export function referenceRegistration(originFeet: Vec3): { scale: number; offset: Vec3 } {
  return {
    scale: FEET_PER_METRE,
    offset: { x: -originFeet.x, y: -originFeet.y, z: -originFeet.z },
  };
}
