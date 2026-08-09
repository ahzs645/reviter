/**
 * First-person navigation for the model viewport.
 *
 * Orbiting is the right way to look at a building from outside and the wrong
 * way to understand it from inside: a corridor, a stair, a floor-to-ceiling
 * height read very differently at eye level. This adds a walk mode alongside
 * the orbit camera rather than replacing it.
 *
 * The scene is drawn in model feet with the model origin subtracted, so the
 * speeds and heights here are real building dimensions and need no scaling.
 * They are Autodesk's own, converted from metres: a 1.8 m eye height and a
 * 4 m/s default pace.
 *
 * Looking is a drag, and the cursor stays the reviewer's own: Autodesk's 1st
 * Person never takes the mouse, and neither does this. A click used to request
 * pointer lock, which hid the cursor, swallowed the next Escape, and stopped
 * anyone reaching the panels beside the viewport without leaving walk first.
 *
 * Movement is WASD, `Shift` to run, and Q/E to descend/ascend between floors.
 * The arrow keys are the second hand: up and down walk, left and right turn.
 */
import * as THREE from "three";

/** One metre in feet, for reading Autodesk's metric walk configuration across. */
const FEET_PER_METRE = 1 / 0.3048;

/**
 * Eye height above the floor the walker is standing on, in feet.
 *
 * Autodesk's BIM Walk reports `cameraDistanceFromFloor: 1.8` metres. Standing
 * six inches lower than the reference viewer is enough to change which way a
 * head-height duct or a door transom reads, so the two now agree.
 */
const EYE_HEIGHT_FEET = 1.8 * FEET_PER_METRE;

export type WalkSpeed = "slow" | "normal" | "fast";

/**
 * The three speed steps, in model feet per second.
 *
 * Read off Autodesk's own walk configuration rather than estimated from it:
 * `minWalkSpeed` 2 m/s, `topWalkSpeed` 4 m/s (its default) and `maxWalkSpeed`
 * 6 m/s. Reviter's previous "normal" of 9 ft/s was about a third slower than
 * the reference viewer's default pace.
 */
export const FIRST_PERSON_SPEEDS: Readonly<Record<WalkSpeed, number>> = {
  slow: 2 * FEET_PER_METRE,
  normal: 4 * FEET_PER_METRE,
  fast: 6 * FEET_PER_METRE,
};

const WALK_SPEED_ORDER: readonly WalkSpeed[] = ["slow", "normal", "fast"];
/** Autodesk's `runMultiplier`. */
const RUN_MULTIPLIER = 2;

/** Vertical pace for rising and falling: Autodesk's `topVerticalSpeed`, 2 m/s. */
const RISE_SPEED = 2 * FEET_PER_METRE;

/** How quickly velocity reaches the target pace; larger is snappier. */
const DAMPING = 12;

/**
 * Falling, on Autodesk's terms: `gravityAcceleration` 9.8 m/s² capped at
 * `gravityTopFallSpeed` 10 m/s.
 *
 * Rising and falling used to share one eased lerp towards the floor, which is
 * not a fall at all — it is proportional, so every drop landed in about half a
 * second whatever its height, and a 60 ft one peaked at 720 ft/s on the way.
 * Stepping up keeps the ease, because a stair should climb smoothly rather than
 * snap a riser at a time; only the downward half is physics.
 */
const GRAVITY_ACCELERATION = 9.8 * FEET_PER_METRE;
const TOP_FALL_SPEED = 10 * FEET_PER_METRE;

/**
 * Radians of pitch either side of the horizon.
 *
 * Autodesk clamps the first-person look to `mouseTurnMinPitchLimit` 0.349 rad
 * and `mouseTurnMaxPitchLimit` 2.793 rad measured from straight up — 70 degrees
 * either side of level. Reviter used to allow very nearly straight up and down,
 * which is a view a person standing in a room cannot take and which made the
 * horizon hard to find again.
 */
const MAX_PITCH = Math.PI / 2 - 0.3490658503988659;

