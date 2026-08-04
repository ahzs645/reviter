import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { WalkSurfaceIndex } from "../app/studio/walk-surface.ts";

import {
  createWalkControls,
  DEFAULT_FLOOR_PROBE_INTERVAL,
  droppedEyeCoordinate,
  easeTravelProgress,
  FIRST_PERSON_SPEEDS,
  floorTravelDirection,
  horizontalWalkDirection,
  stepWalkSpeed,
  travelDurationSeconds,
  turnDirection,
  WALK_EYE_HEIGHT,
  walkKeyboardEventUsesSystemShortcut,
  walkKeyboardTargetIsInteractive,
} from "../app/studio/walk-controls.ts";

/**
 * Autodesk's BIM Walk configuration, in metres, as read from a live session on
 * the UNBC model. Everything Reviter walks with is derived from these.
 */
const AUTODESK_WALK = {
  minWalkSpeed: 2,
  topWalkSpeed: 4,
  maxWalkSpeed: 6,
  cameraDistanceFromFloor: 1.8,
  mouseTurnMinPitchLimit: 0.3490658503988659,
} as const;
const FEET_PER_METRE = 1 / 0.3048;

test("walk speeds and eye height are Autodesk's, converted from metres", () => {
  assert.ok(Math.abs(FIRST_PERSON_SPEEDS.slow - AUTODESK_WALK.minWalkSpeed * FEET_PER_METRE) < 1e-9);
  assert.ok(Math.abs(FIRST_PERSON_SPEEDS.normal - AUTODESK_WALK.topWalkSpeed * FEET_PER_METRE) < 1e-9);
  assert.ok(Math.abs(FIRST_PERSON_SPEEDS.fast - AUTODESK_WALK.maxWalkSpeed * FEET_PER_METRE) < 1e-9);
  assert.ok(
    Math.abs(WALK_EYE_HEIGHT - AUTODESK_WALK.cameraDistanceFromFloor * FEET_PER_METRE) < 1e-9,
    "a reviewer must stand at the same height in both viewers",
  );
});

test("the arrow keys turn where W A S D moves", () => {
  assert.equal(turnDirection(new Set(["ArrowLeft"])), 1);
  assert.equal(turnDirection(new Set(["ArrowRight"])), -1);
  assert.equal(turnDirection(new Set(["ArrowLeft", "ArrowRight"])), 0);
  assert.equal(turnDirection(new Set(["KeyA"])), 0, "A strafes, it does not turn");
  assert.equal(turnDirection(new Set(["ArrowUp"])), 0);
});

test("fast Walk no longer uses the coarse interval that skipped UNBC stair treads", () => {
  const treadDepthFeet = 0.9842519685;
  assert.equal(DEFAULT_FLOOR_PROBE_INTERVAL, 0);
  assert.ok(FIRST_PERSON_SPEEDS.fast * 0.1 > treadDepthFeet * 2);
});

