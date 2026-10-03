// JSTS has no published types; include the checked local ambient declarations.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./native-room-presentation-jsts.d.ts" />
import polygonClipping from "polygon-clipping";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import GeometryNoder from "jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import ArrayList from "jsts/java/util/ArrayList.js";
import type { BoundaryReference } from "./room-boundaries.ts";
import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";
import { cleanRoomBoundary, containsRoomPoint, roomArea, validRoomBoundary } from "./room-directory.ts";

type Point = [number, number];
type Rings = Point[][];
type Wall = IndoorDataset["walls"][number];
type Bounds = [number, number, number, number];
export type NativeRoomInteriors = {
  rooms: { roomKey: string; levelId: number; ringsFeet: Rings; boundaryElementIds: number[]; sourceCoverage: number; cellCoverage: number; boundaryEvidence?:string }[];
  diagnostics: { roomKey: string; levelId: number; code: string; message: string }[];
};
export type NativeWallJunctionRepair = {
  levelId: number;
  nativeWallElementId: number;
  supportingElementId: number;
  supportingElementKind: "wall" | "column";
  repairKind: "end-cap" | "corner";
  gapFeet: number;
  toleranceFeet: number;
  ringsFeet: Rings;
  evidence?: "registered-two-face-wall-continuation";
  sourceSha256?: string;
  sourceSectionId?: string;
  sourceWallSegmentIndices?: [number, number];
};
export const NATIVE_ROOM_JUNCTION_TOLERANCE_FEET = .08; // 24.4 mm; supported native end caps only.
const JUNCTION_TOLERANCE = NATIVE_ROOM_JUNCTION_TOLERANCE_FEET;
const CORNER_TOLERANCE = .04; // A single supported cap corner has less evidence than a complete cap.
const bounds = (rings: Rings): Bounds => {
  const ps = rings.flat();
  return [Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))];
};
const intersects = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const padded = (b: Bounds, d: number): Bounds => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const edges = (rings: Rings): [Point, Point][] => rings.flatMap(r => r.map((a, i) => [a, r[(i + 1) % r.length]!] as [Point, Point]));
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearest(p: Point, rings: Rings): Point {
  let best: Point = p; let minimum = Infinity;
  for (const [a, b] of edges(rings)) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const q: Point = [a[0] + dx * t, a[1] + dy * t];
    if (distance(p, q) < minimum) { best = q; minimum = distance(p, q); }
  }
  return best;
}
const area = (parts: Rings[]) => parts.reduce((total, rings) => total + rings.reduce((sum, ring, i) => sum + (i ? -1 : 1) * roomArea(ring), 0), 0);
const contains = (p: Point, rings: Rings) => containsRoomPoint(p, rings[0]!) && !rings.slice(1).some(h => containsRoomPoint(p, h));
const isVoid = (r: IndoorRecord) => !r.walkable && /open drop|open to (?:below|lower)/i.test(String(r.properties.notes ?? ""));

/** A crossed or collapsed endpoint projection cannot become a barrier. */
function validJunctionPatch(rings: Rings): boolean {
  const ring = rings[0]!.filter((p,i,points)=>i===0||distance(p,points[i-1]!)>1e-7);
  if(ring.length>1&&distance(ring[0]!,ring.at(-1)!)<1e-7)ring.pop();
  if (rings.length !== 1 || ring.length < 3 || ring.some(p => !p.every(Number.isFinite)) || roomArea(ring) < 1e-10) return false;
  const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<ring.length;i++)for(let j=i+2;j<ring.length;j++) {
    if(i===0&&j===ring.length-1)continue;
    const a=ring[i]!,b=ring[(i+1)%ring.length]!,c=ring[j]!,d=ring[(j+1)%ring.length]!;
    if(cross(a,b,c)*cross(a,b,d)<-1e-16&&cross(c,d,a)*cross(c,d,b)<-1e-16)return false;
  }
  return true;
}

/** Query native evidence locally without changing its original order. Long
 * diagonal envelopes use a small overflow list instead of allocating a huge
 * campus-sized grid. This is an index, not a geometry approximation. */
