import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  nativeRationalScalarToIEEE,
  NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay";

export const NATIVE_EXACT_PLANAR_TOPOLOGY_VERSION = "native-exact-planar-topology-v1";
export type NativeExactPlanarBinding = {
  sourceModelSha256: string;
  sourceGeometryKey: string;
  kernelVersion: string;
};
/** Derived native topology keeps exact intersections. Numeric render rings are
 * a separate representation and never supply navigation geometry. */
export type NativeExactPlanarTopology = NativeExactPlanarBinding & {
  version: 1;
  geometrySha256: string;
  coordinates: { x: [string, string]; y: [string, string] }[];
  faces: { id: string; parts: number[][][] }[];
};
export type NativeExactTopologyIndex = {
  readonly binding: NativeExactPlanarBinding;
  readonly geometrySha256: string;
  parts(id: string): NativeRationalParts | undefined;
  ids(): readonly string[];
};
const MAX_COORDINATES = 500_000;
const MAX_FACES = 100_000;
const MAX_INDICES = 2_000_000;
const MAX_SCALAR_CHARS = 64 * 1024 * 1024;
const keys = (value: object, names: string[]) =>
  Object.keys(value).every((key) => names.includes(key));
const hash = (value: object) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const payload = ({ geometrySha256: _, ...value }: NativeExactPlanarTopology) => value;
const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Rational, b: Rational) => {
  const n = a.n * b.d - b.n * a.d;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
};
const zero = () => new Rational(0n);
const one = () => new Rational(1n);
const cross = (a: NativeRationalPoint, b: NativeRationalPoint) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
const delta = (a: NativeRationalPoint, b: NativeRationalPoint): NativeRationalPoint => [sub(a[0], b[0]), sub(a[1], b[1])];
const equal = (a: NativeRationalPoint, b: NativeRationalPoint) => cmp(a[0], b[0]) === 0 && cmp(a[1], b[1]) === 0;
export const nativeRationalPoint = (point: readonly (number | Rational)[]): NativeRationalPoint => [rational(point[0]), rational(point[1])];
export function nativeRationalArea(parts: NativeRationalParts): Rational {
  let total = zero();
  for (const part of parts)
    for (const [index, ring] of part.entries()) {
      let sum = zero();
      for (let i = 0; i < ring.length; i++) sum = add(sum, cross(ring[i], ring[(i + 1) % ring.length]));
      const area = div(new Rational(sum.n < 0n ? -sum.n : sum.n, sum.d), new Rational(2n));
      total = index ? sub(total, area) : add(total, area);
    }
  return total;
}
/** Exact area ordering with bounded directed fixed-point intervals first.
 * Common terms cancel before a rare full-fraction equality fallback. */
