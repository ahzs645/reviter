import pc from 'polygon-clipping';
import{cleanRoomBoundary,containsRoomPoint,roomArea,validRoomBoundary,type RoomPoint}from'./room-directory.ts';
type Rings=RoomPoint[][];
const signed=(r:readonly RoomPoint[])=>{const origin=r[0]!;return r.reduce((s,p,i)=>{const q=r[(i+1)%r.length]!;return s+(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1])},0)/2;};
const regionArea=(parts:pc.MultiPolygon)=>parts.reduce((s,p)=>s+roomArea(p[0]!as RoomPoint[])-p.slice(1).reduce((a,h)=>a+roomArea(h as RoomPoint[]),0),0);
const cross=(a:RoomPoint,b:RoomPoint,c:RoomPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
/** Decompose repeated-point/zero-area backtrack contacts only. Coordinates are
 * original vertices; an existing vertex can split a collinear edge. Actual
 * crossings, disconnected positive cells, invalid holes and any region change
 * remain unresolved. Neither wall corners nor floor voids are smoothed. */
export function normalizeRoomTouchRings(input:readonly (readonly RoomPoint[])[]):{ringsFeet:Rings;contactCount:number}|undefined{
 if(!input.length)return;const cycles:RoomPoint[][]=[];let contactCount=0;
 for(let ringIndex=0;ringIndex<input.length;ringIndex++){
  let original=cleanRoomBoundary(input[ringIndex]!);if(original.length<3||(ringIndex>0&&roomArea(original)<1))return;
  // A genuine crossing is never a repeated-touch normalization candidate.
  for(let i=0;i<original.length;i++)for(let j=i+2;j<original.length;j++){if(i===0&&j===original.length-1)continue;const a=original[i]!,b=original[(i+1)%original.length]!,c=original[j]!,d=original[(j+1)%original.length]!;if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return;}
  if((signed(original)>0)!==(ringIndex===0))original=original.toReversed();
  const representatives:RoomPoint[]=[];
  const canonical=(p:RoomPoint)=>{const existing=representatives.find(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<=1e-9);if(existing)return existing;const q:[number,number]=[p[0],p[1]];representatives.push(q);return q;};
  const points=original.map(canonical),expanded:RoomPoint[]=[];
  for(let i=0;i<points.length;i++){
   const a=points[i]!,b=points[(i+1)%points.length]!,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(length2<1e-18)return;
   const cuts=points.filter(p=>p!==a&&p!==b&&Math.abs(cross(a,b,p))<1e-8).map(p=>({p,t:((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2})).filter(v=>v.t>0&&v.t<1).sort((x,y)=>x.t-y.t);
   expanded.push(a,...cuts.map(v=>v.p));contactCount+=cuts.length;
  }
  const stack:RoomPoint[]=[],positions=new Map<RoomPoint,number>();
  for(const p of [...expanded,expanded[0]!]){
   const at=positions.get(p);if(at==null){positions.set(p,stack.length);stack.push(p);continue;}
   const cycle=cleanRoomBoundary(stack.slice(at));if(cycle.length>=3&&Math.abs(signed(cycle))>0){if(!validRoomBoundary(cycle))return;cycles.push(cycle);}
   if(at>0||stack.length<expanded.length)contactCount++;
   for(const removed of stack.slice(at+1))positions.delete(removed);stack.splice(at+1);
  }
 }
 const outer=cycles.filter(c=>signed(c)>0),holes=cycles.filter(c=>signed(c)<0);if(outer.length!==1)return;
 if(holes.some(h=>!h.every(p=>containsRoomPoint(p,outer[0]!))))return;
 const rings=[outer[0]!,...holes];const before=input.reduce((s,r,i)=>s+(i?-1:1)*roomArea(r),0),after=rings.reduce((s,r,i)=>s+(i?-1:1)*roomArea(r),0);
 if(Math.abs(before-after)>1e-8)return;
 try{if(regionArea(pc.difference(input as pc.Polygon,rings))>1e-8||regionArea(pc.difference(rings,input as pc.Polygon))>1e-8)return;}catch{return;}
 return{ringsFeet:rings,contactCount};
}
