import { containsRoomPoint, type DirectoryRoom, type RoomPoint, type RouteOpening } from "./room-directory.ts";

/** Continuous coverage supplements cell-centre ownership. It cannot bridge a
 * subcell gap between source footprints or traverse a thin private-space mask. */
export function indoorRegionBlocker(
  scope: readonly DirectoryRoom[], masks: readonly DirectoryRoom[], openings: readonly RouteOpening[],
): (a: RoomPoint, b: RoomPoint) => boolean {
  type Item = { rings: RoomPoint[][]; mask: boolean };
  const size = 8, bins = new Map<string, Set<Item>>();
  const add = (item: Item) => {
    const xs=item.rings[0]!.map(p=>p[0]),ys=item.rings[0]!.map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)
      for(let y=Math.floor(Math.min(...ys)/size);y<=Math.floor(Math.max(...ys)/size);y++) {
        const key=`${x}:${y}`,bucket=bins.get(key)??new Set<Item>();bucket.add(item);bins.set(key,bucket);
      }
  };
  for(const r of scope)add({rings:[r.polygonFeet,...r.holesFeet??[],...r.floorOpeningsFeet??[]],mask:false});
  for(const r of masks)add({rings:[r.polygonFeet,...r.holesFeet??[]],mask:true});
  for(const o of openings)if(o.footprint)add({rings:[o.footprint],mask:false});
  const boundary=(p:RoomPoint,ring:RoomPoint[])=>ring.some((a,i)=>{
    const b=ring[(i+1)%ring.length]!,dx=b[0]-a[0],dy=b[1]-a[1];
    const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1);
    return t>=0&&t<=1&&Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<1e-7;
  });
  const inside=(p:RoomPoint,rings:RoomPoint[][],allowBoundary:boolean)=>
    (containsRoomPoint(p,rings[0]!)||(allowBoundary&&boundary(p,rings[0]!)))&&
    !rings.slice(1).some(r=>containsRoomPoint(p,r));
  return (a,b)=>{
    const nearby=new Set<Item>();
    for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)
      for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++)
        for(const item of bins.get(`${x}:${y}`)??[])nearby.add(item);
    const supported=[...nearby].filter(i=>!i.mask),protectedAreas=[...nearby].filter(i=>i.mask);
    const unsupported=(p:RoomPoint)=>!supported.some(i=>inside(p,i.rings,true))||protectedAreas.some(i=>inside(p,i.rings,false));
    if(unsupported(a)||unsupported(b))return true;
    const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[0,1];
    for(const item of nearby)for(const ring of item.rings)for(let i=0;i<ring.length;i++){
      const u=ring[i]!,v=ring[(i+1)%ring.length]!,ex=v[0]-u[0],ey=v[1]-u[1],den=dx*ey-dy*ex;
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
