/**
 * First-person navigation for the model viewport.
 *
 * Orbiting is the right way to look at a building from outside and the wrong
 * way to understand it from inside: a corridor, a stair, a floor-to-ceiling
 * height read very differently at eye level. This adds a walk mode alongside
 * the orbit camera rather than replacing it.
 *
 * The scene is drawn in model feet with the model origin subtracted, so the
 * speeds and heights here are real building dimensions — a 5.6 ft eye height,
 * a walking pace of about 9 ft/s — and need no scaling.
 *
 * Mouse look uses capture-drag so interacting with the viewport never traps the
 * system pointer. Movement is WASD or the arrow keys, `Shift` to run, and Q/E
 * to descend/ascend between floors.
 */
import * as THREE from "three";

/** Eye height above the floor the walker is standing on, in feet. */
const EYE_HEIGHT_FEET = 5.6;

export type WalkSpeed = "slow" | "normal" | "fast";

/** Autodesk-style speed steps, expressed in model feet per second. */
export const FIRST_PERSON_SPEEDS: Readonly<Record<WalkSpeed, number>> = {
  slow: 3.5,
  normal: 9,
  fast: 24,
};

const WALK_SPEED_ORDER: readonly WalkSpeed[] = ["slow", "normal", "fast"];
const RUN_MULTIPLIER = 2;

/** Vertical pace for rising and falling, in feet per second. */
const RISE_SPEED = 7;

/** How quickly velocity reaches the target pace; larger is snappier. */
const DAMPING = 12;

/** Radians of pitch either side of the horizon, kept just short of vertical. */
const MAX_PITCH = Math.PI / 2 - 0.02;

/** Mouse sensitivity, radians per pixel. */
const LOOK_SPEED = 0.0022;
const FLOOR_PROBE_INTERVAL = 0.1;
export const WALK_MAX_STEP_UP = 1.5;

export function stepWalkSpeed(speed: WalkSpeed, direction: -1 | 1): WalkSpeed {
  const index = WALK_SPEED_ORDER.indexOf(speed);
  return WALK_SPEED_ORDER[Math.max(0, Math.min(WALK_SPEED_ORDER.length - 1, index + direction))];
}

export function floorTravelDirection(keys: ReadonlySet<string>): -1 | 0 | 1 {
  return ((keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)) as -1 | 0 | 1;
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

export type WalkControls = {
  /** Attach listeners and take over the camera. */
  enable(): void;
  /** Release the pointer and hand the camera back. */
  disable(): void;
  /** Advance by `deltaSeconds`; call once per animation frame while enabled. */
  update(deltaSeconds: number): void;
  /** True while a look drag is active. */
  isLooking(): boolean;
  /** Retained for navigation diagnostics; Walk never locks the pointer. */
  isPointerLocked(): boolean;
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
  const floorProbeInterval = Math.max(1 / 120, options.floorProbeInterval ?? FLOOR_PROBE_INTERVAL);
  let floorProbeElapsed = floorProbeInterval;
  let trackedSurface: number | null = null;
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

  function applyLookDelta(movementX: number, movementY: number): void {
    if (!looking) return;
    yaw -= movementX * LOOK_SPEED;
    pitch -= movementY * LOOK_SPEED;
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
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
    if (event.code === "Escape") {
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
    if (/^(Arrow|Space|Key[WASDCQE])/.test(event.code)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled || event.button !== lookButton) return;
    cancelTravel();
    // Looking is an in-place gesture. Stop any damped walking momentum now so
    // the camera cannot coast or settle vertically underneath a mouse drag.
    velocity.set(0, 0, 0);
    lookPointerId = event.pointerId;
    reportLooking(true);
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
    // A look drag changes yaw and pitch only. In particular, do not continue a
    // held movement key, residual velocity, gravity settling, or floor travel
    // until the pointer is released.
    if (looking) {
      velocity.set(0, 0, 0);
      applyRotation();
      return;
    }
    const step = Math.min(deltaSeconds, 0.1);
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
    const strafeInput = (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0)
      - (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0);
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
    if (gravity && !floorTravelInput && options.resolveFloor && floorProbeElapsed >= floorProbeInterval) {
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
      height = THREE.MathUtils.lerp(height, targetEye, Math.min(1, DAMPING * step));
      if (up === "y") camera.position.y = height;
      else camera.position.z = height;
      velocity[up] = 0;
    }

    // Keep the walker above the model baseline even when no surface was hit.
    height = up === "y" ? camera.position.y : camera.position.z;
    if (height < options.floor) {
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
    floorProbeElapsed = 0;
    trackedSurface = null;
  }

  return {
    enable,
    disable,
    update,
    isLooking: () => looking,
    isPointerLocked: () => false,
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
