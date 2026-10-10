import {add,sub,mul,div} from "./vendor/native-rational-overlay-arithmetic.mjs";
import { nativeRationalOverlay, nativeRationalScalarToIEEE, rational, NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION, type NativeRationalPoint, type NativeRationalParts } from "./native-rational-overlay.ts";
import { nativeRationalArea,nativeRationalMeasuredArea,nativeRationalAreaCompare, nativeRationalPointInParts, nativeRationalPathSupported, nativeRationalFootprintSupported,freezeNativeRationalParts } from "./native-exact-planar-topology.ts";
import { nativeAuthoredStairTreads } from "./native-authored-stair-treads.ts";
import { nativeExactGeosOverlay } from "./native-exact-geos-overlay.ts";
import { nativeRoomIdentityRings } from "./native-floor-opening-ownership.ts";
import { createNativeBoundaryMaterialQuery,createNativeExactBoundaryMaterialQuery } from "./native-boundary-material.ts";
import {
  createNativeHostApertureQuery,
  createNativeRoutingMaterialQuery,
} from "./native-routing-material.ts";
import pc from "polygon-clipping";
import {
  createNativeIndoorEnvelopeIndex,
  type NativeIndoorEnvelopeIndex,
} from "./native-indoor-envelopes.ts";
import {
  nativeFloorDifference,
  nativeFloorUnion,
  nativeFloorIntersection,
} from "./native-circulation-clearance.ts";
import { indoorExclusionParts } from "./indoor-exclusions.ts";
import { containsRoomPoint, type RoomPoint } from "./room-directory.ts";
import {
  routingFloorPlateRecords,
  nativeFloorPolygons,
  nativeLowSlabRecords,
} from "./routing-floor-support.ts";
import {
  architecturalPlanGeometry,
  nativeWallSolidPolygon,
  boundedNativeWallFootprints,
} from "./architectural-plan.ts";
import { recoverNativeCurtainMemberSections } from "./native-curtain-openings.ts";
import type { ConvertResult } from "./types.ts";
import type {
  IndoorDataset,
  IndoorNode,
  IndoorEdge,
} from "./indoor-contract.ts";
type Point3 = [number, number, number];
type Polygon = RoomPoint[][];
const rationalCompare = (a: NativeRationalParts[number][number][number][number], b: NativeRationalParts[number][number][number][number]) => {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
const rationalBounds = (rings: NativeRationalParts[number]) => {
  const points = rings.flat(), first = points[0]!;
  let minX = first[0], minY = first[1], maxX = first[0], maxY = first[1];
  for (const [x,y] of points) {
    if (rationalCompare(x,minX)<0)minX=x;if(rationalCompare(x,maxX)>0)maxX=x;
    if (rationalCompare(y,minY)<0)minY=y;if(rationalCompare(y,maxY)>0)maxY=y;
  }
  return [minX,minY,maxX,maxY] as const;
};
function prepareNativeWalkingUnclippedOwnershipIntersection(face: NativeRationalParts) {
  const parts = face.map(part => ({ part, holes: part.slice(1).map(ring => ({ ring, box: rationalBounds([ring]) })) }));
  return (identity: NativeRationalParts) => {
    if (!identity.length) return [];
    const box = rationalBounds(identity.flatMap(part => part));
    // This alters only the intersection's temporary operand. A distant hole
    // cannot intersect the identity; all touching holes remain. The original
    // physical face, carrier, and exact majority denominator are never altered.
    const local = parts.map(({part,holes}) => [part[0]!, ...holes.filter(({box:b}) =>
      !(rationalCompare(b[2],box[0])<0 || rationalCompare(b[0],box[2])>0 ||
        rationalCompare(b[3],box[1])<0 || rationalCompare(b[1],box[3])>0)).map(h=>h.ring)]);
    return nativeRationalOverlay("intersection", local, identity);
  };
}
/** Exact identity-bounds clipping is a temporary metadata operand only.
 * The complete original face and its exact majority denominator remain unchanged.
 * Weak clipped walks are resolved by the same exact kernel; if that operation
 * rejects, retry the prior unchanged-source intersection, retaining its errors. */
type Scalar=NativeRationalPoint[number];
const equal=(a:NativeRationalPoint,b:NativeRationalPoint)=>rationalCompare(a[0],b[0])===0&&rationalCompare(a[1],b[1])===0;
function clip(ring:NativeRationalPoint[],axis:0|1,bound:Scalar,lower:boolean){
 if(!ring.length)return[];
 const inside=(p:NativeRationalPoint)=>lower?rationalCompare(p[axis],bound)>=0:rationalCompare(p[axis],bound)<=0;
 const intersection=(a:NativeRationalPoint,b:NativeRationalPoint):NativeRationalPoint=>{
  if(rationalCompare(a[axis],bound)===0)return a;if(rationalCompare(b[axis],bound)===0)return b;
  const other=axis===0?1:0,t=div(sub(bound,a[axis]),sub(b[axis],a[axis]));
  const value=rational(add(a[other],mul(t,sub(b[other],a[other]))));
  return axis===0?[bound,value]:[value,bound];
 };
 const output:NativeRationalPoint[]=[];
 const push=(p:NativeRationalPoint)=>{if(!output.length||!equal(output.at(-1)!,p))output.push(p)};
 let previous=ring.at(-1)!,previousInside=inside(previous);
 for(const current of ring){const currentInside=inside(current);if(currentInside!==previousInside)push(intersection(previous,current));if(currentInside)push(current);previous=current;previousInside=currentInside;}
 if(output.length>1&&equal(output[0]!,output.at(-1)!))output.pop();
 return output;
}
function prepareNativeWalkingOwnershipIntersection(face:NativeRationalParts){
 const fallback=prepareNativeWalkingUnclippedOwnershipIntersection(face);
 return(identity:NativeRationalParts):NativeRationalParts=>{
  if(!identity.length)return[];
  const points=identity.flat(2),first=points[0]!;
  let x0=first[0],y0=first[1],x1=first[0],y1=first[1];
  for(const[x,y]of points){if(rationalCompare(x,x0)<0)x0=x;if(rationalCompare(y,y0)<0)y0=y;if(rationalCompare(x,x1)>0)x1=x;if(rationalCompare(y,y1)>0)y1=y;}
  if(rationalCompare(x0,x1)===0||rationalCompare(y0,y1)===0)return[];
  const clipRing=(ring:NativeRationalPoint[])=>clip(clip(clip(clip(ring,0,x0,true),0,x1,false),1,y0,true),1,y1,false);
  const clipped=face.flatMap(part=>{
   const outer=clipRing(part[0]!);if(outer.length<3)return[];
   return[[outer,...part.slice(1).map(clipRing).filter(r=>r.length>=3)]];
  });
  if(!clipped.length)return[];
  try { return nativeRationalOverlay('intersection',clipped,identity); }
  catch { return fallback(identity); }
 };
}

export function nativeWalkingOwnershipIntersection(face: NativeRationalParts, identity: NativeRationalParts) {
  return prepareNativeWalkingOwnershipIntersection(face)(identity);
}
/** Bounded exact majority memo for one immutable source calculation. Policy
 * decisions stay outside this cache; no face is clipped to an identity. */
/** Bounded content admission for complete exact ownership keys. Hash controls retention only:
 * every hit still compares the complete exact key, so collisions cannot alias. */
export function createStableOwnershipMemo(maximumEntries=512,maximumBytes=16*1024*1024){
 type Entry={key:string;keys:readonly string[];bytes:number;priority:number};
 const entries=new Map<string,Entry>(),ranked:Entry[]=[];let retainedBytes=0,keyBytes=0,hits=0,misses=0,skipped=0;
 const priority=(key:string)=>{let h=0x811c9dc5;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),0x01000193);return h>>>0;};
 const compare=(a:Entry,b:Entry)=>a.priority-b.priority||(a.key<b.key?-1:a.key>b.key?1:0);
 const dropWorst=()=>{const e=ranked.pop();if(e){entries.delete(e.key);retainedBytes-=e.bytes;keyBytes-=2*e.key.length;}};
 return {
  get(key:string){const e=entries.get(key);if(e){hits++;return e;}misses++;return undefined;},
  set(key:string,keys:string[]){
   if(entries.has(key))return;
   const bytes=512+2*key.length+keys.reduce((sum,s)=>sum+40+2*s.length,0);
   const entry:Entry=Object.freeze({key,keys:Object.freeze([...keys]),bytes,priority:priority(key)});
   if(bytes>maximumBytes||maximumEntries<=0){skipped++;return;}
   // Retain a stable bounded sample rather than replacing the entire tail on
   // each long identical face scan. No face or ownership decision is omitted.
   while(ranked.length&&(ranked.length>=maximumEntries||retainedBytes+bytes>maximumBytes)){
    if(compare(entry,ranked[ranked.length-1]!)>=0){skipped++;return;}dropWorst();
   }
   let lo=0,hi=ranked.length;while(lo<hi){const m=(lo+hi)>>>1;if(compare(ranked[m]!,entry)<0)lo=m+1;else hi=m;}
   ranked.splice(lo,0,entry);entries.set(key,entry);retainedBytes+=bytes;keyBytes+=2*key.length;
  },
  statistics:()=>({hits,misses,entries:entries.size,retainedBytes,keyBytes,maximumEntries,maximumBytes,skipped})
 };
}