function evidenceIndex<T extends {levelId:number;box:Bounds;index:number}>(entries:T[]) {
  const size=32, bins=new Map<string,T[]>(), overflow=new Map<number,T[]>();
  const extent=(box:Bounds)=>[Math.floor(box[0]/size),Math.floor(box[1]/size),Math.floor(box[2]/size),Math.floor(box[3]/size)];
  for(const entry of entries) {
    const [x0,y0,x1,y1]=extent(entry.box);
    if((x1!-x0!+1)*(y1!-y0!+1)>256) {overflow.set(entry.levelId,[...overflow.get(entry.levelId)??[],entry]);continue;}
    for(let x=x0!;x<=x1!;x++)for(let y=y0!;y<=y1!;y++) {
      const key=`${entry.levelId}:${x}:${y}`;
      bins.set(key,[...bins.get(key)??[],entry]);
    }
  }
  return (levelId:number,box:Bounds):T[]=>{
    const [x0,y0,x1,y1]=extent(box),found=new Set(overflow.get(levelId)??[]);
    for(let x=x0!;x<=x1!;x++)for(let y=y0!;y<=y1!;y++)
      for(const entry of bins.get(`${levelId}:${x}:${y}`)??[])found.add(entry);
    return [...found].filter(entry=>intersects(entry.box,box)).sort((a,b)=>a.index-b.index);
  };
}

/** Extend only a short native wall end cap to independently recovered barrier
 * material. A column can support a wall endpoint, but cannot invent a partition.
 * No room annotation, window edge or door footprint supplies missing walls. */
export function recoverNativeWallJunctionRepairs(walls: Wall[], doors: NonNullable<IndoorDataset["doors"]>): NativeWallJunctionRepair[] {
  const result: NativeWallJunctionRepair[] = [];
  const nearbyWalls=evidenceIndex(walls.flatMap((wall,index)=>
    (wall.kind==="wall"||wall.kind==="column")&&wall.ringsFeet[0]?.length>=3
      ?[{wall,index,levelId:wall.levelId,box:bounds(wall.ringsFeet)}]:[]));
  const nearbyDoors=evidenceIndex(doors.flatMap((door,index)=>door.footprintFeet?.length
    ?[{door,index,levelId:door.levelId,box:bounds([door.footprintFeet])}]:[]));
  const doorIntersects=(levelId:number,patch:Rings)=>nearbyDoors(levelId,bounds(patch)).length>0;
  for (const wall of walls.filter(w => w.kind === "wall")) {
    const ring = wall.ringsFeet[0]!;
    if (wall.ringsFeet.length !== 1 || ring.length !== 4) continue;
    const lengths = ring.map((a, i) => distance(a, ring[(i + 1) % ring.length]!));
    for (const [i, a] of ring.entries()) {
      if (lengths[i]! > 2 || lengths[i]! * 3 > Math.max(...lengths)) continue;
      const b = ring[(i + 1) % ring.length]!;
      for (const {wall:other} of nearbyWalls(wall.levelId,padded(bounds([[a,b]]),JUNCTION_TOLERANCE)).filter(entry=>entry.wall!==wall)) {
        const qa = nearest(a, other.ringsFeet), qb = nearest(b, other.ringsFeet);
        const da = distance(a, qa), db = distance(b, qb);
        if (Math.max(da, db) > JUNCTION_TOLERANCE) {
          // A tapered/butt junction can meet the supporting face at only one
          // cap corner. Repair a microscopic wedge at that corner, not the
          // unsupported remainder of the cap. This closes polygonization seams
          // such as Studio 05-122's 3.8 mm finish-face corner.
          for (const [p, q, gap, towards] of [[a, qa, da, b], [b, qb, db, a]] as [Point, Point, number, Point][]) {
            if (gap < 1e-7 || gap > CORNER_TOLERANCE) continue;
            const capLength = distance(p, towards);
            const span = Math.min(CORNER_TOLERANCE, capLength);
            const c: Point = [p[0] + (towards[0] - p[0]) * span / capLength,
              p[1] + (towards[1] - p[1]) * span / capLength];
            const patch: Rings = [[p, q, c]];
            if (!validJunctionPatch(patch) || doorIntersects(wall.levelId,patch)) continue;
            result.push({levelId:wall.levelId,nativeWallElementId:wall.nativeElementId,
              supportingElementId:other.nativeElementId,supportingElementKind:other.kind === "column" ? "column" : "wall",
              repairKind:"corner",gapFeet:gap,toleranceFeet:CORNER_TOLERANCE,ringsFeet:patch});
          }
          continue;
        }
        if (Math.max(da, db) < 1e-7) continue;
        // Extend microscopically into the supporting face so precision reduction
        // cannot reopen a zero-width T contact. Total repair remains <= .08 ft.
        const extend = (p: Point, q: Point, d: number): Point => d < 1e-7 ? q : [q[0] + (q[0] - p[0]) / d * Math.min(.0002, JUNCTION_TOLERANCE - d), q[1] + (q[1] - p[1]) / d * Math.min(.0002, JUNCTION_TOLERANCE - d)];
        const patch: Rings = [[a, b, extend(b, qb, db), extend(a, qa, da)]];
        if (!validJunctionPatch(patch) || doorIntersects(wall.levelId,patch)) continue;
        result.push({levelId:wall.levelId,nativeWallElementId:wall.nativeElementId,
          supportingElementId:other.nativeElementId,supportingElementKind:other.kind === "column" ? "column" : "wall",
          repairKind:"end-cap",gapFeet:Math.max(da,db),toleranceFeet:JUNCTION_TOLERANCE,ringsFeet:patch});
      }
    }
  }
  return result;
}