/** Autodesk's `keyboardTopTurnSpeed`, in radians per second. */
const KEYBOARD_TURN_SPEED = 1.5;

/**
 * Mouse sensitivity, radians per pixel.
 *
 * Measured against Autodesk's 1st Person, where a 100 px drag turned about
 * 25.9 degrees. It is roughly twice what Reviter used, which is what a drag
 * bounded by the window edge needs: without pointer lock a quarter of the
 * canvas has to be worth about a quarter turn.
 */
const LOOK_SPEED = 0.0045;

// The indexed floor query is plan-binned and cheap enough to run once per
// rendered update. The former 100 ms interval moved the normal walker almost
// one foot between probes and the fast walker 2.4 ft, so a roughly one-foot
// tread could be skipped and gravity would visibly snap over two or three
// risers at once.
export const DEFAULT_FLOOR_PROBE_INTERVAL = 0;
/** Autodesk's `bigAllowedVerticalStep`, 0.6 m: a riser it will climb, a desk it will not. */
export const WALK_MAX_STEP_UP = 0.6 * FEET_PER_METRE;

export function stepWalkSpeed(speed: WalkSpeed, direction: -1 | 1): WalkSpeed {
  const index = WALK_SPEED_ORDER.indexOf(speed);
  return WALK_SPEED_ORDER[Math.max(0, Math.min(WALK_SPEED_ORDER.length - 1, index + direction))];
}

export function floorTravelDirection(keys: ReadonlySet<string>): -1 | 0 | 1 {
  return ((keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)) as -1 | 0 | 1;
}

/**
 * Which way the arrow keys turn the walker, positive being to the left.
 *
 * Autodesk's BIM Walk splits the two keyboards: WASD strafes, the arrow keys
 * turn. Left and right used to strafe here too, which meant a reviewer who
 * learned the corridor walk in Autodesk Viewer sidled along the wall instead of
 * looking down the branch.
 */
export function turnDirection(keys: ReadonlySet<string>): -1 | 0 | 1 {
  return ((keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0)) as -1 | 0 | 1;
}

export function horizontalWalkDirection(
  up: "y" | "z",
  yaw: number,
  forwardInput: number,
  strafeInput: number,
): THREE.Vector3 {
  const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const forward = up === "y"
    ? new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    : new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
  const right = new THREE.Vector3().crossVectors(forward, upVector).normalize();
  return forward.multiplyScalar(forwardInput).addScaledVector(right, strafeInput);
}

export function droppedEyeCoordinate(
  surface: number | null,
  minimumEyeCoordinate: number,
  eyeHeight: number,
): number {
  return surface == null
    ? minimumEyeCoordinate
    : Math.max(minimumEyeCoordinate, surface + eyeHeight);
}

export function easeTravelProgress(progress: number): number {
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

export function travelDurationSeconds(distanceFeet: number): number {
  return THREE.MathUtils.clamp(0.42 + Math.max(0, distanceFeet) / 38, 0.42, 1.25);
}

/** Walk is global, but form controls must retain their native keyboard behaviour. */
export function walkKeyboardTargetIsInteractive(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { tagName?: string; isContentEditable?: boolean }) | null;
  if (!element) return false;
  const tag = element.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return true;
  return Boolean(element.isContentEditable || element.closest?.("[contenteditable='true'], [role='button'], [role='slider'], [role='tab']"));
}

/** Browser and operating-system shortcuts must win over Walk movement keys. */
export function walkKeyboardEventUsesSystemShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">,
): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

export type WalkControls = {
  /** Attach listeners and take over the camera. */
  enable(): void;
  /** Release the pointer and hand the camera back. */
  disable(): void;
  /** Advance by `deltaSeconds`; call once per animation frame while enabled. */
  update(deltaSeconds: number): void;
  /** True while a look drag is active. */
  isLooking(): boolean;
  /** Move the look drag to another mouse button, releasing any drag in flight. */
  setLookButton(button: number): void;
  /** Change the persistent movement speed without rebuilding the camera. */
  setSpeed(speed: WalkSpeed): void;
  /** Toggle floor following. Off becomes a free-flight first-person camera. */
  setGravity(enabled: boolean): void;
  /** Drop vertically onto the nearest model surface and resume walking. */
  dropToSurface(): boolean;
  /** Animate travel to a picked surface without changing the current view direction. */
  travelToSurface(point: THREE.Vector3, surfaceNormal?: THREE.Vector3): void;
  dispose(): void;
};