export function createNativeWalkingOwnershipQuery(dataset: IndoorDataset) {
  const identities = new WeakMap<IndoorDataset["records"][number], { identity: Polygon; box: number[]; parts?: NativeRationalParts }>();
  const memo = createStableOwnershipMemo();
  const classify = (face: NativeRationalParts, box: readonly number[], records: IndoorDataset["records"], onError: (record: IndoorDataset["records"][number], error: unknown) => void) => {
    const key = JSON.stringify([records.map(r => r.key), face.map(p => p.map(r => r.map(q => q.map(v => `${v.n}/${v.d}`))))]);
    const cached = memo.get(key);
    if (cached) { const keys = new Set(cached.keys); return { owners: records.filter(r => keys.has(r.key)), unresolved: false }; }
    let unresolved = false;
    const intersection = prepareNativeWalkingOwnershipIntersection(face);
    const owners = records.filter(record => {
      let row = identities.get(record);
      if (!row) { const identity = nativeRoomIdentityRings(dataset, record); const created = { identity, box: [...bounds(identity)] }; identities.set(record, created); row = created; }
      if (box[0]! > row.box[2]! || box[2]! < row.box[0]! || box[1]! > row.box[3]! || box[3]! < row.box[1]!) return false;
      try {
        row.parts ??= freezeNativeRationalParts(nativeRationalOverlay("union", [row.identity]));
        const overlap = intersection(row.parts);
        return nativeRationalAreaCompare(overlap, []) > 0 && (nativeRationalAreaCompare(overlap, row.parts, 2n) >= 0 || nativeRationalAreaCompare(overlap, face, 2n) >= 0);
      } catch (error) { unresolved = true; onError(record, error); return false; }
    });
    if (!unresolved) memo.set(key, owners.map(r => r.key));
    return { owners, unresolved };
  };
  classify.statistics = memo.statistics;
  return classify;
}
const area = (polys: RoomPoint[][][]) =>
  polys.reduce(
    (s, p) =>
      s +
      p.reduce(
        (a, r, i) =>
          a +
          (i ? -1 : 1) *
            Math.abs(
              r.reduce(
                (s, q, j) =>
                  s +
                  q[0] * r[(j + 1) % r.length]![1] -
                  q[1] * r[(j + 1) % r.length]![0],
                0,
              ) / 2,
            ),
        0,
      ),
    0,
  );
const inside = (p: RoomPoint, poly: Polygon) =>
  !!poly[0] &&
  containsRoomPoint(p, poly[0]) &&
  !poly.slice(1).some((h) => containsRoomPoint(p, h));
const bounds = (p: Polygon) => {
  const ps = p.flat();
  return [
    Math.min(...ps.map((q) => q[0])),
    Math.min(...ps.map((q) => q[1])),
    Math.max(...ps.map((q) => q[0])),
    Math.max(...ps.map((q) => q[1])),
  ] as const;
};
/** A full two-foot swept strip; no distance-only or bounding-box connection. */
export const walkingStrip = (
  a: RoomPoint,
  b: RoomPoint,
  width = 2,
): Polygon => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    n = Math.hypot(dx, dy),
    x = ((-dy / n) * width) / 2,
    y = ((dx / n) * width) / 2;
  return [
    [
      [a[0] + x, a[1] + y],
      [b[0] + x, b[1] + y],
      [b[0] - x, b[1] - y],
      [a[0] - x, a[1] - y],
    ],
  ];
};

export type NativeWalkingRegion = {
  elevationFeet: number;
  /** Exact authority for strict native operations. Numeric arrays only propose/search/render. */
  exact?: { floors: NativeRationalParts; free: NativeRationalParts; walkable: NativeRationalParts; barriers: NativeRationalParts };
  floors: Polygon[];
  barriers: Polygon[];
  masks: Polygon[];
  wallBarriers?: Polygon[];
  diagnostics?: string[];
  circulation?: Polygon[];
  /** Whole source-defined free faces and their majority metadata identities. */
  identityFaces?: { face: Polygon; exactParts?: NativeRationalParts; roomKeys: string[] }[];
  nativeFloorIds: number[];
};
/** Complete exact native floor/enclosure intersection for one immutable source
 * phase. Portal state and metadata are deliberately absent from this cache:
 * their barriers and ownership are recomputed against the complete floor. */
export function createNativeWalkingFloorIntersectionQuery(sourceModelSha256: string) {
  const entries = new Map<string, { parts: NativeRationalParts; bytes: number }>();
  const maximumEntries = 12, maximumBytes = 16 * 1024 * 1024;
  let retainedBytes = 0, hits = 0, misses = 0;
  const compute = (rawFloors: Polygon[], envelopes: Polygon[]) =>
    freezeNativeRationalParts(rawFloors.length && envelopes.length
      ? nativeRationalOverlay("intersection", rawFloors, envelopes) : []);
  const query = (elevationFeet: number, rawFloors: Polygon[], envelopes: Polygon[]) => {
    if (!Number.isFinite(elevationFeet) || [...rawFloors, ...envelopes].some(part =>
      part.some(ring => ring.some(point => !point.every(Number.isFinite)))))
      return compute(rawFloors, envelopes);
    // Full current operand bytes prevent stale in-place input reuse; no old
    // declared geometry SHA, rounded bounds, portal key or room contour enters.
    const key = JSON.stringify([sourceModelSha256, NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION, elevationFeet, rawFloors, envelopes]);
    const cached = entries.get(key);
    if (cached) { hits++; entries.delete(key); entries.set(key, cached); return cached.parts; }
    misses++;
    const parts = compute(rawFloors, envelopes);
    let bytes = key.length * 2 + 160;
    for (const part of parts) {
      bytes += 64;
      for (const ring of part) {
        bytes += 64;
        for (const point of ring) {
          bytes += 64;
          for (const scalar of point) bytes += 192 + 2 * (String(scalar.n).length + String(scalar.d).length);
        }
      }
    }
    if (bytes <= maximumBytes) {
      while (entries.size && (entries.size >= maximumEntries || retainedBytes + bytes > maximumBytes)) {
        const first = entries.keys().next().value!;
        retainedBytes -= entries.get(first)!.bytes; entries.delete(first);
      }
      entries.set(key, { parts, bytes }); retainedBytes += bytes;
    }
    return parts;
  };
  return Object.assign(query, { statistics: () => ({ hits, misses, entries: entries.size,
    retainedBytes, maximumEntries, maximumBytes }) });
}

/** Complete-operand memo. No height bucketing or metadata cropping.
 * Each factory belongs to one unchanged private ramp-validation phase. */
export function createNativeRampPhysicalOperandMemo() {
  const entries = new Map<string, {parts: NativeRationalParts; bytes: number}>();
  const maximumEntries = 8, maximumBytes = 64 * 1024 * 1024;
  let hits = 0, misses = 0, retainedBytes = 0;
  const query = (completeAuthority: unknown, compute: () => NativeRationalParts) => {
    const key = JSON.stringify(completeAuthority);
    const cached = entries.get(key);
    if (cached) { hits++; entries.delete(key); entries.set(key, cached); return cached.parts; }
    misses++;
    const parts = freezeNativeRationalParts(compute());
    let bytes = 160 + 2 * key.length;
    for (const part of parts) { bytes += 64; for (const ring of part) { bytes += 64;
      for (const point of ring) { bytes += 64;
        for (const v of point) bytes += 192 + 2 * (String(v.n).length + String(v.d).length);
      }
    }}
    if (bytes <= maximumBytes) {
      while (entries.size && (entries.size >= maximumEntries || retainedBytes + bytes > maximumBytes)) {
        const first = entries.keys().next().value!;
        retainedBytes -= entries.get(first)!.bytes; entries.delete(first);
      }
      entries.set(key, {parts, bytes}); retainedBytes += bytes;
    }
    return parts;
  };
  return Object.assign(query, {statistics: () => ({hits, misses, entries: entries.size,
    retainedBytes, maximumEntries, maximumBytes})});
}

