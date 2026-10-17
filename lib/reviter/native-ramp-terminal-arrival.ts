import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import { certifyExportedNativeRampCrossfall, type IndoorRampRecipes } from "./indoor-ramps.ts";
import { nativeRationalPointInParts, nativeRationalPathSupported } from "./native-exact-planar-topology.ts";
import { nativeRationalOverlay } from "./native-rational-overlay.ts";
import type { RoomPoint } from "./room-directory.ts";

export type NativeRampTerminalArrivalProposal = {
  version: 1; sourceModelSha256: string; roomKey: string;
  originalArrivalNodeId: string; originalArrivalPointFeet: [number, number, number];
  proposedArrivalNodeId: string; proposedArrivalPointFeet: [number, number, number];
  nativeRampId: number; rampEdgeId: string; approachEdgeId: string; nativeDoorEdgeId: string;
  nativeFloorElementId: number; roomKeys: string[];
};
const samePoint = (a: readonly number[], b: readonly number[]) =>
  a.length === 3 && b.length === 3 && a.every((v, i) => Number.isFinite(v) && v === b[i]);

/** A named ramp corridor's flat label seed can lie above no flat slab because
 * it is partway up its own nonplanar ramp. Propose its unique existing reviewed
 * landing terminal, via an existing same-owner physical doorway approach.
 * The original label/seed, every source point, edge and permission stay intact.
 * This function grants no route or accessibility: the caller must independently
 * check the original approach/door/ramp, and adopt the proposal separately. */