test("object 1460781 advances across its curved-stair risers without multi-step snaps", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const riser = 0.41244844394450697;
    const treadDepth = 0.984251968503937;
    const eyeHeight = 5.6;
    const surface = new WalkSurfaceIndex({ cellSize: 0.5 });
    for (let step = 0; step < 12; step += 1) {
      const top = riser * (step + 1);
      const geometry = new THREE.BoxGeometry(4, 0.16404199475, treadDepth);
      const matrix = new THREE.Matrix4().makeTranslation(
        0,
        top - 0.16404199475 / 2,
        (step + 0.5) * treadDepth,
      );
      surface.addGeometry(geometry, matrix);
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const element = Object.assign(new EventTarget(), {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const start = new THREE.Vector3(0, eyeHeight + riser, treadDepth * 0.25);
    const controls = createWalkControls(camera, element, {
      start,
      lookAt: start.clone().add(new THREE.Vector3(0, 0, 10)),
      floor: eyeHeight,
      eyeHeight,
      up: "y",
      gravity: true,
      speed: "fast",
      resolveFloor: (position) => surface.floorAt(position, {
        maxDrop: eyeHeight + 12,
        maximumHeight: position.y - eyeHeight + 1.5,
      }),
    });
    controls.enable();
    fakeWindow.dispatchEvent(Object.assign(new Event("keydown"), {
      code: "KeyW",
      repeat: false,
    }));

    let previousHeight = camera.position.y;
    let maximumFrameRise = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      controls.update(1 / 60);
      maximumFrameRise = Math.max(
        maximumFrameRise,
        camera.position.y - previousHeight,
      );
      previousHeight = camera.position.y;
    }

    assert.ok(camera.position.y >= eyeHeight + riser * 6);
    assert.ok(maximumFrameRise < riser);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("walk shortcuts ignore form and disclosure controls", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"]) {
    assert.equal(walkKeyboardTargetIsInteractive({ tagName } as unknown as EventTarget), true);
  }
  assert.equal(walkKeyboardTargetIsInteractive({ tagName: "CANVAS" } as unknown as EventTarget), false);
  assert.equal(walkKeyboardTargetIsInteractive({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
});

test("walk shortcuts leave browser and operating-system shortcuts alone", () => {
  assert.equal(walkKeyboardEventUsesSystemShortcut({ altKey: false, ctrlKey: false, metaKey: true }), true);
  assert.equal(walkKeyboardEventUsesSystemShortcut({ altKey: false, ctrlKey: true, metaKey: false }), true);
  assert.equal(walkKeyboardEventUsesSystemShortcut({ altKey: true, ctrlKey: false, metaKey: false }), true);
  assert.equal(walkKeyboardEventUsesSystemShortcut({ altKey: false, ctrlKey: false, metaKey: false }), false);
});

test("first-person speed steps are ordered and clamp at both ends", () => {
  assert.ok(FIRST_PERSON_SPEEDS.slow < FIRST_PERSON_SPEEDS.normal);
  assert.ok(FIRST_PERSON_SPEEDS.normal < FIRST_PERSON_SPEEDS.fast);

  assert.equal(stepWalkSpeed("slow", -1), "slow");
  assert.equal(stepWalkSpeed("slow", 1), "normal");
  assert.equal(stepWalkSpeed("normal", 1), "fast");
  assert.equal(stepWalkSpeed("fast", 1), "fast");
});

test("first-person floor travel matches Autodesk Q down and E up controls", () => {
  assert.equal(floorTravelDirection(new Set(["KeyQ"])), -1);
  assert.equal(floorTravelDirection(new Set(["KeyE"])), 1);
  assert.equal(floorTravelDirection(new Set(["KeyQ", "KeyE"])), 0);
  assert.equal(floorTravelDirection(new Set()), 0);
});

test("first-person strafing moves to the camera's visual right", () => {
  const yUpRight = horizontalWalkDirection("y", 0, 0, 1);
  assert.deepEqual(yUpRight.toArray(), [-1, 0, 0]);

  const zUpRight = horizontalWalkDirection("z", 0, 0, 1);
  assert.deepEqual(zUpRight.toArray(), [0, -1, 0]);
});

test("surface drop uses the hit surface or the safe model baseline", () => {
  assert.equal(droppedEyeCoordinate(12, 5.6, 5.6), 17.6);
  assert.equal(droppedEyeCoordinate(null, 5.6, 5.6), 5.6);
  assert.equal(droppedEyeCoordinate(-20, 5.6, 5.6), 5.6);
});

test("Float preserves a camera below the model baseline during source handoff", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(new EventTarget(), { hidden: false }),
  });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const element = Object.assign(new EventTarget(), {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const start = new THREE.Vector3(12, -40, 8);
    const controls = createWalkControls(camera, element, {
      start,
      lookAt: start.clone().add(new THREE.Vector3(1, 0, 0)),
      floor: 5.6,
      up: "y",
      gravity: false,
    });
    controls.enable();
    controls.update(0.1);
    assert.equal(camera.position.y, -40);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("face travel uses a bounded ease-out animation", () => {
  assert.equal(easeTravelProgress(0), 0);
  assert.ok(easeTravelProgress(0.5) > 0.5);
  assert.equal(easeTravelProgress(1), 1);
  assert.equal(travelDurationSeconds(0), 0.42);
  assert.equal(travelDurationSeconds(100), 1.25);
});

test("face travel preserves the first-person view direction", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const element = Object.assign(new EventTarget(), {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 5.6, 10),
      lookAt: new THREE.Vector3(0, 5.6, 0),
      floor: 5.6,
      up: "y",
      gravity: false,
    });
    controls.enable();
    const before = new THREE.Vector3();
    camera.getWorldDirection(before);

    controls.travelToSurface(
      new THREE.Vector3(0, 20, 0),
      new THREE.Vector3(0, 0, 1),
    );
    for (let frame = 0; frame < 20; frame += 1) controls.update(0.1);

    const after = new THREE.Vector3();
    camera.getWorldDirection(after);
    assert.ok(before.angleTo(after) < 1e-6);
    assert.ok(camera.position.z < 10);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("desktop look drags without taking the pointer, turns in place, and Escape exits", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), {
    hidden: false,
    pointerLockElement: null as HTMLElement | null,
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    let exitCount = 0;
    let pointerLockRequests = 0;
    let capturedPointer: number | null = null;
    const element = Object.assign(new EventTarget(), {
      // Present, and required to stay untouched: Autodesk's 1st Person leaves
      // the cursor alone, and a viewer that hides it cannot be used alongside
      // the panels beside the viewport.
      requestPointerLock() {
        pointerLockRequests += 1;
        fakeDocument.pointerLockElement = element;
      },
      setPointerCapture: (pointerId: number) => { capturedPointer = pointerId; },
      releasePointerCapture: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
      hasPointerCapture: (pointerId: number) => capturedPointer === pointerId,
    }) as unknown as HTMLElement;
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 5.6, 10),
      lookAt: new THREE.Vector3(0, 5.6, 0),
      floor: 5.6,
      up: "y",
      gravity: false,
      onExit: () => { exitCount += 1; },
    });
    controls.enable();

    element.dispatchEvent(Object.assign(new Event("pointerdown"), {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
    }));
    assert.equal(pointerLockRequests, 0, "walk must never request pointer lock");
    assert.equal(fakeDocument.pointerLockElement, null);
    assert.equal(controls.isLooking(), true);
    assert.equal(capturedPointer, 1, "the drag is held by pointer capture instead");
    const before = camera.getWorldDirection(new THREE.Vector3());
    element.dispatchEvent(Object.assign(new Event("pointermove"), {
      pointerId: 1,
      movementX: 40,
      movementY: -10,
    }));
    assert.ok(before.angleTo(camera.getWorldDirection(new THREE.Vector3())) > 0.01);

    const positionWhileLooking = camera.position.clone();
    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "KeyW",
      repeat: false,
    }));
    controls.update(0.1);
    assert.ok(
      camera.position.distanceTo(positionWhileLooking) > 0,
      "steering must not stop the walk: a held W keeps going through the drag",
    );

    element.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 }));
    assert.equal(controls.isLooking(), false, "releasing the button ends the look drag");
    assert.equal(capturedPointer, null, "and hands the captured pointer back");

    controls.update(0.1);
    assert.ok(camera.position.distanceTo(positionWhileLooking) > 0, "movement resumes after the drag");

    // One press, one exit. Escape used to be swallowed by the pointer lock, so
    // leaving Walk took two.
    assert.equal(exitCount, 0);
    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Escape",
      repeat: false,
    }));
    assert.equal(exitCount, 1);
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("arrow turning rotates in place and pitch stops where Autodesk stops", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    let capturedPointer: number | null = null;
    const element = Object.assign(new EventTarget(), {
      setPointerCapture: (pointerId: number) => { capturedPointer = pointerId; },
      releasePointerCapture: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
      hasPointerCapture: (pointerId: number) => capturedPointer === pointerId,
    }) as unknown as HTMLElement;
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 5.9, 10),
      lookAt: new THREE.Vector3(0, 5.9, 0),
      floor: 5.9,
      up: "y",
      gravity: false,
    });
    controls.enable();

    const startPosition = camera.position.clone();
    const startDirection = camera.getWorldDirection(new THREE.Vector3());
    fakeWindow.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "ArrowLeft",
      repeat: false,
    }));
    for (let frame = 0; frame < 10; frame += 1) controls.update(0.05);
    const turnedDirection = camera.getWorldDirection(new THREE.Vector3());

    assert.ok(
      startDirection.angleTo(turnedDirection) > 0.5,
      "half a second on the left arrow should turn a noticeable amount",
    );
    assert.ok(
      camera.position.distanceTo(startPosition) < 1e-9,
      "turning is a look, not a step sideways",
    );
    fakeWindow.dispatchEvent(Object.assign(new Event("keyup"), { code: "ArrowLeft" }));

    // Drag far past vertical. Autodesk clamps the first-person look 70 degrees
    // either side of level, so straight up must stay out of reach.
    element.dispatchEvent(Object.assign(new Event("pointerdown"), {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
    }));
    for (let move = 0; move < 20; move += 1) {
      element.dispatchEvent(Object.assign(new Event("pointermove"), {
        pointerId: 1,
        movementX: 0,
        movementY: -200,
      }));
    }
    const up = new THREE.Vector3(0, 1, 0);
    const pitched = camera.getWorldDirection(new THREE.Vector3());
    const degreesAboveHorizon = 90 - THREE.MathUtils.radToDeg(pitched.angleTo(up));
    assert.ok(
      Math.abs(degreesAboveHorizon - 70) < 0.5,
      `pitch clamped at ${degreesAboveHorizon.toFixed(2)} degrees, expected 70`,
    );
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("a look drag never moves the walker by itself", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const element = Object.assign(new EventTarget(), {
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 0, WALK_EYE_HEIGHT),
      lookAt: new THREE.Vector3(10, 0, WALK_EYE_HEIGHT),
      floor: WALK_EYE_HEIGHT,
      up: "z",
      gravity: true,
      resolveFloor: () => 0,
    });
    controls.enable();
    // Let gravity finish settling onto the floor before measuring.
    for (let frame = 0; frame < 60; frame += 1) controls.update(1 / 60);

    const before = camera.position.clone();
    const facing = camera.getWorldDirection(new THREE.Vector3());
    element.dispatchEvent(Object.assign(new Event("pointerdown"), {
      button: 0, pointerType: "mouse", pointerId: 1,
    }));
    for (let move = 0; move < 10; move += 1) {
      element.dispatchEvent(Object.assign(new Event("pointermove"), {
        pointerId: 1, movementX: 12, movementY: 4,
      }));
      controls.update(1 / 60);
    }

    // Standing still on a floor, a drag is pure rotation: it turns the head and
    // moves nothing. Anything that does move under a drag has to come from a
    // held key or a settle that was already owed, never from the drag itself.
    assert.equal(
      camera.position.distanceTo(before),
      0,
      "a look drag on settled ground must not translate the walker",
    );
    assert.ok(
      facing.angleTo(camera.getWorldDirection(new THREE.Vector3())) > 0.1,
      "but it must still turn the view",
    );
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("repeated look drags do not accumulate any error", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const element = Object.assign(new EventTarget(), {
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLElement;
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
    const controls = createWalkControls(camera, element, {
      start: new THREE.Vector3(0, 0, WALK_EYE_HEIGHT),
      lookAt: new THREE.Vector3(10, 0, WALK_EYE_HEIGHT),
      floor: WALK_EYE_HEIGHT,
      up: "z",
      gravity: true,
      resolveFloor: () => 0,
    });
    controls.enable();
    for (let frame = 0; frame < 90; frame += 1) controls.update(1 / 60);

    const origin = camera.position.clone();
    const MOVES = 10;
    const PIXELS = 10;
    const DRAGS = 20;
    for (let round = 0; round < DRAGS; round += 1) {
      element.dispatchEvent(Object.assign(new Event("pointerdown"), {
        button: 0, pointerType: "mouse", pointerId: 1,
      }));
      for (let move = 0; move < MOVES; move += 1) {
        element.dispatchEvent(Object.assign(new Event("pointermove"), {
          pointerId: 1, movementX: PIXELS, movementY: 0,
        }));
        controls.update(1 / 60);
      }
      element.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 }));
      // The idle gap between one drag and the next, where a momentum tail would
      // have kept turning after the hand stopped.
      for (let frame = 0; frame < 40; frame += 1) controls.update(1 / 60);
    }

    const direction = camera.getWorldDirection(new THREE.Vector3());
    const turned = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
    const commanded = -DRAGS * MOVES * PIXELS * 0.0045 * (180 / Math.PI);
    let error = turned - (((commanded % 360) + 540) % 360 - 180);
    while (error > 180) error -= 360;
    while (error < -180) error += 360;

    // A momentum tail that replayed the last move's delta cost 2.5 degrees a
    // drag, absolute rather than proportional, so twenty drags landed 50 degrees
    // from where they were aimed. The view must go exactly where the hand put it.
    assert.ok(
      Math.abs(error) < 0.01,
      `${DRAGS} drags drifted ${error.toFixed(3)} degrees from what the hand commanded`,
    );
    assert.equal(camera.position.distanceTo(origin), 0, "and must not have moved at all");
    controls.dispose();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

