import type { DirectoryNavigation } from "./directory-navigation.ts";
import type { BoundaryReference } from "./room-boundaries.ts";
import type { AreaMetadata, AreaRelationship } from "./directory-areas.ts";
import type {ReportedBuildingTransition} from "./building-transitions.ts";
/** Room annotations stay in model feet; boundaries and original provenance survive export. */
export type RoomPoint = [number, number];
export type DirectoryRoom = {
  key: string;
  levelId: number;
  number?: string;
  building?: string;
  modelSurface?: {kind:"crosswalk"|"circulation";elementId:number;levelId:number;elevationFeet:number};
  name?: string;
  spaceUse?: {kind:"atrium"|"hallway"|"room";evidence:"user-reported";notes?:string};
  polygonFeet: RoomPoint[];
  holesFeet?: RoomPoint[][];
  circulationGroup?: string;
  walkability?: "walkable" | "void";
  walkabilityNotes?: string;
  stairAccess?: "unreviewed" | "flight-and-landing" | "up-flight-only" | "local-only";
  stairAccessNotes?: string;
  stairFlightIds?: number[];
  /** Reviewed navigation arrival, distinct from the original drawing label. */
  routePointFeet?: RoomPoint;
  /** Native slab openings exclude flat floor; recovered flight treads keep their own height. */
  floorOpeningsFeet?: RoomPoint[][];
  labelPointFeet: RoomPoint;
  confidence: number;
  status?: string;
  dwg?: { sectionId?: string; [key: string]: unknown };
  [key: string]: unknown;
};
export type RoomDirectoryData = {
  format: "reviter-room-annotations";
  version: 1;
  coordinateSystem: "revit-model-feet";
  model: { fileName: string; [key: string]: unknown };
  annotations: DirectoryRoom[];
  boundaryReference?: BoundaryReference;
  navigation?: DirectoryNavigation;
  areaMetadata?: Record<string, AreaMetadata>;
  areaRelationships?: AreaRelationship[];
  buildingTransitions?: ReportedBuildingTransition[];
  sourceCoverage?: { sourceSha256: string; omittedSheets: { building: string; sectionId: string; labelCount: number; reason: string }[] };
  [key: string]: unknown;
};
export type DirectoryDoor = { id: number; point: RoomPoint; halfWidth: number; halfHeight: number; footprint?: RoomPoint[]; normal?: RoomPoint };
export type RouteOpening = { rooms: [string, string]; point: RoomPoint; from: RoomPoint; to: RoomPoint; halfWidth: number; halfHeight: number; footprint?: RoomPoint[] };
export type RoomPortal = RouteOpening & {doorId:number; reviewed?:boolean};
const point = (p: unknown): p is RoomPoint => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7);