/** Repair a short, coplanar native wall join only where a registered drawing
 * independently continues BOTH wall faces through it and into each native wall.
 * This separate source-backed proof never raises the native-only seam tolerance.
 * Native/source apertures veto a patch. It creates barrier material, not floors,
 * room identity, public access, or navigation authority. Preserve its provenance.
 */
export function recoverRegisteredWallJunctionRepairs(walls:Wall[],doors:NonNullable<IndoorDataset["doors"]>,reference:BoundaryReference|undefined):NativeWallJunctionRepair[] {
  if(!reference)return [];
  const tolerance=.5, sourceTolerance=.05, result:NativeWallJunctionRepair[]=[];
  const caps=walls.flatMap(wall=>{
    const ring=wall.ringsFeet[0];
    if(wall.kind!=="wall"||wall.ringsFeet.length!==1||ring?.length!==4)return [];
    const lengths=ring.map((p,i)=>distance(p,ring[(i+1)%4]!)),centre:Point=[ring.reduce((n,p)=>n+p[0]/4,0),ring.reduce((n,p)=>n+p[1]/4,0)];
    return ring.flatMap((a,i)=>{
      const length=lengths[i]!;if(length>2||length*3>Math.max(...lengths))return [];
      const b=ring[(i+1)%4]!,mid:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2],reach=distance(mid,centre);
      if(reach<1e-8)return [];
      return [{wall,a,b,length,mid,outward:[(mid[0]-centre[0])/reach,(mid[1]-centre[1])/reach] as Point}];
    });
  });
  const capIndex=evidenceIndex(caps.map((cap,index)=>({cap,index,levelId:cap.wall.levelId,box:bounds([[cap.a,cap.b]])})));
  const nearbyDoors=evidenceIndex(doors.flatMap((door,index)=>door.footprintFeet?.length?[{door,index,levelId:door.levelId,box:bounds([door.footprintFeet])}]:[]));
  const segments=reference.sections.flatMap(section=>section.registrationErrorFeet<=sourceTolerance&&Number.isFinite(section.registrationErrorFeet)
    ?section.wallSegments.map((line,sourceIndex)=>({section,line,sourceIndex})):[]);
  const sourceIndex=evidenceIndex(segments.map((segment,index)=>({segment,index,levelId:segment.section.levelId,box:bounds([segment.line])})));
  const seen=new Set<string>();
  for(const a of caps)for(const {cap:b}of capIndex(a.wall.levelId,padded(bounds([[a.a,a.b]]),tolerance))) {
    if(a.wall.nativeElementId===b.wall.nativeElementId)continue;
    const gap=distance(a.mid,b.mid);if(gap<=JUNCTION_TOLERANCE||gap>tolerance||Math.abs(a.length-b.length)>.02)continue;
    const nx=(b.mid[0]-a.mid[0])/gap,ny=(b.mid[1]-a.mid[1])/gap;
    if(a.outward[0]*nx+a.outward[1]*ny<.9995||b.outward[0]*nx+b.outward[1]*ny>-.9995)continue;
    const direct=distance(a.a,b.a)+distance(a.b,b.b),crossed=distance(a.a,b.b)+distance(a.b,b.a);
    const qa=direct<crossed?b.a:b.b,qb=direct<crossed?b.b:b.a;
    if(Math.abs(distance(a.a,qa)-gap)>.02||Math.abs(distance(a.b,qb)-gap)>.02)continue;
    const patch:Rings=[[a.a,a.b,qb,qa]],box=padded(bounds(patch),sourceTolerance);
    if(!validJunctionPatch(patch)||nearbyDoors(a.wall.levelId,box).length)continue;
    const source=sourceIndex(a.wall.levelId,box).map(entry=>entry.segment);
    const supporting=(p:Point,q:Point)=>source.filter(({line})=>{
      const length=distance(line[0],line[1]);if(length<gap+.2)return false;
      const parallel=Math.abs(((line[1][0]-line[0][0])*nx+(line[1][1]-line[0][1])*ny)/length);
      if(parallel<.9995)return false;
      return [[p[0]-.1*nx,p[1]-.1*ny],[q[0]+.1*nx,q[1]+.1*ny]].every(point=>distance(point as Point,nearest(point as Point,[line]))<=sourceTolerance);
    });
    const faceA=supporting(a.a,qa),faceB=supporting(a.b,qb);
    const proof=faceA.flatMap(x=>faceB.filter(y=>y.section===x.section&&y.sourceIndex!==x.sourceIndex).map(y=>({x,y}))).find(({x})=>
      !x.section.doorSegments.some(line=>intersects(padded(bounds([line]),sourceTolerance),box)));
    if(!proof)continue;
    const key=[a.wall.levelId,...[a.wall.nativeElementId,b.wall.nativeElementId].sort((x,y)=>x-y),...patch[0]!.flat().map(n=>n.toFixed(5)).sort()].join(":");
    if(seen.has(key))continue;seen.add(key);
    result.push({levelId:a.wall.levelId,nativeWallElementId:a.wall.nativeElementId,supportingElementId:b.wall.nativeElementId,supportingElementKind:"wall",repairKind:"end-cap",gapFeet:gap,toleranceFeet:tolerance,ringsFeet:patch,
      evidence:"registered-two-face-wall-continuation",sourceSha256:reference.sourceSha256,sourceSectionId:proof.x.section.sectionId,sourceWallSegmentIndices:[proof.x.sourceIndex,proof.y.sourceIndex]});
  }
  return result;
}