/** A walker standing on flat ground at `dropFeet` above it, gravity on. */
function fallingWalker(dropFeet: number) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
  const element = Object.assign(new EventTarget(), {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  }) as unknown as HTMLElement;
  const controls = createWalkControls(camera, element, {
    start: new THREE.Vector3(0, 0, WALK_EYE_HEIGHT + dropFeet),
    lookAt: new THREE.Vector3(10, 0, WALK_EYE_HEIGHT + dropFeet),
    floor: WALK_EYE_HEIGHT,
    up: "z",
    gravity: true,
    resolveFloor: () => 0,
  });
  controls.enable();

  let peakSpeed = 0;
  let landedAfter: number | null = null;
  let previous = camera.position.z;
  for (let frame = 1; frame <= 600; frame += 1) {
    controls.update(1 / 60);
    peakSpeed = Math.max(peakSpeed, (previous - camera.position.z) * 60);
    previous = camera.position.z;
    if (landedAfter === null && Math.abs(camera.position.z - WALK_EYE_HEIGHT) < 0.01) {
      landedAfter = frame / 60;
    }
  }
  controls.dispose();
  return { landedAfter, peakSpeed };
}

test("a walker falls without being asked to walk first", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(new EventTarget(), { hidden: false }),
  });

  try {
    // The floor probe was gated on a movement key being down, so a walker who
    // simply stood there never learned there was a floor beneath and hung in
    // mid-air until something was pressed.
    const { landedAfter } = fallingWalker(20);
    assert.ok(landedAfter !== null, "standing still, the walker never reached the floor");
    assert.ok(landedAfter < 2, `took ${landedAfter?.toFixed(2)}s to fall 20 ft`);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("falling accelerates at Autodesk's gravity and caps at its terminal speed", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(new EventTarget(), { hidden: false }),
  });

  try {
    const terminal = 10 * FEET_PER_METRE;
    // Short drops are free fall: t = sqrt(2h/g), well under terminal speed.
    for (const drop of [1, 5]) {
      const { landedAfter, peakSpeed } = fallingWalker(drop);
      const expected = Math.sqrt((2 * (drop / FEET_PER_METRE)) / 9.8);
      assert.ok(
        landedAfter !== null && Math.abs(landedAfter - expected) < 0.05,
        `${drop} ft took ${landedAfter?.toFixed(3)}s, free fall is ${expected.toFixed(3)}s`,
      );
      assert.ok(peakSpeed <= terminal + 0.1, `${drop} ft peaked at ${peakSpeed.toFixed(1)} ft/s`);
    }

    // A long drop must not outrun `gravityTopFallSpeed`. The eased lerp this
    // replaced was proportional, so a 60 ft fall peaked at 720 ft/s and landed
    // in the same half second as a one-foot step down.
    const long = fallingWalker(60);
    assert.ok(
      long.peakSpeed <= terminal + 0.1,
      `60 ft fall peaked at ${long.peakSpeed.toFixed(1)} ft/s, terminal is ${terminal.toFixed(1)}`,
    );
    assert.ok(
      long.landedAfter !== null && long.landedAfter > 2,
      "a 60 ft fall must take longer than a short one, not the same half second",
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