export function parseRoomDirectory(text: string): RoomDirectoryData {
  const data = JSON.parse(text) as RoomDirectoryData;
  if (!data || data.format !== "reviter-room-annotations" || data.version !== 1 || data.coordinateSystem !== "revit-model-feet"
    || typeof data.model?.fileName !== "string" || !Array.isArray(data.annotations) || data.annotations.length > 50_000) {
    throw new Error("Choose a version 1 Reviter room annotations file in model feet (such as UNBC.rooms.json).");
  }
  const reference = data.boundaryReference;
  const coverage = data.sourceCoverage;
  if (coverage != null && (typeof coverage.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(coverage.sourceSha256)
    || reference != null && coverage.sourceSha256 !== reference.sourceSha256
    || !Array.isArray(coverage.omittedSheets) || coverage.omittedSheets.length > 1000
    || new Set(coverage.omittedSheets.map(s => s?.sectionId)).size !== coverage.omittedSheets.length
    || coverage.omittedSheets.some(s => !s || typeof s.building !== "string" || !s.building.trim() || s.building.length > 100
      || typeof s.sectionId !== "string" || !s.sectionId.trim() || s.sectionId.length > 200
      || !Number.isSafeInteger(s.labelCount) || s.labelCount < 0 || s.labelCount > 50000
      || typeof s.reason !== "string" || !s.reason.trim() || s.reason.length > 10000))) {
    throw new Error("Source coverage needs a matching drawing hash and valid omitted plan records.");
  }
  if (reference != null && (reference.format !== "reviter-boundary-reference" || reference.version !== 1 || reference.coordinateSystem !== "revit-model-feet"
    || typeof reference.sourceSha256 !== "string" || !Array.isArray(reference.sections) || reference.sections.length > 100
    || reference.sections.some((section) => !section || typeof section.sectionId !== "string" || !Number.isSafeInteger(section.levelId)
      || !Number.isFinite(section.registrationErrorFeet) || section.registrationErrorFeet < 0 || section.registrationErrorFeet > .1
      || [section.wallSegments, section.doorSegments].some((segments) => !Array.isArray(segments) || segments.length > 20000
        || segments.some((segment) => !Array.isArray(segment) || segment.length !== 2 || !segment.every(point)))))) {
    throw new Error("The wall reference has invalid coordinates or an unverified registration.");
  }
  const keys = new Set<string>();
  if (data.areaMetadata != null && (typeof data.areaMetadata !== "object" || Array.isArray(data.areaMetadata)
    || Object.entries(data.areaMetadata).length > 50000 || Object.entries(data.areaMetadata).some(([key, value]) => !key || !value || typeof value !== "object" || Array.isArray(value)
      || (value.name != null && (typeof value.name !== "string" || value.name.length > 200))
      || (value.notes != null && (typeof value.notes !== "string" || value.notes.length > 10000))
      || (value.circulationDoorUse != null && !["unknown","usually-open","usually-closed"].includes(value.circulationDoorUse))
      || (value.elementIds != null && (!Array.isArray(value.elementIds) || value.elementIds.length > 1000 || value.elementIds.some(id => !Number.isSafeInteger(id) || id <= 0)))))) {
    throw new Error("Area metadata contains invalid names, notes, door use, or model element IDs.");
  }
  const groups = new Map<string, string>();
  for (const room of data.annotations) {
    if (!room || typeof room.key !== "string" || !room.key || keys.has(room.key) || !Number.isSafeInteger(room.levelId)
      || !Array.isArray(room.polygonFeet) || room.polygonFeet.length < 3 || room.polygonFeet.length > 20_000
      || (room.walkability != null && !["walkable", "void"].includes(room.walkability))
      || (room.walkabilityNotes != null && (typeof room.walkabilityNotes !== "string" || room.walkabilityNotes.length > 10000))
      || (room.spaceUse != null && (!room.spaceUse || !["atrium","hallway","room"].includes(room.spaceUse.kind) || room.spaceUse.evidence !== "user-reported" || room.spaceUse.notes != null && (typeof room.spaceUse.notes !== "string" || room.spaceUse.notes.length > 10000)))
      || (room.stairAccess != null && !["unreviewed", "flight-and-landing", "up-flight-only", "local-only"].includes(room.stairAccess))
      || (room.stairFlightIds != null && (!Array.isArray(room.stairFlightIds) || room.stairFlightIds.length > 100 || new Set(room.stairFlightIds).size !== room.stairFlightIds.length || room.stairFlightIds.some(id=>!Number.isSafeInteger(id)||id<=0)))
      || (room.stairAccessNotes != null && (typeof room.stairAccessNotes !== "string" || room.stairAccessNotes.length > 10000))
      || (room.circulationGroup != null && typeof room.circulationGroup !== "string")
      || (room.holesFeet != null && (!Array.isArray(room.holesFeet) || room.holesFeet.length > 1000 || room.holesFeet.some((h) => !Array.isArray(h) || h.length < 3 || h.length > 20000 || !h.every(point))))
      || (room.floorOpeningsFeet != null && (!Array.isArray(room.floorOpeningsFeet) || room.floorOpeningsFeet.length>1000 || room.floorOpeningsFeet.some(h=>!Array.isArray(h)||h.length<3||h.length>20000||!h.every(point))))
      || !room.polygonFeet.every(point) || !point(room.labelPointFeet)
      || (room.routePointFeet != null && (!point(room.routePointFeet) || !containsDirectoryRoomPoint(room.routePointFeet,room))) || typeof room.confidence !== "number"
      || !Number.isFinite(room.confidence) || room.confidence < 0 || room.confidence > 1
      || (room.building != null && (typeof room.building !== "string" || !room.building.trim() || room.building.length > 100))
      || (room.modelSurface != null && (!["crosswalk", "circulation"].includes(room.modelSurface.kind) || !Number.isSafeInteger(room.modelSurface.elementId) || room.modelSurface.elementId <= 0 || room.modelSurface.levelId !== room.levelId || !Number.isFinite(room.modelSurface.elevationFeet)))
      || (room.name != null && typeof room.name !== "string") || (room.number != null && typeof room.number !== "string")
      || (room.dwg != null && (typeof room.dwg !== "object" || Array.isArray(room.dwg)
        || (room.dwg.sectionId != null && typeof room.dwg.sectionId !== "string")))) {
      throw new Error("The annotations contain invalid coordinates, room fields, or duplicate identities.");
    }
    if (room.circulationGroup && room.status !== "deleted") {
      const fingerprint = JSON.stringify([room.levelId, room.polygonFeet, room.holesFeet ?? []]);
      const previous = groups.get(room.circulationGroup);
      if (previous && previous !== fingerprint) throw new Error("Shared hallway labels must describe the same floor region.");
      groups.set(room.circulationGroup, fingerprint);
    }
    keys.add(room.key);
  }
  if(data.buildingTransitions!=null){
    const links=data.buildingTransitions;
    if(!Array.isArray(links)||links.length>5000||new Set(links.map(l=>l?.id)).size!==links.length||links.some(l=>!l||typeof l.id!=="string"||!l.id||l.id.length>200||l.kind!=="local-steps"||l.evidence!=="user-reported"||!Number.isSafeInteger(l.nativeStairId)||l.nativeStairId<=0||!Array.isArray(l.floorElementIds)||l.floorElementIds.length!==2||l.floorElementIds.some(id=>!Number.isSafeInteger(id)||id<=0)||!Array.isArray(l.endpoints)||l.endpoints.length!==2||l.endpoints[0]?.building===l.endpoints[1]?.building&&(l.endpoints.some(e=>!Number.isFinite(e.elevationFeet))||Math.abs(l.endpoints[0].elevationFeet!-l.endpoints[1].elevationFeet!)<.05)||l.endpoints.some(e=>!e||typeof e.building!=="string"||!e.building.trim()||e.building.length>100||!Number.isSafeInteger(e.levelId)||!point(e.point)||e.elevationFeet!=null&&!Number.isFinite(e.elevationFeet)||e.roomKey!=null&&!data.annotations.some(r=>r.key===e.roomKey&&r.levelId===e.levelId&&roomBuilding(r)===e.building&&r.status!=="deleted"))||l.notes!=null&&(typeof l.notes!=="string"||l.notes.length>10000)))throw new Error("Local building connections need two building locations and explicit native stair and floor identities.");
  }
  if(data.areaRelationships!=null){
    const pairs=new Set<string>();
    if(!Array.isArray(data.areaRelationships)||data.areaRelationships.length>20000)throw new Error("Area relationships must be a list of reported connections.");
    for(const link of data.areaRelationships){
      if(!link||link.evidence!=="user-reported"||!["access","open-space"].includes(link.kind)||!Array.isArray(link.rooms)||link.rooms.length!==2||link.rooms[0]===link.rooms[1]||link.rooms.some(k=>typeof k!=="string"||!keys.has(k))||(link.notes!=null&&(typeof link.notes!=="string"||link.notes.length>10000)))throw new Error("Area relationships must name two existing spaces and retain their reported evidence.");
      const [a,b]=link.rooms.map(k=>data.annotations.find(r=>r.key===k)!);const pair=JSON.stringify([...link.rooms].sort());
      if(a!.status==="deleted"||b!.status==="deleted"||a!.levelId!==b!.levelId||roomBuilding(a!)!==roomBuilding(b!)||pairs.has(pair))throw new Error("Area relationships must join active spaces on one building floor without duplicate pairs.");pairs.add(pair);
    }
  }
  if (data.navigation != null) {
    const nav=data.navigation;
    if(nav.version!==1 || !Array.isArray(nav.doorLinks) || nav.doorLinks.length>20000 || nav.doorLinks.some(link=>!link || !Number.isSafeInteger(link.doorId) || !Number.isSafeInteger(link.levelId) || !Array.isArray(link.rooms) || link.rooms.length!==2 || link.rooms[0]===link.rooms[1] || link.rooms.some(key=>typeof key!=="string" || !data.annotations.some(r=>r.key===key && r.levelId===link.levelId && r.status!=="deleted"))) || new Set(nav.doorLinks.map(l=>`${l.levelId}:${l.doorId}`)).size!==nav.doorLinks.length) throw new Error("Reviewed door connections must join two existing rooms on the same floor, with unique model door identities.");
  }
  if (data.navigation?.openLinks != null) {
    const links=data.navigation.openLinks;
    if(!Array.isArray(links)||links.length>20000||new Set(links.map(l=>l.id)).size!==links.length||links.some(l=>!l||typeof l.id!=="string"||!l.id||l.id.length>200||l.evidence!=="registered-opening"||typeof l.sourceSha256!=="string"||!Number.isSafeInteger(l.levelId)||!Array.isArray(l.rooms)||l.rooms.length!==2||l.rooms[0]===l.rooms[1]||!l.rooms.every(k=>data.annotations.some(r=>r.key===k&&r.levelId===l.levelId&&r.status!=="deleted"))||!point(l.from)||!point(l.to)||!Number.isFinite(l.widthFeet)||l.widthFeet<.6||l.widthFeet>8))throw new Error("Open connections need unique identities, two existing spaces and registered opening geometry.");
  }
  if (data.navigation?.stairLinks != null) {
    const links=data.navigation.stairLinks;
    if(!Array.isArray(links) || links.length>5000 || links.some(link=>!link || !Array.isArray(link.rooms) || link.rooms.length!==2 || link.rooms[0]===link.rooms[1] || link.rooms.some(key=>typeof key!=="string" || !data.annotations.some(r=>r.key===key && r.status!=="deleted")))) throw new Error("Reviewed stair connections must name two existing staircase entrances.");
    const pairs=new Set<string>();
    for(const link of links){const [a,b]=link.rooms.map(key=>data.annotations.find(r=>r.key===key)!);const key=[...link.rooms].sort().join(":");if(a!.levelId===b!.levelId || roomBuilding(a!)!==roomBuilding(b!) || ![a,b].every(r=>/\bstair(?:s|case|well)?\b/i.test(r!.name??"")) || pairs.has(key))throw new Error("Stair connections must join different floors of one building without duplicate pairs.");pairs.add(key);}
  }
  return data;
}