/** Floors are exact profiles at the walking elevation, including all inner holes.
 * Solid obstacles are sliced at ankle height; every native doorway is a veto so
 * recovery cannot bypass a disabled door by cutting through a display opening. */
export function nativeWalkingRegion(
  model: ConvertResult,
  dataset: IndoorDataset,
  elevationFeet: number,
  allowUnlabelled = false,
  portalNode?: IndoorNode,
  envelopeIndex?: NativeIndoorEnvelopeIndex,
  materialQuery?: ReturnType<typeof createNativeRoutingMaterialQuery>,
  boundaryQuery?: ReturnType<typeof createNativeBoundaryMaterialQuery>,
  authoredTreads?: ReturnType<typeof nativeAuthoredStairTreads>,
  exactBoundaryQuery?: ReturnType<typeof createNativeExactBoundaryMaterialQuery>,
  ownershipQuery?: ReturnType<typeof createNativeWalkingOwnershipQuery>,
  privateRampVetoOnly = false,
  floorIntersectionQuery?: ReturnType<typeof createNativeWalkingFloorIntersectionQuery>,
  privatePhysicalMemo?: ReturnType<typeof createNativeRampPhysicalOperandMemo>,
): NativeWalkingRegion {
  const nativeFloors = routingFloorPlateRecords(model, elevationFeet);
  const strictNative = !!dataset.nativeIndoorEnvelopes;
  const sourceProfiles = nativeFloors.flatMap((source) =>
    nativeFloorPolygons(source, strictNative).map((floor) => ({
      floor,
      sourceId: source.elementId,
    })),
  );
  const rawFloors = sourceProfiles.map((p) => p.floor);
  const diagnostics: string[] = [];
  const exactByPolygon = new Map<Polygon, NativeRationalParts>();
  const proposalParts = (parts: NativeRationalParts): Polygon[] => parts.map((part) => {
    const proposal = part.map((ring) => ring.map(([x,y]) => [nativeRationalScalarToIEEE(x),nativeRationalScalarToIEEE(y)] as RoomPoint));
    exactByPolygon.set(proposal, [part]); return proposal;
  });
  const exactParts = (parts: Polygon[]): NativeRationalParts => parts.flatMap(p => exactByPolygon.get(p) ?? nativeRationalOverlay("union", [p]));
  let exact: NativeWalkingRegion["exact"];
  const envelopes = (
    envelopeIndex ??
    createNativeIndoorEnvelopeIndex(
      dataset.nativeIndoorEnvelopes,
      dataset.source.modelSha256,
    )
  ).parts(elevationFeet);
  // Envelopes are source-certified physical indoor coverage, never room traces.
  const envelopeParts = envelopes.map((face) => ({ face, box: bounds(face) }));
  const exactFloors = strictNative
    ? floorIntersectionQuery
      ? floorIntersectionQuery(elevationFeet, rawFloors, envelopes)
      : (rawFloors.length && envelopes.length
        ? nativeRationalOverlay("intersection", rawFloors, envelopes) : [])
    : undefined;
  const floors: Polygon[] = exactFloors ? proposalParts(exactFloors) : rawFloors;
  const material = (materialQuery ?? createNativeRoutingMaterialQuery(dataset))(
    elevationFeet,
  );
  const certifiedMaterialIds = material.known,
    presentMaterialIds = material.present;
  const boundaryMaterial =
    boundaryQuery ?? createNativeBoundaryMaterialQuery(dataset);
  const exactBoundaries=strictNative?(exactBoundaryQuery??createNativeExactBoundaryMaterialQuery(dataset)):undefined;
  const ownsAperture = createNativeHostApertureQuery(material);
  const levels = dataset.nativeLevels
    .filter((l) => Math.abs(l.elevationFeet - elevationFeet) < 0.05)
    .map((l) => l.id);
  const portal =
    portalNode &&
    dataset.doors?.find(
      (d) => portalNode.id === `${d.id}:0` || portalNode.id === `${d.id}:1`,
    );
  const portalHost =
    portal &&
    model.nativeHostRelations?.find(
      (relation) => relation.elementId === portal.nativeElementId,
    )?.hostId;
  const aperture =
    portalHost &&
    portal?.state === "connected" &&
    portal.footprintFeet &&
    dataset.edges.some((e) => e.id === portal.id && e.enabled)
      ? [portal.footprintFeet]
      : undefined;
  const subtractAperture = (parts: Polygon[], opening: Polygon): Polygon[] => strictNative
    ? proposalParts(nativeRationalOverlay("difference", exactParts(parts), [opening]))
    : pc.difference(parts, opening) as Polygon[];
  const barriers: Polygon[] = [],
    wallBarriers: Polygon[] = [];
  const addWalls = (parts: Polygon[]) => {
    barriers.push(...parts);
    wallBarriers.push(...parts);
  };
  // Derived finite source-member continuations remain foreign material; no
  // original host aperture may erase this separately certified layer.
  addWalls(material.derivedParts ?? []);
  for (const part of material.parts) {
    if (part.column) barriers.push(part.rings);
    else
      addWalls(
        aperture &&
          ownsAperture(
            portalHost,
            portal!.nativeElementId,
            part.nativeElementId,
          )
          ? subtractAperture([part.rings], aperture)
          : [part.rings],
      );
  }
  const curtainSections = recoverNativeCurtainMemberSections(
    model,
    elevationFeet + 0.1,
  );
  const curtainHosts = new Set(
    curtainSections.map((section) => section.hostId),
  );
  // A proven curtain host is a container, not its gross solid rectangle.
  // The actual member section at ankle height retains sills/opaque panels and
  // jambs. Door leaves remain separately blocked unless their explicit portal
  // is being continued on its existing side.
  barriers.push(
    ...curtainSections
      .filter((section) => !certifiedMaterialIds.has(section.hostId))
      .flatMap((section) =>
        section.barriers
          .filter((member) => !certifiedMaterialIds.has(member.elementId))
          .map((member) => [member.polygon]),
      ),
  );
  const wallParts = (polygon: RoomPoint[], nativeId: number): Polygon[] =>
    aperture && nativeId === portalHost
      ? subtractAperture([[polygon]], aperture)
      : [[polygon]];
  addWalls(
    (dataset.walls ?? [])
      .filter(
        (w) =>
          w.reviewPatchId &&
          levels.includes(w.levelId) &&
          (!certifiedMaterialIds.has(w.nativeElementId) ||
            presentMaterialIds.has(w.nativeElementId)),
      )
      .flatMap((w) => exactBoundaries?proposalParts(exactBoundaries(w)):boundaryMaterial(w)),
  );
  const originalBodies = new Map(
    model.elementBounds.map((body) => [body.elementId, body]),
  );
  const atWalkingHeight = (id: number) => {
    if (!strictNative) return true;
    const body = originalBodies.get(id),
      z = elevationFeet + 0.1;
    // A plan cut can project raised material onto a lower walking floor.
    // Unknown bodies retain their conservative footprint; known originals
    // veto only where their physical height interval contains the ankle cut.
    if (!body) return true;
    if (body.boundsFeet.min.z > z || body.boundsFeet.max.z < z) return false;
    const solids = body.solids ?? (body.solid ? [body.solid] : []);
    return (
      !solids.length ||
      solids.some((s) => s.baseElevation <= z && s.topElevation >= z)
    );
  };
  for (const level of levels) {
    if (!model.nativeAssociatedLevelRelations?.length) continue;
    const g = architecturalPlanGeometry(model, level);
    addWalls(
      g.walls
        .filter(
          (w) =>
            !curtainHosts.has(w.elementId) &&
            !certifiedMaterialIds.has(w.elementId) &&
            atWalkingHeight(w.elementId),
        )
        .flatMap((w) => wallParts(w.polygon, w.elementId)),
    );
    barriers.push(
      ...g.columns
        .filter(
          (w) =>
            !certifiedMaterialIds.has(w.elementId) &&
            atWalkingHeight(w.elementId),
        )
        .map((w) => [w.polygon]),
      ...g.doors
        .filter((d) => !aperture || d.elementId !== portal?.nativeElementId)
        .map((w) => [w.polygon]),
    );
  }
  // Physical solids cover associated-level omissions without projecting another storey down.
  for (const r of model.elementBounds.filter(
    (r) =>
      [-2000011, -2000100, -2001330].includes(r.categoryId ?? 0) &&
      !curtainHosts.has(r.elementId) &&
      !certifiedMaterialIds.has(r.elementId),
  ))
    for (const s of r.solids ?? (r.solid ? [r.solid] : [])) {
      if (
        s.baseElevation > elevationFeet + 0.1 ||
        s.topElevation < elevationFeet + 0.1
      )
        continue;
      const dx = s.end.x - s.start.x,
        dy = s.end.y - s.start.y,
        n = Math.hypot(dx, dy);
      if (n < 1e-8) continue;
      const polygon: RoomPoint[] = nativeWallSolidPolygon(s);
      // Share the plan's native curtain-host envelope constraint. Reintroducing
      // the raw analytical axis here otherwise blocks floor outside the element,
      // even after the level-aware plan correctly clipped that extension.
      const footprints =
        r.categoryId === -2000011
          ? boundedNativeWallFootprints(r, polygon).map((f) => f.polygon)
          : [polygon];
      if (r.categoryId === -2000011)
        addWalls(footprints.flatMap((p) => wallParts(p, r.elementId)));
      else barriers.push(...footprints.map((p) => [p]));
    }
  const exactAuthoredTreads = authoredTreads ?? nativeAuthoredStairTreads(
    dataset.nativeSourceStairMaterials?.authoredTreadRoles, dataset.source.modelSha256,
  );
  for (const tread of model.elementBounds.flatMap((record) => {
    const exact = strictNative && exactAuthoredTreads.get(record.elementId);
    return exact ? exact.map(t => t.ringFeet.map(p => [p[0], p[1], t.elevationFeet] as [number, number, number])) : record.stairTreads ?? [];
  })) {
    const z = Math.min(...tread.map((p) => p[2]));
    if (z > elevationFeet + 0.05 && z < elevationFeet + 6)
      barriers.push([tread.map((p) => [p[0], p[1]] as RoomPoint)]);
  }
  // A low native slab/tabletop is an obstruction, not another walking floor.
  // Use its exact separate shells and holes, never its bounds rectangle.
  barriers.push(
    ...nativeLowSlabRecords(model, elevationFeet).flatMap((slab) => nativeFloorPolygons(slab, strictNative)),
  );
  const same = dataset.records.filter(
    (r) => Math.abs(r.elevationFeet - elevationFeet) < 0.05,
  );
  const masks: Polygon[] = strictNative
    ? []
    : same
        .filter(
          (r) =>
            (!allowUnlabelled && !r.circulation) ||
            !r.walkable ||
            r.access === "staff",
        )
        .map((r) => r.ringsFeet);
  // Circulation trace holes can be empty bands beside a wall, not physical
  // openings. Native-floor recovery uses actual slab voids and solid obstacles;
  // explicit reviewed floor openings remain a veto on every path.
  masks.push(
    ...same.flatMap((r) =>
      [
        ...(!strictNative && (!allowUnlabelled || !r.circulation)
          ? r.ringsFeet.slice(1)
          : []),
        ...(!strictNative
          ? ((r.properties.floorOpeningsFeet as RoomPoint[][] | undefined) ??
            [])
          : []),
      ].map((h) => [h]),
    ),
  );
  // A matched exit may move away from its already compiled threshold, but the
  // threshold centre itself remains blocked: this continuation cannot bypass a
  // disabled entrance or replace the explicit door edge. Columns are never cut.
  if (aperture && portal?.normalFeet) {
    const n = portal.normalFeet,
      t: [number, number] = [-n[1], n[0]],
      c = portal.footprintFeet!.reduce(
        (sum, p) =>
          [
            sum[0] + p[0] / portal.footprintFeet!.length,
            sum[1] + p[1] / portal.footprintFeet!.length,
          ] as RoomPoint,
        [0, 0] as RoomPoint,
      ),
      w =
        Math.max(
          ...portal.footprintFeet!.map((p) =>
            Math.abs((p[0] - c[0]) * t[0] + (p[1] - c[1]) * t[1]),
          ),
        ) + 0.1;
    barriers.push([
      [
        [c[0] + t[0] * w + n[0] * 0.01, c[1] + t[1] * w + n[1] * 0.01],
        [c[0] - t[0] * w + n[0] * 0.01, c[1] - t[1] * w + n[1] * 0.01],
        [c[0] - t[0] * w - n[0] * 0.01, c[1] - t[1] * w - n[1] * 0.01],
        [c[0] + t[0] * w - n[0] * 0.01, c[1] + t[1] * w - n[1] * 0.01],
      ],
    ]);
  }
  let circulation: Polygon[] | undefined;
  let identityFaces: NativeWalkingRegion["identityFaces"];
  if (strictNative) {
    // Classify complete physical faces. A restricted identity makes its whole
    // shared face unavailable; cutting its old contour would invent access.
    const exactWalls = new Set(wallBarriers);
    const obstacles = [
      ...wallBarriers,
      ...barriers.filter((b) => !exactWalls.has(b)),
      ...masks,
      ...indoorExclusionParts(dataset, elevationFeet),
    ];
    if (!exactFloors!.length) {
      // Ramp triangles are checked independently at intermediate heights.
      // Keep every material/barrier/mask for that check, but there is no flat
      // free face to subtract or classify. Exact barrier authority stays lazy
      // and complete if an exact consumer subsequently requests it.
      let exactObstacles: NativeRationalParts | undefined;
      const empty = freezeNativeRationalParts([]);
      return {
        elevationFeet, floors, barriers, masks, wallBarriers,
        nativeFloorIds: nativeFloors.map(r => r.elementId),
        identityFaces: [],
        ...(!allowUnlabelled ? { circulation: [] } : {}),
        ...(diagnostics.length ? { diagnostics } : {}),
        exact: {
          floors: empty, free: empty, walkable: empty,
          get barriers() {
            return exactObstacles ??= freezeNativeRationalParts(exactParts(obstacles));
          },
        },
      };
    }
    // The private ramp validator checks independently certified ramp/slab
    // support plus these unchanged physical barriers. Without any protected
    // identity, no complete free-face ownership decision can add a veto. Defer
    // that overlay until a caller explicitly requests full exact authority.
    // Never take this path for general queries, portals, or protected records.
    if (privateRampVetoOnly && allowUnlabelled && !portalNode && !masks.length &&
      !same.some(record => !record.walkable || record.access === "staff")) {
      let deferredFree: NativeRationalParts | undefined;
      let deferredObstacles: NativeRationalParts | undefined;
      const completeObstacles = () => deferredObstacles ??= freezeNativeRationalParts(exactParts(obstacles));
      const completeFree = () => deferredFree ??= freezeNativeRationalParts(
        nativeRationalOverlay("difference", exactFloors!, completeObstacles()));
      return {
        elevationFeet, floors, barriers, masks, wallBarriers,
        nativeFloorIds: nativeFloors.map(record => record.elementId),
        ...(diagnostics.length ? {diagnostics} : {}),
        get identityFaces() { return proposalParts(completeFree()).map(face => ({face, roomKeys: []})); },
        exact: {
          floors: freezeNativeRationalParts(exactFloors!),
          get free() { return completeFree(); },
          get walkable() { return completeFree(); },
          get barriers() { return completeObstacles(); },
        },
      };
    }
    // Retain the exact rational result across all source booleans. A rendered
    // IEEE corner must never become the next operand or a walking proof.
    const computeFree = () => nativeRationalOverlay("difference", exactFloors!, exactParts(obstacles));
    const exactWire = (parts: NativeRationalParts) => parts.map(part => part.map(ring =>
      ring.map(point => point.map(value => [String(value.n), String(value.d)]))));
    // z-specific physical construction has already run. Reuse only its COMPLETE
    // identical original operands and policy, including exact derived repairs.
    const freeExact = freezeNativeRationalParts(privatePhysicalMemo && privateRampVetoOnly && allowUnlabelled && !portalNode
      ? privatePhysicalMemo([
          dataset.source.modelSha256, NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
          sourceProfiles.map(p => [p.sourceId, p.floor]), envelopes,
          dataset.nativeIndoorEnvelopes?.geometrySha256,
          dataset.nativeMaterialSections?.geometrySha256,
          material.parts, material.derivedParts ?? [],
          [...material.known].sort((a,b) => a-b), [...material.present].sort((a,b) => a-b),
          obstacles.map(p => exactByPolygon.has(p) ? ["exact", exactWire(exactByPolygon.get(p)!)] : ["original-ieee", p]),
          same.filter(record => !record.walkable || record.access === "staff"),
          allowUnlabelled, privateRampVetoOnly,
        ], computeFree)
      : computeFree());
    const free = proposalParts(freeExact);
    const classifyOwnership = ownershipQuery ?? createNativeWalkingOwnershipQuery(dataset);
    const faces = free.map((face) => {
      const box = bounds(face);
      const membership = classifyOwnership(exactParts([face]), box, same, (record, error) => diagnostics.push(
        `Elevation ${elevationFeet}: native face ownership for ${record.key} is unclassifiable; complete face remains unavailable: ${String(error).slice(0, 300)}`,
      ));
      return { face, ...membership };
    });
    identityFaces = faces
      .filter((c) => !c.unresolved)
      .map((c) => ({ face: c.face, exactParts: freezeNativeRationalParts(exactParts([c.face])), roomKeys: c.owners.map((o) => o.key) }));
    masks.push(
      ...faces
        .filter(
          (c) =>
            c.unresolved ||
            c.owners.some((r) => !r.walkable || r.access === "staff"),
        )
        .map((c) => c.face),
    );
    if (!allowUnlabelled)
      circulation = faces
        .filter(
          (c) =>
            !c.unresolved &&
            c.owners.some(
              (r) => r.circulation && r.walkable && r.access !== "staff",
            ) &&
            !c.owners.some((r) => !r.walkable || r.access === "staff"),
        )
        .map((c) => c.face);
    const accepted = faces.filter(c => !c.unresolved && !c.owners.some(r => !r.walkable || r.access === "staff") &&
      (allowUnlabelled || c.owners.some(r => r.circulation && r.walkable && r.access !== "staff")));
    exact = { floors: freezeNativeRationalParts(exactFloors!), free: freezeNativeRationalParts(freeExact),
      walkable: freezeNativeRationalParts(accepted.flatMap(c => exactParts([c.face]))), barriers: freezeNativeRationalParts(exactParts(obstacles)) };
  } else if (!allowUnlabelled)
    circulation = same
      .filter((r) => r.circulation && r.walkable && r.access !== "staff")
      .map((r) => r.ringsFeet);
  return {
    elevationFeet,
    ...(exact ? {exact} : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
    floors,
    barriers,
    masks,
    wallBarriers,
    nativeFloorIds: nativeFloors.map((r) => r.elementId),
    ...(circulation ? { circulation } : {}),
    ...(identityFaces ? { identityFaces } : {}),
  };
}
/** Bounded cache for a compiler phase with unchanged physical walls, doors,
 * source records and exclusions. Terminal/edge creation does not affect a
 * no-portal region. Start a fresh query after physical authoring mutations. */
function createSourceNativeWalkingRegionQuery(
  model: ConvertResult,
  dataset: IndoorDataset,
  protectedOnly = false,
) {
  const completeOwnership = createNativeWalkingOwnershipQuery(dataset);
  const floorIntersections = createNativeWalkingFloorIntersectionQuery(dataset.source.modelSha256);
  const privatePhysicalMemo = protectedOnly ? createNativeRampPhysicalOperandMemo() : undefined;
  const ownership = protectedOnly ? Object.assign(
    ((face, box, records, onError) => completeOwnership(face, box, records.filter(r => !r.walkable || r.access === "staff"), onError)) as typeof completeOwnership,
    { statistics: completeOwnership.statistics },
  ) : completeOwnership;
  const envelopes = createNativeIndoorEnvelopeIndex(
      dataset.nativeIndoorEnvelopes,
      dataset.source.modelSha256,
    ),
    materials = createNativeRoutingMaterialQuery(dataset),
    boundaries = createNativeBoundaryMaterialQuery(dataset),
    exactBoundaries = createNativeExactBoundaryMaterialQuery(dataset),
    authoredTreads = nativeAuthoredStairTreads(dataset.nativeSourceStairMaterials?.authoredTreadRoles, dataset.source.modelSha256),
    regions = new Map<string, NativeWalkingRegion>(),
    diagnostics = new Set<string>();
  const query = (
    elevationFeet: number,
    allowUnlabelled = false,
    portalNode?: IndoorNode,
  ) => {
    if (protectedOnly && !allowUnlabelled) throw new Error("Ramp physical veto queries must retain explicit unlabelled geometry mode.");
    const portal =
      portalNode &&
      dataset.doors?.find(
        (d) => portalNode.id === `${d.id}:0` || portalNode.id === `${d.id}:1`,
      );
    const key = JSON.stringify([
      elevationFeet,
      allowUnlabelled,
      ...(portalNode
        ? [
            portalNode.id,
            portalNode.pointFeet,
            portal?.state,
            portal?.footprintFeet,
            portal?.normalFeet,
            dataset.edges.find((e) => e.id === portal?.id)?.enabled,
          ]
        : []),
    ]);
    let region = regions.get(key);
    if (!region) {
      region = nativeWalkingRegion(
        model,
        dataset,
        elevationFeet,
        allowUnlabelled,
        portalNode,
        envelopes,
        materials,
        boundaries,
        authoredTreads,
        exactBoundaries,
        ownership,
        protectedOnly,
        floorIntersections,
        privatePhysicalMemo,
      );
      if (regions.size >= 32) regions.delete(regions.keys().next().value!);
      regions.set(key, region);
      for (const message of region.diagnostics ?? []) diagnostics.add(message);
    } else {
      // Promote a reused portal to keep nearby candidate approaches warm.
      regions.delete(key);
      regions.set(key, region);
    }
    return region;
  };
  return Object.assign(query, { diagnostics: () => [...diagnostics], ownershipCacheStatistics: ownership.statistics, floorCacheStatistics: floorIntersections.statistics, privatePhysicalMemoStatistics: () => privatePhysicalMemo?.statistics() });
}

/** General source query always retains complete majority metadata. */
export function createNativeWalkingRegionQuery(model: ConvertResult, dataset: IndoorDataset) {
  return createSourceNativeWalkingRegionQuery(model, dataset);
}

/** Private ramp-validation view: with unlabelled physical geometry, public
 * labels cannot affect acceptance. Every restricted/nonwalkable identity still
 * tests the complete original face with the unchanged exact majority rule.
 * This view does not provide complete room associations for compiler output. */
export function createNativeRampWalkingRegionQuery(model: ConvertResult, dataset: IndoorDataset) {
  return createSourceNativeWalkingRegionQuery(model, dataset, true);
}

/** Continuous polygon proof of native support, obstacle clearance and source
 * circulation ownership. Raster searches propose candidates; this authorizes them. */
export function supportedWalkingPath(
  region: NativeWalkingRegion,
  points: readonly Point3[],
  width = 2,
): boolean {
  if (
    points.length < 2 ||
    points.some(
      (p) =>
        !p.every(Number.isFinite) ||
        Math.abs(p[2] - region.elevationFeet) > 0.05,
    ) ||
    !region.floors.length
  )
    return false;
  if (region.exact) {
    try {
      if (!nativeRationalPathSupported(points, region.exact.walkable)) return false;
      for (let i=1;i<points.length;i++) {
        const a=points[i-1]!, b=points[i]!;
        if (a[0]===b[0] && a[1]===b[1]) continue;
        const strip=walkingStrip([a[0],a[1]],[b[0],b[1]],width);
        if (!nativeRationalFootprintSupported(nativeRationalOverlay("union",[strip]),region.exact.walkable)) return false;
      }
      return true;
    } catch { return false; }
  }
  try {
    const floor = pc.union(region.floors[0]!, ...region.floors.slice(1)),
      owned = region.circulation?.length
        ? pc.union(region.circulation[0]!, ...region.circulation.slice(1))
        : undefined;
    if (region.circulation && !owned) return false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8) {
        const point: [number, number] = [a[0], a[1]];
        if (
          !region.floors.some((f) => inside(point, f)) ||
          (region.circulation &&
            !region.circulation.some((f) => inside(point, f))) ||
          [...region.barriers, ...region.masks].some((f) => inside(point, f))
        )
          return false;
        continue;
      }
      const strip = walkingStrip([a[0], a[1]], [b[0], b[1]], width);
      if (area(pc.difference(strip, floor) as RoomPoint[][][]) > 1e-7)
        return false;
      if (owned && area(pc.difference(strip, owned) as RoomPoint[][][]) > 1e-7)
        return false;
      if (
        [...region.barriers, ...region.masks].some(
          (p) => area(pc.intersection(strip, p) as RoomPoint[][][]) > 1e-7,
        )
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Bounded native-floor search for an unlabelled landing approach. It explores
 * physical geometry, never campus floor names or nearest-room assignment. */
export function findNativeWalkingPath(
  region: NativeWalkingRegion,
  from: Point3,
  to: Point3,
  maxDistanceFeet = 90,
): Point3[] | undefined {
  if (
    Math.abs(from[2] - to[2]) > 0.05 ||
    Math.hypot(from[0] - to[0], from[1] - to[1]) > maxDistanceFeet
  )
    return;
  if (supportedWalkingPath(region, [from, to])) return [from, to];
  const margin = 8,
    cell = 0.6,
    minX = Math.min(from[0], to[0]) - margin,
    minY = Math.min(from[1], to[1]) - margin,
    maxX = Math.max(from[0], to[0]) + margin,
    maxY = Math.max(from[1], to[1]) + margin;
  const nx = Math.ceil((maxX - minX) / cell) + 1,
    ny = Math.ceil((maxY - minY) / cell) + 1;
  if (nx * ny > 50000) return;
  const near = (p: Point3) =>
    [
      Math.round((p[0] - minX) / cell),
      Math.round((p[1] - minY) / cell),
    ] as const;
  const id = (x: number, y: number) => y * nx + x,
    xy = (i: number): RoomPoint => [
      minX + (i % nx) * cell,
      minY + Math.floor(i / nx) * cell,
    ];
  const obstacles = [...region.barriers, ...region.masks].map((p) => ({
    p,
    b: bounds(p),
  }));
  const available = new Map<number, boolean>();
  const clear = (i: number) => {
    if (available.has(i)) return available.get(i)!;
    const p = xy(i);
    const probes = [
      p,
      [p[0] - 1, p[1]],
      [p[0] + 1, p[1]],
      [p[0], p[1] - 1],
      [p[0], p[1] + 1],
    ] as RoomPoint[];
    const ok = region.exact ? probes.every(q=>nativeRationalPointInParts(q,region.exact!.walkable)) : probes.every(
      (q) =>
        region.floors.some((f) => inside(q, f)) &&
        (!region.circulation || region.circulation.some((f) => inside(q, f))) &&
        !obstacles.some(
          ({ p: f, b }) =>
            q[0] >= b[0] &&
            q[0] <= b[2] &&
            q[1] >= b[1] &&
            q[1] <= b[3] &&
            inside(q, f),
        ),
    );
    available.set(i, ok);
    return ok;
  };
  const snap = (p: Point3) => {
    const [x, y] = near(p);
    for (let r = 0; r <= 2; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          const k = id(x + dx, y + dy);
          if (
            x + dx < 0 ||
            x + dx >= nx ||
            y + dy < 0 ||
            y + dy >= ny ||
            !clear(k)
          )
            continue;
          const q = xy(k);
          if (supportedWalkingPath(region, [p, [...q, region.elevationFeet]]))
            return k;
        }
    return;
  };
  const start = snap(from),
    end = snap(to);
  if (start == null || end == null) return;
  const heap: { id: number; score: number }[] = [];
  const push = (v: { id: number; score: number }) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.score <= v.score) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = v;
  };
  const pop = () => {
    const out = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1]!.score < heap[j]!.score) j++;
        if (last.score <= heap[j]!.score) break;
        heap[i] = heap[j]!;
        i = j;
      }
      heap[i] = last;
    }
    return out;
  };
  const costs = new Map([[start, 0]]),
    parents = new Map<number, number>(),
    closed = new Set<number>();
  push({ id: start, score: 0 });
  while (heap.length) {
    const k = pop().id;
    if (closed.has(k)) continue;
    closed.add(k);
    if (k === end) break;
    const x = k % nx,
      y = Math.floor(k / nx);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny) continue;
      const n = id(xx, yy);
      if (!clear(n) || closed.has(n)) continue;
      const c = costs.get(k)! + cell;
      if (c > maxDistanceFeet * 2 || c >= (costs.get(n) ?? Infinity)) continue;
      costs.set(n, c);
      parents.set(n, k);
      push({
        id: n,
        score:
          c + Math.hypot(xx - (end % nx), yy - Math.floor(end / nx)) * cell,
      });
    }
  }
  if (!closed.has(end)) return;
  const chain = [end];
  while (chain.at(-1) !== start) chain.push(parents.get(chain.at(-1)!)!);
  chain.reverse();
  const dense = [
    from,
    ...chain.map((i) => [...xy(i), region.elevationFeet] as Point3),
    to,
  ];
  // Greedy visibility reduction retains continuous full-width proof at every turn.
  const result = [dense[0]!];
  for (let i = 0; i < dense.length - 1; ) {
    let j = dense.length - 1;
    while (j > i + 1 && !supportedWalkingPath(region, [dense[i]!, dense[j]!]))
      j--;
    if (!supportedWalkingPath(region, [dense[i]!, dense[j]!])) return;
    result.push(dense[j]!);
    i = j;
  }
  return supportedWalkingPath(region, result) ? result : undefined;
}

