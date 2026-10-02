import pc from "polygon-clipping";
import { recoverNativeRoomInteriors } from "./native-room-presentation.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import { cleanRoomBoundary, containsRoomPoint, roomArea, validRoomBoundary } from "./room-directory.ts";

type Point = [number, number];
type Rings = Point[][];
const area = (parts: Rings[]) => parts.reduce((sum, rings) => sum + rings.reduce((n, ring, i) => n + (i ? -1 : 1) * roomArea(ring), 0), 0);
const contains = (p: Point, rings: Rings) => containsRoomPoint(p, rings[0]!) && !rings.slice(1).some(r => containsRoomPoint(p, r));
const isVoid = (r: IndoorDataset["records"][number]) => !r.walkable && /open drop|open to (?:below|lower)/i.test(String(r.properties.notes ?? ""));
const NUMERIC_AREA = .002; // ft²; rounding-only slivers, never passage width.
const bounds = (rings: Rings) => { const p=rings.flat(); return [Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))]; };
const intersects=(a:number[],b:number[])=>a[0]!<=b[2]!&&a[2]!>=b[0]!&&a[1]!<=b[3]!&&a[3]!>=b[1]!;

/** Explicitly promote independently enclosed native interiors before a complete
 * routing recompile. Roofs include wall material and must never be navigable.
 * Source arrays remain unchanged; original rings survive in annotation provenance. */
