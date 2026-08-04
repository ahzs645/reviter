/**
 * Navigation feel measured off Autodesk Viewer, not guessed at.
 *
 * Reviter and Autodesk Viewer are looked at side by side on the same building,
 * so an orbit that is three times faster here reads as a different tool rather
 * than a different renderer. Every constant below was read out of a live LMV
 * session driving the UNBC model: synthetic drags of a known pixel length were
 * dispatched at its canvas and the resulting camera was differenced, which is
 * why the numbers are odd rather than round.
 *
 * Two findings shape the whole file:
 *
 * - LMV rotates by *absolute pixels*. Halving its canvas to 1200x800 left the
 *   rate unchanged at 1/512 rad/px horizontally, so the viewport size must not
 *   enter the arithmetic. OrbitControls normalises by `clientHeight`, so the
 *   installer below divides that back out.
 * - Pitch runs about 2.02x faster than yaw. Autodesk drags vertically through
 *   the same arc in half the travel; matching yaw alone still feels wrong.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { NavigationMode } from "../../lib/reviter/viewer.ts";

/** Yaw per pixel of horizontal drag. Measured 1/512.03 over 50-500 px drags. */
export const ORBIT_YAW_RADIANS_PER_PIXEL = 1 / 512;

/** Pitch per pixel of vertical drag. Measured 1/253.41, i.e. 2.02x the yaw. */
export const ORBIT_PITCH_RADIANS_PER_PIXEL = 1 / 253.41;

/**
 * `zoomSpeed` that reproduces Autodesk's wheel notch.
 *
 * LMV moves 7.34% of the way to the point under the cursor per 120-unit wheel
 * delta. OrbitControls' scale is `0.95 ** (zoomSpeed * |delta| / 100)`, so
 * matching 0.9266 at delta 120 needs ln(0.9266) / (1.2 * ln(0.95)).
 */
export const WHEEL_ZOOM_SPEED = 1.238;

/** What a drag does, independent of which button and modifier produced it. */
export type DragAction = "orbit" | "pan" | "dolly";

export type DragModifiers = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

/**
 * Autodesk's button table, as measured. The empty cells are not omissions —
 * `alt` and `ctrl` deliberately leave most buttons alone there too.
 *
 *  |        | (none) | shift | ctrl/cmd | alt  |
 *  | left   | orbit  | pan   | orbit    | orbit|
 *  | middle | pan    | orbit | pan      | pan  |
 *  | right  | pan    | dolly | orbit    | pan  |
 *
 * Only `shift` is a real modifier for the left button; ctrl, cmd and alt all
 * orbit exactly as an unmodified drag does. That matters because OrbitControls
 * treats all three interchangeably, so the mapping cannot be expressed as its
 * `mouseButtons` alone — see `orbitControlsMouseButton`.
 */
export function autodeskDragAction(
  mode: NavigationMode,
  button: number,
  modifiers: DragModifiers = {},
): DragAction | null {
  const shift = Boolean(modifiers.shiftKey);
  const command = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  // The Pan and Zoom tools only rebind the left button. Autodesk keeps the
  // middle and right buttons doing what they do under Orbit, so a reviewer who
  // learned "right drag pans" does not lose it by picking up another tool.
  if (button === 0) {
    if (mode === "pan") return "pan";
    if (mode === "zoom") return "dolly";
    return shift ? "pan" : "orbit";
  }
  if (button === 1) return shift ? "orbit" : "pan";
  if (button === 2) {
    if (shift) return "dolly";
    if (command) return "orbit";
    return "pan";
  }
  return null;
}

/**
 * The `mouseButtons` value that makes OrbitControls perform `action`.
 *
 * OrbitControls rewrites its own mapping when any of ctrl/cmd/shift is held:
 * `ROTATE` becomes a pan and `PAN` becomes a rotate, while `DOLLY` is left
 * alone. Rather than fight that, feed it the value that its rewrite turns into
 * what Autodesk does — so with a modifier down the two rotating/panning cases
 * are handed in swapped.
 */
export function orbitControlsMouseButton(
  action: DragAction,
  modifiers: DragModifiers = {},
): THREE.MOUSE {
  if (action === "dolly") return THREE.MOUSE.DOLLY;
  const inverted = Boolean(modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey);
  if (action === "orbit") return inverted ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  return inverted ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
}

/**
 * Rewrite `controls.mouseButtons` from the modifiers on a pointer event.
 *
 * Call this before OrbitControls sees the same event — it reads `mouseButtons`
 * once, in its own `pointerdown` handler — which is what the capture-phase
 * listener installed by `applyAutodeskNavigation` arranges.
 */
export function applyAutodeskButtonMap(
  controls: OrbitControls,
  mode: NavigationMode,
  button: number,
  modifiers: DragModifiers,
): DragAction | null {
  const action = autodeskDragAction(mode, button, modifiers);
  if (!action) return null;
  const value = orbitControlsMouseButton(action, modifiers);
  if (button === 0) controls.mouseButtons.LEFT = value;
  else if (button === 1) controls.mouseButtons.MIDDLE = value;
  else if (button === 2) controls.mouseButtons.RIGHT = value;
  return action;
}

/**
 * Convert OrbitControls' viewport-relative rotation into Autodesk's per-pixel
 * one.
 *
 * `_rotateLeft`/`_rotateUp` are handed `2*PI * pixels / clientHeight` (already
 * multiplied by `rotateSpeed`, which stays at -1 so that the building keeps
 * following the pointer rather than fleeing it). Scaling that by
 * `rate * clientHeight / 2*PI` recovers `pixels * rate` and cancels the
 * viewport out, which is the whole point.
 */
export function autodeskRotationScale(radiansPerPixel: number, viewportHeight: number): number {
  return (radiansPerPixel * Math.max(1, viewportHeight)) / (2 * Math.PI);
}

type RotatableControls = OrbitControls & {
  _sphericalDelta: { theta: number; phi: number };
  _rotateLeft(angle: number): void;
  _rotateUp(angle: number): void;
};

/**
 * Give an OrbitControls instance Autodesk's orbit rates, wheel notch and
 * cursor-directed zoom. The button table is applied per event by
 * `applyAutodeskButtonMap`, because it depends on modifiers this cannot see.
 */
export function applyAutodeskNavigation(controls: OrbitControls, viewport: HTMLElement): void {
  const rotatable = controls as RotatableControls;
  // Instance properties shadow the prototype methods, and OrbitControls calls
  // them through `this`, so both the mouse and the two-finger touch path pick
  // these up.
  rotatable._rotateLeft = function rotateLeft(angle: number) {
    this._sphericalDelta.theta -=
      angle * autodeskRotationScale(ORBIT_YAW_RADIANS_PER_PIXEL, viewport.clientHeight);
  };
  rotatable._rotateUp = function rotateUp(angle: number) {
    this._sphericalDelta.phi -=
      angle * autodeskRotationScale(ORBIT_PITCH_RADIANS_PER_PIXEL, viewport.clientHeight);
  };
  controls.zoomSpeed = WHEEL_ZOOM_SPEED;
  // Autodesk dollies along the ray through the cursor, so the detail you point
  // at is the detail you arrive at. Its `zoomTowardsPivot` preference is off,
  // which is exactly this behaviour rather than zooming at the orbit centre.
  controls.zoomToCursor = true;
}