export type WalkOptions = {
  /** Where the walker starts, in scene units. */
  start: THREE.Vector3;
  /** Direction the walker faces at the start. */
  lookAt: THREE.Vector3;
  /** Lowest the camera may go, so the walker cannot sink through the model. */
  floor: number;
  /** Eye offset above a detected walking surface. */
  eyeHeight?: number;
  /** Scene distance represented by one foot (1 for RVT recovery, 0.3048 for metre geometry). */
  sceneUnitsPerFoot?: number;
  /** Which axis points up in this scene. */
  up: "y" | "z";
  /** Initial speed shown by the first-person popup. */
  speed?: WalkSpeed;
  /** Follow horizontal model surfaces when true. */
  gravity?: boolean;
  /** Seconds between walking-surface samples. */
  floorProbeInterval?: number;
  /** Return the walking-surface coordinate below this eye position. */
  resolveFloor?: (eyePosition: THREE.Vector3, maxDrop?: number) => number | null;
  /** Longest vertical search used by the explicit Space-key drop. */
  dropDistance?: number;
  /** Constrain a proposed camera move against model walls or other obstacles. */
  resolveMovement?: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3;
  /**
   * Mouse button that drags to look. Left by default; a drawing tool takes the
   * left button for its stroke, so looking moves to the right one rather than
   * the two gestures fighting over the same drag.
   */
  lookButton?: number;
  onLookChange?: (looking: boolean) => void;
  onSpeedChange?: (speed: WalkSpeed) => void;
  onGravityChange?: (enabled: boolean) => void;
  onExit?: () => void;
};

/**
 * Yaw and pitch are tracked directly rather than read back off the camera:
 * accumulating rotations on a quaternion drifts into roll, which on a building
 * reads as the horizon tipping over.
 */