/** A door may close a cell only where its native envelope reaches wall material
 * on both ends of its long axis. A free-floating door envelope is not a barrier. */
function supportedThreshold(footprint: Point[], walls: Wall[]): boolean {
  if (footprint.length !== 4 || roomArea(footprint) < .001) return false;
  const lengths = footprint.map((p, i) => distance(p, footprint[(i + 1) % 4]!));
  const longest = lengths.indexOf(Math.max(...lengths));
  const a = footprint[longest]!, b = footprint[(longest + 1) % 4]!;
  const oppositeA = footprint[(longest + 3) % 4]!, oppositeB = footprint[(longest + 2) % 4]!;
  const ends: Point[] = [[(a[0] + oppositeA[0]) / 2, (a[1] + oppositeA[1]) / 2], [(b[0] + oppositeB[0]) / 2, (b[1] + oppositeB[1]) / 2]];
  const axis: Point = [(b[0] - a[0]) / lengths[longest]!, (b[1] - a[1]) / lengths[longest]!];
  return ends.every(p => walls.some(w => {
    if (contains(p, w.ringsFeet)) return true;
    const q = nearest(p, w.ringsFeet), gap = distance(p, q);
    // Jamb support is along the door opening's long axis. Being close to a
    // parallel wall face on its front/back cannot seal an unrelated wall gap.
    return gap <= CORNER_TOLERANCE && (gap < .0002 || Math.abs((q[0] - p[0]) * axis[0] + (q[1] - p[1]) * axis[1]) >= gap * .9);
  }));
}

/** Precise native presentation recovery, isolated from source room/routing data.
 * Fully noded wall-face linework yields bounded planar cells; annotations only
 * identify cells and never close them. Original records are not modified. */
