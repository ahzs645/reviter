import type { IndoorDataset } from "./indoor-contract.ts";
import {
  containsDirectoryRoomPoint,
  type DirectoryRoom,
} from "./room-directory.ts";
/** An explicitly identified shaft area is a destination at its verified lobby,
 * not a walking edge through the car footprint. Call after native stop validation. */
export function bindConnectorAreaArrivals(
  data: IndoorDataset,
  rooms: readonly DirectoryRoom[],
) {
  const candidates = new Map<
    string,
    { connectorId: string; nodeId: string }[]
  >();
  for (const c of data.connectors ?? []) {
    if (!c.reviewedShaft || c.sourceModelSha256 !== data.source.modelSha256)
      continue;
    for (const e of c.entrances) {
      if (!e.areaKey) continue;
      const area = rooms.find(
        (r) =>
          r.key === e.areaKey &&
          r.levelId === e.levelId &&
          r.status !== "deleted",
      );
      const r = data.records.find((r) => r.key === e.areaKey),
        lobby = data.records.find((r) => r.key === e.roomKey),
        node = data.nodes.find((n) => n.id === e.nodeId);
      if (
        !area ||
        !r ||
        !lobby ||
        !node ||
        !r.walkable ||
        r.access === "staff" ||
        !lobby.walkable ||
        lobby.access === "staff" ||
        r.levelId !== e.levelId ||
        r.building !== lobby.building ||
        node.roomKey !== e.roomKey ||
        node.levelId !== e.levelId ||
        Math.abs(r.elevationFeet - node.pointFeet[2]) > 0.05 ||
        !containsDirectoryRoomPoint(c.reviewedShaft.pointFeet, area)
      )
        continue;
      candidates.set(r.key, [
        ...(candidates.get(r.key) ?? []),
        { connectorId: c.id, nodeId: e.nodeId },
      ]);
    }
  }
  let bound = 0;
  const boundKeys = new Set<string>();
  for (const [key, stops] of candidates) {
    const r = data.records.find((r) => r.key === key)!;
    if (
      stops.length !== 1 ||
      (r.arrivalNodeId && r.arrivalNodeId !== stops[0]!.nodeId)
    )
      continue;
    r.arrivalNodeId = stops[0]!.nodeId;
    r.properties.reviewedConnectorArrival = {
      ...stops[0]!,
      sourceModelSha256: data.source.modelSha256,
    };
    boundKeys.add(key);
    bound++;
  }
  data.issues = (data.issues ?? []).filter(
    (issue) =>
      issue.code !== "isolated-arrival" || !boundKeys.has(issue.roomKey ?? ""),
  );
  return bound;
}
