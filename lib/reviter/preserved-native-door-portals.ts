import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
} from "./indoor-contract.ts";
/** Verified package snapshot supplies physical portal metadata only. Current
 * decoded native door geometry and unchanged source identities/policy rebind it.
 * No historical room contour, walking branch, support, or access grant is copied. */
export function preservedNativeDoorPortals(
  current: IndoorDataset,
  original?: IndoorDataset,
) {
  const result: {
    doorId: string;
    roomKeys: string[];
    nodes: IndoorNode[];
    edge: IndoorEdge;
  }[] = [];
  if (!original || !current.nativeIndoorEnvelopes) return result;
  if (original.source.modelSha256 !== current.source.modelSha256)
    throw new Error(
      "Preserved physical doorway snapshot belongs to another native model.",
    );
  const currentRecords = new Map(current.records.map((r) => [r.key, r])),
    oldRecords = new Map(original.records.map((r) => [r.key, r])),
    oldNodes = new Map(original.nodes.map((n) => [n.id, n])),
    oldEdges = new Map(original.edges.map((e) => [e.id, e]));
  const geometry = (d: NonNullable<IndoorDataset["doors"]>[number]) =>
    JSON.stringify([
      d.levelId,
      d.nativeElementId,
      d.pointFeet,
      d.normalFeet,
      d.footprintFeet,
    ]);
  const policy = (r: IndoorDataset["records"][number]) =>
    JSON.stringify([
      r.key,
      r.number,
      r.building,
      r.levelId,
      r.elevationFeet,
      r.walkable,
      r.access,
      r.properties.spaceUse,
      r.properties.stairAccess,
      r.properties.throughNavigationReview,
    ]);
  for (const door of current.doors ?? []) {
    const old = original.doors?.find((d) => d.id === door.id),
      edge = oldEdges.get(door.id);
    if (
      !old ||
      old.state !== "connected" ||
      !old.footprintFeet ||
      !old.normalFeet ||
      geometry(old) !== geometry(door) ||
      (old.hostWallNativeElementId !== undefined &&
        old.hostWallNativeElementId !== door.hostWallNativeElementId) ||
      edge?.kind !== "door" ||
      !edge.enabled ||
      edge.nativeElementId !== door.nativeElementId ||
      !["native-door", "reviewed-native-door"].includes(edge.evidence) ||
      old.roomKeys.length !== 2 ||
      edge.roomKeys.length !== 2 ||
      JSON.stringify([...old.roomKeys].sort()) !==
        JSON.stringify([...edge.roomKeys].sort())
    )
      continue;
    if (
      door.state === "connected" &&
      JSON.stringify([...door.roomKeys].sort()) !==
        JSON.stringify([...old.roomKeys].sort())
    )
      continue;
    if (
      edge.roomKeys.some(
        (k) =>
          !currentRecords.has(k) ||
          !oldRecords.has(k) ||
          policy(currentRecords.get(k)!) !== policy(oldRecords.get(k)!),
      )
    )
      continue;
    const nodes = [oldNodes.get(edge.from), oldNodes.get(edge.to)];
    if (
      nodes.some(
        (n) =>
          !n ||
          n.kind !== "portal" ||
          n.levelId !== door.levelId ||
          !edge.roomKeys.includes(n.roomKey) ||
          n.pointFeet.some((p) => !Number.isFinite(p)),
      ) ||
      nodes[0]!.roomKey === nodes[1]!.roomKey ||
      JSON.stringify(edge.pointsFeet) !==
        JSON.stringify(nodes.map((n) => n!.pointFeet))
    )
      continue;
    result.push({
      doorId: door.id,
      roomKeys: [...old.roomKeys],
      nodes: structuredClone(nodes as IndoorNode[]),
      edge: structuredClone(edge),
    });
  }
  return result;
}
