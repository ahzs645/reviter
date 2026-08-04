/**
 * The navigation table measured off a live Autodesk Viewer session driving the
 * UNBC model, pinned so a refactor cannot quietly drift away from it.
 *
 * The numbers here are not preferences. Each was read back from LMV by
 * dispatching a synthetic drag of a known pixel length at its canvas and
 * differencing the camera, so a change to one of them is a claim that the
 * measurement was wrong.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  applyAutodeskButtonMap,
  autodeskDragAction,
  autodeskRotationScale,
  ORBIT_PITCH_RADIANS_PER_PIXEL,
  ORBIT_YAW_RADIANS_PER_PIXEL,
  orbitControlsMouseButton,
  WHEEL_ZOOM_SPEED,
  type DragAction,
  type DragModifiers,
} from "../app/studio/autodesk-navigation.ts";

const NONE: DragModifiers = {};
const SHIFT: DragModifiers = { shiftKey: true };
const CTRL: DragModifiers = { ctrlKey: true };
const META: DragModifiers = { metaKey: true };
const ALT: DragModifiers = { altKey: true };

test("the orbit tool reproduces Autodesk's measured button table", () => {
  const orbit = (button: number, modifiers: DragModifiers) =>
    autodeskDragAction("orbit", button, modifiers);

  assert.equal(orbit(0, NONE), "orbit");
  assert.equal(orbit(0, SHIFT), "pan");
  // ctrl, cmd and alt were all measured as leaving the left button orbiting.
  assert.equal(orbit(0, CTRL), "orbit");
  assert.equal(orbit(0, META), "orbit");
  assert.equal(orbit(0, ALT), "orbit");

  assert.equal(orbit(1, NONE), "pan");
  assert.equal(orbit(1, SHIFT), "orbit");
  assert.equal(orbit(1, CTRL), "pan");

  assert.equal(orbit(2, NONE), "pan");
  // Shift plus the right button translates the eye and the target together
  // along the view direction — measured as a dolly, not a pan.
  assert.equal(orbit(2, SHIFT), "dolly");
  assert.equal(orbit(2, CTRL), "orbit");
  assert.equal(orbit(2, ALT), "pan");
});

test("the Pan and Zoom tools rebind only the left button", () => {
  assert.equal(autodeskDragAction("pan", 0, NONE), "pan");
  assert.equal(autodeskDragAction("zoom", 0, NONE), "dolly");
  for (const mode of ["pan", "zoom"] as const) {
    assert.equal(autodeskDragAction(mode, 1, NONE), "pan");
    assert.equal(autodeskDragAction(mode, 2, NONE), "pan");
    assert.equal(autodeskDragAction(mode, 2, CTRL), "orbit");
  }
});

/**
 * OrbitControls rewrites its own mapping whenever ctrl, cmd or shift is held:
 * ROTATE becomes a pan, PAN becomes a rotate, DOLLY is left alone. This is that
 * rule, so the encoding can be checked end to end rather than by inspection.
 */
function orbitControlsResolves(button: THREE.MOUSE, modifiers: DragModifiers): DragAction {
  const inverted = Boolean(modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey);
  if (button === THREE.MOUSE.DOLLY) return "dolly";
  if (button === THREE.MOUSE.ROTATE) return inverted ? "pan" : "orbit";
  return inverted ? "orbit" : "pan";
}

test("the encoded button survives OrbitControls' own modifier rewrite", () => {
  const modifierSets = [NONE, SHIFT, CTRL, META, ALT];
  for (const mode of ["orbit", "pan", "zoom"] as const) {
    for (const button of [0, 1, 2]) {
      for (const modifiers of modifierSets) {
        const wanted = autodeskDragAction(mode, button, modifiers);
        assert.ok(wanted, `${mode}/${button} should map to an action`);
        const encoded = orbitControlsMouseButton(wanted, modifiers);
        assert.equal(
          orbitControlsResolves(encoded, modifiers),
          wanted,
          `${mode} button ${button} with ${JSON.stringify(modifiers)}`,
        );
      }
    }
  }
});

test("a press writes only the button it came from", () => {
  const controls = {
    mouseButtons: {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    },
  };
  const controlsRef = controls as unknown as Parameters<typeof applyAutodeskButtonMap>[0];

  assert.equal(applyAutodeskButtonMap(controlsRef, "orbit", 0, SHIFT), "pan");
  // Shift plus left is a pan, and OrbitControls turns a ROTATE into a pan when
  // a modifier is down, so ROTATE is the value that produces it.
  assert.equal(controls.mouseButtons.LEFT, THREE.MOUSE.ROTATE);
  assert.equal(controls.mouseButtons.MIDDLE, THREE.MOUSE.PAN);
  assert.equal(controls.mouseButtons.RIGHT, THREE.MOUSE.PAN);

  assert.equal(applyAutodeskButtonMap(controlsRef, "orbit", 2, SHIFT), "dolly");
  assert.equal(controls.mouseButtons.RIGHT, THREE.MOUSE.DOLLY);
  assert.equal(controls.mouseButtons.LEFT, THREE.MOUSE.ROTATE);

  assert.equal(applyAutodeskButtonMap(controlsRef, "orbit", 4, NONE), null);
});

test("orbit rates are per pixel, not per viewport", () => {
  // LMV was measured at 2560x1112 and again at 1200x800: 1/512.03 rad per pixel
  // of yaw both times. OrbitControls divides by clientHeight, so the scale must
  // cancel that back out — the same drag has to survive a resize.
  const tallScale = autodeskRotationScale(ORBIT_YAW_RADIANS_PER_PIXEL, 1112);
  const shortScale = autodeskRotationScale(ORBIT_YAW_RADIANS_PER_PIXEL, 800);
  const yawFor = (pixels: number, height: number, scale: number) =>
    ((2 * Math.PI * pixels) / height) * scale;

  assert.ok(Math.abs(yawFor(200, 1112, tallScale) - 200 * ORBIT_YAW_RADIANS_PER_PIXEL) < 1e-12);
  assert.ok(Math.abs(yawFor(200, 800, shortScale) - 200 * ORBIT_YAW_RADIANS_PER_PIXEL) < 1e-12);

  // 200 px of yaw measured -22.38 degrees in LMV.
  assert.ok(Math.abs((200 * ORBIT_YAW_RADIANS_PER_PIXEL * 180) / Math.PI - 22.38) < 0.01);
  // 100 px of pitch measured 22.61 degrees, about 2.02x the yaw rate.
  assert.ok(Math.abs((100 * ORBIT_PITCH_RADIANS_PER_PIXEL * 180) / Math.PI - 22.61) < 0.01);
  assert.ok(ORBIT_PITCH_RADIANS_PER_PIXEL > ORBIT_YAW_RADIANS_PER_PIXEL * 2);
});

test("the wheel notch matches Autodesk's 7.34 percent approach per detent", () => {
  // OrbitControls' scale for a 120-unit wheel delta.
  const scale = 0.95 ** (WHEEL_ZOOM_SPEED * Math.abs(120 * 0.01));
  assert.ok(Math.abs(1 - scale - 0.0734) < 0.0005, `moved ${(1 - scale).toFixed(4)} of the gap`);
});