// Reduce one anchored determinant, preserving exact numerator/denominator.
function relativeCross(origin:NativeRationalPoint,a:NativeRationalPoint,b:NativeRationalPoint):Rational {
 const dxn=a[0].n*origin[0].d-origin[0].n*a[0].d,dxd=a[0].d*origin[0].d;
 const dyn=a[1].n*origin[1].d-origin[1].n*a[1].d,dyd=a[1].d*origin[1].d;
 const pxn=b[0].n*origin[0].d-origin[0].n*b[0].d,pxd=b[0].d*origin[0].d;
 const pyn=b[1].n*origin[1].d-origin[1].n*b[1].d,pyd=b[1].d*origin[1].d;
 return new Rational(dxn*pyn*dyd*pxd-dyn*pxn*dxd*pyd,dxd*pyd*dyd*pxd);
}
type ExactAreaTerm = { value: Rational; coefficient: bigint };
const frozenAreaTerms = new Map<NativeRationalPoint[], { terms: readonly ExactAreaTerm[]; bytes: number }>();
let areaTermBytes=0,areaTermHits=0,areaTermMisses=0,areaTermSkipped=0;
const MAX_AREA_TERM_ENTRIES=512,MAX_AREA_TERM_BYTES=16*1024*1024;
export const nativeRationalAreaTermCacheStatistics=()=>({entries:frozenAreaTerms.size,retainedBytes:areaTermBytes,hits:areaTermHits,misses:areaTermMisses,skipped:areaTermSkipped,maximumEntries:MAX_AREA_TERM_ENTRIES,maximumBytes:MAX_AREA_TERM_BYTES});
function exactRingAreaTerms(ring:NativeRationalPoint[]):readonly ExactAreaTerm[]{
 const immutable=immutableRing(ring),previous=immutable?frozenAreaTerms.get(ring):undefined;
 if(previous){areaTermHits++;frozenAreaTerms.delete(ring);frozenAreaTerms.set(ring,previous);return previous.terms;}
 areaTermMisses++;
 const direction=BigInt(exactSimpleRingOrientation(equal(ring[0],ring[ring.length-1])?ring.slice(0,-1):ring));
 const origin=ring[0],terms:ExactAreaTerm[]=[];
 for(let j=0;j<ring.length;j++){
  const value=relativeCross(origin,ring[j],ring[(j+1)%ring.length]);if(value.n)terms.push({value,coefficient:direction});
 }
 if(!immutable)return terms;
 let bytes=512+64*ring.length;for(const point of ring)for(const value of point)bytes+=192+2*(String(value.n).length+String(value.d).length);for(const t of terms)bytes+=256+2*(String(t.value.n).length+String(t.value.d).length);
 if(bytes>MAX_AREA_TERM_BYTES){areaTermSkipped++;return terms;}
 while(frozenAreaTerms.size&&(frozenAreaTerms.size>=MAX_AREA_TERM_ENTRIES||areaTermBytes+bytes>MAX_AREA_TERM_BYTES)){
  const first=frozenAreaTerms.keys().next().value!;areaTermBytes-=frozenAreaTerms.get(first)!.bytes;frozenAreaTerms.delete(first);
 }
 for(const t of terms){Object.freeze(t.value);Object.freeze(t);}Object.freeze(terms);
 frozenAreaTerms.set(ring,{terms,bytes});areaTermBytes+=bytes;return terms;
}
export function nativeRationalAreaCompare(a:NativeRationalParts,b:NativeRationalParts,multiplierA=1n,multiplierB=1n):number {
  const terms=new Map<string,{value:Rational;coefficient:bigint}>();
  for(const [parts,multiplier] of [[a,multiplierA],[b,-multiplierB]] as const)for(const part of parts)for(const [i,ring] of part.entries()){
    const factor=multiplier*(i?-1n:1n);
    for(const {value,coefficient} of exactRingAreaTerms(ring)){
      const key=`${value.n}/${value.d}`,previous=terms.get(key);terms.set(key,{value,coefficient:factor*coefficient+(previous?.coefficient??0n)});
    }
  }
  const active=[...terms.values()].filter(t=>t.coefficient);if(!active.length)return 0;
  for(const bits of [64n,128n,256n,512n,1024n]){
    let lo=0n,hi=0n;
    for(const {value,coefficient}of active){const n=value.n*coefficient*(1n<<bits),q=n/value.d,r=n%value.d;const floor=r&&n<0n?q-1n:q;lo+=floor;hi+=floor+(r?1n:0n);}
    if(lo>0n)return 1;if(hi<0n)return -1;if(!lo&&!hi)return 0;
  }
  let total=zero();for(const {value,coefficient}of active)total=add(total,new Rational(value.n*coefficient,value.d));return total.n<0n?-1:total.n>0n?1:0;
}
/** Approximate scalar for ownership/coverage metadata only. Exact geometry
 * predicates never infer positive topology from this measurement. */