export function createWalkControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  options: WalkOptions,
): WalkControls {
  const up = options.up;
  const pressed = new Set<string>();
  const velocity = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let enabled = false;
  let looking = false;
  let lookPointerId: number | null = null;
  let lookButton = options.lookButton ?? 0;
  let speed = options.speed ?? "normal";
  let gravity = options.gravity ?? true;
  const floorProbeInterval = Math.max(
    0,
    options.floorProbeInterval ?? DEFAULT_FLOOR_PROBE_INTERVAL,
  );
  let floorProbeElapsed = floorProbeInterval;
  let trackedSurface: number | null = null;
  /** Downward speed of a fall in progress, in scene units per second. */
  let fallSpeed = 0;
  let travel: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromYaw: number;
    toYaw: number;
    fromPitch: number;
    toPitch: number;
    elapsed: number;
    duration: number;
    surface: number | null;
  } | null = null;
  const sceneUnitsPerFoot = options.sceneUnitsPerFoot ?? 1;
  const eyeHeight = options.eyeHeight ?? EYE_HEIGHT_FEET * sceneUnitsPerFoot;

  // A basis that maps "forward, right, up" to whichever axis this scene stands
  // on, so the same movement code serves both the Y-up and Z-up viewports.
  const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);

  function applyRotation(): void {
    const cosPitch = Math.cos(pitch);
    const forward = up === "y"
      ? new THREE.Vector3(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch)
      : new THREE.Vector3(Math.cos(yaw) * cosPitch, Math.sin(yaw) * cosPitch, Math.sin(pitch));
    camera.up.copy(upVector);
    camera.lookAt(camera.position.clone().add(forward));
  }

  function facingAngles(from: THREE.Vector3, to: THREE.Vector3): { yaw: number; pitch: number } {
    const direction = to.clone().sub(from);
    if (up === "y") {
      return {
        yaw: Math.atan2(direction.x, direction.z),
        pitch: Math.max(
          -MAX_PITCH,
          Math.min(MAX_PITCH, Math.atan2(direction.y, Math.hypot(direction.x, direction.z))),
        ),
      };
    }
    return {
      yaw: Math.atan2(direction.y, direction.x),
      pitch: Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, Math.atan2(direction.z, Math.hypot(direction.x, direction.y))),
      ),
    };
  }

  function setFacing(from: THREE.Vector3, to: THREE.Vector3): void {
    const facing = facingAngles(from, to);
    yaw = facing.yaw;
    pitch = facing.pitch;
  }

  function cancelTravel(): void {
    travel = null;
  }

  /**
   * The view turns by exactly what the hand did, and stops when the hand stops.
   *
   * There was briefly a momentum tail here, on the strength of Autodesk's
   * `mouseTurnStopDuration`. It was wrong twice over: it replayed the last
   * move's delta on top of the one already applied, so every drag over-turned
   * by one move's worth — 2.5 degrees on a ten-move drag — and the error was
   * absolute, so it compounded. Twenty drags came out 50 degrees from where
   * they were aimed. A smoothing filter has to be conservative in total travel;
   * one that adds a fixed surcharge per gesture is a drift generator.
   */
  function applyLookDelta(movementX: number, movementY: number): void {
    if (!looking) return;
    yaw -= movementX * LOOK_SPEED;
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - movementY * LOOK_SPEED));
    applyRotation();
  }

  function onPointerMove(event: PointerEvent): void {
    applyLookDelta(event.movementX, event.movementY);
  }

  function reportLooking(next: boolean): void {
    if (looking === next) return;
    looking = next;
    options.onLookChange?.(looking);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled) return;
    if (walkKeyboardTargetIsInteractive(event.target)) return;
    if (walkKeyboardEventUsesSystemShortcut(event)) return;
    if (event.code === "Escape") {
      // Nothing to hand back now that looking is an ordinary drag, so Escape
      // means what it says the first time it is pressed.
      options.onExit?.();
      return;
    }
    if (!event.repeat && (event.code === "Minus" || event.code === "NumpadSubtract")) {
      speed = stepWalkSpeed(speed, -1);
      options.onSpeedChange?.(speed);
      event.preventDefault();
      return;
    }
    if (!event.repeat && (event.code === "Equal" || event.code === "NumpadAdd")) {
      speed = stepWalkSpeed(speed, 1);
      options.onSpeedChange?.(speed);
      event.preventDefault();
      return;
    }
    if (!event.repeat && event.code === "Space") {
      dropToSurface();
      event.preventDefault();
      return;
    }
    if (/^(Arrow|Key[WASDQE])/.test(event.code)) cancelTravel();
    pressed.add(event.code);
    // The keys that drive the walker would otherwise scroll the page.
    if (/^(Arrow|Space|Key[WASDQE])/.test(event.code)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled || event.button !== lookButton) return;
    cancelTravel();
    // Turning a corner is one gesture: hold W, drag to steer, and keep going.
    // Walking used to stop dead for the duration of the drag, which made every
    // corner a stop-turn-start and is not how BIM Walk behaves.
    floorProbeElapsed = 0;
    lookPointerId = event.pointerId;
    reportLooking(true);
    // Capture, not lock: the drag keeps receiving moves past the canvas edge,
    // but the cursor stays visible and stays the reviewer's to move.
    domElement.setPointerCapture(event.pointerId);
  }

  function releaseInput(): void {
    pressed.clear();
    stopLooking();
  }

  function onVisibilityChange(): void {
    if (document.hidden) releaseInput();
  }

  function stopLooking(event?: PointerEvent): void {
    if (event && event.pointerId !== lookPointerId) return;
    if (!looking) return;
    const pointerId = lookPointerId;
    lookPointerId = null;
    reportLooking(false);
    if (pointerId != null && domElement.hasPointerCapture(pointerId)) {
      domElement.releasePointerCapture(pointerId);
    }
  }

  function enable(): void {
    if (enabled) return;
    enabled = true;
    camera.position.copy(options.start);
    setFacing(options.start, options.lookAt);
    applyRotation();
    velocity.set(0, 0, 0);
    fallSpeed = 0;
    floorProbeElapsed = floorProbeInterval;
    trackedSurface = null;
    domElement.addEventListener("pointerdown", onPointerDown);
    domElement.addEventListener("pointermove", onPointerMove);
    domElement.addEventListener("pointerup", stopLooking);
    domElement.addEventListener("pointercancel", stopLooking);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseInput);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function disable(): void {
    if (!enabled) return;
    enabled = false;
    cancelTravel();
    releaseInput();
    domElement.removeEventListener("pointerdown", onPointerDown);
    domElement.removeEventListener("pointermove", onPointerMove);
    domElement.removeEventListener("pointerup", stopLooking);
    domElement.removeEventListener("pointercancel", stopLooking);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", releaseInput);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  function update(deltaSeconds: number): void {
    if (!enabled) return;
    const step = Math.min(deltaSeconds, 0.1);
    // Looking steers; it does not stop the walker. Movement, gravity and the
    // floor probe all keep running under the drag, so a held W carries you
    // round the corner you are dragging towards.
    if (travel) {
      travel.elapsed += step;
      const progress = Math.min(1, travel.elapsed / travel.duration);
      const eased = easeTravelProgress(progress);
      camera.position.lerpVectors(travel.from, travel.to, eased);
      const yawDelta = Math.atan2(
        Math.sin(travel.toYaw - travel.fromYaw),
        Math.cos(travel.toYaw - travel.fromYaw),
      );
      yaw = travel.fromYaw + yawDelta * eased;
      pitch = THREE.MathUtils.lerp(travel.fromPitch, travel.toPitch, eased);
      if (progress >= 1) {
        camera.position.copy(travel.to);
        yaw = travel.toYaw;
        pitch = travel.toPitch;
        trackedSurface = travel.surface;
        travel = null;
        floorProbeElapsed = floorProbeInterval;
      }
      applyRotation();
      return;
    }

    const forwardInput = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0)
      - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
    const strafeInput = (pressed.has("KeyD") ? 1 : 0) - (pressed.has("KeyA") ? 1 : 0);
    // Turning is a look, not a move: it changes facing without asking the floor
    // probe to reconsider, exactly as holding the arrow key does in BIM Walk.
    const turnInput = turnDirection(pressed);
    if (turnInput) yaw += turnInput * KEYBOARD_TURN_SPEED * step;
    const floorTravelInput = floorTravelDirection(pressed);

    // Movement stays in the horizontal plane whatever the camera is looking at,
    // so looking down at the floor does not drive the walker into it.
    const movementSpeed = FIRST_PERSON_SPEEDS[speed] * sceneUnitsPerFoot
      * (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? RUN_MULTIPLIER : 1);
    const target = horizontalWalkDirection(up, yaw, forwardInput, strafeInput)
      .multiplyScalar(movementSpeed);
    if (floorTravelInput) {
      target.addScaledVector(upVector, floorTravelInput * RISE_SPEED * sceneUnitsPerFoot);
    }

    velocity.lerp(target, Math.min(1, DAMPING * step));
    const from = camera.position.clone();
    const next = from.clone().addScaledVector(velocity, step);
    camera.position.copy(options.resolveMovement?.(from, next) ?? next);

    let height = up === "y" ? camera.position.y : camera.position.z;
    floorProbeElapsed += step;
    // The floor is probed whether or not a movement key is down. Gating this on
    // movement meant a walker standing still never learned there was a floor
    // below, so `trackedSurface` stayed null and gravity never ran: you could
    // hover in mid-air indefinitely and only drop once you pressed W. Autodesk
    // falls after ten updates without ground under it, asked or not.
    if (
      gravity &&
      !floorTravelInput &&
      options.resolveFloor &&
      floorProbeElapsed >= floorProbeInterval
    ) {
      floorProbeElapsed = 0;
      const surface = options.resolveFloor(camera.position);
      if (surface != null) {
        const targetEye = surface + eyeHeight;
        // A stair riser is walkable; a desk or roof encountered by the probe is
        // not something the camera should snap upward onto.
        if (targetEye <= height + WALK_MAX_STEP_UP * sceneUnitsPerFoot) {
          trackedSurface = surface;
        }
      }
    }
    if (gravity && !floorTravelInput && trackedSurface != null) {
      const targetEye = Math.max(options.floor, trackedSurface + eyeHeight);
      if (height <= targetEye) {
        // Stepping up onto a tread. Eased, so a stair climbs smoothly.
        fallSpeed = 0;
        height = THREE.MathUtils.lerp(height, targetEye, Math.min(1, DAMPING * step));
      } else {
        fallSpeed = Math.min(
          TOP_FALL_SPEED * sceneUnitsPerFoot,
          fallSpeed + GRAVITY_ACCELERATION * sceneUnitsPerFoot * step,
        );
        height = Math.max(targetEye, height - fallSpeed * step);
        if (height === targetEye) fallSpeed = 0;
      }
      if (up === "y") camera.position.y = height;
      else camera.position.z = height;
      velocity[up] = 0;
    } else {
      fallSpeed = 0;
    }

    // Walk mode keeps an eye above the model baseline when no surface was hit.
    // Float is deliberately unconstrained: source handoff and Q-down both need
    // to preserve a viewpoint below another source's nominal floor.
    height = up === "y" ? camera.position.y : camera.position.z;
    if (gravity && height < options.floor) {
      if (up === "y") camera.position.y = options.floor;
      else camera.position.z = options.floor;
      if (velocity[up] < 0) velocity[up] = 0;
    }
    applyRotation();
  }

  function dropToSurface(): boolean {
    cancelTravel();
    const surface = options.resolveFloor?.(
      camera.position,
      options.dropDistance ?? 10_000 * sceneUnitsPerFoot,
    ) ?? null;
    const droppedEye = droppedEyeCoordinate(surface, options.floor, eyeHeight);
    if (up === "y") camera.position.y = droppedEye;
    else camera.position.z = droppedEye;
    velocity.set(0, 0, 0);
    fallSpeed = 0;
    gravity = true;
    floorProbeElapsed = 0;
    trackedSurface = surface;
    options.onGravityChange?.(true);
    applyRotation();
    return surface != null;
  }

  function travelToSurface(point: THREE.Vector3, surfaceNormal?: THREE.Vector3): void {
    const normal = surfaceNormal?.clone().normalize() ?? upVector.clone();
    const horizontalNormal = normal.clone().addScaledVector(upVector, -normal.dot(upVector));
    const isWalkingSurface = Math.abs(normal.dot(upVector)) >= 0.55;
    const destination = point.clone();
    let destinationSurface: number | null = null;
    if (isWalkingSurface || horizontalNormal.lengthSq() < 1e-6) {
      destination.addScaledVector(upVector, eyeHeight);
      destinationSurface = up === "y" ? point.y : point.z;
    } else {
      horizontalNormal.normalize();
      if (horizontalNormal.dot(camera.position.clone().sub(point)) < 0) horizontalNormal.negate();
      const standOff = 3 * sceneUnitsPerFoot;
      destination.addScaledVector(horizontalNormal, standOff);
      const floor = options.resolveFloor?.(destination);
      if (floor != null) {
        if (up === "y") destination.y = floor + eyeHeight;
        else destination.z = floor + eyeHeight;
        destinationSurface = floor;
      }
    }
    const distanceFeet = camera.position.distanceTo(destination) / sceneUnitsPerFoot;
    travel = {
      from: camera.position.clone(),
      to: destination,
      fromYaw: yaw,
      toYaw: yaw,
      fromPitch: pitch,
      toPitch: pitch,
      elapsed: 0,
      duration: travelDurationSeconds(distanceFeet),
      surface: destinationSurface,
    };
    velocity.set(0, 0, 0);
    fallSpeed = 0;
    floorProbeElapsed = 0;
    trackedSurface = null;
  }

  return {
    enable,
    disable,
    update,
    isLooking: () => looking,
    setLookButton: (button) => {
      if (button === lookButton) return;
      lookButton = button;
      stopLooking();
    },
    setSpeed: (nextSpeed) => {
      speed = nextSpeed;
    },
    setGravity: (enabled) => {
      gravity = enabled;
      cancelTravel();
      velocity[up] = 0;
      fallSpeed = 0;
      floorProbeElapsed = floorProbeInterval;
      trackedSurface = null;
    },
    dropToSurface,
    travelToSurface,
    dispose: disable,
  };
}

