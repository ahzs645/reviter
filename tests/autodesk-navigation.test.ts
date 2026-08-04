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
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  applyAutodeskButtonMap,
  applyAutodeskNavigation,
  autodeskDragAction,
  installAutodeskWheelDolly,
  wheelTravel,
  autodeskRotationScale,
  ORBIT_PITCH_RADIANS_PER_PIXEL,
  ORBIT_YAW_RADIANS_PER_PIXEL,
  orbitControlsMouseButton,
  WHEEL_ZOOM_SPEED,
  type DragAction,
  type DragModifiers,
} from "../app/studio/autodesk-navigation.ts";

/** Autodesk turned 11.1906 degrees for a 100 px horizontal drag. */
const AUTODESK_YAW_100PX_DEGREES = 11.1906;

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

/**
 * A real OrbitControls over a fake element, so a drag can be measured end to
 * end without a browser. Everything OrbitControls touches on its DOM node is
 * stubbed; nothing about the rotation arithmetic is.
 */
function orbitRig(clientHeight = 882, { upBeforeConstruction = true } = {}) {
  const rootNode = new EventTarget();
  const element = Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    clientWidth: 1024,
    clientHeight,
    getRootNode: () => rootNode,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: clientHeight }),
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  }) as unknown as HTMLElement;

  const camera = new THREE.PerspectiveCamera(45, 1024 / clientHeight, 0.1, 100_000);
  if (upBeforeConstruction) camera.up.set(0, 0, 1);
  const radius = 1560.7;
  const elevation = (28.7 * Math.PI) / 180;
  const azimuth = (-45 * Math.PI) / 180;
  camera.position.set(
    radius * Math.cos(elevation) * Math.cos(azimuth),
    radius * Math.cos(elevation) * Math.sin(azimuth),
    radius * Math.sin(elevation),
  );

  const controls = new OrbitControls(camera, element);
  controls.screenSpacePanning = true;
  controls.rotateSpeed = -1;
  controls.target.set(0, 0, 0);
  applyAutodeskNavigation(controls, element);
  // The studio builds the control first and applies the camera preset after, so
  // the z-up scene only reaches `camera.up` once the control already exists.
  if (!upBeforeConstruction) camera.up.set(0, 0, 1);
  controls.update();
  return { camera, controls, element, clientHeight };
}

const azimuthDegrees = (camera: THREE.Camera, target: THREE.Vector3) => {
  const offset = camera.position.clone().sub(target);
  return (Math.atan2(offset.y, offset.x) * 180) / Math.PI;
};

test("a finished drag has finished turning: no damping tail", () => {
  const { camera, controls, clientHeight } = orbitRig();
  const rotatable = controls as unknown as { _rotateLeft(angle: number): void };
  const before = azimuthDegrees(camera, controls.target);

  // Ten moves of ten pixels, exactly as _handleMouseMoveRotate delivers them.
  for (let move = 0; move < 10; move += 1) {
    rotatable._rotateLeft((2 * Math.PI * -10) / clientHeight);
    controls.update();
  }
  const whenTheButtonComesUp = Math.abs(azimuthDegrees(camera, controls.target) - before);

  // Damping used to leave 3.72 of these 11.19 degrees applied here and coast
  // through the rest over the next second and a half, so the building lagged
  // the cursor round and then overshot. Autodesk's orbit is rigid.
  assert.ok(
    Math.abs(whenTheButtonComesUp - AUTODESK_YAW_100PX_DEGREES) < 0.01,
    `drag landed ${whenTheButtonComesUp.toFixed(4)} deg, expected ${AUTODESK_YAW_100PX_DEGREES}`,
  );

  // And nothing keeps moving afterwards.
  for (let frame = 0; frame < 120; frame += 1) controls.update();
  assert.ok(
    Math.abs(Math.abs(azimuthDegrees(camera, controls.target) - before) - whenTheButtonComesUp) < 1e-9,
    "the camera must be still once the drag ends",
  );
  assert.equal(controls.enableDamping, false);
});

test("orbit follows the camera's up vector even when it is set after construction", () => {
  // OrbitControls reads `object.up` once, in its constructor, and the studio
  // builds it before the camera preset declares this scene z-up. Left alone it
  // orbited about world +Y while the building stood on +Z, so a horizontal drag
  // swung the camera around the wrong axis: 3.5 degrees instead of 11.19, and
  // drifting further out of true the longer the drag.
  const { camera, controls, clientHeight } = orbitRig(882, { upBeforeConstruction: false });
  const rotatable = controls as unknown as { _rotateLeft(angle: number): void };

  const before = {
    azimuth: azimuthDegrees(camera, controls.target),
    height: camera.position.z - controls.target.z,
  };
  for (let move = 0; move < 10; move += 1) {
    rotatable._rotateLeft((2 * Math.PI * -10) / clientHeight);
    controls.update();
  }
  const turned = Math.abs(azimuthDegrees(camera, controls.target) - before.azimuth);

  assert.ok(
    Math.abs(turned - AUTODESK_YAW_100PX_DEGREES) < 0.01,
    `turned ${turned.toFixed(4)} deg about world z, expected ${AUTODESK_YAW_100PX_DEGREES}`,
  );
  // A yaw is a yaw: orbiting sideways must not raise or lower the eye.
  assert.ok(
    Math.abs((camera.position.z - controls.target.z) - before.height) < 1e-6,
    "a horizontal drag changed the camera's height, so it is not turning about world z",
  );
});

