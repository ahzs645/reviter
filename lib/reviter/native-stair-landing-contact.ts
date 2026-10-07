import pc from 'polygon-clipping';
import {architecturalPlanGeometry,type ArchitecturalPlanGeometry} from './architectural-plan.ts';
import {containsDirectoryRoomPoint,roomArea,type DirectoryRoom,type RoomPoint} from './room-directory.ts';
import type {ConvertResult,ElementBoundsRecord} from './types.ts';
const area=(parts:RoomPoint[][][])=>parts.reduce((sum,p)=>sum+roomArea(p[0]!)-p.slice(1).reduce((s,h)=>s+roomArea(h),0),0);
const closed=(parts:RoomPoint[][][])=>parts.map(p=>p.map(r=>[...r,r[0]!])) as pc.MultiPolygon;
type NativeModel=Pick<ConvertResult,"levels">&Partial<ConvertResult>;
const cache=new WeakMap<object,Map<number,ArchitecturalPlanGeometry>>();
function sourcePlan(model:NativeModel,levelId:number){let levels=cache.get(model);if(!levels){levels=new Map();cache.set(model,levels);}let g=levels.get(levelId);if(!g){g=architecturalPlanGeometry(model as ConvertResult,levelId);levels.set(levelId,g);}return g;}
/** A reviewed, explicitly bound landing may meet a stair at its terminal cap
 * without filling the protected stairwell opening with tread projections.
 * This proves source floor contact only; it never grants access or lift use. */
export function nativeStairLandingContact(model:NativeModel,room:DirectoryRoom,stairElementId:number,runs:readonly ElementBoundsRecord[],end:'bottom'|'top',geometry?:ArchitecturalPlanGeometry):boolean {
 if(!room.stairFlightIds?.includes(stairElementId)||!containsDirectoryRoomPoint(room.routePointFeet??room.labelPointFeet,room))return false;
 const level=model.levels.find(l=>l.levelId===room.levelId);if(!level)return false;
 const owned=[room.polygonFeet,...room.holesFeet??[]],own=closed([owned]),ownArea=area([owned]);if(ownArea<=1)return false;
 if(!geometry&&(!model.elementBounds||!model.nativeAssociatedLevelRelations?.length))return false;
 const g=geometry??sourcePlan(model,room.levelId);if(!g.floors.length)return false;
 // Whole declared landing must be supported by the original level's slab,
 // including its original holes; walls and columns cannot become landing.
 if(area(pc.difference(own,...g.floors.map(p=>closed([p]))) as RoomPoint[][][])>1e-4)return false;
 const solids=[...g.walls,...g.columns].map(w=>closed([[w.polygon]]));
 if(solids.some(s=>area(pc.intersection(own,s) as RoomPoint[][][])>1e-4))return false;
 const steps=runs.flatMap(r=>(r.stairTreads??[]).map(t=>({t,z:t.reduce((s,p)=>s+p[2]/t.length,0),c:t.reduce((s,p)=>[s[0]+p[0]/t.length,s[1]+p[1]/t.length] as RoomPoint,[0,0] as RoomPoint)}))).sort((a,b)=>a.z-b.z);
 if(steps.length<2)return false;
 const terminal=end==='bottom'?steps[0]!:steps.at(-1)!,neighbour=end==='bottom'?steps[1]!:steps.at(-2)!;
 if(Math.abs(terminal.z-level.elevation)>1)return false;
 const dx=terminal.c[0]-neighbour.c[0],dy=terminal.c[1]-neighbour.c[1],length=Math.hypot(dx,dy);if(length<1e-6)return false;
 const ux=dx/length,uy=dy/length;
 // Select the outward, transverse edge of the first/last persisted tread.
 const edges=terminal.t.map((p,i)=>{const q=terminal.t[(i+1)%terminal.t.length]!,ex=q[0]-p[0],ey=q[1]-p[1],span=Math.hypot(ex,ey);return {a:[p[0],p[1]] as RoomPoint,b:[q[0],q[1]] as RoomPoint,span,transverse:span>0?Math.abs(ex*ux+ey*uy)/span:1,outward:((p[0]+q[0])/2-terminal.c[0])*ux+((p[1]+q[1])/2-terminal.c[1])*uy};}).filter(e=>e.transverse<.1&&e.outward>0).sort((a,b)=>b.outward-a.outward);
 const cap=edges[0];if(!cap||cap.span<.5)return false;
 const cuts=[0,1],vx=cap.b[0]-cap.a[0],vy=cap.b[1]-cap.a[1];
 for(const ring of owned)for(let i=0;i<ring.length;i++){const a=ring[i]!,b=ring[(i+1)%ring.length]!,ex=b[0]-a[0],ey=b[1]-a[1],den=vx*ey-vy*ex;if(Math.abs(den)<1e-12)continue;const ox=a[0]-cap.a[0],oy=a[1]-cap.a[1],t=(ox*ey-oy*ex)/den,u=(ox*vy-oy*vx)/den;if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);}
 cuts.sort((a,b)=>a-b);const onOwn=(p:RoomPoint)=>containsDirectoryRoomPoint(p,room)||owned.some(r=>r.some((a,i)=>{const b=r[(i+1)%r.length]!,ex=b[0]-a[0],ey=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*ex+(p[1]-a[1])*ey)/(ex*ex+ey*ey||1)));return Math.hypot(p[0]-a[0]-t*ex,p[1]-a[1]-t*ey)<1e-7;}));
 const contact=cuts.slice(1).reduce((sum,t,i)=>{const previous=cuts[i]!,mid=(previous+t)/2;return sum+(onOwn([cap.a[0]+vx*mid,cap.a[1]+vy*mid])?(t-previous)*cap.span:0);},0);
 return contact>=Math.max(.5,cap.span/2)-1e-7;
}
