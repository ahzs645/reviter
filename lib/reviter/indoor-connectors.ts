import { directoryModelFloor } from "../../app/studio/directory-model.ts";
import {
  validReviewedShaft,
  supportedShaftStop,
  type ReviewedShaft,
} from "./reviewed-shaft.ts";
import type { ConvertResult } from "./types.ts";
import {
  containsDirectoryRoomPoint,
  isWalkable,
  roomBuilding,
  type DirectoryRoom,
  type RoomPoint,
} from "./room-directory.ts";
/** Explicit reviewer/exporter statements, bound to exact model bytes. Geometry overlap
 * and names are deliberately absent from connector discovery. */
export type IndoorConnectorReview = {
  version: 1;
  modelSha256: string;
  connectors: {
    id: string;
    kind: "elevator" | "escalator";
    nativeElementId: number;
    evidence: string;
    reviewedShaft?: ReviewedShaft;
    accessible: "yes" | "no" | "unknown";
    direction: "both" | "from-to" | "to-from";
    /** Ordered by the explicit travel direction, not proximity or floor labels. */
    entrances: {
      roomKey: string;
      /** Explicit shaft-area identity whose destination is this lobby stop. */
      areaKey?: string;
      levelId: number;
      nativeElementId: number;
      pointFeet: RoomPoint;
    }[];
  }[];
};
export function validateIndoorConnectorReview(
  value: unknown,
): asserts value is IndoorConnectorReview {
  const d = value as IndoorConnectorReview;
  if (
    !d ||
    d.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(d.modelSha256) ||
    !Array.isArray(d.connectors) ||
    d.connectors.length > 5000
  )
    throw new Error(
      "Connector review requires version 1 and an exact model SHA-256.",
    );
  const ids = new Set<string>();
  for (const c of d.connectors) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      c.id.length > 200 ||
      ids.has(c.id) ||
      !["elevator", "escalator"].includes(c.kind) ||
      (c.reviewedShaft !== undefined &&
        (c.kind !== "elevator" ||
          !validReviewedShaft(c.reviewedShaft) ||
          !c.reviewedShaft.wallElementIds.includes(c.nativeElementId))) ||
      !Number.isSafeInteger(c.nativeElementId) ||
      typeof c.evidence !== "string" ||
      !c.evidence.trim() ||
      c.evidence.length > 10000 ||
      !["yes", "no", "unknown"].includes(c.accessible) ||
      !["both", "from-to", "to-from"].includes(c.direction) ||
      (c.kind === "escalator" &&
        (c.accessible === "yes" || c.direction === "both")) ||
      !Array.isArray(c.entrances) ||
      c.entrances.length < 2 ||
      c.entrances.length > 200 ||
      (c.kind === "escalator" && c.entrances.length !== 2) ||
      new Set(c.entrances.map((e) => e.levelId)).size !== c.entrances.length ||
      c.entrances.some(
        (e) =>
          !e ||
          typeof e.roomKey !== "string" ||
          !e.roomKey ||
          (e.areaKey !== undefined &&
            (!c.reviewedShaft ||
              typeof e.areaKey !== "string" ||
              !e.areaKey.trim() ||
              e.areaKey.length > 512)) ||
          !Number.isSafeInteger(e.levelId) ||
          !Number.isSafeInteger(e.nativeElementId) ||
          !Array.isArray(e.pointFeet) ||
          e.pointFeet.length !== 2 ||
          !e.pointFeet.every((p) => Number.isFinite(p) && Math.abs(p) < 1e7),
      )
    )
      throw new Error(
        "Invalid explicit connector identity, served floors, direction or accessibility.",
      );
    ids.add(c.id);
  }
}
export function supportedIndoorConnectors(
  model: ConvertResult,
  rooms: readonly DirectoryRoom[],
  sha: string,
  value: IndoorConnectorReview,
) {
  validateIndoorConnectorReview(value);
  if (value.modelSha256 !== sha)
    throw new Error("Connector review belongs to different model bytes.");
  const nativeIds = new Set(model.elementBounds.map((e) => e.elementId)),
    levels = new Set(
      model.levels.flatMap((l) => (l.levelId == null ? [] : [l.levelId])),
    );
  const accepted: IndoorConnectorReview["connectors"] = [],
    rejected: { id: string; message: string }[] = [];
  const incompatibleCategories = new Set([
    -2000011, -2000170, -2000171, -2000023, -2000014, -2000100, -2000133,
    -2000919, -2000920,
  ]);
  for (const c of value.connectors) {
    const main = model.elementBounds.find(
      (e) => e.elementId === c.nativeElementId,
    );
    const linked = c.entrances.map((e) =>
      rooms.find(
        (r) =>
          r.key === e.roomKey &&
          r.levelId === e.levelId &&
          r.status !== "deleted",
      ),
    );
    if (
      !nativeIds.has(c.nativeElementId) ||
      (!c.reviewedShaft && incompatibleCategories.has(main?.categoryId ?? 0)) ||
      (!c.reviewedShaft &&
        /^(?:walls?|columns?|structural columns?|floors?|doors?|stairs?)$/i.test(
          main?.categoryName ?? "",
        )) ||
      linked.some(
        (r, i) =>
          !r ||
          !isWalkable(r) ||
          r.access?.kind === "staff" ||
          !levels.has(c.entrances[i]!.levelId) ||
          !nativeIds.has(c.entrances[i]!.nativeElementId) ||
          (c.reviewedShaft
            ? !supportedShaftStop(
                model,
                c.reviewedShaft,
                c.entrances[i]!.nativeElementId,
                c.entrances[i]!.pointFeet,
                directoryModelFloor(model, rooms, r.levelId, r.key)
                  ?.roomElevations[r.key]?.elevation ?? NaN,
              )
            : !model.nativeAssociatedLevelRelations?.some(
                (relation) =>
                  relation.elementId === c.entrances[i]!.nativeElementId &&
                  relation.levelId === c.entrances[i]!.levelId,
              )) ||
          !containsDirectoryRoomPoint(c.entrances[i]!.pointFeet, r) ||
          (c.entrances[i]!.areaKey !== undefined &&
            !rooms.some(
              (area) =>
                area.key === c.entrances[i]!.areaKey &&
                area.levelId === r.levelId &&
                area.status !== "deleted" &&
                isWalkable(area) &&
                area.access?.kind !== "staff" &&
                !!c.reviewedShaft &&
                containsDirectoryRoomPoint(c.reviewedShaft.pointFeet, area),
            )),
      ) ||
      (!c.reviewedShaft &&
        new Set(linked.map((r) => r && roomBuilding(r))).size !== 1)
    )
      rejected.push({
        id: c.id,
        message:
          "Reviewed connector lacks native connector/shaft evidence, a supported served floor or a walkable room entrance.",
      });
    else accepted.push(c);
  }
  return { accepted, rejected };
}