export function promoteNativeRoomInteriors(dataset: IndoorDataset, source: RoomDirectoryData) {
  const report = { sourceModelSha256: dataset.source.modelSha256, candidates: 0, promoted: 0,
    rejected: [] as { roomKey: string; code: string; message: string }[],
    rooms: [] as { roomKey: string; boundaryElementIds: number[]; sourceCoverage: number; cellCoverage: number }[] };
  const data = structuredClone(source);
  if (dataset.presentation?.sourceModelSha256 !== dataset.source.modelSha256) throw new Error("Native presentation source digest is stale; recover boundaries before promotion.");
  const records = new Map(dataset.records.map(r => [r.key, r]));
  const annotations = new Map(data.annotations.map(r => [r.key, r]));
  const walls=dataset.walls.map(w=>({wall:w,box:bounds(w.ringsFeet)}));
  const protectedAreas=dataset.records.filter(r=>r.circulation||isVoid(r)).map(r=>({record:r,box:bounds(r.ringsFeet)}));
  let independentlyRecovered: ReturnType<typeof recoverNativeRoomInteriors> | undefined;
  const accepted: { roomKey: string; rings: Rings; evidence: NonNullable<IndoorDataset["presentation"]>["rooms"][number] }[] = [];
  for (const boundary of dataset.presentation.rooms) {
    if (boundary.boundarySource !== "native-wall-enclosure") continue;
    report.candidates++;
    const record = records.get(boundary.roomKey), annotation = annotations.get(boundary.roomKey);
    const fail = (code: string, message: string) => report.rejected.push({ roomKey: boundary.roomKey, code, message });
    if (!record || !annotation || !record.walkable || record.circulation || record.stair) { fail("ineligible-room", "Only noncirculation, nonstair room interiors may be promoted by this operation."); continue; }
    if (boundary.levelId !== record.levelId || annotation.levelId !== record.levelId || boundary.sourceGeometryKey !== JSON.stringify([record.levelId,record.ringsFeet]) || JSON.stringify([annotation.polygonFeet,...annotation.holesFeet ?? []]) !== JSON.stringify(record.ringsFeet)) { fail("stale-source-geometry", "Presentation/source annotation geometry changed; recover and review the current source before promotion."); continue; }
    try {
      let rings = boundary.interiorRingsFeet.map(cleanRoomBoundary);
      if (!rings.length || !validRoomBoundary(rings[0]!) || !boundary.boundaryElementIds.length || boundary.sourceCoverage < .65) { fail("invalid-enclosure", "Native enclosure lacks valid geometry, supporting elements or independent source coverage."); continue; }
      if(boundary.cellCoverage < .65) {
        // A saved string/coverage number is not authority to enlarge a room.
        // Recompute the complete native enclosure/sole-label/source-claim proof
        // before admitting an inset contour whose cell coverage is small.
        independentlyRecovered ??= recoverNativeRoomInteriors(dataset.records,dataset.walls,dataset.doors??[],new Map(data.annotations.map(r=>[r.key,r.labelPointFeet])));
        const native=independentlyRecovered.rooms.find(r=>r.roomKey===record.key);
        if(!native || native.sourceCoverage<.95 || JSON.stringify(native.ringsFeet)!==JSON.stringify(boundary.interiorRingsFeet)) {fail("unproved-contained-source-cell","Low source-cell coverage requires a recomputed unique native enclosure and uncontested label identity.");continue;}
      }
      const holes = [...record.ringsFeet.slice(1),...annotation.floorOpeningsFeet ?? []].map(r => [r] as Rings);
      const clipped = holes.length ? pc.difference(rings,...holes) as Rings[] : [rings];
      if (clipped.length !== 1) { fail("opening-splits-room", "Preserving source apertures splits the native enclosure into disconnected interiors."); continue; }
      rings = clipped[0]!.map(cleanRoomBoundary);
      const box=bounds(rings);
      if (!contains(annotation.labelPointFeet,rings) || (annotation.routePointFeet && !contains(annotation.routePointFeet,rings))) { fail("anchor-outside-interior", "A source label or reviewed route arrival falls outside the corrected native interior."); continue; }
      if (walls.some(({wall:w,box:wallBox}) => w.levelId === record.levelId && intersects(box,wallBox) && area(pc.intersection(rings,w.ringsFeet) as Rings[]) > NUMERIC_AREA)) { fail("native-barrier-overlap", "The interior overlaps native wall/column material beyond numerical rounding; review native geometry before promotion."); continue; }
      if (protectedAreas.some(({record:r,box:protectedBox}) => r.key !== record.key && r.levelId === record.levelId && intersects(box,protectedBox) && area(pc.intersection(rings,r.ringsFeet) as Rings[]) > NUMERIC_AREA)) { fail("protected-floor-overlap", "The source claims circulation or an open-to-below region inside this enclosure; review these masks before promoting it."); continue; }
      accepted.push({roomKey:record.key,rings,evidence:boundary});
    } catch (error) { fail("invalid-native-topology",error instanceof Error ? error.message : String(error)); }
  }
  const contested = new Set<string>();
  for (let i=0;i<accepted.length;i++) for(let j=i+1;j<accepted.length;j++) {
    const a=accepted[i]!,b=accepted[j]!;
    if (a.evidence.levelId === b.evidence.levelId && intersects(bounds(a.rings),bounds(b.rings)) && area(pc.intersection(a.rings,b.rings) as Rings[]) > NUMERIC_AREA) {contested.add(a.roomKey);contested.add(b.roomKey);}
  }
  for(const candidate of accepted) {
    if(contested.has(candidate.roomKey)) {report.rejected.push({roomKey:candidate.roomKey,code:"contested-native-interiors",message:"Two promoted interiors overlap; neither is authorized by input ordering."});continue;}
    const room = annotations.get(candidate.roomKey)!;
    const previous = room.nativeInteriorProvenance as {sourceModelSha256?:string;originalRingsFeet?:Rings}|undefined;
    room.nativeInteriorProvenance = { version:1, sourceModelSha256:dataset.source.modelSha256,
      boundarySource:"native-wall-enclosure", boundaryElementIds:candidate.evidence.boundaryElementIds,
      originalRingsFeet: previous?.sourceModelSha256 === dataset.source.modelSha256 && Array.isArray(previous.originalRingsFeet)
        ? previous.originalRingsFeet : [room.polygonFeet,...room.holesFeet ?? []], sourceCoverage:candidate.evidence.sourceCoverage,
      cellCoverage:candidate.evidence.cellCoverage };
    room.polygonFeet = candidate.rings[0]!; room.holesFeet=candidate.rings.slice(1);
    report.rooms.push({roomKey:candidate.roomKey,boundaryElementIds:candidate.evidence.boundaryElementIds,sourceCoverage:candidate.evidence.sourceCoverage,cellCoverage:candidate.evidence.cellCoverage});
  }
  report.promoted=report.rooms.length;
  return {data,report};
}
