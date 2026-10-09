import type { ConvertResult } from "./types.ts";
import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";
import {
  containsRoomPoint,
  roomArea,
  type RoomPoint,
} from "./room-directory.ts";
import {
  routingFloorPlateRecords,
  nativeFloorPolygons,
} from "./routing-floor-support.ts";
import { prepareNativeCirculationGeometry } from "./native-circulation-geometry.ts";

/** A reviewer identifies use at a point, never supplies a replacement outline.
 * Recover only its bounded native free cell. Temporary slab owners permit
 * discovery; they are never returned or persisted as public circulation. */
export function recoverReviewedNativeCirculation(
  model: ConvertResult,
  data: IndoorDataset,
  seed: {
    pinId: string;
    levelId: number;
    pointFeet: RoomPoint;
    maximumAreaFeet: number;
  },
) {
  const level = data.nativeLevels.find((l) => l.id === seed.levelId);
  if (
    !level ||
    !seed.pinId ||
    !seed.pointFeet.every(Number.isFinite) ||
    !(seed.maximumAreaFeet > 0)
  )
    throw new Error(
      "A valid native level, review pin and bounded area limit are required.",
    );
  const inside = (rs: RoomPoint[][]) =>
    containsRoomPoint(seed.pointFeet, rs[0]!) &&
    !rs.slice(1).some((r) => containsRoomPoint(seed.pointFeet, r));
  const floors = routingFloorPlateRecords(model, level.elevationFeet);
  if (!floors.some((f) => nativeFloorPolygons(f, !!data.nativeIndoorEnvelopes).some(inside)))
    return {
      reason: "The pin has no flat native floor support at this elevation.",
    };
  const discovered = floors.flatMap((f) =>
    nativeFloorPolygons(f, !!data.nativeIndoorEnvelopes).map((ringsFeet, i): IndoorRecord => ({
      key: `discovery:${f.elementId}:${i}`,
      number: "",
      name: "Temporary native floor classification",
      building: "",
      levelId: level.id,
      elevationFeet: level.elevationFeet,
      elevationEvidence: "Native slab",
      surfaceId: `discovery:${f.elementId}`,
      circulation: true,
      stair: false,
      walkable: true,
      access: "unknown",
      confidence: 1,
      ringsFeet,
      properties: {},
    })),
  );
  const prepared = prepareNativeCirculationGeometry(model, {
    ...data,
    records: [
      ...data.records.filter(
        (r) => Math.abs(r.elevationFeet - level.elevationFeet) < 0.05,
      ),
      ...discovered,
    ],
  });
  const cells = prepared.geometry.cells.filter((c) => inside(c.ringsFeet));
  if (cells.length !== 1)
    return {
      reason:
        "The pin is blocked, private, on a flight, or has ambiguous native support.",
    };
  const cell = cells[0]!;
  const areaFeet =
    roomArea(cell.ringsFeet[0]!) -
    cell.ringsFeet.slice(1).reduce((n, r) => n + roomArea(r), 0);
  if (areaFeet > seed.maximumAreaFeet)
    return {
      reason:
        "This point would classify an unbounded wing; additional source review is needed.",
    };
  return {
    cell: {
      ...cell,
      roomKeys: cell.roomKeys.filter((k) => !k.startsWith("discovery:")),
    },
    areaFeet,
  };
}