/** Different directory IDs can refer to one original physical slab. The
 * source-certified envelope and exact slab profiles, never names/proximity,
 * authorize considering that alias; the complete swept path is checked later. */
function createNativeFloorAliasQuery(
  model: ConvertResult,
  dataset: IndoorDataset,
  index: NativeIndoorEnvelopeIndex,
) {
  const elevations = new Map<
      string,
      { part: Polygon; box: readonly number[]; floorIds: Set<number> }[]
    >(),
    memberships = new Map<string, { face: number; floorIds: Set<number> }[]>();
  const rows = (z: number) => {
    const key = z.toFixed(6);
    if (!elevations.has(key)) {
      const floors = routingFloorPlateRecords(model, z);
      elevations.set(
        key,
        index.levels
          .filter((scope) => Math.abs(scope.elevationFeet - z) < 0.05)
          .flatMap((scope) =>
            scope.partsFeet.map((part) => ({
              part,
              box: bounds(part),
              floorIds: new Set(
                floors
                  .filter((f) => scope.sourceElementIds.includes(f.elementId))
                  .map((f) => f.elementId),
              ),
            })),
          ),
      );
    }
    return elevations.get(key)!;
  };
  const membership = (n: IndoorNode) => {
    const p = n.pointFeet,
      key = p.join(":");
    if (!memberships.has(key)) {
      const floors = routingFloorPlateRecords(model, p[2]).map((f) => ({
          id: f.elementId,
          parts: nativeFloorPolygons(f, !!dataset.nativeIndoorEnvelopes),
        })),
        point: RoomPoint = [p[0], p[1]];
      const owned = floors
        .filter((f) => f.parts.some((part) => inside(point, part)))
        .map((f) => f.id);
      memberships.set(
        key,
        rows(p[2]).flatMap((row, face) =>
          p[0] >= row.box[0]! &&
          p[0] <= row.box[2]! &&
          p[1] >= row.box[1]! &&
          p[1] <= row.box[3]! &&
          inside(point, row.part)
            ? [
                {
                  face,
                  floorIds: new Set(owned.filter((id) => row.floorIds.has(id))),
                },
              ]
            : [],
        ),
      );
    }
    return memberships.get(key)!;
  };
  return (a: IndoorNode, b: IndoorNode) =>
    !!dataset.nativeIndoorEnvelopes &&
    Math.abs(a.pointFeet[2] - b.pointFeet[2]) <= 0.01 &&
    a.pointFeet[2].toFixed(6) === b.pointFeet[2].toFixed(6) &&
    membership(a).some((left) =>
      membership(b).some(
        (right) =>
          left.face === right.face &&
          [...left.floorIds].some((id) => right.floorIds.has(id)),
      ),
    );
}
export function nativeFloorAliasSupported(
  model: ConvertResult,
  dataset: IndoorDataset,
  a: IndoorNode,
  b: IndoorNode,
): boolean {
  return createNativeFloorAliasQuery(
    model,
    dataset,
    createNativeIndoorEnvelopeIndex(
      dataset.nativeIndoorEnvelopes,
      dataset.source.modelSha256,
    ),
  )(a, b);
}