export function nativeRationalMeasuredArea(parts:NativeRationalParts):number {
  return parts.reduce((total,part)=>total+part.reduce((sum,ring,index)=>{
    // Translation limits cancellation without changing any geometry.
    const origin=ring[0];let value=0;
    for(let i=0;i<ring.length;i++){
      const a=delta(ring[i],origin),b=delta(ring[(i+1)%ring.length],origin);
      value+=nativeRationalScalarToIEEE(cross(a,b));
    }
    return sum+(index?-1:1)*Math.abs(value/2);
  },0),0);
}
function exactSimpleRingOrientation(ring:NativeRationalPoint[]):number {
  let at=0;for(let i=1;i<ring.length;i++) if(cmp(ring[i][0],ring[at][0])<0||(cmp(ring[i][0],ring[at][0])===0&&cmp(ring[i][1],ring[at][1])<0))at=i;
  for(let distance=1;distance<ring.length;distance++){
    const a=ring[(at-distance+ring.length)%ring.length],b=ring[at],c=ring[(at+distance)%ring.length];
    const direction=integerOrientation(a,b,c);if(direction)return direction<0n?-1:1;
  }
  return 0;
}
export function freezeNativeRationalParts(parts:NativeRationalParts):NativeRationalParts {
  for(const part of parts){for(const ring of part){for(const point of ring){Object.freeze(point[0]);Object.freeze(point[1]);Object.freeze(point);}Object.freeze(ring);}Object.freeze(part);}return Object.freeze(parts) as NativeRationalParts;
}
const immutableRings = new WeakSet<NativeRationalPoint[]>();
function immutableRing(ring: NativeRationalPoint[]): boolean {
  if (immutableRings.has(ring)) return true;
  if (!Object.isFrozen(ring) || !ring.every(p => Object.isFrozen(p) && Object.isFrozen(p[0]) && Object.isFrozen(p[1]))) return false;
  immutableRings.add(ring);
  return true;
}
const ringBands = new WeakMap<NativeRationalPoint[],{min:Rational;max:Rational;bands:number[][]}>();
function ringEdgesAt(point:NativeRationalPoint,ring:NativeRationalPoint[]):number[]{
  if(!immutableRing(ring)||ring.length<64)return ring.map((_,i)=>i);
  let index=ringBands.get(ring);
  if(!index){
    const min=ring.reduce((v,p)=>cmp(v,p[1])<0?v:p[1],ring[0][1]),max=ring.reduce((v,p)=>cmp(v,p[1])>0?v:p[1],ring[0][1]);
    if(cmp(min,max)===0)return ring.map((_,i)=>i);
    const bands:number[][]=Array.from({length:64},()=>[]),range=sub(max,min);
    const band=(y:Rational)=>{const t=div(mul(sub(y,min),new Rational(64n)),range);return Math.min(63,Math.max(0,Number(t.n/t.d)));};
    for(let i=0;i<ring.length;i++){const a=ring[i][1],b=ring[(i+1)%ring.length][1],lo=band(cmp(a,b)<0?a:b),hi=band(cmp(a,b)>0?a:b);for(let j=lo;j<=hi;j++)bands[j].push(i);}
    index={min,max,bands};ringBands.set(ring,index);
  }
  if(cmp(point[1],index.min)<0||cmp(point[1],index.max)>0)return [];
  const t=div(mul(sub(point[1],index.min),new Rational(64n)),sub(index.max,index.min));
  return index.bands[Math.min(63,Math.max(0,Number(t.n/t.d)))];
}
const ringBounds=new WeakMap<NativeRationalPoint[],{minX:Rational;maxX:Rational;minY:Rational;maxY:Rational}>();
function outsideExactFrozenRing(point:NativeRationalPoint,ring:NativeRationalPoint[]):boolean {
 if(!ring.length||!immutableRing(ring))return false;
 let bounds=ringBounds.get(ring);
 if(!bounds){
  let minX=ring[0][0],maxX=minX,minY=ring[0][1],maxY=minY;
  for(const [x,y]of ring){if(cmp(x,minX)<0)minX=x;if(cmp(x,maxX)>0)maxX=x;if(cmp(y,minY)<0)minY=y;if(cmp(y,maxY)>0)maxY=y;}
  bounds={minX,maxX,minY,maxY};ringBounds.set(ring,bounds);
 }
 return cmp(point[0],bounds.minX)<0||cmp(point[0],bounds.maxX)>0||cmp(point[1],bounds.minY)<0||cmp(point[1],bounds.maxY)>0;
}
/** Exact determinant sign without intermediate canonical Rational construction. */
function integerOrientation(a:NativeRationalPoint,b:NativeRationalPoint,p:NativeRationalPoint):bigint {
  const dxn=b[0].n*a[0].d-a[0].n*b[0].d,dxd=b[0].d*a[0].d;
  const dyn=b[1].n*a[1].d-a[1].n*b[1].d,dyd=b[1].d*a[1].d;
  const pxn=p[0].n*a[0].d-a[0].n*p[0].d,pxd=p[0].d*a[0].d;
  const pyn=p[1].n*a[1].d-a[1].n*p[1].d,pyd=p[1].d*a[1].d;
  return dxn*pyn*dyd*pxd-dyn*pxn*dxd*pyd;
}
/** 0 outside, 1 inside, -1 exact finite boundary. Existing band broadphase unchanged. */
export function nativeRationalPointInRing(point:NativeRationalPoint,ring:NativeRationalPoint[]):-1|0|1 {
 if(outsideExactFrozenRing(point,ring))return 0;
 let inside=false;
 for(const i of ringEdgesAt(point,ring)){
  const a=ring[i],b=ring[(i+1)%ring.length],ay=cmp(a[1],point[1]),by=cmp(b[1],point[1]);
  if((ay<0&&by<0)||(ay>0&&by>0))continue;
  const det=integerOrientation(a,b,point);
  if(!det && cmp(point[0],cmp(a[0],b[0])<0?a[0]:b[0])>=0 && cmp(point[0],cmp(a[0],b[0])>0?a[0]:b[0])<=0 &&
    cmp(point[1],cmp(a[1],b[1])<0?a[1]:b[1])>=0 && cmp(point[1],cmp(a[1],b[1])>0?a[1]:b[1])<=0)return -1;
  if((ay>0)!==(by>0)){
   const dy=cmp(b[1],a[1]);
   if((dy>0&&det>0n)||(dy<0&&det<0n))inside=!inside;
  }
 }
 return inside?1:0;
}
export function nativeRationalPointInParts(point: readonly (number | Rational)[], parts: NativeRationalParts): boolean {
  const p = nativeRationalPoint(point);
  return parts.some((part) => part.length > 0 && nativeRationalPointInRing(p, part[0]) !== 0 &&
    !part.slice(1).some((hole) => nativeRationalPointInRing(p, hole) !== 0));
}
const localParts = new WeakMap<NativeRationalParts,Map<string,NativeRationalParts>>();
const localPartCounts=new WeakMap<NativeRationalParts,number>();
const localTileLifetime:{parts:WeakRef<NativeRationalParts>;key:string;value:WeakRef<NativeRationalParts>}[]=[];
/** Exact bounded tile intersection only removes distant support. It never
 * widens source geometry or fills a hole; cached results retain rationals. */