export const isWalkable = (room: DirectoryRoom) => room.status !== "deleted" && room.walkability !== "void";

export const isHallway = (room: DirectoryRoom) => room.spaceUse ? room.spaceUse.kind !== "room" : /\b(corridor|hallway|circulation|vestibule|lobby|atrium|connecting passage)\b/i.test(room.name ?? "")
  || /^(?:(?:main|entry|entrance|north|south|east|west|central|upper|lower)\s+)?hall$/i.test(room.name ?? "");
export const roomBuilding = (room: DirectoryRoom) => room.number?.match(/^([^-]+)-/)?.[1] ?? room.building ?? room.dwg?.sectionId?.split(" ")[0] ?? "Unassigned";

export function containsRoomPoint(p: RoomPoint, polygon: readonly RoomPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!; const b = polygon[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export const containsDirectoryRoomPoint = (p: RoomPoint, room: DirectoryRoom) => containsRoomPoint(p, room.polygonFeet) && ![...room.holesFeet ?? [],...room.floorOpeningsFeet ?? []].some((h) => containsRoomPoint(p, h));
export const directoryRoomArea = (room: DirectoryRoom) => roomArea(room.polygonFeet) - (room.holesFeet ?? []).reduce((sum, h) => sum + roomArea(h), 0);

export function nearestRoomBoundary(p: RoomPoint, polygon: readonly RoomPoint[]): { point: RoomPoint; distance: number } {
  let closest: RoomPoint = polygon[0]!; let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    const candidate: RoomPoint = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - candidate[0], p[1] - candidate[1]);
    if (d < distance) { closest = candidate; distance = d; }
  }
  return { point: closest, distance };
}

