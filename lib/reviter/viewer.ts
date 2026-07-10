import type { Bounds3, ElementBoundsRecord, Vec3 } from "./types";

export type CameraPreset = "home" | "top" | "front" | "right";
export type NavigationMode = "orbit" | "pan" | "zoom";
export type RenderMode = "technical" | "xray";

export type CameraPose = {
  position: Vec3;
  up: Vec3;
};

export function cameraPoseForPreset(
  center: Vec3,
  radius: number,
  preset: CameraPreset,
): CameraPose {
  const distance = Math.max(1, radius);
  if (preset === "top") {
    return {
      position: { x: center.x, y: center.y, z: center.z + distance * 2.25 },
      up: { x: 0, y: 1, z: 0 },
    };
  }
  if (preset === "front") {
    return {
      position: { x: center.x, y: center.y - distance * 2.05, z: center.z + distance * 0.12 },
      up: { x: 0, y: 0, z: 1 },
    };
  }
  if (preset === "right") {
    return {
      position: { x: center.x + distance * 2.05, y: center.y, z: center.z + distance * 0.12 },
      up: { x: 0, y: 0, z: 1 },
    };
  }
  return {
    position: {
      x: center.x + distance,
      y: center.y - distance * 1.2,
      z: center.z + distance * 0.82,
    },
    up: { x: 0, y: 0, z: 1 },
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