function localExactParts(parts:NativeRationalParts,points:NativeRationalPoint[]):NativeRationalParts {
  if(!Object.isFrozen(parts)||!points.length)return parts;
  let count=localPartCounts.get(parts);if(count===undefined){count=parts.reduce((n,p)=>n+p.reduce((n,r)=>n+r.length,0),0);localPartCounts.set(parts,count);}if(count<128)return parts;
  const floor=(q:Rational)=>{const n=q.n/q.d;return q.n<0n&&q.n%q.d?n-1n:n;};
  const lo=(axis:number)=>points.reduce((v,p)=>cmp(v,p[axis])<0?v:p[axis],points[0][axis]),hi=(axis:number)=>points.reduce((v,p)=>cmp(v,p[axis])>0?v:p[axis],points[0][axis]);
  const x0=floor(div(lo(0),new Rational(16n)))*16n,y0=floor(div(lo(1),new Rational(16n)))*16n,x1=(floor(div(hi(0),new Rational(16n)))+1n)*16n,y1=(floor(div(hi(1),new Rational(16n)))+1n)*16n;
  const key=`${x0},${y0},${x1},${y1}`;
  let cache=localParts.get(parts);if(!cache){cache=new Map();localParts.set(parts,cache);}const saved=cache.get(key);if(saved)return saved;
  const point=(x:bigint,y:bigint):NativeRationalPoint=>[new Rational(x),new Rational(y)];
  const intersectsTile = (part: NativeRationalPoint[][]) => {
    const outer = part[0];
    if (!outer?.length) return true; // Preserve the existing invalid-input path.
    // An exact complete shell bounding box can only reject distant parts.
    // Tangent contacts and every hole of a retained part stay in the overlay.
    let minX=outer[0][0],maxX=minX,minY=outer[0][1],maxY=minY;
    for (const [x,y] of outer) {
      if(cmp(x,minX)<0)minX=x;if(cmp(x,maxX)>0)maxX=x;
      if(cmp(y,minY)<0)minY=y;if(cmp(y,maxY)>0)maxY=y;
    }
    return cmp(maxX,new Rational(x0))>=0 && cmp(minX,new Rational(x1))<=0 &&
      cmp(maxY,new Rational(y0))>=0 && cmp(minY,new Rational(y1))<=0;
  };
  const clipped=freezeNativeRationalParts(nativeRationalOverlay("intersection",parts.filter(intersectsTile),[[[point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1)]]]));
  if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,clipped);
  localTileLifetime.push({parts:new WeakRef(parts),key,value:new WeakRef(clipped)});
  while(localTileLifetime.length>256){const old=localTileLifetime.shift()!,owner=old.parts.deref(),value=old.value.deref();if(owner&&value&&localParts.get(owner)?.get(old.key)===value)localParts.get(owner)!.delete(old.key);}
  return clipped;
}
/** Every rational boundary cut is retained, including collinear endpoints and
 * arbitrarily narrow positive gaps. A degenerate trace still needs point support. */
