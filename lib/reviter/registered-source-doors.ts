import pc from 'polygon-clipping';
import type {ArchitecturalPlanGeometry} from './architectural-plan.ts';
import type {BoundaryReference,BoundarySection} from './room-boundaries.ts';
import type {IndoorEdge} from './indoor-contract.ts';
import {containsDirectoryRoomPoint,containsRoomPoint,isHallway,isWalkable,roomArea,roomBuilding,type DirectoryRoom,type RoomPoint,type RouteOpening} from './room-directory.ts';
import {isStairArea} from './directory-stair-geometry.ts';
export type RegisteredSourceDoor=RouteOpening&{sourceDoorId:string;proof:NonNullable<IndoorEdge['sourceDoorProof']>};
export type SourceDoorFloorSupport={elevationFeet:number;nativeFloorElementIds:number[];floors:ArchitecturalPlanGeometry['floors']};
const distance=(a:RoomPoint,b:RoomPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const dot=(a:RoomPoint,b:RoomPoint)=>a[0]*b[0]+a[1]*b[1];
const sub=(a:RoomPoint,b:RoomPoint):RoomPoint=>[a[0]-b[0],a[1]-b[1]];
const area=(p:pc.MultiPolygon)=>p.reduce((s,r)=>s+roomArea(r[0]! as RoomPoint[])-r.slice(1).reduce((v,h)=>v+roomArea(h as RoomPoint[]),0),0);
const shape=(r:DirectoryRoom):pc.Polygon=>[r.polygonFeet,...r.holesFeet??[]];
type Line={id:number;ps:[RoomPoint,RoomPoint];len:number};
type Swing={ids:number[];centre:RoomPoint;radius:number;ends:[RoomPoint,RoomPoint];leafIds:number[];hinge:RoomPoint;open:RoomPoint};
/** Drawing-specific tessellated quarters need their actual four-stroke leaf
 * rectangle as independent evidence. The 0.005 ft radial bound accommodates
 * sub-1.5 mm drawing tessellation, never enlarges native-door evidence. */
function swings(section:BoundarySection):Swing[]{
 const raw:Line[]=section.wallSegments.map((ps,id)=>({ps,id,len:distance(...ps)}));
 const capPoints=raw.filter(l=>l.len>=.03&&l.len<=.25).flatMap(l=>l.ps);
 // CAD may merge an open leaf's outer stroke with its short jamb return.
 // Split only at exact existing cap vertices; retain the original source index.
 const all:Line[]=raw.flatMap(l=>{if(l.len<.9)return[l];const v=sub(l.ps[1],l.ps[0]),cuts=[0,1];for(const p of capPoints){const w=sub(p,l.ps[0]),t=dot(w,v)/(l.len*l.len);if(t>1e-8&&t<1-1e-8&&Math.abs(v[0]*w[1]-v[1]*w[0])/l.len<1e-6)cuts.push(t);}cuts.sort((a,b)=>a-b);return cuts.slice(1).map((t,i)=>{const a=cuts[i]!,ps:[RoomPoint,RoomPoint]=[[l.ps[0][0]+v[0]*a,l.ps[0][1]+v[1]*a],[l.ps[0][0]+v[0]*t,l.ps[0][1]+v[1]*t]];return{id:l.id,ps,len:distance(...ps)}}).filter(l=>l.len>1e-8);});
 const vertexKey=(p:RoomPoint)=>`${Math.round(p[0]*1e6)},${Math.round(p[1]*1e6)}`,longVertices=new Map<string,Line[]>();for(const l of all.filter(l=>l.len>=.9))for(const p of l.ps){const k=vertexKey(p),ls=longVertices.get(k)??[];ls.push(l);longVertices.set(k,ls);}
 const capIds=new Set(all.filter(l=>l.len>=.03&&l.len<=.25&&l.ps.every(p=>(longVertices.get(vertexKey(p))??[]).some(v=>Math.abs(dot(sub(v.ps[1],v.ps[0]),sub(l.ps[1],l.ps[0])))/(v.len*l.len)<.01))).map(l=>l.id));
 const short=all.filter(l=>l.len>=.025&&l.len<=.5&&!capIds.has(l.id)),key=(p:RoomPoint)=>`${Math.round(p[0]*1e6)},${Math.round(p[1]*1e6)}`,nodes=new Map<string,Line[]>();
 for(const l of short)for(const p of l.ps){const k=key(p),v=nodes.get(k)??[];v.push(l);nodes.set(k,v);}
 const turn=(a:RoomPoint,b:RoomPoint,c:RoomPoint)=>Math.atan2((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]),(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]));
 const used=new Set<number>(),out:Swing[]=[];
 for(const seed of short){if(used.has(seed.id))continue;const ps:RoomPoint[]=[...seed.ps],ids=[seed.id];let sign=0;
  for(const reverse of [false,true]){if(reverse){ps.reverse();ids.reverse();sign=-sign;}for(let k=0;k<100;k++){const a=ps.at(-2)!,b=ps.at(-1)!;const next=(nodes.get(key(b))??[]).filter(l=>!ids.includes(l.id)).map(l=>{const q=key(l.ps[0])===key(b)?l.ps[1]:l.ps[0];return{l,q,t:turn(a,b,q)}}).filter(v=>Math.abs(v.t)>=.01&&Math.abs(v.t)<=.15&&(!sign||Math.sign(v.t)===sign));if(next.length!==1)break;const v=next[0]!;sign=Math.sign(v.t);ps.push(v.q);ids.push(v.l.id);}}
  for(const id of ids)used.add(id);if(ids.length<8)continue;
  // Translate before fitting, avoiding cancellation at large model coordinates.
  const a=ps[0]!,b=sub(ps[Math.floor(ps.length/2)]!,a),c=sub(ps.at(-1)!,a),d=2*(b[0]*c[1]-c[0]*b[1]);if(Math.abs(d)<1e-6)continue;const bb=dot(b,b),cc=dot(c,c),local:RoomPoint=[(bb*c[1]-cc*b[1])/d,(cc*b[0]-bb*c[0])/d],centre:RoomPoint=[a[0]+local[0],a[1]+local[1]],radius=distance(a,centre);
  if(radius<.9||radius>8||ps.some(p=>Math.abs(distance(p,centre)-radius)>.005))continue;
  const sweep=ps.slice(1).reduce((s,p,i)=>{const v=sub(ps[i]!,centre),w=sub(p,centre);return s+Math.abs(Math.atan2(v[0]*w[1]-v[1]*w[0],dot(v,w)))},0);if(sweep<82*Math.PI/180||sweep>98*Math.PI/180)continue;
  for(const end of [ps[0]!,ps.at(-1)!])for(const leaf of all.filter(l=>Math.abs(l.len-radius)<.1&&l.ps.some(p=>distance(p,end)<.05)&&l.ps.some(p=>distance(p,centre)<.25))){
   const hinge=leaf.ps.find(p=>distance(p,centre)<.25)!,open=leaf.ps.find(p=>p!==hinge)!,v=sub(open,hinge),len=distance(open,hinge),direction:RoomPoint=[v[0]/len,v[1]/len];
   const parallel=all.filter(l=>l.id!==leaf.id&&Math.abs(l.len-len)<.01&&Math.abs(dot(sub(l.ps[1],l.ps[0]),direction))/l.len>.99999);
   for(const other of parallel){const oh=other.ps.reduce((a,b)=>distance(a,hinge)<distance(b,hinge)?a:b),oo=other.ps.find(p=>p!==oh)!,thickness=distance(hinge,oh);if(thickness<.03||thickness>.25||Math.abs(dot(sub(oh,hinge),direction))>.01||distance(open,oo)>.25)continue;
    const cap=(p:RoomPoint,q:RoomPoint)=>all.find(l=>l.len>=.03&&l.len<=.25&&((distance(l.ps[0],p)<.001&&distance(l.ps[1],q)<.001)||(distance(l.ps[1],p)<.001&&distance(l.ps[0],q)<.001)));
    const hcap=cap(hinge,oh),ocap=cap(open,oo);if(!hcap||!ocap)continue;
    const leafIds=[leaf.id,other.id,hcap.id,ocap.id];if(out.some(s=>s.ids[0]===ids[0]))continue;out.push({ids,centre,radius,ends:[ps[0]!,ps.at(-1)!],leafIds,hinge:distance(hinge,centre)<distance(oh,centre)?hinge:oh,open:distance(hinge,centre)<distance(oh,centre)?open:oo});
   }
  }
 }
 return out;
}
type DrawingOpening={indices:number[];symbolIds:number[];aperture: [RoomPoint,RoomPoint,RoomPoint,RoomPoint];normal:RoomPoint;point:RoomPoint;u:RoomPoint;left:number;right:number;lo:number;hi:number};
export function registeredSourceDoorSymbols(section:BoundarySection):DrawingOpening[]{
 const candidates=swings(section),all=section.wallSegments.map((ps,id)=>({ps,id,len:distance(...ps)})),result:DrawingOpening[]=[];
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
  const a=candidates[i]!,b=candidates[j]!,v=sub(b.hinge,a.hinge),length=distance(a.hinge,b.hinge),av=sub(a.open,a.hinge),al=distance(a.open,a.hinge),axis:RoomPoint=[av[1]/al,-av[0]/al],sign=dot(axis,v)>0?1:-1,u:RoomPoint=[axis[0]*sign,axis[1]*sign],n:RoomPoint=[-u[1],u[0]];
  if(Math.abs(length-a.radius-b.radius)>.2||Math.abs(a.radius-b.radius)>.05||Math.abs(dot(sub(a.open,a.hinge),u))>.08||Math.abs(dot(sub(b.open,b.hinge),u))>.08)continue;
  const ac=a.ends.find(p=>distance(p,a.open)>.2)!,bc=b.ends.find(p=>distance(p,b.open)>.2)!;if(distance(ac,bc)>.25||Math.abs(dot(sub(ac,a.hinge),n))>.2||Math.abs(dot(sub(bc,b.hinge),n))>.2)continue;
  // Two actual wall faces must continue away from EACH hinge. Their near
  // endpoints, not swing extents, define the clear aperture and wall thickness.
  const faces=(hinge:RoomPoint,side:number)=>all.filter(l=>l.len>=.6&&Math.abs(dot(sub(l.ps[1],l.ps[0]),u))/l.len>.99999).map(l=>{const p=l.ps.reduce((a,b)=>distance(a,hinge)<distance(b,hinge)?a:b),q=l.ps.find(v=>v!==p)!;return{...l,p,q}}).filter(l=>distance(l.p,hinge)<.3&&dot(sub(l.q,l.p),u)*side>0);
  const left=faces(a.hinge,-1),right=faces(b.hinge,1);
  for(let k=0;k<left.length;k++)for(let l=k+1;l<left.length;l++)for(let x=0;x<right.length;x++)for(let y=x+1;y<right.length;y++){
   const lf=[left[k]!,left[l]!].sort((a,b)=>dot(a.p,n)-dot(b.p,n)),rf=[right[x]!,right[y]!].sort((a,b)=>dot(a.p,n)-dot(b.p,n)),lo=dot(lf[0]!.p,n),hi=dot(lf[1]!.p,n);
   if(hi-lo<.1||hi-lo>2||Math.abs(lo-dot(rf[0]!.p,n))>.01||Math.abs(hi-dot(rf[1]!.p,n))>.01||Math.abs(dot(lf[0]!.p,u)-dot(lf[1]!.p,u))>.015||Math.abs(dot(rf[0]!.p,u)-dot(rf[1]!.p,u))>.015)continue;
   const L=Math.max(...lf.map(f=>dot(f.p,u))),R=Math.min(...rf.map(f=>dot(f.p,u)));if(R-L<2||R-L>16)continue;
   const at=(h:number,z:number):RoomPoint=>[u[0]*h+n[0]*z,u[1]*h+n[1]*z],mid=(L+R)/2;
   if(result.some(r=>distance(r.point,at(mid,(lo+hi)/2))<.1))continue;
   result.push({indices:[...lf,...rf].map(f=>f.id),symbolIds:[...new Set([...a.ids,...b.ids,...a.leafIds,...b.leafIds])].sort((a,b)=>a-b),aperture:[at(L,lo),at(R,lo),at(R,hi),at(L,hi)],normal:n,point:at(mid,(lo+hi)/2),u,left:L,right:R,lo,hi});
  }
 }
 return result;
}
const lineHits=(ps:readonly[RoomPoint,RoomPoint],polygon:RoomPoint[])=>{
 const [p,q]=ps,v=sub(q,p),ts=[0,1];for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,e=sub(b,a),den=v[0]*e[1]-v[1]*e[0];if(Math.abs(den)<1e-10)continue;const w=sub(a,p),t=(w[0]*e[1]-w[1]*e[0])/den,z=(w[0]*v[1]-w[1]*v[0])/den;if(t>=0&&t<=1&&z>=0&&z<=1)ts.push(t);}ts.sort((a,b)=>a-b);return ts.slice(1).some((t,i)=>t-ts[i]!>1e-9&&containsRoomPoint([p[0]+v[0]*(t+ts[i]!)/2,p[1]+v[1]*(t+ts[i]!)/2],polygon));
};
/** Source-only doors require a complete paired symbol and both wall jambs.
 * Unique corridor ownership is derived from intersections along the actual
 * door normal, independently escaping raster-overlap on each side (max 4 ft).
 * Every bridge is proved at full width against both exact native floors and
 * all native/source barriers. Access and step-free status stay unknown. */
