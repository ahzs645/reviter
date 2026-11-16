/** Door-scoped native-cell owner review.
 *
 * A short, explicitly listed set of native doors may take their two owner rooms
 * from the native wall-bounded cells on each side of the door (the opt-in
 * matcher in directory-navigation.ts) where the registered room outline stops
 * short of the real wall. Every other door keeps the legacy result untouched.
 *
 * A listed door is applied only when ALL of this holds, otherwise the compile
 * throws:
 *  - the door exists on the level with a precise footprint and normal;
 *  - no reviewed door link names it (explicit reviews keep precedence);
 *  - the ordinary pipeline (legacy matcher, physical-level labels, automatic
 *    native ownership recovery) left it without a portal;
 *  - the native-cell matcher, with its default steps and its fail-closed 2 ft
 *    owner gap, decides two different walkable rooms in two different cells;
 *  - those two rooms are exactly the two listed rooms, at one floor height.
 * No tolerance is configurable here.
 *
 * The cells are the plane's own exact native free space (nativeWalkingRegion,
 * the same authority the native circulation cells use) minus every door
 * threshold on that plane, with room identities attached by the unchanged
 * majority rule. They are never derived from room outlines. This grants no
 * access: the door edge keeps `accessible: "unknown"` like any native door. */
import * as DMath from "./deterministic-math.ts";
import {
  nativeRationalOverlay,
  nativeRationalScalarToIEEE,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import {
  nativeRationalAreaCompare,
  nativeRationalFootprintSupported,
} from "./native-exact-planar-topology.ts";
import { nativeRationalIntersectionOperand } from "./native-rational-intersection-broadphase.ts";
import { nativeRoomIdentityRings } from "./native-floor-opening-ownership.ts";
import { nativeAccessZoneSplit, nativeAccessZonesAt } from "./native-access-zones.ts";
import {
  directoryDoorReviews,
  NATIVE_DOOR_OWNER_MAX_GAP_FEET,
  NATIVE_DOOR_SIDE_STEPS_FEET,
  type DoorReview,
  type NativeCellDoorOwners,
  type NativeDoorCell,
  type ReviewedDoorLink,
} from "./directory-navigation.ts";
import type {
  DirectoryDoor,
  DirectoryRoom,
  RoomPoint,
  RoomPortal,
} from "./room-directory.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

export type NativeDoorOwnerDecision = {
  levelId: number;
  nativeDoorId: number;
  roomKeys: [string, string];
};
export type NativeDoorOwnerEvidence = {
  levelId: number;
  nativeDoorId: number;
  /** Present for a listed decision; absent for a diagnostic observation. */
  listedRoomKeys?: [string, string];
  accepted: boolean;
  /** True only for an accepted listed decision: the door was connected. */
  applied: boolean;
  reason?: string;
  elevationFeet?: number;
  door?: {
    pointFeet: RoomPoint;
    normalFeet?: RoomPoint;
    footprintFeet?: RoomPoint[];
  };
  /** Outcome of the unchanged pipeline before this review. */
  ordinary?: {
    state: DoorReview["state"];
    candidates: string[];
    portalRooms?: [string, string];
    hasExplicitReview: boolean;
  };
  native?: {
    kind: NativeCellDoorOwners["kind"];
    rooms?: [string, string];
    reason?: string;
    /** Side against the normal first, then along it. */
    sides: {
      side: "against-normal" | "along-normal";
      cellId?: string;
      cellRoomKeys?: string[];
      /** Outer ring bounds of the cell: min x, min y, max x, max y. */
      cellBoundsFeet?: [number, number, number, number];
      stepFeet?: number;
      probeFeet?: RoomPoint;
      owner?: string;
      ownerGapFeet?: number;
      reason?: string;
    }[];
  };
  limits: { stepsFeet: number[]; maxOwnerGapFeet: number };
  cells?: { planeFaces: number; classifiedNearDoor: number };
  /** The portal and exported door as applied (accepted listed decision only). */
  portal?: RoomPortal;
};
export type NativeDoorOwnerReviewOption = {
  /** Listed doors. Each is applied exactly as listed or the compile throws. */
  decisions: readonly NativeDoorOwnerDecision[];
  /** Diagnostics only: the same predicate is evaluated and reported, the door
   * is never changed and nothing is thrown. */
  observe?: readonly { levelId: number; nativeDoorId: number }[];
  onEvidence?: (evidence: NativeDoorOwnerEvidence) => void;
};

const LIMITS = () => ({
  stepsFeet: [...NATIVE_DOOR_SIDE_STEPS_FEET],
  maxOwnerGapFeet: NATIVE_DOOR_OWNER_MAX_GAP_FEET,
});
const doorKey = (levelId: number, nativeDoorId: number) =>
  `${levelId}:${nativeDoorId}`;

/** Shape only. Model, door, room and geometry checks happen in the compile. */
export function validateNativeDoorOwnerDecisions(
  value: unknown,
): asserts value is NativeDoorOwnerDecision[] {
  if (!Array.isArray(value) || value.length > 64)
    throw new Error(
      "Native door owner review needs a finite list of at most 64 doors.",
    );
  const seen = new Set<string>();
  for (const d of value as Partial<NativeDoorOwnerDecision>[]) {
    if (
      !d ||
      !Number.isSafeInteger(d.levelId) ||
      !Number.isSafeInteger(d.nativeDoorId) ||
      !Array.isArray(d.roomKeys) ||
      d.roomKeys.length !== 2 ||
      d.roomKeys.some((k) => typeof k !== "string" || !k.trim()) ||
      d.roomKeys[0] === d.roomKeys[1]
    )
      throw new Error(
        "Native door owner review rows need an integer level, an integer native door and two different room keys.",
      );
    const key = doorKey(d.levelId!, d.nativeDoorId!);
    if (seen.has(key))
      throw new Error(
        `Native door owner review lists door ${d.nativeDoorId} on level ${d.levelId} more than once.`,
      );
    seen.add(key);
  }
}

const ieeeRings = (part: NativeRationalParts[number]): RoomPoint[][] =>
  part.map((ring) =>
    ring.map(
      ([x, y]) =>
        [nativeRationalScalarToIEEE(x), nativeRationalScalarToIEEE(y)] as RoomPoint,
    ),
  );

/** Native wall-bounded cells of one physical plane near the given doors.
 *
 * Mirrors the strict branch of prepareNativeCirculationGeometry: exact free
 * floor minus every door threshold, split along the reviewed access zones,
 * kept only where it is supported walking floor, and named by the majority
 * rule (a room is a member when the overlap is at least half the room identity
 * or half the face). Faces with a staff or non-walkable member, and faces with
 * no member, carry no cell. Connector anchors do not exist yet at door review,
 * so an unlabelled face that the finished geometry would name from an anchor
 * has no cell here: that side then stays undecided (fail closed).
 *
 * Only faces whose bounds meet a door's probe reach are classified; a face a
 * probe cannot land in cannot change the matcher's answer. */
export function nativeDoorOwnerPlaneCells(input: {
  dataset: IndoorDataset;
  elevationFeet: number;
  /** nativeWalkingRegion(model, dataset, elevationFeet, true) of this plane. */
  region: { exact?: { free: NativeRationalParts; walkable: NativeRationalParts } };
  /** Every door threshold footprint on the plane's levels. */
  thresholdsFeet: readonly (readonly RoomPoint[])[];
  doors: readonly DirectoryDoor[];
}): { cells: NativeDoorCell[]; planeFaces: number; classifiedNearDoor: number } {
  const { dataset: data, elevationFeet: z, region } = input;
  if (!data.nativeIndoorEnvelopes || !region.exact)
    throw new Error(
      "Native door owner review needs the exact native walking authority of a native-envelope project.",
    );
  const reach = Math.max(...NATIVE_DOOR_SIDE_STEPS_FEET) + 0.01;
  const boxes = input.doors
    .filter((d) => d.footprint?.length)
    .map((d) => {
      const span =
        Math.max(
          ...d.footprint!.map((p) =>
            DMath.hypot(p[0] - d.point[0], p[1] - d.point[1]),
          ),
        ) + reach;
      return [
        d.point[0] - span,
        d.point[1] - span,
        d.point[0] + span,
        d.point[1] + span,
      ] as const;
    });
  const physicalFaces = nativeRationalOverlay(
    "difference",
    region.exact.free,
    input.thresholdsFeet.map((ring) => [[...ring]]),
  );
  const owners = data.records.filter(
    (r) => Math.abs(r.elevationFeet - z) < 0.05 && r.walkable,
  );
  const recordsByKey = new Map(data.records.map((r) => [r.key, r]));
  const cells: NativeDoorCell[] = [];
  let index = -1,
    classifiedNearDoor = 0;
  const pieces = nativeAccessZoneSplit(physicalFaces, nativeAccessZonesAt(data, z));
  for (const { part, zone } of pieces) {
    index++;
    const rings = ieeeRings(part),
      outer = rings[0];
    if (!outer?.length) continue;
    const xs = outer.map((p) => p[0]),
      ys = outer.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (
      !boxes.some(
        (b) => box[0]! <= b[2] && box[2]! >= b[0] && box[1]! <= b[3] && box[3]! >= b[1],
      )
    )
      continue;
    classifiedNearDoor++;
    const face: NativeRationalParts = [part];
    if (
      !nativeRationalFootprintSupported(
        face,
        zone ? region.exact.free : region.exact.walkable,
      )
    )
      continue;
    const id = `native-door-owner-cell:${z.toFixed(6)}:${index}`;
    if (zone) {
      if (zone.zone.access !== "staff") continue;
      cells.push({
        id,
        roomKeys: zone.zone.memberRoomKeys
          .filter((k) => recordsByKey.has(k))
          .sort(),
        ringsFeet: rings,
      });
      continue;
    }
    const members = owners.filter((record) => {
      const identity = [nativeRoomIdentityRings(data, record)];
      const nearby = nativeRationalIntersectionOperand(identity, face);
      const overlap = nearby.length
        ? nativeRationalOverlay("intersection", identity, nearby)
        : [];
      return (
        nativeRationalAreaCompare(overlap, []) > 0 &&
        (nativeRationalAreaCompare(
          overlap,
          nativeRationalOverlay("union", identity),
          2n,
        ) >= 0 ||
          nativeRationalAreaCompare(overlap, face, 2n) >= 0)
      );
    });
    if (!members.length || members.some((r) => !r.walkable || r.access === "staff"))
      continue;
    cells.push({ id, roomKeys: members.map((r) => r.key).sort(), ringsFeet: rings });
  }
  return { cells, planeFaces: pieces.length, classifiedNearDoor };
}

/** One door against the review predicate. Pure: nothing is changed. `review`
 * is the door's outcome from the unchanged pipeline (legacy matcher, physical
 * level labels and automatic recovery) on the same rooms. */
export function evaluateNativeDoorOwner(input: {
  levelId: number;
  nativeDoorId: number;
  listedRoomKeys?: [string, string];
  /** Rooms of the door's level, as the pipeline matches doors against them. */
  rooms: readonly DirectoryRoom[];
  door: DirectoryDoor | undefined;
  review: DoorReview | undefined;
  /** Every reviewed door link of the project, accepted or not. */
  explicitLinks: readonly ReviewedDoorLink[];
  cells: readonly NativeDoorCell[];
  /** Why the plane's native cells could not be built; refuses the door. */
  cellsUnavailable?: string;
  roomElevationFeet: (roomKey: string) => number | undefined;
}): NativeDoorOwnerEvidence {
  const { levelId, nativeDoorId, listedRoomKeys, door, review } = input;
  const base: NativeDoorOwnerEvidence = {
    levelId,
    nativeDoorId,
    ...(listedRoomKeys ? { listedRoomKeys: [...listedRoomKeys] } : {}),
    accepted: false,
    applied: false,
    limits: LIMITS(),
  };
  const refuse = (reason: string, more: Partial<NativeDoorOwnerEvidence> = {}) => ({
    ...base,
    ...more,
    reason,
  });
  if (!door || !review)
    return refuse(`Native door ${nativeDoorId} does not exist on level ${levelId}.`);
  const facts: Partial<NativeDoorOwnerEvidence> = {
    door: {
      pointFeet: door.point,
      normalFeet: door.normal,
      footprintFeet: door.footprint,
    },
    ordinary: {
      state: review.state,
      candidates: [...review.candidates],
      ...(review.portal ? { portalRooms: [...review.portal.rooms] } : {}),
      hasExplicitReview: review.hasExplicitReview === true,
    },
  };
  if (!door.footprint || door.footprint.length < 3 || !door.normal)
    return refuse("The door has no precise footprint and normal.", facts);
  if (input.cellsUnavailable) return refuse(input.cellsUnavailable, facts);
  // The matcher is run alone on this door, with no reviewed links, default
  // steps and the default fail-closed owner gap: evidence for every outcome.
  const native = directoryDoorReviews(input.rooms, [door], [], [], {
    mode: "native-cell",
    cells: input.cells,
  })[0]!.nativeOwners!;
  const cellsById = new Map(input.cells.map((c) => [c.id, c]));
  const cellFacts = (id: string) => {
    const found = cellsById.get(id),
      outer = found?.ringsFeet[0] ?? [];
    return {
      cellRoomKeys: [...(found?.roomKeys ?? [])],
      ...(outer.length
        ? {
            cellBoundsFeet: [
              Math.min(...outer.map((p) => p[0])),
              Math.min(...outer.map((p) => p[1])),
              Math.max(...outer.map((p) => p[0])),
              Math.max(...outer.map((p) => p[1])),
            ] as [number, number, number, number],
          }
        : {}),
    };
  };
  facts.native = {
    kind: native.kind,
    ...(native.rooms ? { rooms: [...native.rooms] } : {}),
    ...(native.reason ? { reason: native.reason } : {}),
    sides: native.sides.map((s, i) => ({
      side: i ? ("along-normal" as const) : ("against-normal" as const),
      ...s,
      ...(s.cellId ? cellFacts(s.cellId) : {}),
    })),
  };
  if (
    review.hasExplicitReview ||
    input.explicitLinks.some((l) => l.doorId === door.id && l.levelId === levelId)
  )
    return refuse(
      "A reviewed door link already names this door; explicit reviews keep precedence.",
      facts,
    );
  if (review.portal)
    return refuse(
      `The door is already paired without this review (${review.portal.rooms.join(", ")}).`,
      facts,
    );
  if (native.legacyRooms)
    return refuse(
      `The legacy matcher already pairs this door (${native.legacyRooms.join(", ")}).`,
      facts,
    );
  if (native.kind !== "native-pair" || !native.rooms || !native.decided)
    return refuse(
      `The native-cell matcher does not decide this door: ${native.reason ?? native.kind}`,
      facts,
    );
  const [a, b] = native.rooms;
  const gaps = native.sides.map((s) => s.ownerGapFeet);
  if (
    a === b ||
    gaps.some(
      (g) => g === undefined || !(g >= 0) || g > NATIVE_DOOR_OWNER_MAX_GAP_FEET,
    )
  )
    return refuse("Native owners are not two rooms within the 2 ft owner gap.", facts);
  const za = input.roomElevationFeet(a),
    zb = input.roomElevationFeet(b);
  if (za === undefined || zb === undefined || Math.abs(za - zb) > 0.05)
    return refuse(
      "The two native owner rooms are not at one floor height.",
      facts,
    );
  if (
    listedRoomKeys &&
    [...listedRoomKeys].sort().join("\n") !== [a, b].sort().join("\n")
  )
    return refuse(
      `Native owners ${a}, ${b} are not the listed rooms ${listedRoomKeys.join(", ")}.`,
      facts,
    );
  return { ...base, ...facts, accepted: true };
}

/** Portal for an accepted decision: the native rule's portal, marked reviewed. */
export function reviewedNativeDoorOwnerPortal(
  rooms: readonly DirectoryRoom[],
  door: DirectoryDoor,
  cells: readonly NativeDoorCell[],
): RoomPortal | undefined {
  const portal = directoryDoorReviews(rooms, [door], [], [], {
    mode: "native-cell",
    cells,
  })[0]!.portal;
  return portal ? { ...portal, reviewed: true } : undefined;
}

export const nativeDoorOwnerReviewKey = doorKey;