/** Propose an approach leaving a source-checked ramp cap along its native axis.
 * This point authorizes nothing: its full strip must still pass exact support. */
function nativeRampCapOutward(
  dataset: IndoorDataset,
  node: IndoorNode,
): Point3 | undefined {
  const record = dataset.records.find((r) => r.key === node.roomKey),
    rampId = record?.properties.nativeRampId;
  if (
    !record?.properties.generatedLanding ||
    !Number.isSafeInteger(rampId) ||
    dataset.rampDisplay?.sourceModelSha256 !== dataset.source.modelSha256
  )
    return;
  const edge = dataset.edges.find(
    (e) =>
      e.kind === "ramp" &&
      e.enabled &&
      e.nativeElementId === rampId &&
      (e.from === node.id || e.to === node.id) &&
      dataset.rampDisplay!.ramps.some(
        (r) => r.edgeId === e.id && r.nativeElementId === rampId,
      ),
  );
  if (!edge) return;
  const points =
    edge.from === node.id ? edge.pointsFeet : [...edge.pointsFeet].reverse();
  if (
    !points[0] ||
    Math.hypot(...points[0].map((v, k) => v - node.pointFeet[k]!)) > 1e-7
  )
    return;
  const inner = points
    .slice(1)
    .find(
      (p) =>
        Math.hypot(p[0] - node.pointFeet[0], p[1] - node.pointFeet[1]) > 0.05,
    );
  if (!inner) return;
  const dx = node.pointFeet[0] - inner[0],
    dy = node.pointFeet[1] - inner[1],
    length = Math.hypot(dx, dy);
  return [
    node.pointFeet[0] + (dx / length) * 2,
    node.pointFeet[1] + (dy / length) * 2,
    node.pointFeet[2],
  ];
}

