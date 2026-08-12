import type { DerivedRoom, DerivedRoomGap, DerivedRoomResult } from "./derived-rooms.ts";

export const ROOM_REVIEW_VERSION = 1 as const;

export type RoomDisposition = "unreviewed" | "accepted" | "dismissed";
export type GapDisposition = "unreviewed" | "treat-as-closed" | "dismissed";

/**
 * The `IfcSpace.PredefinedType` values a reviewed room may carry.
 *
 * The IFC exporter's header declares `FILE_SCHEMA(('IFC4'))`, and in IFC4 that
 * attribute is an `IfcSpaceTypeEnum` — SPACE, PARKING, GFA, INTERNAL, EXTERNAL,
 * USERDEFINED, NOTDEFINED. It is not the `IfcInternalOrExternalEnum` that held
 * IFC2x3's `IfcSpace.InteriorOrExteriorSpace`, so the EXTERNAL_EARTH /
 * EXTERNAL_WATER / EXTERNAL_FIRE items of that other enum would be rejected by
 * an IFC4 schema check. Reviter offers the three items below; the list is the
 * permitted set, not a formatting hint, because the value reaches STEP as a
 * bare `.ENUM.` token that no escaping function can make safe.
 */
export const SPACE_PREDEFINED_TYPES = ["INTERNAL", "EXTERNAL", "NOTDEFINED"] as const;

export type SpacePredefinedType = (typeof SPACE_PREDEFINED_TYPES)[number];

export function isSpacePredefinedType(value: unknown): value is SpacePredefinedType {
  return SPACE_PREDEFINED_TYPES.includes(value as SpacePredefinedType);
}

/** The permitted enum item for a value of unproven origin, defaulting to NOTDEFINED. */
export function spacePredefinedType(value: unknown): SpacePredefinedType {
  return isSpacePredefinedType(value) ? value : "NOTDEFINED";
}

export type RoomDetails = {
  number: string;
  name: string;
  longName: string;
  description: string;
  department: string;
  occupancyType: string;
  accessibility: string;
  notes: string;
  heightFeet: number | null;
};

export type ReviewedRoom = {
  roomId: string;
  candidateKey: string;
  levelId: number;
  closure: DerivedRoom["closure"];
  disposition: RoomDisposition;
  geometry: {
    areaSquareFeet: number;
    centroidFeet: [number, number];
    loopsFeet: [number, number][][];
  };
  gapIds: string[];
  details: RoomDetails;
  ifc: { export: boolean; predefinedType: SpacePredefinedType };
  createdAt: string;
  updatedAt: string;
};

export type ReviewedGap = DerivedRoomGap & {
  disposition: GapDisposition;
  note: string;
  updatedAt: string;
};

export type RoomReviewState = {
  rooms: ReviewedRoom[];
  gaps: ReviewedGap[];
};

export type RoomReviewSidecar = {
  format: "reviter-room-review";
  version: typeof ROOM_REVIEW_VERSION;
  algorithmVersion: 1;
  exportedAt: string;
  model: {
    fileName: string;
    byteLength: number;
    fingerprint: string;
  };
  coordinateSystem: "revit-model-feet";
  rooms: ReviewedRoom[];
  gaps: ReviewedGap[];
};

const emptyDetails = (): RoomDetails => ({
  number: "",
  name: "",
  longName: "",
  description: "",
  department: "",
  occupancyType: "",
  accessibility: "",
  notes: "",
  heightFeet: null,
});

function roomFromCandidate(room: DerivedRoom, now: string): ReviewedRoom {
  return {
    roomId: `review-${room.key}`,
    candidateKey: room.key,
    levelId: room.levelId,
    closure: room.closure,
    disposition: "unreviewed",
    geometry: {
      areaSquareFeet: room.areaSquareFeet,
      centroidFeet: room.centroid,
      loopsFeet: room.loops,
    },
    gapIds: [...room.gapIds],
    details: emptyDetails(),
    ifc: { export: false, predefinedType: "NOTDEFINED" },
    createdAt: now,
    updatedAt: now,
  };
}