function recoverNativeRoomInteriorsInScope(records: IndoorRecord[], walls: IndoorDataset["walls"], doors: NonNullable<IndoorDataset["doors"]>, seeds: Map<string, Point>, paddingFeet: number, roomKeys?: Set<string>): NativeRoomInteriors {
  const result: NativeRoomInteriors = { rooms: [], diagnostics: [] };
  const native = walls.filter(w => (w.kind === "wall" || w.kind === "column") && w.ringsFeet[0]?.length >= 3).map(w => ({ wall: w, box: bounds(w.ringsFeet) }));
  const recordBounds = records.map(record => ({ record, box: bounds(record.ringsFeet) }));
  const byKey=new Map(records.map(record=>[record.key,record]));
  const cellLabels=new WeakMap<Rings,string[]>();
  const labelsInCell=(cell:Rings,levelId:number)=>{
    let labels=cellLabels.get(cell);
    if(!labels) {labels=records.filter(other=>other.levelId===levelId&&!other.circulation&&seeds.has(other.key)&&contains(seeds.get(other.key)!,cell)).map(other=>other.key);cellLabels.set(cell,labels);}
    return labels;
  };
  const reader = new GeoJSONReader(), writer = new GeoJSONWriter();
  const contexts=new Map<number,{cells:Rings[];supportedDoors:NonNullable<IndoorDataset["doors"]>;thresholds:Rings[];doorCount:number;dangles:number;cuts:number}>();
  for (const room of records.filter(r => r.walkable && !r.circulation && (!roomKeys || roomKeys.has(r.key)))) {
    const fail = (code: string, message: string) => result.diagnostics.push({ roomKey: room.key, levelId: room.levelId, code, message });
    const seed = seeds.get(room.key);
    if (!seed) { fail("missing-room-seed", "No native-level room label position is available."); continue; }
    const localBox = padded(bounds(room.ringsFeet), paddingFeet);
    const local = native.filter(w => w.wall.levelId === room.levelId && intersects(w.box, localBox)).map(w => w.wall);
    if (!local.some(w => w.kind === "wall")) { fail("no-native-walls", "No structural wall faces were recovered on this native level."); continue; }
    try {
      let context=paddingFeet===Infinity?contexts.get(room.levelId):undefined;
      if(!context) {
      const localDoors = doors.filter(d => d.levelId === room.levelId && d.footprintFeet && intersects(bounds([d.footprintFeet]), localBox));
      const supports=evidenceIndex(local.map((wall,index)=>({wall,index,levelId:wall.levelId,box:bounds(wall.ringsFeet)})));
      const supportedDoors = localDoors.filter(d => supportedThreshold(d.footprintFeet!,supports(d.levelId,padded(bounds([d.footprintFeet!]),CORNER_TOLERANCE)).map(entry=>entry.wall)));
      const thresholds = supportedDoors.map(d => [d.footprintFeet!] as Rings);
      const patches = recoverNativeWallJunctionRepairs(local, localDoors).map(repair => repair.ringsFeet);
      const barriers = [...local.map(w => w.ringsFeet), ...thresholds, ...patches];
      if(paddingFeet===Infinity) {
        // Full-level wall-face noding repeats thousands of coincident segments.
        // The bounded holes of the union of native barrier material are the
        // same closed free-space cells. Remove barrier islands/columns from the
        // complete hole union so nested circuits cannot produce duplicate cells.
        const box=bounds(barriers.flat()),origin:Point=[box[0],box[1]];
        const normalized=barriers.map(rings=>rings.map(ring=>ring.map(([x,y])=>
          [Math.round((x-origin[0])*10000)/10000,Math.round((y-origin[1])*10000)/10000] as Point)));
        const material=polygonClipping.union(normalized[0]!,...normalized.slice(1));
        const holes=material.flatMap(part=>part.slice(1).map(ring=>[ring] as Rings));
        const bounded=holes.length?polygonClipping.union(holes[0]!,...holes.slice(1)):[];
        const free=bounded.length?polygonClipping.difference(bounded,material):[];
        const cells=free.map(part=>part.map(ring=>cleanRoomBoundary(ring.map(([x,y])=>[x+origin[0],y+origin[1]] as Point))));
        context={cells,supportedDoors,thresholds,doorCount:localDoors.length,dangles:0,cuts:0};
        contexts.set(room.levelId,context);
      } else {
      // JSTS 2.12's GeometryNoder uses the older MCIndexSnapRounder, whose
      // input coordinates must already use its precision model. Keep this
      // microscopic grid separate from supported physical junction repairs.
      const linework = edges(barriers.flat()).map(edge => edge.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]));
      const inputs = new ArrayList();
      inputs.add(reader.read({ type: "MultiLineString", coordinates: linework }));
      const noder = new GeometryNoder(new PrecisionModel(10000));
      noder.setValidate(true);
      // Noding retains duplicate substrings. Polygonizer needs a dissolved
      // planar graph: overlapping native faces must not create twin copies of
      // the same undirected edge (which would turn a real cell into cut edges).
      const dissolved = new Map<string, [Point, Point]>();
      for (const geometry of noder.node(inputs).toArray()) {
        const points = (writer.write(geometry) as { coordinates: Point[] }).coordinates;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!, b = points[i]!;
          if (distance(a, b) < 1e-9) continue;
          const ka = a.join(","), kb = b.join(",");
          dissolved.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b]);
        }
      }
      const polygonizer = new Polygonizer();
      polygonizer.add(reader.read({ type: "MultiLineString", coordinates: [...dissolved.values()] }));
      const cells = polygonizer.getPolygons().toArray().map((geometry: unknown) => (writer.write(geometry) as { coordinates: Rings }).coordinates.map(cleanRoomBoundary));
      context={cells,supportedDoors,thresholds,doorCount:localDoors.length,dangles:polygonizer.getDangles().size(),cuts:polygonizer.getCutEdges().size()};
      }
      }
      const {cells,supportedDoors,thresholds}=context;
      const sourceArea = area([room.ringsFeet]);
      if (sourceArea <= 0) { fail("invalid-source-room", "The source room has no positive interior area."); continue; }
      const labelled = cells.filter((cell: Rings) => contains(seed, cell));
      if (!labelled.length) { fail("unclosed-native-cell", `No bounded native wall cell contains the room label (${paddingFeet===Infinity?"exhaustive native-level barrier union":`${context.dangles} dangling edges, ${context.cuts} cut edges`}; ${thresholds.length}/${context.doorCount} supported native door thresholds).`); continue; }
      let rejected = "insufficient-source-overlap";
      let bestSourceCoverage = 0, bestCellCoverage = 0;
      let bestOtherLabels: string[] = [];
      const candidates: { cell: Rings; sourceCoverage: number; cellCoverage: number; containedSourceIdentity: boolean }[] = [];
      for (const cell of labelled as Rings[]) {
        const cellArea = area([cell]);
        if (cellArea <= 0 || cell.slice(1).some(ring => ring.length < 3 || roomArea(ring) <= 0)) continue;
        const overlap = area(polygonClipping.intersection(cell, room.ringsFeet) as Rings[]);
        const sourceCoverage = overlap / sourceArea, cellCoverage = overlap / cellArea;
        if (sourceCoverage * cellCoverage > bestSourceCoverage * bestCellCoverage) {
          bestSourceCoverage = sourceCoverage; bestCellCoverage = cellCoverage;
          bestOtherLabels=labelsInCell(cell,room.levelId).filter(key=>key!==room.key).map(key=>byKey.get(key)!.number||key);
        }
        // Source contours are often heavily inset/coarse raster regions. A
        // bounded native cell need not be 65% painted by that contour when the
        // contour is almost entirely inside it and its sole label establishes
        // identity independently. This fallback cannot absorb any other source
        // claim (including circulation/void masks), or a second room label.
        const cellBox=bounds(cell);
        const others = recordBounds.filter(other => other.record.levelId === room.levelId && other.record.key !== room.key && intersects(other.box, cellBox));
        if (others.some(({ record }) => labelsInCell(cell,room.levelId).includes(record.key))) { rejected = "multiple-room-labels"; continue; }
        const containedSourceIdentity = sourceCoverage >= .95 && cellCoverage < .65;
        if (sourceCoverage < .65 || (cellCoverage < .65 && !containedSourceIdentity)) continue;
        const competingClaims=others.filter(({record})=>area(polygonClipping.intersection(cell,record.ringsFeet) as Rings[]) > (containedSourceIdentity ? .002 : cellArea*.05));
        if (competingClaims.some(({record})=>record.circulation||isVoid(record))) { rejected = "circulation-or-void-overlap"; continue; }
        if (containedSourceIdentity && competingClaims.length) { rejected = "competing-source-room-claim"; continue; }
        if(!validRoomBoundary(cell[0]!))continue;
        if (local.some(w => intersects(bounds(w.ringsFeet),cellBox)&&area(polygonClipping.intersection(cell, w.ringsFeet) as Rings[]) > cellArea * .001)) { rejected = "cell-includes-wall-material"; continue; }
        candidates.push({ cell, sourceCoverage, cellCoverage, containedSourceIdentity });
      }
      if (candidates.length !== 1) { fail(candidates.length > 1 ? "ambiguous-native-cell" : rejected, `A unique closed, uncontested native room enclosure could not be verified (best source coverage ${(bestSourceCoverage * 100).toFixed(1)}%, cell coverage ${(bestCellCoverage * 100).toFixed(1)}%; ${thresholds.length}/${context.doorCount} supported native door thresholds; other enclosed room labels: ${bestOtherLabels.join(", ") || "none"}).`); continue; }
      const candidate = candidates[0]!;
      const holes = room.ringsFeet.slice(1).map(ring => [ring] as Rings);
      const parts = holes.length ? polygonClipping.difference(candidate.cell, ...holes) as Rings[] : [candidate.cell];
      if (parts.length !== 1 || !contains(seed, parts[0]!)) { fail("ambiguous-room-holes", "Preserving source holes split the enclosure or excluded its label."); continue; }
      const ringsFeet = parts[0]!.map(cleanRoomBoundary);
      const touchesBoundary = (rings: Rings) => ringsFeet.some(ring => ring.some(p => distance(p, nearest(p, rings)) <= .05)) || rings.some(ring => ring.some(p => distance(p, nearest(p, ringsFeet)) <= .05));
      const boundaryBox=padded(bounds(ringsFeet),.05);
      const boundaryElementIds = [...new Set([
        ...local.filter(w => intersects(bounds(w.ringsFeet),boundaryBox)&&touchesBoundary(w.ringsFeet)).map(w => w.nativeElementId),
        ...supportedDoors.filter(d => intersects(bounds([d.footprintFeet!]),boundaryBox)&&touchesBoundary([d.footprintFeet!])).map(d => d.nativeElementId),
      ])].sort((a, b) => a - b);
      result.rooms.push({ roomKey: room.key, levelId: room.levelId, ringsFeet, boundaryElementIds, sourceCoverage: candidate.sourceCoverage, cellCoverage: candidate.cellCoverage,
        boundaryEvidence:`Native wall/column faces and supported door thresholds; ${paddingFeet===Infinity?"exhaustive native-level barrier union":"local native wall-face graph"}; end-cap seam tolerance 0.08 ft, single-corner tolerance 0.04 ft.${candidate.containedSourceIdentity ? " Identity: sole native-cell label, >=95% contained source contour, no competing source claims." : ""}` });
    } catch (error) {
      fail("native-topology-error", error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

/** Coarse drawing contours are not a limit on the native evidence query.
 * Retry only unenclosed labels with a wider context; every cell still has to
 * pass the unchanged identity/overlap/barrier/protected-floor checks. Wider
 * context never expands source geometry or relaxes enclosure acceptance. */
export function recoverNativeRoomInteriors(records: IndoorRecord[], walls: IndoorDataset["walls"], doors: NonNullable<IndoorDataset["doors"]>, seeds: Map<string, Point>, options?: {roomKeys?: Set<string>; exhaustive?: boolean}): NativeRoomInteriors {
  const result = recoverNativeRoomInteriorsInScope(records,walls,doors,seeds,3,options?.roomKeys);
  for(const paddingFeet of options?.exhaustive === false ? [] : [Infinity]) {
    const retryKeys=new Set(result.diagnostics.filter(d=>d.code==="unclosed-native-cell").map(d=>d.roomKey));
    if(!retryKeys.size)break;
    const expanded=recoverNativeRoomInteriorsInScope(records,walls,doors,seeds,paddingFeet,retryKeys);
    const acceptedKeys=new Set(expanded.rooms.map(room=>room.roomKey));
    const diagnostics=new Map(expanded.diagnostics.map(d=>[d.roomKey,d]));
    result.rooms.push(...expanded.rooms);
    result.diagnostics=result.diagnostics.filter(d=>!acceptedKeys.has(d.roomKey)).map(d=>diagnostics.get(d.roomKey)??d);
  }
  const order=new Map(records.map((record,i)=>[record.key,i]));
  result.rooms.sort((a,b)=>order.get(a.roomKey)!-order.get(b.roomKey)!);
  return result;
}