/** Eye height above a scene's floor, exported so callers can place the walker. */
export const WALK_EYE_HEIGHT = EYE_HEIGHT_FEET;

export type WalkFlightOptions = {
  camera: THREE.PerspectiveCamera;
  /** The walk start eye position the flight lands on. */
  start: THREE.Vector3;
  /** Where the walker will be looking when walk controls take over. */
  lookAt: THREE.Vector3;
  up: "y" | "z";
  /** Extra height, in scene units, the arc keeps over the landing point. */
  clearance: number;
  durationMs?: number;
  invalidate: () => void;
  onDone: () => void;
};

/**
 * Arc height and duration for a teleport flight, scaled to how far it travels.
 * A hop a few feet along the same floor glides low and lands quickly; a jump
 * across the campus rises to the full clearance and takes longer, with the
 * growth square-rooted so even the longest teleport stays under 1.4 seconds.
 * Distances and clearance share whatever unit the scene uses.
 */
export function walkFlightProfile(
  distance: number,
  clearance: number,
): { arc: number; durationMs: number } {
  const reach = distance / Math.max(clearance, 1e-6);
  const arc = clearance * Math.min(1, 0.08 + reach * 0.3);
  const durationMs = Math.round(Math.min(1_400, Math.max(380, 400 * (0.75 + Math.sqrt(reach)))));
  return { arc, durationMs };
}

