import {registeredDoubleDoorSwingSegments} from './registered-door-symbols.ts';
import pc from 'polygon-clipping';
import type {ArchitecturalPlanGeometry} from './architectural-plan.ts';
import type {BoundaryReference} from './room-boundaries.ts';
import {isStairArea} from './directory-stair-geometry.ts';
import type {DoorReview} from './directory-navigation.ts';
import {containsDirectoryRoomPoint,containsRoomPoint,isWalkable,isHallway,roomBuilding,nativeRouteBlocker,roomArea,type DirectoryRoom,type RoomPoint,type RoomPortal} from './room-directory.ts';

export type NativeDoorOwnershipFinding={doorId:number;status:'recovered'|'review';reason:string};
export type NativeDoorOwnershipRecovery = {portal:RoomPortal;proof:{widthFeet:number;approachDepthFeet:number;floorCoveredSquareFeet:number;sourceSha256?:string;sourceSectionId?:string;sourceRegistrationErrorFeet?:number;sourceDoorSymbolSegmentIndices?:number[]}};
const area=(polygons:pc.MultiPolygon)=>polygons.reduce((sum,p)=>sum+roomArea(p[0]! as RoomPoint[])-p.slice(1).reduce((s,h)=>s+roomArea(h as RoomPoint[]),0),0);
const shape=(room:DirectoryRoom):pc.Polygon=>[room.polygonFeet,...room.holesFeet??[]];
/** Native threshold sides can be recessed relative to registered room boundaries.
 * Recover only a unique side pair across all jamb samples, with a full two-foot
 * bridge proved on native floor and clear of every non-aperture wall, column,
 * repaired joint, third room and hole. This never establishes access permissions.
 */