/** Add fresh candidates without overwriting durable user decisions or details. */
export function reconcileRoomReview(
  current: RoomReviewState,
  derived: DerivedRoomResult,
  now = new Date().toISOString(),
): RoomReviewState {
  const byCandidate = new Map(current.rooms.map((room) => [room.candidateKey, room]));
  const generated = derived.rooms.map((candidate) => {
    const saved = byCandidate.get(candidate.key);
    if (!saved) return roomFromCandidate(candidate, now);
    return {
      ...saved,
      closure: candidate.closure,
      geometry: {
        areaSquareFeet: candidate.areaSquareFeet,
        centroidFeet: candidate.centroid,
        loopsFeet: candidate.loops,
      },
      gapIds: [...candidate.gapIds],
    };
  });
  const analyzedLevels = new Set(derived.levelIds);
  const otherLevels = current.rooms.filter((room) => !analyzedLevels.has(room.levelId));
  const staleReviewed = current.rooms.filter((room) =>
    analyzedLevels.has(room.levelId) && room.disposition !== "unreviewed" && !derived.rooms.some((candidate) => candidate.key === room.candidateKey));
  const gapsById = new Map(current.gaps.map((gap) => [gap.id, gap]));
  const generatedGaps = derived.gaps.map((gap) => {
    const saved = gapsById.get(gap.id);
    return saved ? { ...gap, disposition: saved.disposition, note: saved.note, updatedAt: saved.updatedAt } : {
      ...gap, disposition: "unreviewed" as const, note: "", updatedAt: now,
    };
  });
  const otherGaps = current.gaps.filter((gap) => !analyzedLevels.has(gap.levelId));
  const staleGapDecisions = current.gaps.filter((gap) =>
    analyzedLevels.has(gap.levelId) && gap.disposition !== "unreviewed" && !derived.gaps.some((candidate) => candidate.id === gap.id));
  return { rooms: [...otherLevels, ...generated, ...staleReviewed], gaps: [...otherGaps, ...generatedGaps, ...staleGapDecisions] };
}

export function mergeRoomReview(current: RoomReviewState, incoming: RoomReviewState): RoomReviewState {
  const merge = <T extends { updatedAt: string }>(left: readonly T[], right: readonly T[], key: (value: T) => string) => {
    const values = new Map(left.map((value) => [key(value), value]));
    for (const value of right) {
      const prior = values.get(key(value));
      if (!prior || Date.parse(value.updatedAt) >= Date.parse(prior.updatedAt)) values.set(key(value), value);
    }
    return [...values.values()];
  };
  return {
    rooms: merge(current.rooms, incoming.rooms, (room) => room.roomId),
    gaps: merge(current.gaps, incoming.gaps, (gap) => gap.id),
  };
}

function finitePoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function isReviewedRoom(value: unknown): value is ReviewedRoom {
  if (!value || typeof value !== "object") return false;
  const room = value as ReviewedRoom;
  return typeof room.roomId === "string" && typeof room.candidateKey === "string"
    && Number.isSafeInteger(room.levelId)
    && ["closed", "near-closed"].includes(room.closure)
    && ["unreviewed", "accepted", "dismissed"].includes(room.disposition)
    && Number.isFinite(room.geometry?.areaSquareFeet) && finitePoint(room.geometry?.centroidFeet)
    && Array.isArray(room.geometry?.loopsFeet) && room.geometry.loopsFeet.length <= 100
    && room.geometry.loopsFeet.every((loop) => Array.isArray(loop) && loop.length >= 3 && loop.length <= 20_000 && loop.every(finitePoint))
    && Array.isArray(room.gapIds) && room.gapIds.every((id) => typeof id === "string")
    && Boolean(room.details) && typeof room.details.name === "string"
    && Boolean(room.ifc) && typeof room.ifc.export === "boolean"
    && isSpacePredefinedType(room.ifc.predefinedType)
    && typeof room.createdAt === "string" && typeof room.updatedAt === "string";
}

export function isReviewedGap(value: unknown): value is ReviewedGap {
  if (!value || typeof value !== "object") return false;
  const gap = value as ReviewedGap;
  return typeof gap.id === "string" && Number.isSafeInteger(gap.levelId)
    && Array.isArray(gap.endpoints) && gap.endpoints.length === 2 && gap.endpoints.every(finitePoint)
    && Number.isFinite(gap.widthFeet) && gap.widthFeet >= 0
    && ["unreviewed", "treat-as-closed", "dismissed"].includes(gap.disposition)
    && typeof gap.note === "string" && typeof gap.updatedAt === "string";
}