/**
 * A short eased descent from the current camera pose into a walk start,
 * instead of a hard cut. The path is a quadratic arc sized by the travel
 * distance — low and quick for a same-floor hop, up to `clearance` above the
 * landing spot for a cross-campus jump — so a map teleport reads as "flying
 * down into the building", the way dollhouse-style viewers keep the viewer
 * oriented. Honors reduced-motion preferences and returns a cancel function;
 * cancelling never calls `onDone`.
 */
export function flyToWalkStart(options: WalkFlightOptions): () => void {
  const { camera, start, lookAt, invalidate, onDone } = options;
  const axis = options.up;
  const from = camera.position.clone();
  const reduceMotion = typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || from.distanceTo(start) < options.clearance * 0.05) {
    onDone();
    return () => {};
  }
  const profile = walkFlightProfile(from.distanceTo(start), options.clearance);
  const fromLook = from.clone().addScaledVector(
    camera.getWorldDirection(new THREE.Vector3()),
    Math.max(from.distanceTo(start), options.clearance),
  );
  const control = from.clone().lerp(start, 0.55);
  control[axis] = Math.max(from[axis], start[axis] + profile.arc);
  const duration = options.durationMs ?? profile.durationMs;
  const startedAt = performance.now();
  const position = new THREE.Vector3();
  const look = new THREE.Vector3();
  let frame = 0;
  let finished = false;
  const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
  const tick = () => {
    const t = Math.min(1, (performance.now() - startedAt) / duration);
    const k = easeInOutCubic(t);
    const inverse = 1 - k;
    position.copy(from).multiplyScalar(inverse * inverse)
      .addScaledVector(control, 2 * inverse * k)
      .addScaledVector(start, k * k);
    look.copy(fromLook).lerp(lookAt, k);
    camera.position.copy(position);
    camera.lookAt(look);
    invalidate();
    if (t >= 1) { finished = true; onDone(); return; }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { if (!finished) cancelAnimationFrame(frame); };
}