export function roomArea(polygon: readonly RoomPoint[]): number {
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length]!; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}

/** Remove only redundant collinear vertices, never smooth over a wall corner. */
export function cleanRoomBoundary(polygon: readonly RoomPoint[]): RoomPoint[] {
  const points = polygon.filter((p, i) => i === 0 || Math.hypot(p[0] - polygon[i - 1]![0], p[1] - polygon[i - 1]![1]) > 1e-7);
  if (points.length > 1 && Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1]) < 1e-7) points.pop();
  return points.filter((b, i) => {
    const a = points[(i + points.length - 1) % points.length]!; const c = points[(i + 1) % points.length]!;
    return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-7
      || (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0;
  }).map((p) => [...p]);
}

export function validRoomBoundary(polygon: readonly RoomPoint[]): boolean {
  if (polygon.length < 3 || !polygon.every(point) || roomArea(polygon) < 1) return false;
  const cross = (a: RoomPoint, b: RoomPoint, c: RoomPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: RoomPoint, b: RoomPoint, p: RoomPoint) => Math.abs(cross(a, b, p)) < 1e-8
    && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8
    && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) return false;
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j]!; const d = polygon[(j + 1) % polygon.length]!;
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return false;
    }
  }
  return true;
}

/** A nearby room alone is insufficient: retain only unambiguous door-to-two-region joins. */
export function roomPortals(rooms: readonly DirectoryRoom[], doors: readonly DirectoryDoor[]): RoomPortal[] {
  const unique = rooms.filter(isWalkable).filter((r, i, active) => !r.circulationGroup || active.findIndex((other) => other.circulationGroup === r.circulationGroup) === i);
  const bounds = unique.map((room) => {
    const xs = room.polygonFeet.map((p) => p[0]); const ys = room.polygonFeet.map((p) => p[1]);
    return { room, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  const portals: RoomPortal[] = [];
  for (const door of doors) {
    const candidates = bounds.filter((b) => door.point[0] >= b.minX - 2 && door.point[0] <= b.maxX + 2
      && door.point[1] >= b.minY - 2 && door.point[1] <= b.maxY + 2)
      .map(({ room }) => ({ room, ...([room.polygonFeet, ...room.holesFeet ?? []].map((p) => nearestRoomBoundary(door.point, p)).sort((a, b) => a.distance - b.distance)[0]!) }))
      .filter((c) => c.distance <= 2);
    let pair=candidates;
    // A third nearby corner is not necessarily a third doorway side. Recover
    // ownership on both sides of a precise opening at several width samples.
    if(candidates.length>2 && door.footprint && door.normal){
      const [nx,ny]=door.normal,ux=-ny,uy=nx;
      const projection=(p:RoomPoint,n:RoomPoint)=>p[0]*n[0]+p[1]*n[1];
      const low=Math.min(...door.footprint.map(p=>projection(p,[nx,ny]))),high=Math.max(...door.footprint.map(p=>projection(p,[nx,ny])));
      const left=Math.min(...door.footprint.map(p=>projection(p,[ux,uy]))),right=Math.max(...door.footprint.map(p=>projection(p,[ux,uy])));
      const votes=new Map<string,{pair:typeof candidates;count:number}>();
      for(const t of [.25,.5,.75]){
        const u=left+(right-left)*t;
        const side=(n:number)=>candidates.filter(c=>containsDirectoryRoomPoint([ux*u+nx*n,uy*u+ny*n],c.room));
        const a=side(low-.35),b=side(high+.35);
        if(a.length!==1 || b.length!==1 || a[0]!.room.key===b[0]!.room.key)continue;
        const key=[a[0]!.room.key,b[0]!.room.key].sort().join(":");const vote=votes.get(key)??{pair:[a[0]!,b[0]!],count:0};vote.count++;votes.set(key,vote);
      }
      const winners=[...votes.values()].filter(v=>v.count>=2);
      if(winners.length===1)pair=winners[0]!.pair;
    }
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    // Both boundaries must lie inside the persisted opening's envelope.
    if (![a!, b!].every((c) => Math.abs(c.point[0] - door.point[0]) <= door.halfWidth + 0.6
      && Math.abs(c.point[1] - door.point[1]) <= door.halfHeight + 0.6)) continue;
    if (door.normal) {
      const side=(p:RoomPoint)=>(p[0]-door.point[0])*door.normal![0]+(p[1]-door.point[1])*door.normal![1];
      const sa=side(a!.point),sb=side(b!.point);
      // Nearby corners on the same side of a wall are not two doorway sides.
      if(sa>.05&&sb>.05 || sa<-.05&&sb<-.05)continue;
    }
    portals.push({ doorId: door.id, rooms: [a!.room.key, b!.room.key], point: door.point,
      from: a!.point, to: b!.point, halfWidth: door.halfWidth, halfHeight: door.halfHeight, footprint: door.footprint });
  }
  return portals;
}

export type DirectoryRoute = { points: RoomPoint[]; distanceFeet: number; roomKeys: string[]; cellSizeFeet: number };
export type DirectoryElevations = Readonly<Record<string,{elevation:number}>>;
export type DirectoryRouteBarriers = {walls:readonly {polygon:RoomPoint[]}[];columns:readonly {polygon:RoomPoint[]}[]};

/** Check the whole grid edge, including thin native dividers between cell centres.
 * Only a matched, precise opening footprint can permit crossing a wall. */
function nativeRouteBlocker(barriers:DirectoryRouteBarriers|undefined, openings:readonly RouteOpening[]) {
  if(!barriers)return ()=>false;
  const bins=new Map<string,{polygon:RoomPoint[];wall:boolean}[]>(),size=8;
  for(const item of [...barriers.walls.map(w=>({...w,wall:true})),...barriers.columns.map(w=>({...w,wall:false}))]){
    const xs=item.polygon.map(p=>p[0]),ys=item.polygon.map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let y=Math.floor(Math.min(...ys)/size);y<=Math.floor(Math.max(...ys)/size);y++){
      const key=`${x}:${y}`;if(!bins.has(key))bins.set(key,[]);bins.get(key)!.push(item);
    }
  }
  const door=(p:RoomPoint)=>openings.some(o=>o.footprint&&containsRoomPoint(p,o.footprint));
  return (a:RoomPoint,b:RoomPoint)=>{
    const candidates=new Set([...bins.get(`${Math.floor(a[0]/size)}:${Math.floor(a[1]/size)}`)??[],...bins.get(`${Math.floor(b[0]/size)}:${Math.floor(b[1]/size)}`)??[]]);
    const dx=b[0]-a[0],dy=b[1]-a[1];
    for(const item of candidates){
      if([a,b].some(p=>containsRoomPoint(p,item.polygon)&&(!item.wall||!door(p))))return true;
      for(let i=0;i<item.polygon.length;i++){
        const u=item.polygon[i]!,v=item.polygon[(i+1)%item.polygon.length]!,ex=v[0]-u[0],ey=v[1]-u[1],den=dx*ey-dy*ex;
        if(Math.abs(den)<1e-10)continue;
        const ox=u[0]-a[0],oy=u[1]-a[1],t=(ox*ey-oy*ex)/den,k=(ox*dy-oy*dx)/den;
        if(t>=0&&t<=1&&k>=0&&k<=1&&(!item.wall||!door([a[0]+t*dx,a[1]+t*dy])))return true;
      }
    }
    return false;
  };
}

/** Raster route follows hallway interiors and crosses room boundaries only at recovered doors.
 * Four-neighbour movement prevents cutting corners or diagonal wall crossings. */
export function findDirectoryRoute(rooms: readonly DirectoryRoom[], portals: readonly RouteOpening[], startKey: string, endKey: string, elevations:DirectoryElevations = {},barriers?:DirectoryRouteBarriers): DirectoryRoute | null {
  const start = rooms.find((r) => r.key === startKey); const end = rooms.find((r) => r.key === endKey);
  if (!start || !end || !isWalkable(start) || !isWalkable(end) || start.levelId !== end.levelId) return null;
  const elevation=(r:DirectoryRoom)=>elevations[r.key]?.elevation??r.modelSurface?.elevationFeet;
  const sameHeight=(a:DirectoryRoom,b:DirectoryRoom)=>elevation(a)==null||elevation(b)==null||Math.abs(elevation(a)!-elevation(b)!)<=.05;
  // A shared directory level can contain sunken lounges or raised landings.
  // They need a stair/ramp transition, never a flat adjacency shortcut.
  if(!sameHeight(start,end))return null;
  const openings=rooms.filter(r=>r.levelId===start.levelId&&r.status!=="deleted"&&sameHeight(start,r)).flatMap(r=>r.floorOpeningsFeet??[]);
  if(openings.some(h=>containsRoomPoint(start.routePointFeet??start.labelPointFeet,h)||containsRoomPoint(end.routePointFeet??end.labelPointFeet,h)))return null;
  if(start.key===end.key)return {points:[start.routePointFeet??start.labelPointFeet],distanceFeet:0,roomKeys:[start.key],cellSizeFeet:0};
  // Hallway-to-hallway routes must stay in circulation spaces. Room access
  // routes may still use real room-to-room doors to reach an inner room.
  const circulationOnly = isHallway(start) && isHallway(end);
  const floorRooms = rooms.filter((r) => r.levelId === start.levelId && r.status !== "deleted");
  // Keep private-room footprints in the raster as obstacles, even when an
  // imported hallway outline overlaps them. Their masks take precedence.
  const walkRooms = floorRooms.filter((r, i) => !r.circulationGroup
    || floorRooms.findIndex((other) => other.circulationGroup === r.circulationGroup) === i)
    .sort((a, b) => Number(isWalkable(b)) - Number(isWalkable(a)) || Number(isHallway(b)) - Number(isHallway(a)));
  const permitted = (r: DirectoryRoom) => isWalkable(r) && sameHeight(start,r) && (!circulationOnly || isHallway(r));
  const xs = walkRooms.flatMap((r) => r.polygonFeet.map((p) => p[0])); const ys = walkRooms.flatMap((r) => r.polygonFeet.map((p) => p[1]));
  const minX = Math.min(...xs) - 3; const minY = Math.min(...ys) - 3;
  const spanX = Math.max(...xs) - minX + 3; const spanY = Math.max(...ys) - minY + 3;
  const cell = Math.max(0.6, Math.sqrt(spanX * spanY / 450_000));
  const width = Math.ceil(spanX / cell); const height = Math.ceil(spanY / cell); const size = width * height;
  const owner = new Int32Array(size); owner.fill(-1);
  const at = (x: number, y: number) => y * width + x;
  const world = (i: number): RoomPoint => [minX + ((i % width) + 0.5) * cell, minY + (Math.floor(i / width) + 0.5) * cell];
  // Scanline fill avoids an all-polygons hit test for every cell of a campus plan.
  walkRooms.forEach((room, index) => {
    const lo = Math.max(0, Math.floor((Math.min(...room.polygonFeet.map((p) => p[1])) - minY) / cell));
    const hi = Math.min(height - 1, Math.ceil((Math.max(...room.polygonFeet.map((p) => p[1])) - minY) / cell));
    for (let y = lo; y <= hi; y++) {
      const wy = minY + (y + 0.5) * cell; const hits: number[] = [];
      for (const loop of [room.polygonFeet, ...room.holesFeet ?? []]) loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length]!;
        if ((a[1] > wy) !== (b[1] > wy)) hits.push(a[0] + (b[0] - a[0]) * (wy - a[1]) / (b[1] - a[1]));
      });
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const x0 = Math.max(0, Math.ceil((hits[i]! - minX) / cell - 0.5));
        const x1 = Math.min(width - 1, Math.floor((hits[i + 1]! - minX) / cell - 0.5));
        for (let x = x0; x <= x1; x++) owner[at(x, y)] = index;
      }
    }
  });
  // Native slab holes override every overlapping flat-floor source, including door bridges.
  if(openings.length)for(let i=0;i<size;i++)if(openings.some(h=>containsRoomPoint(world(i),h)))owner[i]=-2;
  const doorAt = new Int32Array(size); doorAt.fill(-1);
  const usable = portals.filter((p) => p.rooms.every((key) => walkRooms.some((r) => r.key === key && permitted(r))));
  usable.forEach((portal, index) => {
    const x0 = Math.max(0, Math.floor((portal.point[0] - portal.halfWidth - 0.3 - minX) / cell));
    const x1 = Math.min(width - 1, Math.ceil((portal.point[0] + portal.halfWidth + 0.3 - minX) / cell));
    const y0 = Math.max(0, Math.floor((portal.point[1] - portal.halfHeight - 0.3 - minY) / cell));
    const y1 = Math.min(height - 1, Math.ceil((portal.point[1] + portal.halfHeight + 0.3 - minY) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = at(x, y); const p = world(i);
      if (portal.footprint && !containsRoomPoint(p, portal.footprint) && nearestRoomBoundary(p, portal.footprint).distance > cell * .75) continue;
      if (Math.abs(p[0] - portal.point[0]) > portal.halfWidth + 0.3 || Math.abs(p[1] - portal.point[1]) > portal.halfHeight + 0.3) continue;
      // A rotated door's axis-aligned envelope includes jambs and nearby wall.
      // Bridge only the short segment between the two matched boundary points.
      const dx = portal.to[0] - portal.from[0]; const dy = portal.to[1] - portal.from[1];
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((p[0] - portal.from[0]) * dx + (p[1] - portal.from[1]) * dy) / length)) : 0;
      if (Math.hypot(p[0] - portal.from[0] - t * dx, p[1] - portal.from[1] - t * dy) > Math.max(.45, cell * .75)) continue;
      if (owner[i]! >= 0 && !portal.rooms.includes(walkRooms[owner[i]!]!.key)) continue;
      doorAt[i] = index;
    }
  });
  const nativeBlocked=nativeRouteBlocker(barriers,usable),openingBlocked=nativeRouteBlocker({walls:[],columns:openings.map(polygon=>({polygon}))},[]);
  const blocked=(a:RoomPoint,b:RoomPoint)=>nativeBlocked(a,b)||openingBlocked(a,b);
  const canStep = (a: number, b: number): boolean => {
    if(blocked(world(a),world(b)))return false;
    const oa = owner[a]!; const ob = owner[b]!;
    if(oa===-2||ob===-2)return false;
    if (oa >= 0 && !permitted(walkRooms[oa]!) || ob >= 0 && !permitted(walkRooms[ob]!)) return false;
    if (oa >= 0 && ob >= 0 && (oa === ob || (isHallway(walkRooms[oa]!) && isHallway(walkRooms[ob]!)))) return true;
    const da = doorAt[a]!; const db = doorAt[b]!;
    for (const d of [da, db]) {
      if (d < 0 || (oa < 0 && da !== d) || (ob < 0 && db !== d)) continue;
      const keys = usable[d]!.rooms;
      if ((oa < 0 || keys.includes(walkRooms[oa]!.key)) && (ob < 0 || keys.includes(walkRooms[ob]!.key))) return true;
    }
    return false;
  };
  const endpoint = (room: DirectoryRoom): number => {
    const index = walkRooms.findIndex((r) => r.key === room.key || !!room.circulationGroup && r.circulationGroup === room.circulationGroup); let best = -1; let distance = Infinity;
    for (let i = 0; i < size; i++) if (owner[i] === index && !blocked(world(i),world(i))) {
      const p = world(i); const d = Math.hypot(p[0] - (room.routePointFeet??room.labelPointFeet)[0], p[1] - (room.routePointFeet??room.labelPointFeet)[1]);
      if (d < distance) { best = i; distance = d; }
    }
    return distance <= 2 * cell ? best : -1;
  };
  const from = endpoint(start); const to = endpoint(end);
  if (from < 0 || to < 0) return null;
  const previous = new Int32Array(size); previous.fill(-1);
  const queue = new Int32Array(size); let head = 0; let tail = 1; queue[0] = from; previous[from] = from;
  while (head < tail && previous[to] === -1) {
    const i = queue[head++]!; const x = i % width; const y = Math.floor(i / width);
    for (const next of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (next < 0 || previous[next] !== -1 || !canStep(i, next)) continue;
      previous[next] = i; queue[tail++] = next;
    }
  }
  if (previous[to] === -1) return null;
  const cells: number[] = []; for (let i = to; i !== from; i = previous[i]!) cells.push(i); cells.push(from); cells.reverse();
  const keys = [...new Set([startKey, ...cells.filter((i) => owner[i]! >= 0).map((i) => walkRooms[owner[i]!]!.key), endKey])];
  const points = cells.filter((i, index) => index === 0 || index === cells.length - 1
    || i - cells[index - 1]! !== cells[index + 1]! - i).map(world);
  return { points, roomKeys: keys, distanceFeet: (cells.length - 1) * cell, cellSizeFeet: cell };
}