type OwnershipOptions={depths?:(review:DoorReview)=>readonly number[];eligiblePair?:(a:DirectoryRoom,b:DirectoryRoom)=>boolean;additionalProof?:(a:DirectoryRoom,b:DirectoryRoom,footprint:pc.MultiPolygon,review:DoorReview)=>string|undefined;proofFields?:(a:DirectoryRoom,b:DirectoryRoom,review:DoorReview)=>Partial<NativeDoorOwnershipRecovery["proof"]>};
function recoverDoorOwnership(rooms:readonly DirectoryRoom[], reviews:readonly DoorReview[],geometry:ArchitecturalPlanGeometry,onReview:((finding:NativeDoorOwnershipFinding)=>void)|undefined,options:OwnershipOptions={}):NativeDoorOwnershipRecovery[]{
 const result:NativeDoorOwnershipRecovery[]=[];
 const active=rooms.filter(isWalkable).filter((r,i,all)=>!r.circulationGroup||all.findIndex(o=>o.circulationGroup===r.circulationGroup)===i);
 for(const review of reviews){
  const door=review.door;if(review.portal)continue;
  const reject=(reason:string)=>onReview?.({doorId:door.id,status:'review',reason});
  if(review.hasExplicitReview){reject('An explicit doorway ownership review must be corrected rather than overridden.');continue;}
  if(!door.footprint||!door.normal||!geometry.floors.length){reject('Precise native threshold, direction and floor coverage are required.');continue;}
  const [nx,ny]=door.normal;if(Math.abs(Math.hypot(nx,ny)-1)>1e-5){reject('Native threshold direction is invalid.');continue;}
  const ux=-ny,uy=nx,proj=(p:RoomPoint,x:number,y:number)=>p[0]*x+p[1]*y;
  const ns=door.footprint.map(p=>proj(p,nx,ny)),us=door.footprint.map(p=>proj(p,ux,uy));
  const lo=Math.min(...ns),hi=Math.max(...ns),left=Math.min(...us),right=Math.max(...us),mid=(left+right)/2;
  if(right-left<2){reject('Native jamb width is below the two-foot proof width.');continue;}
  const at=(u:number,n:number):RoomPoint=>[ux*u+nx*n,uy*u+ny*n];
  const own=(u:number,n:number)=>active.filter(r=>[-.05,0,.05].every(delta=>containsDirectoryRoomPoint(at(u,n+delta),r)));
  const pairs=new Set<string>(), choices:{a:DirectoryRoom;b:DirectoryRoom;fromDepth:number;toDepth:number}[]=[];
  // Each side is independent: a shallow corridor and a recessed room need
  // different approach depths. Retain the original maximum search distance and
  // ownership quorum; every candidate must still prove its complete width.
  const depths=options.depths?.(review)??[.35,.7,1,1.5];
  for(const fromDepth of depths)for(const toDepth of depths){
   const votes=[.25,.5,.75].map(t=>({a:own(left+(right-left)*t,lo-fromDepth),b:own(left+(right-left)*t,hi+toDepth)}));
   for(const v of votes)if(v.a.length===1&&v.b.length===1&&v.a[0]!.key!==v.b[0]!.key&&(!options.eligiblePair||options.eligiblePair(v.a[0]!,v.b[0]!)))pairs.add([v.a[0]!.key,v.b[0]!.key].sort().join(':'));
   if(votes.every(v=>v.a.length===1&&v.b.length===1&&v.a[0]!.key===votes[0]!.a[0]!.key&&v.b[0]!.key===votes[0]!.b[0]!.key)&&votes[0]!.a[0]!.key!==votes[0]!.b[0]!.key&&(!options.eligiblePair||options.eligiblePair(votes[0]!.a[0]!,votes[0]!.b[0]!)))choices.push({a:votes[0]!.a[0]!,b:votes[0]!.b[0]!,fromDepth,toDepth});
  }
  if(!choices.length||pairs.size!==1){reject(pairs.size>1?'Jamb samples disagree on room ownership.':options.depths?'No unique pair owns the independently registered stair threshold rays.':'No unique pair owns both native threshold sides within 1.5 feet.');continue;}
  choices.sort((a,b)=>a.fromDepth+a.toDepth-b.fromDepth-b.toDepth||a.fromDepth-b.fromDepth);
  let failure='Native threshold centre has no supported room ownership.', accepted=false;
  for(const {a,b,fromDepth,toDepth} of choices){
  const from=at(mid,lo-fromDepth),to=at(mid,hi+toDepth);
  if(!containsDirectoryRoomPoint(from,a)||!containsDirectoryRoomPoint(to,b))continue;
  const footprint:pc.MultiPolygon=[[[at(mid-1,lo-fromDepth),at(mid+1,lo-fromDepth),at(mid+1,hi+toDepth),at(mid-1,hi+toDepth)]]];
  try{
   // Centre ownership alone must not conceal a corner/overlap inside the width.
   const tips:pc.MultiPolygon=[[[at(mid-1,lo-fromDepth),at(mid+1,lo-fromDepth),at(mid+1,lo-fromDepth+.05),at(mid-1,lo-fromDepth+.05)]]];
   const farTips:pc.MultiPolygon=[[[at(mid-1,hi+toDepth-.05),at(mid+1,hi+toDepth-.05),at(mid+1,hi+toDepth),at(mid-1,hi+toDepth)]]];
   if(area(pc.difference(tips,shape(a)))>1e-8||area(pc.difference(farTips,shape(b)))>1e-8){failure='Room boundaries do not own the full two-foot approach width.';continue;}
   if(rooms.some(r=>r.status!=='deleted'&&r.key!==a.key&&r.key!==b.key&&!(r.circulationGroup&&[a.circulationGroup,b.circulationGroup].includes(r.circulationGroup))&&area(pc.intersection(footprint,shape(r)))>1e-8)){failure='Bridge overlaps a third room boundary.';continue;}
   if(rooms.flatMap(r=>[...r.holesFeet??[],...r.floorOpeningsFeet??[]]).some(h=>area(pc.intersection(footprint,[h]))>1e-8)){failure='Bridge overlaps a source or native floor opening.';continue;}
   if(geometry.columns.some(c=>area(pc.intersection(footprint,[c.polygon]))>1e-8)){failure='Bridge intersects a native column.';continue;}
   if(geometry.walls.some(w=>area(pc.difference(pc.intersection(footprint,[w.polygon]),[door.footprint!]))>1e-8)){failure='Bridge intersects a native wall or repaired joint outside the actual aperture.';continue;}
   let uncovered=footprint;
   for(const floor of geometry.floors){uncovered=pc.difference(uncovered,floor);if(!uncovered.length)break;}
   if(area(uncovered)>1e-8){failure='Full bridge width is not continuously supported by native floor.';continue;}
   const proofFailure=options.additionalProof?.(a,b,footprint,review);if(proofFailure){failure=proofFailure;continue;}
   const portal:RoomPortal={doorId:door.id,rooms:[a.key,b.key],point:door.point,from,to,halfWidth:door.halfWidth,halfHeight:door.halfHeight,footprint:door.footprint,normal:door.normal};
   const blocked=nativeRouteBlocker(geometry,[portal]);
   if([-1,0,1].some(offset=>blocked(at(mid+offset,lo-fromDepth),at(mid+offset,hi+toDepth)))){failure='Continuous native barrier check blocks the bridge.';continue;}
   result.push({portal,proof:{widthFeet:2,approachDepthFeet:Math.max(fromDepth,toDepth),floorCoveredSquareFeet:area(footprint),...options.proofFields?.(a,b,review)}});
   accepted=true;
   onReview?.({doorId:door.id,status:'recovered',reason:'Unique threshold sides, full two-foot native floor support and continuous native barrier clearance proved.'});
   break;
  }catch{failure='Invalid clipping geometry prevents a supported doorway proof.';}
  }
  if(!accepted)reject(failure);
 }
 return result;
}


