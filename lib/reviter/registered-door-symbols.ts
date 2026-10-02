import type {BoundarySection} from './room-boundaries.ts';
import type {DirectoryDoor,RoomPoint} from './room-directory.ts';
const distance=(a:RoomPoint,b:RoomPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
/** DWG exports often tessellate swing arcs into ordinary wall-layer LINEs.
 * Recognise only two complementary, tightly circular quarter swings whose
 * hinges coincide with the actual precise native double-door jambs. Real arcs,
 * lone curves and straight wall strokes remain barriers. */
export function registeredDoubleDoorSwingSegments(section:BoundarySection,door:DirectoryDoor):Set<number>{
 const accepted=new Set<number>();if(!door.footprint||!door.normal)return accepted;
 const n=door.normal,u:RoomPoint=[-n[1],n[0]],dot=(p:RoomPoint,v:RoomPoint)=>p[0]*v[0]+p[1]*v[1],us=door.footprint.map(p=>dot(p,u)),ns=door.footprint.map(p=>dot(p,n)),lo=Math.min(...us),hi=Math.max(...us),near=Math.min(...ns),far=Math.max(...ns),mid=(lo+hi)/2,width=hi-lo;
 const lines=section.wallSegments.map((ps,id)=>({ps,id,len:distance(...ps)})).filter(l=>l.len>=.025&&l.len<=.3&&l.ps.every(p=>{const a=dot(p,u),b=dot(p,n);return a>=lo-.2&&a<=hi+.2&&b>=near-width/2-.3&&b<=far+width/2+.3}));
 const key=(p:RoomPoint)=>`${Math.round(p[0]*1e6)},${Math.round(p[1]*1e6)}`,nodes=new Map<string,typeof lines>();for(const l of lines)for(const p of l.ps){const k=key(p),v=nodes.get(k)??[];v.push(l);nodes.set(k,v);}
 const turn=(a:RoomPoint,b:RoomPoint,c:RoomPoint)=>Math.atan2((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]),(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]));
 const circles:{ids:number[];centre:RoomPoint;radius:number;side:number;normalSide:number}[]=[];
 const used=new Set<number>();
 for(const seed of lines){if(used.has(seed.id))continue;const ps:RoomPoint[]=[...seed.ps],ids=[seed.id];let sign=0;
  for(const reverse of [false,true]){if(reverse){ps.reverse();ids.reverse();sign=-sign;}for(let k=0;k<100;k++){
   const a=ps.at(-2)!,b=ps.at(-1)!;const next=(nodes.get(key(b))??[]).filter(l=>!ids.includes(l.id)).map(l=>{const q=key(l.ps[0])===key(b)?l.ps[1]:l.ps[0];return{l,q,t:turn(a,b,q)}}).filter(v=>Math.abs(v.t)>=.01&&Math.abs(v.t)<=.13&&(!sign||Math.sign(v.t)===sign));
   if(next.length!==1)break;const v=next[0]!;sign=Math.sign(v.t);ps.push(v.q);ids.push(v.l.id);
  }}
  for(const id of ids)used.add(id);if(ids.length<12)continue;
  const a=ps[0]!,b=ps[Math.floor(ps.length/2)]!,c=ps.at(-1)!,d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));if(Math.abs(d)<1e-6)continue;
  const aa=a[0]*a[0]+a[1]*a[1],bb=b[0]*b[0]+b[1]*b[1],cc=c[0]*c[0]+c[1]*c[1],centre:RoomPoint=[(aa*(b[1]-c[1])+bb*(c[1]-a[1])+cc*(a[1]-b[1]))/d,(aa*(c[0]-b[0])+bb*(a[0]-c[0])+cc*(b[0]-a[0]))/d],radius=distance(a,centre);
  if(radius<.9||radius>8||Math.abs(radius-width/2)>.2||ps.some(p=>Math.abs(distance(p,centre)-radius)>.001))continue;
  const sweep=ps.slice(1).reduce((s,p,i)=>{const q=ps[i]!,vx=q[0]-centre[0],vy=q[1]-centre[1],wx=p[0]-centre[0],wy=p[1]-centre[1];return s+Math.abs(Math.atan2(vx*wy-vy*wx,vx*wx+vy*wy))},0);if(sweep<Math.PI/180*82||sweep>Math.PI/180*98)continue;
  const h=dot(centre,u),z=dot(centre,n),side=Math.abs(h-lo)<=.15?-1:Math.abs(h-hi)<=.15?1:0;if(!side||z<near-.15||z>far+.15)continue;
  // One end is a closed half leaf, the other is its normal open position.
  const closed=[a,c].find(p=>Math.abs(dot(p,n)-z)<.2&&Math.abs(dot(p,u)-mid)<.2),open=[a,c].find(p=>Math.abs(dot(p,u)-h)<.2&&Math.abs(Math.abs(dot(p,n)-z)-radius)<.2);if(!closed||!open)continue;
  circles.push({ids,centre,radius,side,normalSide:Math.sign(dot(open,n)-z)});
 }
 for(const a of circles)for(const b of circles)if(a.side!==b.side&&a.normalSide===b.normalSide&&Math.abs(a.radius-b.radius)<.05&&Math.abs(dot(a.centre,n)-dot(b.centre,n))<.05)for(const id of [...a.ids,...b.ids])accepted.add(id);
 return accepted;
}