/** Physical hallway regions can have several directory labels. Keep those aliases
 * together, and include doors between circulation regions in the topology. */
export function hallwayComponents(rooms: readonly DirectoryRoom[], portals: readonly RouteOpening[]): string[][] {
  const hallways = rooms.filter(r => isWalkable(r) && isHallway(r)); const adjacent = hallways.map(() => new Set<number>());
  const loops = (r: DirectoryRoom) => [r.polygonFeet, ...r.holesFeet ?? []];
  for (let i = 0; i < hallways.length; i++) for (let j = i + 1; j < hallways.length; j++) {
    const a = hallways[i]!; const b = hallways[j]!; if (a.levelId !== b.levelId) continue;
    const touches = (one: DirectoryRoom, other: DirectoryRoom) => loops(one).some((loop) => loop.some((p, k) => {
      const q = loop[(k + 1) % loop.length]!; const mid: RoomPoint = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return containsDirectoryRoomPoint(mid, other) || loops(other).some((l) => nearestRoomBoundary(mid, l).distance < .01);
    }));
    if (a.circulationGroup && a.circulationGroup === b.circulationGroup || touches(a, b) || touches(b, a)
      || portals.some((p) => p.rooms.includes(a.key) && p.rooms.includes(b.key))) { adjacent[i]!.add(j); adjacent[j]!.add(i); }
  }
  const seen = new Set<number>(); const components: string[][] = [];
  for (let i = 0; i < hallways.length; i++) {
    if (seen.has(i)) continue;
    const queue = [i]; seen.add(i);
    for (let k = 0; k < queue.length; k++) for (const j of adjacent[queue[k]!]!) if (!seen.has(j)) { seen.add(j); queue.push(j); }
    components.push(queue.map((j) => hallways[j]!.key));
  }
  return components;
}

/** Test usable routes between hallway labels. A shared corner or a tiny seam
 * can make outlines touch while the routing grid still has no usable passage. */
export function hallwayRouteComponents(rooms: readonly DirectoryRoom[], portals: readonly RouteOpening[], elevations:DirectoryElevations = {},barriers?:DirectoryRouteBarriers): string[][] {
  const pending = rooms.filter(r => isWalkable(r) && isHallway(r)).sort((a,b)=>directoryRoomArea(b)-directoryRoomArea(a));
  const groups:string[][]=[];
  while(pending.length){
    const seed=pending.shift()!,group=[seed.key];
    for(let i=pending.length-1;i>=0;i--)if(findDirectoryRoute(rooms,portals,seed.key,pending[i]!.key,elevations,barriers)){group.push(pending[i]!.key);pending.splice(i,1);}
    groups.push(group);
  }
  return groups;
}
