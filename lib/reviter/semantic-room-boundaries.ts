import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import { cleanRoomBoundary, containsRoomPoint, roomArea, validRoomBoundary } from "./room-directory.ts";

type Point = [number, number];
type Rings = Point[][];
/** Export from Revit's SpatialElement.GetBoundarySegments with Finish boundaries.
 * Coordinates are unchanged Revit internal XY feet, never shared/GIS coordinates.
 * Annotation keys must be explicitly mapped to semantic Room UniqueIds. */
export type SemanticRoomBoundaryInput = {
  format: "reviter-semantic-room-boundaries";
  version: 1;
  sourceModelSha256: string;
  units: "feet";
  coordinateSystem: "revit-internal";
  boundaryLocation: "finish";
  exporter: string;
  rooms: {
    roomKey: string;
    exporter?: string;
    nativeRoomUniqueId: string;
    phaseUniqueId: string;
    levelId: number;
    elevationFeet: number;
    ringsFeet: Rings;
    boundaryElementIds: number[];
  }[];
};
export type ValidatedSemanticRoom = {
  sourceModelSha256: string;
  nativeRoomUniqueId: string;
  phaseUniqueId: string;
  exporter: string;
  elevationFeet: number;
  roomKey: string;
  levelId: number;
  ringsFeet: Rings;
  boundaryElementIds: number[];
  sourceCoverage: number;
  cellCoverage: number;
  boundaryEvidence: string;
};
type Diagnostic = { roomKey: string; levelId: number; code: string; message: string };
const area = (parts: Rings[]) => parts.reduce((sum, rings) => sum + rings.reduce((n, ring, i) => n + (i ? -1 : 1) * roomArea(ring), 0), 0);
const contains = (p: Point, rings: Rings) => containsRoomPoint(p, rings[0]!) && !rings.slice(1).some(r => containsRoomPoint(p, r));
const isVoid = (r: IndoorDataset["records"][number]) => !r.walkable && /open drop|open to (?:below|lower)/i.test(String(r.properties.notes ?? ""));
const bounds = (rings: Rings) => { const p=rings.flat(); return [Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))]; };
const intersects=(a:number[],b:number[])=>a[0]!<=b[2]!&&a[2]!>=b[0]!&&a[1]!<=b[3]!&&a[3]!>=b[1]!;
const validHole = (ring: Point[]) => {
  const a = roomArea(ring);
  if (a < 1e-8) return false;
  // The directory helper requires a 1ft² room; holes can be smaller columns.
  // Scaling is validation-only and does not modify exported coordinates.
  const origin=ring[0]!, scale=Math.max(1,Math.sqrt(2/a));
  return validRoomBoundary(ring.map(([x,y])=>[(x-origin[0])*scale,(y-origin[1])*scale]));
};

/** The export establishes semantic enclosure evidence. Independent geometry checks
 * reject stale identity, coordinate mistakes, invalid topology and merged rooms.
 * Acceptance authorizes presentation only; graph regeneration is explicit. */