export function recoverRegisteredSourceDoors(rooms:readonly DirectoryRoom[],reference:BoundaryReference|undefined,geometry:ArchitecturalPlanGeometry,floorSupport:ReadonlyMap<string,SourceDoorFloorSupport>,sourceModelSha256:string):RegisteredSourceDoor[]{
 if(!reference||!/^[a-f0-9]{64}$/i.test(reference.sourceSha256)||!/^[a-f0-9]{64}$/i.test(sourceModelSha256))return[];const result:RegisteredSourceDoor[]=[];
 const halls=rooms.filter(r=>isWalkable(r)&&isHallway(r)&&!isStairArea(r)&&r.dwg?.sha256===reference.sourceSha256);
 for(const section of reference.sections.filter(s=>Number.isFinite(s.registrationErrorFeet)&&s.registrationErrorFeet<=.05)){
  const local=halls.filter(r=>r.levelId===section.levelId&&r.dwg?.sectionId===section.sectionId);if(local.length<2)continue;
  for(const d of registeredSourceDoorSymbols(section)){
   const at=(h:number,z:number):RoomPoint=>[d.u[0]*h+d.normal[0]*z,d.u[1]*h+d.normal[1]*z],mid=(d.left+d.right)/2;
   const own=(z:number)=>local.filter(r=>[-1,0,1].every(o=>[-.025,0,.025].every(delta=>containsDirectoryRoomPoint(at(mid+o,z+delta),r))));
   const depths=(sign:number)=>{const edge=sign<0?d.lo:d.hi,values=new Set([.1]);for(const r of local)for(const o of [-1,0,1])for(const ring of [r.polygonFeet,...r.holesFeet??[]])for(let i=0;i<ring.length;i++){const a=ring[i]!,b=ring[(i+1)%ring.length]!,au=dot(a,d.u),bu=dot(b,d.u);if(Math.abs(bu-au)<1e-9)continue;const t=(mid+o-au)/(bu-au);if(t<0||t>1)continue;const z=dot(a,d.normal)+(dot(b,d.normal)-dot(a,d.normal))*t,depth=(z-edge)*sign+.075;if(depth>.075&&depth<=4)values.add(depth);}return[...values].sort((a,b)=>a-b);};
   const choices:{a:DirectoryRoom;b:DirectoryRoom;from:number;to:number}[]=[];for(const fd of depths(-1))for(const td of depths(1)){const a=own(d.lo-fd),b=own(d.hi+td);if(a.length===1&&b.length===1&&a[0]!.key!==b[0]!.key&&roomBuilding(a[0]!)===roomBuilding(b[0]!))choices.push({a:a[0]!,b:b[0]!,from:d.lo-fd,to:d.hi+td});}
   if(!choices.length||new Set(choices.map(c=>[c.a.key,c.b.key].sort().join('|'))).size!==1)continue;
   choices.sort((a,b)=>(a.to-a.from)-(b.to-b.from));
   for(const c of choices){const af=floorSupport.get(c.a.key),bf=floorSupport.get(c.b.key);if(!af||!bf||!Number.isFinite(af.elevationFeet)||!Number.isFinite(bf.elevationFeet)||Math.abs(af.elevationFeet-bf.elevationFeet)>.05||!af.floors.length||!bf.floors.length||![...af.nativeFloorElementIds,...bf.nativeFloorElementIds].every(id=>Number.isSafeInteger(id)&&id>0)||!af.nativeFloorElementIds.length||!bf.nativeFloorElementIds.length)continue;
    const bridge:RoomPoint[]=[at(mid-1,c.from),at(mid+1,c.from),at(mid+1,c.to),at(mid-1,c.to)],foot:pc.MultiPolygon=[[bridge]];
    try{
     const tips=(z:number):pc.Polygon=>[[at(mid-1,z-.025),at(mid+1,z-.025),at(mid+1,z+.025),at(mid-1,z+.025)]];
     if(area(pc.difference(tips(c.from),shape(c.a)))>1e-8||area(pc.difference(tips(c.to),shape(c.b)))>1e-8||area(pc.intersection(tips(c.from),shape(c.b)))>1e-8||area(pc.intersection(tips(c.to),shape(c.a)))>1e-8)continue;
     if(rooms.some(r=>r.levelId===section.levelId&&r.status!=='deleted'&&![c.a.key,c.b.key].includes(r.key)&&area(pc.intersection(foot,shape(r)))>1e-8))continue;
     if(rooms.filter(r=>r.levelId===section.levelId).flatMap(r=>[...r.holesFeet??[],...r.floorOpeningsFeet??[]]).some(h=>area(pc.intersection(foot,[h]))>1e-8))continue;
     if([...geometry.walls,...geometry.columns,...geometry.doors].some(w=>area(pc.intersection(foot,[w.polygon]))>1e-8))continue;
     const symbols=new Set(d.symbolIds);if(section.wallSegments.some((line,i)=>!symbols.has(i)&&lineHits(line,bridge))||section.doorSegments.some(line=>lineHits(line,bridge)))continue;
     let supported=true;for(const f of [af,bf]){let missing=foot;for(const floor of f.floors){missing=pc.difference(missing,floor);if(!missing.length)break;}if(area(missing)>1e-8){supported=false;break;}}if(!supported)continue;
     const sourceDoorId=`source-door:${reference.sourceSha256}:${section.levelId}:${section.sectionId}:${d.indices.slice().sort((a,b)=>a-b).join('-')}`;
     result.push({sourceDoorId,rooms:[c.a.key,c.b.key],point:d.point,from:at(mid,c.from),to:at(mid,c.to),normal:d.normal,footprint:d.aperture,halfWidth:(d.right-d.left)/2,halfHeight:(d.hi-d.lo)/2,proof:{version:1,sourceModelSha256,sourceSha256:reference.sourceSha256,sectionId:section.sectionId,registrationErrorFeet:section.registrationErrorFeet,levelId:section.levelId,elevationFeet:af.elevationFeet,nativeFloorElementIds:[...new Set([...af.nativeFloorElementIds,...bf.nativeFloorElementIds])].sort((a,b)=>a-b),wallSegmentIndices:d.indices,doorSymbolSegmentIndices:d.symbolIds,doorSymbolCollection:'wallSegments',apertureFeet:d.aperture,walkingStripWidthFeet:2}});break;
    }catch{/* Clipping uncertainty never authorizes a door. */}
   }
  }
 }
 return result;
}