export function recoverNativeDoorOwnership(rooms:readonly DirectoryRoom[],reviews:readonly DoorReview[],geometry:ArchitecturalPlanGeometry,onReview?:(finding:NativeDoorOwnershipFinding)=>void):NativeDoorOwnershipRecovery[]{
 return recoverDoorOwnership(rooms,reviews,geometry,onReview);
}

/** Source boundaries may omit the flat approach to an actual native stair
 * entrance. Use geometric ray intersections, not a larger ordinary-room radius.
 * Both registered circulation identities, exact equal-height floors, full width,
 * every barrier/third-room/hole and source wall outside the actual aperture must
 * be proved. This cannot infer a vertical stair flight or access permission.
 */
export function recoverRegisteredStairDoorOwnership(rooms:readonly DirectoryRoom[],reviews:readonly DoorReview[],geometry:ArchitecturalPlanGeometry,reference:BoundaryReference|undefined,floorSupport:ReadonlyMap<string,{elevationFeet:number;floors:ArchitecturalPlanGeometry["floors"]}>,onReview?:(finding:NativeDoorOwnershipFinding)=>void):NativeDoorOwnershipRecovery[]{
 if(!reference)return [];
 const eligible=rooms.filter(r=>isWalkable(r)&&isHallway(r));
 const sectionFor=(r:DirectoryRoom)=>r.dwg?.sha256===reference.sourceSha256?reference.sections.find(s=>s.levelId===r.levelId&&s.sectionId===r.dwg?.sectionId&&Number.isFinite(s.registrationErrorFeet)&&s.registrationErrorFeet<=.05):undefined;
 const depthsFor=(review:DoorReview):number[]=>{
  const d=review.door;if(!d.footprint||!d.normal)return [];
  const [nx,ny]=d.normal,ux=-ny,uy=nx,normal=d.footprint.map(p=>p[0]*nx+p[1]*ny),across=d.footprint.map(p=>p[0]*ux+p[1]*uy),left=Math.min(...across),right=Math.max(...across),mid=(left+right)/2;
  const depths=new Set([.35,.7,1,1.5]);
  for(const room of eligible.filter(r=>sectionFor(r)))for(const sign of [-1,1]){
   const edgeN=sign<0?Math.min(...normal):Math.max(...normal),ray:[number,number]=[nx*sign,ny*sign];
   const entries=[left+(right-left)*.25,mid,right-(right-left)*.25,mid-1,mid+1].map(u=>{
    const origin:RoomPoint=[ux*u+nx*edgeN,uy*u+ny*edgeN];let entry=Infinity;
    for(const ring of [room.polygonFeet,...room.holesFeet??[]])for(let i=0;i<ring.length;i++){
     const p=ring[i]!,q=ring[(i+1)%ring.length]!,ex=q[0]-p[0],ey=q[1]-p[1],den=ray[0]*ey-ray[1]*ex;
     if(Math.abs(den)<1e-9)continue;
     const px=p[0]-origin[0],py=p[1]-origin[1],t=(px*ey-py*ex)/den,v=(px*ray[1]-py*ray[0])/den;
     if(t<0||t>3.925||v<0||v>1)continue;
     const depth=t+.075;
     if(containsDirectoryRoomPoint([origin[0]+ray[0]*depth,origin[1]+ray[1]*depth],room))entry=Math.min(entry,depth);
    }
    return entry;
   });
   if(entries.every(Number.isFinite)){const depth=Math.max(...entries);if(depth>1.5&&depth<=4)depths.add(depth);}
  }
  return [...depths].sort((a,b)=>a-b);
 };
 const pairAllowed=(a:DirectoryRoom,b:DirectoryRoom)=>{
  const af=floorSupport.get(a.key),bf=floorSupport.get(b.key),sa=sectionFor(a),sb=sectionFor(b);
  return isHallway(a)&&isHallway(b)&&(isStairArea(a)||isStairArea(b))&&a.levelId===b.levelId&&roomBuilding(a)===roomBuilding(b)&&!!sa&&sa===sb&&!!af&&!!bf&&Number.isFinite(af.elevationFeet)&&Number.isFinite(bf.elevationFeet)&&Math.abs(af.elevationFeet-bf.elevationFeet)<=.05&&af.floors.length>0&&bf.floors.length>0;
 };
 const crossesOutside=(line:readonly [RoomPoint,RoomPoint],bridge:RoomPoint[],aperture:RoomPoint[])=>{
  const [p,q]=line,dx=q[0]-p[0],dy=q[1]-p[1],ts=[0,1];
  for(const polygon of [bridge,aperture])for(let i=0;i<polygon.length;i++){
   const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,ex=b[0]-a[0],ey=b[1]-a[1],den=dx*ey-dy*ex;if(Math.abs(den)<1e-10)continue;
   const ax=a[0]-p[0],ay=a[1]-p[1],t=(ax*ey-ay*ex)/den,u=(ax*dy-ay*dx)/den;
   if(t>=0&&t<=1&&u>=0&&u<=1)ts.push(t);
  }
  ts.sort((a,b)=>a-b);
  for(let i=1;i<ts.length;i++){if(ts[i]!-ts[i-1]!<1e-9)continue;const t=(ts[i]!+ts[i-1]!)/2,point:RoomPoint=[p[0]+dx*t,p[1]+dy*t];if(containsRoomPoint(point,bridge)&&!containsRoomPoint(point,aperture))return true;}
  return false;
 };
 const exactFloors=[...floorSupport.values()].flatMap(s=>s.floors);
 return recoverDoorOwnership(rooms,reviews,{...geometry,floors:exactFloors},onReview,{depths:depthsFor,eligiblePair:pairAllowed,
  additionalProof:(a,b,footprint,review)=>{
   for(const room of [a,b]){let uncovered=footprint;for(const floor of floorSupport.get(room.key)!.floors){uncovered=pc.difference(uncovered,floor);if(!uncovered.length)break;}if(area(uncovered)>1e-8)return 'The stair approach is not fully supported by both exact same-height native floor profiles.';}
   const section=sectionFor(a)!;
   const swingSegments=registeredDoubleDoorSwingSegments(section,review.door);
   if(section.wallSegments.some((line,index)=>!swingSegments.has(index)&&crossesOutside(line,footprint[0]![0]! as RoomPoint[],review.door.footprint!)))return 'A registered source wall crosses the stair approach outside the native aperture.';
   return undefined;
  },proofFields:(a,_b,review)=>({sourceDoorSymbolSegmentIndices:[...registeredDoubleDoorSwingSegments(sectionFor(a)!,review.door)],sourceSha256:reference.sourceSha256,sourceSectionId:sectionFor(a)!.sectionId,sourceRegistrationErrorFeet:sectionFor(a)!.registrationErrorFeet})});
}