export function validateSemanticRoomBoundaries(dataset: IndoorDataset, annotations: RoomDirectoryData["annotations"], raw: unknown): { rooms: ValidatedSemanticRoom[]; diagnostics: Diagnostic[] } {
  const input = raw as Partial<SemanticRoomBoundaryInput> | null;
  if (!input || input.format !== "reviter-semantic-room-boundaries" || input.version !== 1 || input.units !== "feet" || input.coordinateSystem !== "revit-internal" || input.boundaryLocation !== "finish" || !Array.isArray(input.rooms) || typeof input.exporter !== "string" || !input.exporter.trim())
    throw new Error("Semantic boundaries require version 1 finish-face Revit internal-feet export metadata.");
  if (input.sourceModelSha256 !== dataset.source.modelSha256)
    throw new Error("Semantic boundary export belongs to a different source model digest.");
  const result: { rooms: ValidatedSemanticRoom[]; diagnostics: Diagnostic[] } = { rooms: [], diagnostics: [] };
  const records = new Map(dataset.records.map(r => [r.key, r]));
  const seeds = new Map(annotations.map(r => [r.key, r.labelPointFeet]));
  const wallBounds=dataset.walls.map(w=>({wall:w,box:bounds(w.ringsFeet)}));
  const recordBounds=dataset.records.map(r=>({record:r,box:bounds(r.ringsFeet)}));
  const duplicates = new Set(input.rooms.filter((r, i, all) => all.some((other, j) => j !== i && other?.roomKey === r?.roomKey)).map(r => r?.roomKey));
  const duplicateIds = new Set(input.rooms.filter((r, i, all) => all.some((other, j) => j !== i && other?.nativeRoomUniqueId === r?.nativeRoomUniqueId)).map(r => r?.nativeRoomUniqueId));
  for (const entry of input.rooms) {
    const roomKey = typeof entry?.roomKey === "string" ? entry.roomKey : "unknown";
    const record = records.get(roomKey);
    const fail = (code: string, message: string) => result.diagnostics.push({ roomKey, levelId: record?.levelId ?? (Number.isInteger(entry?.levelId) ? entry.levelId : -1), code: `semantic-${code}`, message });
    if (!record || !record.walkable || record.circulation) { fail("unknown-room", "Map the export explicitly to an existing eligible room annotation key."); continue; }
    if (duplicates.has(roomKey) || duplicateIds.has(entry.nativeRoomUniqueId)) { fail("duplicate-room", "One semantic Revit room may map to exactly one annotation key; duplicate mappings are rejected."); continue; }
    if (typeof entry.nativeRoomUniqueId !== "string" || !entry.nativeRoomUniqueId.trim() || typeof entry.phaseUniqueId !== "string" || !entry.phaseUniqueId.trim() || (entry.exporter!==undefined && (typeof entry.exporter!=="string"||!entry.exporter.trim())) || !Array.isArray(entry.boundaryElementIds) || !entry.boundaryElementIds.length || !entry.boundaryElementIds.every(id => Number.isSafeInteger(id) && id > 0)) { fail("missing-provenance", "Export the native Room UniqueId, phase UniqueId and supporting boundary element IDs."); continue; }
    if (entry.levelId !== record.levelId || !Number.isFinite(entry.elevationFeet) || Math.abs(entry.elevationFeet - record.elevationFeet) > .1) { fail("wrong-surface", "The native level and floor elevation must match the mapped room; review split levels before importing."); continue; }
    try {
      if (!Array.isArray(entry.ringsFeet) || !entry.ringsFeet.length || entry.ringsFeet.some(r => !Array.isArray(r) || r.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) { fail("invalid-topology", "Boundary rings must contain finite internal-feet XY points."); continue; }
      const rings = entry.ringsFeet.map(cleanRoomBoundary);
      if (!validRoomBoundary(rings[0]!) || rings.slice(1).some(r => !validHole(r))) { fail("invalid-topology", "Reject self intersections, duplicate edges, zero-area holes and rooms smaller than one square foot."); continue; }
      // Union changes an invalid/nested/intersecting hole topology. Difference
      // verifies holes remain strictly inside the exterior and do not overlap.
      const holes = rings.slice(1).map(r => [r] as Rings);
      const clipped = holes.length ? pc.difference([rings[0]!], ...holes) as Rings[] : [rings];
      const expected = area([rings]);
      const outsideHole = holes.some(h => area(pc.difference(h, [rings[0]!]) as Rings[]) > 1e-6);
      const overlappingHole = holes.some((h, i) => holes.some((other, j) => j > i && area(pc.intersection(h, other) as Rings[]) > 1e-6));
      if (outsideHole || overlappingHole || clipped.length !== 1 || clipped[0]!.length !== rings.length || expected <= 0 || Math.abs(area(clipped) - expected) > 1e-5) { fail("invalid-topology", "Holes must be disjoint, strictly interior and preserve one room region."); continue; }
      const seed = seeds.get(roomKey);
      if (!seed || !contains(seed, rings)) { fail("label-outside", "The mapped annotation label must lie inside the semantic room boundary."); continue; }
      const overlap = area(pc.intersection(rings, record.ringsFeet) as Rings[]);
      const sourceCoverage = overlap / area([record.ringsFeet]), cellCoverage = overlap / expected;
      if (sourceCoverage < .65 || cellCoverage < .65) { fail("source-mismatch", `Semantic and source interiors overlap insufficiently (${(sourceCoverage * 100).toFixed(1)}% source, ${(cellCoverage * 100).toFixed(1)}% semantic); review the mapping/coordinate origin.`); continue; }
      const box=bounds(rings);
      const others = recordBounds.filter(({record:r,box:otherBox}) => r.levelId === record.levelId && r.key !== record.key && intersects(box,otherBox)).map(({record})=>record);
      if (others.some(r => !r.circulation && seeds.has(r.key) && contains(seeds.get(r.key)!, rings))) { fail("multiple-room-labels", "The exported boundary contains another room label; review room separation and the explicit mapping."); continue; }
      if (others.some(r => (r.circulation || isVoid(r)) && area(pc.intersection(rings, r.ringsFeet) as Rings[]) > expected * .05)) { fail("protected-floor-overlap", "The exported room consumes circulation or an open-to-below region."); continue; }
      if (wallBounds.some(({wall:w,box:wallBox}) => w.levelId === record.levelId && intersects(box,wallBox) && area(pc.intersection(rings, w.ringsFeet) as Rings[]) > .002)) { fail("native-barrier-overlap", "The exported finish interior overlaps native wall or column material beyond numerical tolerance; check phase/finish-face extraction."); continue; }
      // Preserve existing holes even if the exporter accidentally omitted them.
      const annotation=annotations.find(r=>r.key===roomKey);
      const protectedHoles = [...record.ringsFeet.slice(1),...annotation?.floorOpeningsFeet ?? []].map(r => [r] as Rings);
      const safe = protectedHoles.length ? pc.difference(rings, ...protectedHoles) as Rings[] : [rings];
      if (safe.length !== 1 || !contains(seed, safe[0]!)) { fail("protected-hole-conflict", "Preserving existing room openings splits the semantic room or excludes its label."); continue; }
      const exporter=entry.exporter??input.exporter!;
      result.rooms.push({ sourceModelSha256: dataset.source.modelSha256, nativeRoomUniqueId:entry.nativeRoomUniqueId, phaseUniqueId:entry.phaseUniqueId,
        exporter, elevationFeet:entry.elevationFeet, roomKey, levelId: record.levelId, ringsFeet: safe[0]!.map(cleanRoomBoundary), boundaryElementIds: [...new Set(entry.boundaryElementIds)].sort((a, b) => a - b), sourceCoverage, cellCoverage, boundaryEvidence: `${exporter}; Room ${entry.nativeRoomUniqueId}; phase ${entry.phaseUniqueId}; Finish boundary; source ${dataset.source.modelSha256}` });
    } catch (error) { fail("invalid-topology", error instanceof Error ? error.message : String(error)); }
  }
  // Independent accepted exports may overlap even when neither contains the
  // other's label. Reject both instead of letting one win by input order.
  const contested = new Set<string>();
  for (let i = 0; i < result.rooms.length; i++) for (let j = i + 1; j < result.rooms.length; j++) {
    const a = result.rooms[i]!, b = result.rooms[j]!;
    if (a.levelId === b.levelId && intersects(bounds(a.ringsFeet),bounds(b.ringsFeet)) && area(pc.intersection(a.ringsFeet, b.ringsFeet) as Rings[]) > .001) { contested.add(a.roomKey); contested.add(b.roomKey); }
  }
  for (const r of result.rooms.filter(r => contested.has(r.roomKey))) result.diagnostics.push({ roomKey: r.roomKey, levelId: r.levelId, code: "semantic-contested-interior", message: "Accepted semantic interiors overlap; correct phase/room mapping before importing either room." });
  result.rooms = result.rooms.filter(r => !contested.has(r.roomKey));
  return result;
}

/** Opt-in source promotion for a subsequent complete graph regeneration. Source
 * annotations are cloned, never mutated; Revit/GIS identity is preserved. */
export function applySemanticRoomBoundaries(data: RoomDirectoryData, rooms: ValidatedSemanticRoom[]): RoomDirectoryData {
  const byKey = new Map(rooms.map(r => [r.roomKey, r]));
  const next = structuredClone(data);
  next.annotations = next.annotations.map(room => {
    const boundary = byKey.get(room.key);
    if (!boundary) return room;
    const previous=room.semanticInteriorProvenance as {sourceModelSha256?:string;originalRingsFeet?:Rings}|undefined;
    return { ...room, polygonFeet: boundary.ringsFeet[0]!, holesFeet: boundary.ringsFeet.slice(1),
      semanticInteriorProvenance: {version:1,sourceModelSha256:boundary.sourceModelSha256,boundarySource:"revit-finish-face",boundaryEvidence:boundary.boundaryEvidence,
        format:"reviter-semantic-room-boundaries",units:"feet",coordinateSystem:"revit-internal",boundaryLocation:"finish",
        nativeRoomUniqueId:boundary.nativeRoomUniqueId,phaseUniqueId:boundary.phaseUniqueId,exporter:boundary.exporter,
        elevationFeet:boundary.elevationFeet,sourceGeometryKey:JSON.stringify([room.levelId,boundary.ringsFeet]),
        boundaryElementIds:boundary.boundaryElementIds,originalRingsFeet:previous?.sourceModelSha256===boundary.sourceModelSha256 && Array.isArray(previous.originalRingsFeet)
          ? previous.originalRingsFeet : [room.polygonFeet,...room.holesFeet ?? []],sourceCoverage:boundary.sourceCoverage,cellCoverage:boundary.cellCoverage},
      walkabilityNotes: [room.walkabilityNotes, `Semantic Finish boundary imported: ${boundary.boundaryEvidence}`].filter(Boolean).join("\n") };
  });
  return next;
}

/** Reconstruct only unchanged, model-bound saved semantic inputs. Every saved
 * room still goes through the full geometric validator on each regeneration. */
export function savedSemanticRoomBoundaryInput(dataset: IndoorDataset, annotations: RoomDirectoryData["annotations"]): { input?: SemanticRoomBoundaryInput; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[]=[];
  const rooms: SemanticRoomBoundaryInput["rooms"]=[];
  const exporters=new Set<string>();
  for(const annotation of annotations) {
    const p=annotation.semanticInteriorProvenance as Record<string,unknown>|undefined;
    if(!p)continue;
    const fail=(message:string)=>diagnostics.push({roomKey:annotation.key,levelId:annotation.levelId,code:"semantic-saved-provenance-stale",message});
    const currentRings=[annotation.polygonFeet,...annotation.holesFeet??[]];
    if(p.format!=="reviter-semantic-room-boundaries"||p.version!==1||p.units!=="feet"||p.coordinateSystem!=="revit-internal"||p.boundaryLocation!=="finish"||p.boundarySource!=="revit-finish-face"||p.sourceModelSha256!==dataset.source.modelSha256) {
      fail("Saved semantic export schema/model identity is stale; reimport a matching Finish boundary export.");continue;
    }
    if(p.sourceGeometryKey!==JSON.stringify([annotation.levelId,currentRings])) {
      fail("The promoted annotation rings or level changed after semantic import; revalidate with the original Finish export.");continue;
    }
    if(typeof p.exporter!=="string"||!p.exporter.trim()||typeof p.nativeRoomUniqueId!=="string"||typeof p.phaseUniqueId!=="string"||typeof p.elevationFeet!=="number"||!Array.isArray(p.boundaryElementIds)) {
      fail("Saved semantic export lacks structured room/phase/exporter/elevation provenance; reimport the source sidecar.");continue;
    }
    exporters.add(p.exporter);
    rooms.push({roomKey:annotation.key,exporter:p.exporter,nativeRoomUniqueId:p.nativeRoomUniqueId,phaseUniqueId:p.phaseUniqueId,
      levelId:annotation.levelId,elevationFeet:p.elevationFeet,ringsFeet:currentRings,boundaryElementIds:p.boundaryElementIds as number[]});
  }
  return {input:rooms.length?{format:"reviter-semantic-room-boundaries",version:1,sourceModelSha256:dataset.source.modelSha256,
    units:"feet",coordinateSystem:"revit-internal",boundaryLocation:"finish",exporter:[...exporters].sort().join("; "),rooms}:undefined,diagnostics};
}
