import * as DMath from "./deterministic-math.ts";
import { type DirectoryRoom, type RoomPoint, type RouteOpening } from "./room-directory.ts";

/** Continuous coverage supplements cell-centre ownership. It cannot bridge a
 * subcell gap between source footprints or traverse a thin private-space mask. */
export function indoorRegionBlocker(
  scope: readonly DirectoryRoom[], masks: readonly DirectoryRoom[], openings: readonly RouteOpening[],
): (a: RoomPoint, b: RoomPoint) => boolean {
  // Each ring keeps its edges in an index (2D cells for the cut and boundary tests, horizontal bands for
  // the even-odd test), so a query reads only the edges near it. Every edge an exact test could accept is
  // in the cells or band read, and the per-edge arithmetic is the original, so results are identical; a
  // giant circulation cell no longer makes each query scan all of its edges.
  type Ring = { points: RoomPoint[]; cells: Map<string, number[]>; bands: Map<number, number[]> };
  type Item = { rings: Ring[]; mask: boolean };
  const cell = 2, band = 1, pad = 1e-6;
  const indexRing = (points: RoomPoint[]): Ring => {
    const cells = new Map<string, number[]>(), bands = new Map<number, number[]>();
    for (let i = 0; i < points.length; i++) {
      const u = points[i]!, v = points[(i + 1) % points.length]!;
      const x0 = Math.min(u[0], v[0]) - pad, x1 = Math.max(u[0], v[0]) + pad, y0 = Math.min(u[1], v[1]) - pad, y1 = Math.max(u[1], v[1]) + pad;
      for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
        for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) { const k = `${x}:${y}`; const l = cells.get(k) ?? []; l.push(i); cells.set(k, l); }
      for (let y = Math.floor(y0 / band); y <= Math.floor(y1 / band); y++) { const l = bands.get(y) ?? []; l.push(i); bands.set(y, l); }
    }
    return { points, cells, bands };
  };
  // even-odd ray test of room-directory containsRoomPoint, over the edges of the point's band only
  const contains = (p: RoomPoint, r: Ring) => {
    let inside = false;
    for (const i of r.bands.get(Math.floor(p[1] / band)) ?? []) {
      const a = r.points[(i + 1) % r.points.length]!, b = r.points[i]!;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const edgesNear = (r: Ring, x0: number, y0: number, x1: number, y1: number) => {
    const out = new Set<number>();
    for (let x = Math.floor((x0 - pad) / cell); x <= Math.floor((x1 + pad) / cell); x++)
      for (let y = Math.floor((y0 - pad) / cell); y <= Math.floor((y1 + pad) / cell); y++) for (const i of r.cells.get(`${x}:${y}`) ?? []) out.add(i);
    return [...out].sort((a, b) => a - b);
  };
  const size = 8, bins = new Map<string, Set<Item>>();
  const add = (item: Item) => {
    const xs=item.rings[0]!.points.map(p=>p[0]),ys=item.rings[0]!.points.map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)
      for(let y=Math.floor(Math.min(...ys)/size);y<=Math.floor(Math.max(...ys)/size);y++) {
        const key=`${x}:${y}`,bucket=bins.get(key)??new Set<Item>();bucket.add(item);bins.set(key,bucket);
      }
  };
  for(const r of scope)add({rings:[r.polygonFeet,...r.holesFeet??[],...r.floorOpeningsFeet??[]].map(indexRing),mask:false});
  for(const r of masks)add({rings:[r.polygonFeet,...r.holesFeet??[]].map(indexRing),mask:true});
  for(const o of openings)if(o.footprint)add({rings:[indexRing(o.footprint)],mask:false});
  const boundary=(p:RoomPoint,r:Ring)=>edgesNear(r,p[0],p[1],p[0],p[1]).some(i=>{
    const ring=r.points,a=ring[i]!,b=ring[(i+1)%ring.length]!,dx=b[0]-a[0],dy=b[1]-a[1];
    const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1);
    return t>=0&&t<=1&&DMath.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<1e-7;
  });
  const inside=(p:RoomPoint,rings:Ring[],allowBoundary:boolean)=>
    (contains(p,rings[0]!)||(allowBoundary&&boundary(p,rings[0]!)))&&
    !rings.slice(1).some(r=>contains(p,r));
  return (a,b)=>{
    const nearby=new Set<Item>();
    for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)
      for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++)
        for(const item of bins.get(`${x}:${y}`)??[])nearby.add(item);
    const supported=[...nearby].filter(i=>!i.mask),protectedAreas=[...nearby].filter(i=>i.mask);
    const unsupported=(p:RoomPoint)=>!supported.some(i=>inside(p,i.rings,true))||protectedAreas.some(i=>inside(p,i.rings,false));
    if(unsupported(a)||unsupported(b))return true;
    const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[0,1];
    for(const item of nearby)for(const r of item.rings)for(const i of edgesNear(r,Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1]))){
      const ring=r.points,u=ring[i]!,v=ring[(i+1)%ring.length]!,ex=v[0]-u[0],ey=v[1]-u[1],den=dx*ey-dy*ex;
      if(Math.abs(den)<1e-10)continue;
      const ox=u[0]-a[0],oy=u[1]-a[1],t=(ox*ey-oy*ex)/den,k=(ox*dy-oy*dx)/den;
      if(t>0&&t<1&&k>=0&&k<=1)cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);
    for(let i=1;i<cuts.length;i++){
      if(cuts[i]!-cuts[i-1]!<1e-9)continue;
      const t=(cuts[i]!+cuts[i-1]!)/2;
      if(unsupported([a[0]+t*dx,a[1]+t*dy]))return true;
    }
    return false;
  };
}
