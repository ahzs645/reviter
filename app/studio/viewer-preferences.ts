/**
 * Viewer preferences that belong to the reviewer rather than to a model.
 *
 * A model's markup, comments and room review are stored per file, because they
 * are about that building. How the mouse should behave is not: it follows the
 * person between files, so it is one key with no model in it.
 */
import type { OrbitDragConvention } from "../../lib/reviter";

const ORBIT_DRAG_KEY = "reviter.viewer.orbit-drag";

/**
 * The stored orbit-drag convention, or Autodesk's.
 *
 * Read lazily rather than in an effect: the viewport applies this when its
 * controls are built, and a default applied first and corrected afterwards is
 * one frame of the wrong feel on every load.
 */
export function readOrbitDrag(): OrbitDragConvention {
  if (typeof localStorage === "undefined") return "model";
  try {
    return localStorage.getItem(ORBIT_DRAG_KEY) === "camera" ? "camera" : "model";
  } catch {
    // A browser with storage denied still gets a working viewer.
    return "model";
  }
}

export function writeOrbitDrag(value: OrbitDragConvention): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ORBIT_DRAG_KEY, value);
  } catch {
    // Nothing to recover: the preference simply does not outlive the session.
  }
}