/** Metadata only: retain every positively traversed complete exact face. A
 * drawing proposal or an area/segment cutoff cannot erase an access identity. */
export function nativeWalkingTraversedIdentityKeys(
  faces: NonNullable<NativeWalkingRegion["identityFaces"]>,
  path: Point3[],
): string[] {
  const strips = path.slice(1).flatMap((b, i) => {
    const a = path[i]!;
    if (a[0] === b[0] && a[1] === b[1]) return [];
    return [walkingStrip([a[0], a[1]], [b[0], b[1]])];
  });
  const keys = new Set<string>();
  for (const face of faces) {
    if (!face.roomKeys.length || !strips.length) continue;
    if (!face.exactParts) throw new Error("Missing complete exact face for traversed native identity.");
    if (strips.some(strip => nativeRationalAreaCompare(
      nativeRationalOverlay("intersection", [strip], face.exactParts!), []
    ) > 0)) for (const key of face.roomKeys) keys.add(key);
  }
  return [...keys];
}

/** Join only disconnected source circulation surfaces which overlap at a
 * physically supported height, plus native generated landings. Explicit doors,
 * walls, voids, private rooms and another storey's floors remain hard vetoes. */
export type NativeApproachPair = {
  a: IndoorNode;
  b: IndoorNode;
  landing: boolean;
  distance: number;
};
/** Order-independent result of one candidate pair. It retains the region
 * diagnostics observed for that pair so an ordered replay can reproduce the
 * original first-seen diagnostic sequence exactly. */