export function nativeRationalPathSupported(points: readonly (readonly (number | Rational)[])[], parts: NativeRationalParts): boolean {
  if (!points.length || !parts.length) return false;
  const path = points.map(nativeRationalPoint);
  parts=localExactParts(parts,path);
  if (path.some((p) => !nativeRationalPointInParts(p, parts))) return false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], v = delta(b, a);
    if (equal(a, b)) continue;
    const cuts = new Map<string, Rational>();
    const put = (t: Rational) => { if (cmp(t, zero()) >= 0 && cmp(t, one()) <= 0) cuts.set(`${t.n}/${t.d}`, t); };
    put(zero()); put(one());
    for (const part of parts) for (const ring of part) for (let k = 0; k < ring.length; k++) {
      const p = ring[k], q = ring[(k + 1) % ring.length], w = delta(q, p), offset = delta(p, a), den = cross(v, w);
      if (den.n) {
        const t = div(cross(offset, w), den), u = div(cross(offset, v), den);
        if (cmp(u, zero()) >= 0 && cmp(u, one()) <= 0) put(t);
      } else if (!cross(offset, v).n) {
        const axis = v[0].n ? 0 : 1;
        put(div(sub(p[axis], a[axis]), v[axis])); put(div(sub(q[axis], a[axis]), v[axis]));
      }
    }
    const sorted = [...cuts.values()].sort(cmp);
    for (let k = 1; k < sorted.length; k++) {
      const t = div(add(sorted[k - 1], sorted[k]), new Rational(2n));
      const p: NativeRationalPoint = [add(a[0], mul(v[0], t)), add(a[1], mul(v[1], t))];
      if (!nativeRationalPointInParts(p, parts)) return false;
    }
  }
  return true;
}
/** A complete positive footprint must fit. No area allowance drops a true void. */
export function nativeRationalFootprintSupported(footprint: NativeRationalParts, parts: NativeRationalParts): boolean {
  if (!footprint.length || !parts.length) return false;
  return nativeRationalOverlay("difference", footprint, localExactParts(parts,footprint.flat(2))).length === 0;
}
/** Explicit approximate representation for raster proposals only. Never feed
 * these points back into an exact Boolean or use them as floor authority. */
