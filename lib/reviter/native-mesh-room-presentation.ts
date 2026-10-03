import pc from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { DirectoryRoom } from "./room-directory.ts";
import { roomArea } from "./room-directory.ts";
import { nativeMeshBarrierCuts } from "./native-mesh-barrier-cuts.ts";
import { recoverNativeRoomInteriors } from "./native-room-presentation.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";

const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (sum, rings) =>
      sum +
      roomArea(rings[0]! as [number, number][]) -
      rings.slice(1).reduce((s, r) => s + roomArea(r as [number, number][]), 0),
    0,
  );
const bounds = (rings: [number, number][][]) => {
  const points = rings.flat();
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
};
/** Retry unfinished visual rooms with the certified 3D wall joins. Existing
 * routing barriers stay authoritative and are never removed. Added material
 * must come from a closed owned native cross-section. Source identity, other
 * labels, circulation/void masks and precise physical floor support still gate
 * every candidate. This stage does not authorize doors or change the graph. */
export function recoverNativeMeshRoomInteriors(
  dataset: IndoorDataset,
  annotations: readonly DirectoryRoom[],
  model: ConvertResult,
  candidateKeys: ReadonlySet<string>,
  floorsByRecord: ReadonlyMap<string, ArchitecturalPlanGeometry["floors"]>,
) {
  const rooms: (ReturnType<
    typeof recoverNativeRoomInteriors
  >["rooms"][number] & {
    meshProof: {
      cutElevationFeet: number;
      precisionFeet: number;
      nativeFloorCoveredSquareFeet: number;
      nativeElementIds: number[];
    };
  })[] = [];
  const cutsByLevel = new Map<number, IndoorDataset["walls"]>();
  const seeds = new Map(annotations.map((r) => [r.key, r.labelPointFeet]));
  for (const record of dataset.records.filter(
    (r) => candidateKeys.has(r.key) && r.walkable && !r.circulation && !r.stair,
  )) {
    const elevation = model.levels.find(
      (l) => l.levelId === record.levelId,
    )?.elevation;
    if (elevation == null) continue;
    const cutElevationFeet = elevation + 4;
    let cuts = cutsByLevel.get(record.levelId);
    if (!cuts) {
      cuts = nativeMeshBarrierCuts(model, record.levelId, cutElevationFeet);
      cutsByLevel.set(record.levelId, cuts);
    }
    const box = bounds(record.ringsFeet).map((n, i) => n + (i < 2 ? -3 : 3));
    const localCuts = cuts.filter((w) => {
      const b = bounds(w.ringsFeet);
      return (
        b[0]! <= box[2]! &&
        b[2]! >= box[0]! &&
        b[1]! <= box[3]! &&
        b[3]! >= box[1]!
      );
    });
    if (!localCuts.length) continue;
    const walls = [
      ...dataset.walls.filter((w) => w.levelId === record.levelId),
      ...localCuts,
    ];
    const recovered = recoverNativeRoomInteriors(
      dataset.records,
      walls,
      dataset.doors ?? [],
      seeds,
      { roomKeys: new Set([record.key]), exhaustive: false },
    );
    for (const room of recovered.rooms) {
      try {
        // Never silently crop an unsupported edge or bridge a floor opening.
        let uncovered: pc.MultiPolygon = [room.ringsFeet];
        for (const floor of floorsByRecord.get(record.key) ?? []) {
          uncovered = pc.difference(uncovered, floor);
          if (!uncovered.length) break;
        }
        if (area(uncovered) > 0.002) continue;
        const nativeElementIds = [
          ...new Set(
            localCuts
              .filter((w) =>
                room.boundaryElementIds.includes(w.nativeElementId),
              )
              .map((w) => w.nativeElementId),
          ),
        ].sort((a, b) => a - b);
        if (!nativeElementIds.length) continue;
        rooms.push({
          ...room,
          boundaryEvidence: `Certified native 3D wall/column cross-sections at ${cutElevationFeet.toFixed(6)} ft; existing routing barriers retained; closed, unbranched native shells only; 0.0001 ft tessellation endpoint tolerance; complete precise native floor support; visual evidence only.`,
          meshProof: {
            cutElevationFeet,
            precisionFeet: 0.0001,
            nativeFloorCoveredSquareFeet: area([room.ringsFeet]),
            nativeElementIds,
          },
        });
      } catch {
        /* Inconsistent boolean topology remains unresolved. */
      }
    }
  }
  return { rooms, walls: [...cutsByLevel.values()].flat() };
}