export type NativeApproachCandidate = {
  regionDiagnostics: string[];
  nativeFloorIds?: number[];
  path?: Point3[];
  traversedKeys?: string[];
  traversalError?: string;
};
export type NativeApproachPlan = {
  pairs: NativeApproachPair[];
  starts: IndoorNode[];
  /** Union-find parents after joining existing enabled walk/door/opening edges. */
  initialParents: [string, string][];
};
/** Candidate enumeration, in the original deterministic distance order. */
export function planNativeApproaches(
  model: ConvertResult,
  dataset: IndoorDataset,
): NativeApproachPlan {
  const envelopes = createNativeIndoorEnvelopeIndex(
    dataset.nativeIndoorEnvelopes,
    dataset.source.modelSha256,
  );
  const aliasSupported = createNativeFloorAliasQuery(model, dataset, envelopes);
  const records = new Map(dataset.records.map((r) => [r.key, r])),
    nodes = dataset.nodes.filter((n) => {
      const r = records.get(n.roomKey);
      return r?.circulation && r.walkable && r.access !== "staff";
    });
  const unions = createApproachUnionFind(
    dataset.nodes.map((n) => [n.id, n.id] as [string, string]),
  );
  for (const e of dataset.edges.filter(
    (e) => e.enabled && ["walk", "door", "opening"].includes(e.kind),
  ))
    unions.join(e.from, e.to);
  // Existing native-generated landings are the only starts allowed to cross an
  // unlabelled floor patch. All other links must remain source-circulation-owned.
  const starts = nodes.filter(
    (n) =>
      n.roomKey.startsWith("landing:") ||
      (records.get(n.roomKey)?.stair && n.kind === "portal"),
  );
  const pairs: NativeApproachPair[] = [];
  for (const a of nodes) {
    const landing = starts.includes(a);
    for (const b of nodes) {
      if (
        (a.id >= b.id && !landing) ||
        a.id === b.id ||
        (a.roomKey === b.roomKey && !landing) ||
        unions.root(a.id) === unions.root(b.id) ||
        Math.abs(a.pointFeet[2] - b.pointFeet[2]) > 0.05
      )
        continue;
      const distance = Math.hypot(
        a.pointFeet[0] - b.pointFeet[0],
        a.pointFeet[1] - b.pointFeet[1],
      );
      if (
        distance > (landing ? 90 : 12) ||
        (a.levelId !== b.levelId && !aliasSupported(a, b))
      )
        continue;
      const ar = records.get(a.roomKey)!,
        br = records.get(b.roomKey)!;
      if (!landing && ar.surfaceId === br.surfaceId) continue;
      pairs.push({ a, b, landing, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  return { pairs, starts, initialParents: unions.snapshot() };
}
export function createApproachUnionFind(parents: Iterable<[string, string]>) {
  const parent = new Map(parents);
  const root = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const r = root(p);
    parent.set(id, r);
    return r;
  };
  return {
    root,
    join: (a: string, b: string) => parent.set(root(a), root(b)),
    snapshot: (): [string, string][] => [...parent],
  };
}
/** Region key used by the walking-region query for this pair (portal or plain). */
export function nativeApproachPortal(p: NativeApproachPair): IndoorNode | undefined {
  return p.landing
    ? p.a.kind === "portal"
      ? p.a
      : p.b.kind === "portal"
        ? p.b
        : undefined
    : undefined;
}
/** Pure per-pair evaluation. It depends only on the unchanged model/dataset and
 * the pair; region memos are complete-operand caches and never change results. */
export function createNativeApproachEvaluator(
  model: ConvertResult,
  dataset: IndoorDataset,
) {
  const records = new Map(dataset.records.map((r) => [r.key, r]));
  const walkingQuery = createNativeWalkingRegionQuery(model, dataset);
  const region = (z: number, landing: boolean) => walkingQuery(z, landing);
  return (p: NativeApproachPair): NativeApproachCandidate => {
    const portal = nativeApproachPortal(p);
    const r = portal
      ? walkingQuery(portal.pointFeet[2], true, portal)
      : region(p.a.pointFeet[2], p.landing);
    const candidate: NativeApproachCandidate = {
      regionDiagnostics: [...(r.diagnostics ?? [])],
    };
    let path: Point3[] | undefined;
    if (portal) {
      const door = dataset.doors?.find(
          (d) => portal.id === `${d.id}:0` || portal.id === `${d.id}:1`,
        ),
        n = door?.normalFeet;
      if (
        !door ||
        !n ||
        door.state !== "connected" ||
        !dataset.edges.some((e) => e.id === door.id && e.enabled)
      )
        return candidate;
      const side =
          (portal.pointFeet[0] - door.pointFeet[0]) * n[0] +
          (portal.pointFeet[1] - door.pointFeet[1]) * n[1],
        sign = side >= 0 ? 1 : -1,
        out: Point3 = [
          portal.pointFeet[0] + n[0] * sign * 2,
          portal.pointFeet[1] + n[1] * sign * 2,
          portal.pointFeet[2],
        ];
      if (!supportedWalkingPath(r, [portal.pointFeet, out])) return candidate;
      const other = portal === p.a ? p.b : p.a,
        capOut = nativeRampCapOutward(dataset, other);
      let rest: Point3[] | undefined;
      if (capOut && supportedWalkingPath(r, [capOut, other.pointFeet])) {
        const middle = findNativeWalkingPath(r, out, capOut);
        if (middle) rest = [...middle, other.pointFeet];
      }
      if (!rest) rest = findNativeWalkingPath(r, out, other.pointFeet);
      if (rest) {
        path = [portal.pointFeet, ...rest];
        if (portal === p.b) path.reverse();
      }
    } else if (p.landing) {
      const capOut = nativeRampCapOutward(dataset, p.a);
      if (capOut && supportedWalkingPath(r, [p.a.pointFeet, capOut])) {
        const rest = findNativeWalkingPath(r, capOut, p.b.pointFeet);
        if (rest) path = [p.a.pointFeet, ...rest];
      }
      const record = records.get(p.a.roomKey)!,
        floor = model.elementBounds.find(
          (f) => f.elementId === record.properties.nativeFloorId,
        );
      let nearest: { point: RoomPoint; distance: number } | undefined;
      for (const [i, a] of (floor?.loops?.[0] ?? []).entries()) {
        const b = floor!.loops![0]![(i + 1) % floor!.loops![0]!.length]!,
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) continue;
        const t = Math.max(
            0,
            Math.min(
              1,
              ((p.a.pointFeet[0] - a[0]) * dx +
                (p.a.pointFeet[1] - a[1]) * dy) /
                len2,
            ),
          ),
          point: RoomPoint = [a[0] + t * dx, a[1] + t * dy],
          distance = Math.hypot(
            point[0] - p.a.pointFeet[0],
            point[1] - p.a.pointFeet[1],
          );
        if (!nearest || distance < nearest.distance)
          nearest = { point, distance };
      }
      if (nearest && nearest.distance > 0.00001 && nearest.distance < 1.05) {
        const out: Point3 = [
          p.a.pointFeet[0] +
            ((p.a.pointFeet[0] - nearest.point[0]) / nearest.distance) * 2,
          p.a.pointFeet[1] +
            ((p.a.pointFeet[1] - nearest.point[1]) / nearest.distance) * 2,
          p.a.pointFeet[2],
        ];
        if (supportedWalkingPath(r, [p.a.pointFeet, out])) {
          const rest = findNativeWalkingPath(r, out, p.b.pointFeet);
          if (rest) path = [p.a.pointFeet, ...rest];
        }
      }
      if (!path) path = findNativeWalkingPath(r, p.a.pointFeet, p.b.pointFeet);
    } else
      path = supportedWalkingPath(r, [p.a.pointFeet, p.b.pointFeet])
        ? [p.a.pointFeet, p.b.pointFeet]
        : undefined;
    if (!path) return candidate;
    let traversedKeys: string[];
    if (dataset.nativeIndoorEnvelopes) {
      try {
        traversedKeys = nativeWalkingTraversedIdentityKeys(r.identityFaces ?? [], path);
      } catch (error) {
        candidate.traversalError = String(error).slice(0, 300);
        return candidate;
      }
    } else
      traversedKeys = dataset.records
        .filter(
          (record) =>
            Math.abs(record.elevationFeet - r.elevationFeet) < 0.05 &&
            path!.slice(1).some((point, i) => {
              try {
                return (
                  area(
                    pc.intersection(
                      walkingStrip(
                        [path![i]![0], path![i]![1]],
                        [point[0], point[1]],
                      ),
                      record.ringsFeet,
                    ) as RoomPoint[][][],
                  ) > 1e-7
                );
              } catch {
                return false;
              }
            }),
        )
        .map((record) => record.key);
    candidate.path = path;
    candidate.traversedKeys = traversedKeys;
    candidate.nativeFloorIds = [...r.nativeFloorIds];
    return candidate;
  };
}
/** Ordered replay: the only order dependence of the original stage is the
 * union-find skip before evaluation and the join after acceptance, plus
 * first-seen region diagnostic de-duplication. Candidates for pairs that the
 * replay skips are never consulted, so speculative evaluation cannot add
 * diagnostics or edges. */
export function createNativeApproachReplay(
  dataset: IndoorDataset,
  plan: NativeApproachPlan,
  onProgress?: (checkedPairs: number, totalPairs: number, newEdges: number) => void,
) {
  const unions = createApproachUnionFind(plan.initialParents);
  const edges: IndoorEdge[] = [],
    diagnostics: string[] = [];
  let next = 0,
    reported = 0;
  onProgress?.(0, plan.pairs.length, 0);
  const apply = (p: NativeApproachPair, c: NativeApproachCandidate) => {
    for (const message of c.regionDiagnostics)
      if (!diagnostics.includes(message)) diagnostics.push(message);
    if (c.traversalError !== undefined) {
      diagnostics.push(
        `Native approach ${p.a.id} / ${p.b.id} has unclassifiable whole-face identity; no route generated: ${c.traversalError}`,
      );
      return;
    }
    const path = c.path;
    if (!path) return;
    edges.push({
      id: `native-circulation:${[p.a.id, p.b.id].sort().join("|")}`,
      from: p.a.id,
      to: p.b.id,
      kind: p.a.surfaceId === p.b.surfaceId ? "walk" : "opening",
      pointsFeet: path,
      lengthMetres: path
        .slice(1)
        .reduce(
          (s, q, i) =>
            s +
            Math.hypot(...q.map((v, k) => v - path[i]![k]!)) *
              dataset.alignment.horizontalMetresPerFoot,
          0,
        ),
      roomKeys: [...new Set([p.a.roomKey, p.b.roomKey, ...c.traversedKeys!])],
      evidence: `continuously supported full 2 ft native floor approach; exact slabs ${c.nativeFloorIds!.join(",")}; walls, columns, doors, voids and staff/nonwalkable masks vetoed; all traversed source room identities retained; ${p.landing ? "generated native landing" : "source circulation overlap"}; access/accessibility remain unverified`,
      accessible: "unknown",
      enabled: true,
    });
    unions.join(p.a.id, p.b.id);
  };
  return {
    /** Index of the next pair to replay, or plan.pairs.length when done. */
    get next() {
      return next;
    },
    /** True when pair i (>= next) is currently unconnected, i.e. would be
     * evaluated if replay reached it with the present joins. */
    open: (i: number) =>
      unions.root(plan.pairs[i]!.a.id) !== unions.root(plan.pairs[i]!.b.id),
    /** Advance through skipped pairs; returns the next pair needing a candidate. */
    advance(): number {
      while (next < plan.pairs.length) {
        const p = plan.pairs[next]!;
        // Report completed work exactly once per 25 pairs, as before, without
        // reordering geometry checks or implying route certification.
        if (next > reported && next % 25 === 0) {
          reported = next;
          onProgress?.(next, plan.pairs.length, edges.length);
        }
        if (unions.root(p.a.id) !== unions.root(p.b.id)) return next;
        next++;
      }
      return next;
    },
    /** Apply the candidate for the pair returned by advance(). */
    accept(candidate: NativeApproachCandidate) {
      apply(plan.pairs[next]!, candidate);
      next++;
    },
    finish() {
      onProgress?.(plan.pairs.length, plan.pairs.length, edges.length);
      for (const n of plan.starts)
        if (!edges.some((e) => e.from === n.id || e.to === n.id))
          diagnostics.push(
            `Native landing ${n.id} has no new continuously supported attachment; retained existing graph connections.`,
          );
      return { edges, diagnostics };
    },
  };
}
export function attachNativeCirculation(
  model: ConvertResult,
  dataset: IndoorDataset,
  onProgress?: (checkedPairs: number, totalPairs: number, newEdges: number) => void,
): { edges: IndoorEdge[]; diagnostics: string[] } {
  const plan = planNativeApproaches(model, dataset);
  const evaluate = createNativeApproachEvaluator(model, dataset);
  const replay = createNativeApproachReplay(dataset, plan, onProgress);
  while (replay.advance() < plan.pairs.length)
    replay.accept(evaluate(plan.pairs[replay.next]!));
  return replay.finish();
}