export function nativeExactPartsForProposals(parts:NativeRationalParts): [number,number][][][] {
  return parts.map(part=>part.map(ring=>ring.map(([x,y])=>[nativeRationalScalarToIEEE(x),nativeRationalScalarToIEEE(y)])));
}
/** Exact clipping of the immutable finite physical doorway to one portal side. */
export function nativeRationalThresholdHalf(footprint:readonly (readonly number[])[], normal:readonly number[], node:readonly number[]): NativeRationalParts {
  if(footprint.length<3||normal.length<2||!normal.slice(0,2).every(Number.isFinite)) return [];
  const points=footprint.map(nativeRationalPoint), n=nativeRationalPoint(normal);
  const c:NativeRationalPoint=[div(points.reduce((v,p)=>add(v,p[0]),zero()),new Rational(BigInt(points.length))),div(points.reduce((v,p)=>add(v,p[1]),zero()),new Rational(BigInt(points.length)))];
  const side=(p:NativeRationalPoint)=>{const v=delta(p,c);return add(mul(v[0],n[0]),mul(v[1],n[1]));};
  const direction=cmp(side(nativeRationalPoint(node)),zero());if(!direction)return [];
  const sign=new Rational(BigInt(direction)), half:NativeRationalPoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],sa=mul(side(a),sign),sb=mul(side(b),sign);
    if(sa.n>=0n)half.push(a);
    if((sa.n>=0n)!==(sb.n>=0n)){const t=div(sa,sub(sa,sb)),v=delta(b,a);half.push([add(a[0],mul(t,v[0])),add(a[1],mul(t,v[1]))]);}
  }
  return half.length>=3?nativeRationalOverlay("union",[[half]]):[];
}
function validateExactPartTopology(part: NativeRationalPoint[][]) {
  const normalized = part.map(r => Object.freeze(equal(r[0],r[r.length-1]) ? r.slice(0,-1) : r) as NativeRationalPoint[]);
  const intersects = (a:NativeRationalPoint,b:NativeRationalPoint,c:NativeRationalPoint,d:NativeRationalPoint) => {
    const ab=delta(b,a),cd=delta(d,c),ca=delta(c,a),den=cross(ab,cd);
    if (den.n) {const t=div(cross(ca,cd),den),u=div(cross(ca,ab),den);return cmp(t,zero())>=0&&cmp(t,one())<=0&&cmp(u,zero())>=0&&cmp(u,one())<=0;}
    if(cross(ca,ab).n) return false;
    const axis=ab[0].n?0:1;
    const min=(a:Rational,b:Rational)=>cmp(a,b)<0?a:b, max=(a:Rational,b:Rational)=>cmp(a,b)>0?a:b;
    return cmp(max(min(a[axis],b[axis]),min(c[axis],d[axis])), min(max(a[axis],b[axis]),max(c[axis],d[axis])))<=0;
  };
  const min=(a:Rational,b:Rational)=>cmp(a,b)<0?a:b,max=(a:Rational,b:Rational)=>cmp(a,b)>0?a:b;
  const segments=normalized.flatMap((ring,r)=>{
    if(ring.length<3||!exactSimpleRingOrientation(ring))throw new Error("Invalid exact native ring area.");
    return ring.map((a,i)=>{const b=ring[(i+1)%ring.length];if(equal(a,b))throw new Error("Duplicate exact native ring edge.");return {a,b,r,i,count:ring.length,minX:min(a[0],b[0]),maxX:max(a[0],b[0]),minY:min(a[1],b[1]),maxY:max(a[1],b[1])};});
  }).sort((a,b)=>cmp(a.minX,b.minX));
  const active:typeof segments=[];
  for(const s of segments){
    for(let i=active.length-1;i>=0;i--)if(cmp(active[i].maxX,s.minX)<0)active.splice(i,1);
    for(const t of active){
      if(cmp(t.maxY,s.minY)<0||cmp(s.maxY,t.minY)<0)continue;
      if(t.r===s.r && (Math.abs(t.i-s.i)===1||Math.abs(t.i-s.i)===s.count-1))continue;
      if(intersects(s.a,s.b,t.a,t.b)){
        const den=cross(delta(s.b,s.a),delta(t.b,t.a));
        const common=[s.a,s.b].filter(p=>equal(p,t.a)||equal(p,t.b));
        // Canonical polygon topology can retain an isolated shared vertex
        // between shell and hole or between disjoint holes. No edge overlap
        // or crossing is admitted; the exact nesting checks below remain.
        if(s.r!==t.r){
          if(den.n){
            const offset=delta(t.a,s.a),v=delta(s.b,s.a),w=delta(t.b,t.a),u=div(cross(offset,v),den),q=div(cross(offset,w),den);
            if(!u.n||cmp(u,one())===0||!q.n||cmp(q,one())===0)continue;
          }
          const axis=delta(s.b,s.a)[0].n?0:1;
          const lo=max(min(s.a[axis],s.b[axis]),min(t.a[axis],t.b[axis])),hi=min(max(s.a[axis],s.b[axis]),max(t.a[axis],t.b[axis]));
          if(cmp(lo,hi)===0)continue;
        }
        throw new Error(`${t.r===s.r?"Self-intersecting":"Intersecting"} exact native rings ${s.r}:${s.i}/${t.r}:${t.i}.`);
      }
    }
    active.push(s);
  }

  const ringBoxes=normalized.map(r=>({minX:r.reduce((v,p)=>min(v,p[0]),r[0][0]),maxX:r.reduce((v,p)=>max(v,p[0]),r[0][0]),minY:r.reduce((v,p)=>min(v,p[1]),r[0][1]),maxY:r.reduce((v,p)=>max(v,p[1]),r[0][1])}));
  for(let i=1;i<normalized.length;i++){
    const hole=normalized[i];
    if(!hole.some(p=>nativeRationalPointInRing(p,normalized[0])===1)||hole.some(p=>nativeRationalPointInRing(p,normalized[0])===0)) throw new Error("Native hole is outside its exact shell.");
    for(let j=0;j<i;j++){
      const other=normalized[j];

      const a=ringBoxes[i],b=ringBoxes[j];
      if(cmp(a.maxX,b.minX)<0||cmp(b.maxX,a.minX)<0||cmp(a.maxY,b.minY)<0||cmp(b.maxY,a.minY)<0)continue;
      if(j>0&&nativeRationalOverlay("intersection",[[hole]],[[other]]).length) throw new Error("Nested or overlapping exact native holes.");
    }
  }
}
function validBinding(binding: NativeExactPlanarBinding) {
  return /^[a-f0-9]{64}$/.test(binding.sourceModelSha256) &&
    typeof binding.sourceGeometryKey === "string" && binding.sourceGeometryKey.length > 0 && binding.sourceGeometryKey.length <= 1024 &&
    binding.kernelVersion === NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION;
}
export function encodeNativeExactTopology(binding: NativeExactPlanarBinding, input: { id: string; parts: NativeRationalParts }[]): NativeExactPlanarTopology {
  if (!validBinding(binding)) throw new Error("Invalid exact native topology binding.");
  const coordinates: NativeExactPlanarTopology["coordinates"] = [], indices = new Map<string, number>();
  const faces = input.map(({ id, parts }) => ({ id, parts: parts.map((part) => part.map((ring) => ring.map(([x, y]) => {
    const key = `${x.n}/${x.d},${y.n}/${y.d}`;
    if (!indices.has(key)) { indices.set(key, coordinates.length); coordinates.push({ x: [String(x.n), String(x.d)], y: [String(y.n), String(y.d)] }); }
    return indices.get(key)!;
  }))) }));
  const base = { version: 1 as const, sourceModelSha256:binding.sourceModelSha256, sourceGeometryKey:binding.sourceGeometryKey, kernelVersion:binding.kernelVersion, coordinates, faces };
  const value = { ...base, geometrySha256: hash(base) };
  createNativeExactTopologyIndex(value, binding);
  return value;
}
export function createNativeExactTopologyIndex(value: NativeExactPlanarTopology, binding: NativeExactPlanarBinding): NativeExactTopologyIndex {
  if (!value || !validBinding(binding) || !keys(value, ["version", "sourceModelSha256", "sourceGeometryKey", "kernelVersion", "geometrySha256", "coordinates", "faces"]) ||
      value.version !== 1 || value.sourceModelSha256 !== binding.sourceModelSha256 || value.sourceGeometryKey !== binding.sourceGeometryKey || value.kernelVersion !== binding.kernelVersion ||
      !/^[a-f0-9]{64}$/.test(value.geometrySha256) || !Array.isArray(value.coordinates) || value.coordinates.length > MAX_COORDINATES || !Array.isArray(value.faces) || value.faces.length > MAX_FACES)
    throw new Error("Missing, stale or invalid exact native topology.");
  let chars = 0;
  const scalar = (pair: [string, string]): Rational => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
        !/^(0|-?[1-9][0-9]*)$/.test(pair[0]) || !/^[1-9][0-9]*$/.test(pair[1]) || pair.some((s) => s.length > 4096) || (chars += pair[0].length + pair[1].length) > MAX_SCALAR_CHARS)
      throw new Error("Invalid bounded rational native coordinate.");
    const q = new Rational(BigInt(pair[0]), BigInt(pair[1]));
    if (cmp(q,new Rational(-10_000_000n))<0 || cmp(q,new Rational(10_000_000n))>0) throw new Error("Exact native coordinate exceeds physical domain.");
    if (String(q.n) !== pair[0] || String(q.d) !== pair[1]) throw new Error("Noncanonical rational native coordinate.");
    return Object.freeze(q);
  };
  const seenCoordinates = new Set<string>();
  const coordinates = value.coordinates.map((coordinate) => {
    if (!coordinate || !keys(coordinate, ["x", "y"])) throw new Error("Invalid native coordinate fields.");
    const p: NativeRationalPoint = [scalar(coordinate.x), scalar(coordinate.y)], key = `${p[0].n}/${p[0].d},${p[1].n}/${p[1].d}`;
    if (seenCoordinates.has(key)) throw new Error("Duplicate exact native coordinate.");
    seenCoordinates.add(key); return Object.freeze(p) as NativeRationalPoint;
  });
  const faces = new Map<string, NativeRationalParts>(); let indexCount = 0;
  for (const face of value.faces) {
    if (!face || !keys(face, ["id", "parts"]) || typeof face.id !== "string" || !face.id.length || face.id.length > 512 || faces.has(face.id) || !Array.isArray(face.parts) || !face.parts.length)
      throw new Error("Invalid exact native topology face.");
    const parts = face.parts.map((part) => {
      if (!Array.isArray(part) || !part.length) throw new Error("Invalid exact native polygon.");
      return Object.freeze(part.map((ring) => {
        if (!Array.isArray(ring) || ring.length < 3 || (indexCount += ring.length) > MAX_INDICES || ring.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= coordinates.length))
          throw new Error("Invalid exact native polygon indices.");
        return Object.freeze(ring.map((i) => coordinates[i])) as NativeRationalPoint[];
      })) as NativeRationalPoint[][];
    });
    for(const part of parts) validateExactPartTopology(part);

    faces.set(face.id, Object.freeze(parts) as NativeRationalParts);
  }
  if (hash(payload(value)) !== value.geometrySha256) throw new Error("Exact native topology checksum mismatch.");
  const ids = Object.freeze([...faces.keys()]);
  return Object.freeze({ binding: Object.freeze({ sourceModelSha256:binding.sourceModelSha256, sourceGeometryKey:binding.sourceGeometryKey, kernelVersion:binding.kernelVersion }), geometrySha256: value.geometrySha256, parts: (id: string) => faces.get(id), ids: () => ids });
}
