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

/** Fraction of the way to the point under the cursor covered by one detent. */
export const WHEEL_APPROACH_PER_NOTCH = 0.0734;

/** Wheel delta one detent reports. Trackpads send fractions of it. */
export const WHEEL_NOTCH_DELTA = 120;

/**
 * How far a wheel gesture carries the camera, given what it has to travel to.
 *
 * Autodesk's zoom is multiplicative — each detent covers the same fraction of
 * what is left — so five notches close 32% of the gap rather than 37%. Rolling
 * back is the inverse, which is why retreating covers slightly more ground than
 * advancing did (measured 7.66% out against 7.34% in).
 */
export function wheelTravel(deltaY: number, reach: number): number {
  const notches = -deltaY / WHEEL_NOTCH_DELTA;
  return reach * (1 - (1 - WHEEL_APPROACH_PER_NOTCH) ** notches);
}

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
  _quat: THREE.Quaternion;
  _quatInverse: THREE.Quaternion;
  _rotateLeft(angle: number): void;
  _rotateUp(angle: number): void;
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Keep OrbitControls' idea of "up" in step with the camera's.
 *
 * OrbitControls derives the frame it orbits in from `object.up` exactly once,
 * in its constructor, and never looks again. Reviter builds the control before
 * the camera preset tells the camera that this scene stands on +Z, so it spent
 * its life orbiting about +Y while the building stood on +Z: a horizontal drag
 * swung the camera around the wrong axis, which is why the same drag that turns
 * 11.19 degrees in Autodesk Viewer turned 3.5 here and drifted as it went.
 *
 * Rechecking on update costs one vector comparison a frame and survives every
 * later reassignment of `camera.up` — source handoffs, camera presets and the
 * y-up reference model all move it.
 */
function watchUpVector(controls: RotatableControls): void {
  const known = controls.object.up.clone();
  const syncFrame = () => {
    controls._quat.setFromUnitVectors(controls.object.up, Y_AXIS);
    controls._quatInverse.copy(controls._quat).invert();
  };
  syncFrame();
  const inherited = controls.update.bind(controls);
  controls.update = (deltaTime?: number | null) => {
    if (!known.equals(controls.object.up)) {
      known.copy(controls.object.up);
      syncFrame();
    }
    return inherited(deltaTime ?? null);
  };
}

/**
 * Give an OrbitControls instance Autodesk's orbit rates, wheel notch and
 * cursor-directed zoom. The button table is applied per event by
 * `applyAutodeskButtonMap`, because it depends on modifiers this cannot see.
 */
export function applyAutodeskNavigation(controls: OrbitControls, viewport: HTMLElement): void {
  const rotatable = controls as RotatableControls;
  watchUpVector(rotatable);
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
  controls.zoomToCursor = true;
  // No damping. This is the single biggest reason the two viewers used to feel
  // unalike, and it is not a matter of taste: with `dampingFactor` at 0.075,
  // OrbitControls applies 7.5% of the pending rotation per frame, so a 100 px
  // drag had turned only 3.72 of its 11.19 degrees by the time the button came
  // up and spent the next second and a half coasting through the rest. The
  // building lagged the cursor on the way round and overshot on release.
  // Autodesk's orbit is rigid — the same drag measured 11.19 degrees whether it
  // arrived in ten steps or forty, which no damped control can do.
  controls.enableDamping = false;
}

/**
 * Replace OrbitControls' zoom with Autodesk's, which translates the whole
 * camera rather than reeling the eye in towards a fixed target.
 *
 * The two are not variations on one idea. Measured against LMV, one detent
 * moved the eye 24.4 units *and the target 24.4 units with it*, leaving the
 * distance between them at 333 exactly as it was. OrbitControls moves the eye
 * 114 and the target not at all, so every zoom silently rewrites the orbit
 * radius: zoom in twice and a drag that used to swing you gently round the
 * building now whips it across the viewport, because the sphere you are
 * orbiting on has collapsed. Keeping the target a fixed distance ahead of the
 * eye is what makes Autodesk's orbit feel the same before and after a zoom.
 *
 * `measureReach` should return the distance to whatever is under the cursor,
 * so approaching a wall slows down the way it does in the reference viewer.
 * Without it the eye-to-target distance stands in, which is the right shape but
 * never decelerates.
 */
export function installAutodeskWheelDolly(
  controls: OrbitControls,
  viewport: HTMLElement,
  measureReach?: (clientX: number, clientY: number) => number | null,
): () => void {
  // OrbitControls' own wheel handler would fight this one for the same event.
  controls.enableZoom = false;
  // `object` is typed as the base Object3D, but OrbitControls only ever drives a
  // camera and `unproject` needs to see one.
  const camera = controls.object as THREE.Camera & { position: THREE.Vector3 };
  const cursor = new THREE.Vector3();
  const along = new THREE.Vector3();

  const onWheel = (event: WheelEvent) => {
    if (!controls.enabled || event.ctrlKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    cursor.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      1,
    );
    along.copy(cursor).unproject(camera).sub(camera.position);
    if (along.lengthSq() < 1e-12) return;
    along.normalize();
    const reach = measureReach?.(event.clientX, event.clientY)
      ?? camera.position.distanceTo(controls.target);
    const travel = wheelTravel(event.deltaY, reach);
    if (!Number.isFinite(travel) || travel === 0) return;
    camera.position.addScaledVector(along, travel);
    controls.target.addScaledVector(along, travel);
    controls.update();
  };

  viewport.addEventListener("wheel", onWheel, { passive: false });
  return () => viewport.removeEventListener("wheel", onWheel);
}