export function proposeNativeRampTerminalArrival(data: IndoorDataset, metadata: unknown,
    roomKey: string, physicallyChecked: (edge: IndoorEdge) => boolean): NativeRampTerminalArrivalProposal | undefined {
  const recipes = metadata as IndoorRampRecipes | undefined,
    room = data.records.find(r => r.key === roomKey),
    seed = data.nodes.find(n => n.id === `arrival:${roomKey}`),
    sha = data.source.modelSha256;
  if (!room || !seed || room.arrivalNodeId || room.stair || !room.circulation || !room.walkable ||
      room.access === "staff" || seed.roomKey !== roomKey || seed.kind !== "arrival" ||
      seed.levelId !== room.levelId || seed.surfaceId !== room.surfaceId ||
      seed.pointFeet[2] !== room.elevationFeet || !seed.pointFeet.every(Number.isFinite) ||
      !recipes || recipes.version !== 1 || recipes.sourceModelSha256 !== sha || !Array.isArray(recipes.ramps) ||
      data.walkingSupport?.sourceModelSha256 !== sha || data.rampDisplay?.sourceModelSha256 !== sha ||
      typeof physicallyChecked !== "function" || data.edges.some(e => e.enabled && e.kind === "walk" &&
        !!e.nativeCellId && (e.from === seed.id || e.to === seed.id))) return;
  const original = (room.properties.originalSourceRingsFeet ?? room.ringsFeet) as RoomPoint[][],
    own = nativeRationalOverlay("intersection", [room.ringsFeet], [original]);
  if (!nativeRationalPointInParts(seed.pointFeet, own)) return;
  const samePlane = data.walkingSupport.floors.filter(f => f.elevationFeet === seed.pointFeet[2])
    .flatMap(f => f.partsFeet ?? [f.ringsFeet]);
  if (samePlane.length && nativeRationalPointInParts(seed.pointFeet, nativeRationalOverlay("union", samePlane))) return;
  const nodes = new Map(data.nodes.map(n => [n.id, n])), records = new Map(data.records.map(r => [r.key, r]));
  const allowed = (keys: string[]) => keys.every(key => records.get(key)?.walkable && records.get(key)?.access !== "staff");
  const proposals: NativeRampTerminalArrivalProposal[] = [];
  for (const recipe of recipes.ramps) {
    if (!recipe || typeof recipe.id !== "string" || !Number.isSafeInteger(recipe.nativeRampId) ||
        !Array.isArray(recipe.floorElementIds) || recipe.floorElementIds.length !== 2 ||
        !Array.isArray(recipe.pointsFeet) || recipe.pointsFeet.length < 2 || !Array.isArray(recipe.trianglesFeet)) continue;
    const edge = data.edges.find(e => e.id === recipe.id), proof = edge?.nativeRampSurface,
      display = data.rampDisplay.ramps.find(r => r.edgeId === recipe.id && r.nativeElementId === recipe.nativeRampId && !r.displayOnly);
    if (!edge || !proof || !display || !edge.enabled || edge.kind !== "ramp" ||
        edge.nativeElementId !== recipe.nativeRampId || proof.sourceModelSha256 !== sha ||
        proof.version !== 1 || proof.nativeRampId !== recipe.nativeRampId ||
        JSON.stringify(proof.pointsFeet) !== JSON.stringify(edge.pointsFeet) ||
        JSON.stringify(recipe.pointsFeet) !== JSON.stringify(edge.pointsFeet) ||
        JSON.stringify(recipe.floorElementIds) !== JSON.stringify(proof.nativeFloorElementIds) ||
        JSON.stringify(recipe.trianglesFeet) !== JSON.stringify(display.trianglesFeet) ||
        !allowed(edge.roomKeys)) continue;
    const rampPlan = nativeRationalOverlay("union", display.trianglesFeet.map(t => [t.map(p => [p[0], p[1]] as RoomPoint)]));
    if (!nativeRationalPointInParts(seed.pointFeet, rampPlan)) continue;
    const certificate = certifyExportedNativeRampCrossfall(data, display.trianglesFeet, recipe.floorElementIds, edge.pointsFeet);
    if (!certificate || JSON.stringify(certificate) !== JSON.stringify(proof.widthCertificate) || !physicallyChecked(edge)) continue;
    for (const [side, id] of [edge.from, edge.to].entries()) {
      const node = nodes.get(id), owner = node && records.get(node.roomKey), expected = side ? edge.pointsFeet.at(-1)! : edge.pointsFeet[0]!, floorId = recipe.floorElementIds[side]!;
      if (!node || !owner || node.kind !== "connector" || node.id !== `${recipe.id}:${side ? "upper" : "lower"}` ||
          node.levelId !== room.levelId || node.pointFeet[2] !== room.elevationFeet ||
          node.roomKey !== owner.key || node.surfaceId !== owner.surfaceId ||
          owner.properties.generatedLanding !== true || owner.properties.nativeRampId !== recipe.nativeRampId ||
          owner.properties.nativeFloorId !== floorId || !samePoint(node.pointFeet, expected) ||
          !nativeRationalPointInParts(node.pointFeet, own)) continue;
      const floors = data.walkingSupport.floors.filter(f => f.nativeElementId === floorId && f.elevationFeet === node.pointFeet[2])
        .flatMap(f => f.partsFeet ?? [f.ringsFeet]);
      if (!floors.length || !nativeRationalPointInParts(node.pointFeet, nativeRationalOverlay("union", floors))) continue;
      for (const approach of data.edges.filter(e => e.enabled && e.kind === "walk" && e.nativeCellId &&
          e.roomKeys.includes(roomKey) && e.roomKeys.includes(owner.key) && (e.from === id || e.to === id))) {
        const portal = nodes.get(approach.from === id ? approach.to : approach.from),
          cell = data.circulationGeometry?.cells.find(c => c.id === approach.nativeCellId);
        if (!portal || !cell || cell.elevationFeet !== node.pointFeet[2] || !cell.nativeFloorIds.includes(floorId) ||
            portal.kind !== "portal" || portal.roomKey !== roomKey || portal.levelId !== room.levelId ||
            portal.surfaceId !== room.surfaceId || portal.pointFeet[2] !== room.elevationFeet ||
            !samePoint(approach.pointsFeet[0]!, nodes.get(approach.from)!.pointFeet) ||
            !samePoint(approach.pointsFeet.at(-1)!, nodes.get(approach.to)!.pointFeet) ||
            approach.pointsFeet.some(p => p[2] !== room.elevationFeet || !p.every(Number.isFinite)) ||
            !nativeRationalPathSupported(approach.pointsFeet, own) ||
            !allowed([...cell.roomKeys, ...approach.roomKeys]) || !physicallyChecked(approach)) continue;
        const door = (data.doors ?? []).find(d => d.state === "connected" && d.roomKeys.includes(roomKey) &&
          data.edges.some(e => e.id === d.id && e.enabled && e.kind === "door" &&
            e.nativeElementId === d.nativeElementId && (e.from === portal.id || e.to === portal.id) &&
            allowed(e.roomKeys) && physicallyChecked(e)));
        if (!door) continue;
        proposals.push({ version: 1, sourceModelSha256: sha, roomKey,
          originalArrivalNodeId: seed.id, originalArrivalPointFeet: [...seed.pointFeet],
          proposedArrivalNodeId: node.id, proposedArrivalPointFeet: [...node.pointFeet],
          nativeRampId: recipe.nativeRampId, rampEdgeId: edge.id, approachEdgeId: approach.id,
          nativeDoorEdgeId: door.id, nativeFloorElementId: floorId,
          roomKeys: [...new Set([roomKey, ...edge.roomKeys, ...approach.roomKeys, ...cell.roomKeys, ...door.roomKeys])].sort() });
      }
    }
  }
  const terminals = new Set(proposals.map(p => p.proposedArrivalNodeId));
  return terminals.size === 1 ? proposals[0] : undefined;
}