test("orbit is step-independent, as a rigid control must be", () => {
  const measure = (steps: number) => {
    const { camera, controls, clientHeight } = orbitRig();
    const rotatable = controls as unknown as { _rotateLeft(angle: number): void };
    const before = azimuthDegrees(camera, controls.target);
    for (let move = 0; move < steps; move += 1) {
      rotatable._rotateLeft((2 * Math.PI * -(100 / steps)) / clientHeight);
      controls.update();
    }
    return Math.abs(azimuthDegrees(camera, controls.target) - before);
  };
  // Autodesk measured 11.19 degrees for 100 px whether it arrived in ten steps
  // or forty. A damped control cannot reproduce that.
  assert.ok(Math.abs(measure(10) - measure(40)) < 1e-9);
  assert.ok(Math.abs(measure(10) - AUTODESK_YAW_100PX_DEGREES) < 0.01);
});

test("the wheel notch matches Autodesk's 7.34 percent approach per detent", () => {
  // OrbitControls' scale for a 120-unit wheel delta.
  const scale = 0.95 ** (WHEEL_ZOOM_SPEED * Math.abs(120 * 0.01));
  assert.ok(Math.abs(1 - scale - 0.0734) < 0.0005, `moved ${(1 - scale).toFixed(4)} of the gap`);
});

test("wheel travel is multiplicative, so approaching decelerates", () => {
  const reach = 333;
  // One detent, measured in LMV as 24.445 units out of 333.
  assert.ok(Math.abs(wheelTravel(-120, reach) - 24.445) < 0.05);
  // Five detents measured 106.85, not five times one — each covers the same
  // share of what is left rather than the same distance.
  assert.ok(Math.abs(wheelTravel(-600, reach) - 106.85) < 3);
  assert.ok(wheelTravel(-600, reach) < 5 * wheelTravel(-120, reach));
  // Rolling back is the inverse, and so covers slightly more ground.
  assert.ok(wheelTravel(120, reach) < 0);
  assert.ok(Math.abs(wheelTravel(120, reach)) > Math.abs(wheelTravel(-120, reach)));
  // A trackpad's fractional delta is a fractional step, not a whole one.
  assert.ok(Math.abs(wheelTravel(-60, reach)) < Math.abs(wheelTravel(-120, reach)));
  assert.equal(wheelTravel(0, reach), 0);
});

test("the wheel carries the target with the eye, holding the orbit radius", () => {
  const { camera, controls, element } = orbitRig();
  const release = installAutodeskWheelDolly(controls, element);
  const before = {
    radius: camera.position.distanceTo(controls.target),
    eye: camera.position.clone(),
    target: controls.target.clone(),
  };

  element.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), {
    clientX: 512,
    clientY: 441,
    deltaY: -120,
    deltaMode: 0,
    ctrlKey: false,
  }));

  const eyeMoved = camera.position.distanceTo(before.eye);
  const targetMoved = controls.target.distanceTo(before.target);
  // Autodesk moved both by 24.4 and left the gap between them at 333. Pulling
  // the eye in towards a pinned target is what made every zoom change how the
  // next orbit drag behaved.
  assert.ok(eyeMoved > 1, `the eye should have moved, moved ${eyeMoved.toFixed(3)}`);
  assert.ok(
    Math.abs(eyeMoved - targetMoved) < 1e-6,
    `eye moved ${eyeMoved.toFixed(3)} but target moved ${targetMoved.toFixed(3)}`,
  );
  assert.ok(
    Math.abs(camera.position.distanceTo(controls.target) - before.radius) < 1e-6,
    "the orbit radius must survive a zoom",
  );
  assert.equal(controls.enableZoom, false, "OrbitControls' own zoom would fight this one");

  release();
  element.dispatchEvent(Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), {
    clientX: 512, clientY: 441, deltaY: -120, deltaMode: 0, ctrlKey: false,
  }));
  assert.ok(
    camera.position.distanceTo(before.eye) - eyeMoved < 1e-6,
    "releasing must detach the listener",
  );
});
