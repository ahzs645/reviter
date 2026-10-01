import pc from "polygon-clipping";
import {architecturalPlanGeometry} from "./architectural-plan.ts";
import {floorPlateRecords} from "./export-svg.ts";
import {boundaryFaces, type BoundaryReference, type BoundarySegment} from "./room-boundaries.ts";
import {cleanRoomBoundary, containsDirectoryRoomPoint, containsRoomPoint, isHallway, nearestRoomBoundary, roomArea, roomBuilding, validRoomBoundary, type DirectoryRoom, type RoomPoint} from "./room-directory.ts";
import type {ConvertResult} from "./types.ts";

const edges = (ps: RoomPoint[]): BoundarySegment[] => ps.map((p,i)=>[p,ps[(i+1)%ps.length]!]);
// Survey/native coordinates have sub-micron discrepancies at shared vertices.
const rounded = (ps: readonly RoomPoint[]): RoomPoint[] => ps.map(p=>p.map(v=>Math.round(v*1e5)/1e5) as RoomPoint);

/** Recover only the bounded, unlabelled survey face containing the selected point.
 * A campus slab is support evidence, never a building ownership boundary. */
export function recoverUnassignedCirculation(model: ConvertResult, rooms: readonly DirectoryRoom[], reference: BoundaryReference | undefined, selection: {building:string;levelId:number;point:RoomPoint}): {room?:DirectoryRoom;reason?:string} {
  const {building,levelId,point}=selection,level=model.levels.find(l=>l.levelId===levelId);
  const active=rooms.filter(r=>r.status!=="deleted"&&r.levelId===levelId);
  if(active.some(r=>containsDirectoryRoomPoint(point,r)))return {reason:"This location already belongs to an annotated area."};
  if(!level||!reference)return {reason:"A registered wall plan and this level’s native floor are required."};
  if(!model.nativeAssociatedLevelRelations?.length)return {reason:"Persisted model level relationships are unavailable; review this boundary manually."};
  const sections=reference.sections.filter(s=>{
    if(s.levelId!==levelId||s.registrationErrorFeet>.1||!active.some(r=>roomBuilding(r)===building&&r.dwg?.sectionId===s.sectionId&&r.dwg.sha256===reference.sourceSha256))return false;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const segment of s.wallSegments)for(const p of segment){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
    return point[0]>=minX&&point[0]<=maxX&&point[1]>=minY&&point[1]<=maxY;
  });
  const assigned=floorPlateRecords(model,levelId);
  const unassigned=model.elementBounds.filter(r=>r.categoryId===-2000032&&!model.nativeAssociatedLevelRelations?.some(a=>a.elementId===r.elementId));
  const slabs=[...assigned,...unassigned].filter(r=>Math.abs(r.boundsFeet.max.z-level.elevation)<.1&&(r.loops?.length??0)>0);
  const supported=slabs.filter(r=>{const loops=r.loops!.map(l=>l.map(p=>[p[0],p[1]] as RoomPoint));return containsRoomPoint(point,loops[0]!)&&!loops.slice(1).some(h=>containsRoomPoint(point,h));});
  if(!supported.length)return {reason:"No native floor at this level supports the picked location. A void or another elevation cannot be filled."};
  const outlines=active.flatMap(r=>edges(r.polygonFeet));
  const faces=sections.flatMap(section=>boundaryFaces([...section.wallSegments,...section.doorSegments,...outlines]).filter(f=>f.signedArea>0&&containsRoomPoint(point,f.polygon)).map(f=>({...f,section}))).sort((a,b)=>a.signedArea-b.signedArea);
  // Enclosed annotated islands are subtracted below, including their holes.
  const face=faces.find(f=>f.signedArea*.092903<=500);
  if(!face)return {reason:"No small, unlabelled region is enclosed by the registered plan and existing area boundaries here. Review its boundary manually."};
  const geometry=architecturalPlanGeometry(model,levelId);
  // Preserve source holes too: an unlabelled island may be a fixture or a drop.
  const xs=face.polygon.map(p=>p[0]),ys=face.polygon.map(p=>p[1]);
  const bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  const intersects=(ps:readonly RoomPoint[])=>Math.min(...ps.map(p=>p[0]))<=bounds[2]!&&Math.max(...ps.map(p=>p[0]))>=bounds[0]!&&Math.min(...ps.map(p=>p[1]))<=bounds[3]!&&Math.max(...ps.map(p=>p[1]))>=bounds[1]!;
  // Keep annotated coordinates exact so the recovered outline shares their
  // edges. Rounding both sides independently leaves hairline false boundaries.
  const obstacles=[...active.filter(r=>intersects(r.polygonFeet)).map(r=>[r.polygonFeet]),...geometry.walls.filter(w=>intersects(w.polygon)).map(w=>[rounded(w.polygon)]),...geometry.columns.filter(c=>intersects(c.polygon)).map(c=>[rounded(c.polygon)])];
  for(const slab of supported){
    try {
      const native=slab.loops!.map(l=>rounded(l.map(p=>[p[0],p[1]] as RoomPoint)));
      const polygons=pc.difference(pc.intersection([face.polygon],native),...obstacles) as RoomPoint[][][];
      const polygon=polygons.find(ps=>containsRoomPoint(point,ps[0]!)&&!ps.slice(1).some(h=>containsRoomPoint(point,h)));
      if(!polygon)continue;
      const polygonFeet=cleanRoomBoundary(polygon[0]!),holesFeet=polygon.slice(1).map(cleanRoomBoundary);
      if(!validRoomBoundary(polygonFeet)||holesFeet.some(h=>!validRoomBoundary(h)))continue;
      const area=roomArea(polygonFeet)-holesFeet.reduce((sum,h)=>sum+roomArea(h),0);
      if(area<8)continue;
      const neighbours=active.filter(r=>roomBuilding(r)===building&&isHallway(r)&&r.walkability!=="void"&&polygonFeet.some((p,i)=>{const q=polygonFeet[(i+1)%polygonFeet.length]!,mid:RoomPoint=[(p[0]+q[0])/2,(p[1]+q[1])/2];return nearestRoomBoundary(mid,r.polygonFeet).distance<.01;}));
      if(neighbours.length<2)continue;
      return {room:{key:`circulation:${building}:${levelId}:${slab.elementId}:${Math.round(point[0]*100)}:${Math.round(point[1]*100)}`,building,levelId,name:"Recovered circulation",polygonFeet,holesFeet,labelPointFeet:point,confidence:.8,status:"active",modelSurface:{kind:"circulation",elementId:slab.elementId,levelId,elevationFeet:slab.boundsFeet.max.z},source:{polygon:"registered-plan-and-native-floor",name:"reviewed-model-surface"},boundaryReview:{method:"registered-plan-and-native-floor",sectionId:face.section.sectionId,sourceSha256:reference.sourceSha256,nativeLevelAssociation:assigned.some(r=>r.elementId===slab.elementId)?"model-associated":"unassigned-elevation-match",neighbourRoomKeys:neighbours.map(r=>r.key),notes:"Previously unlabelled circulation enclosed by registered walls and existing area boundaries, supported by native floor geometry at this level’s elevation. Existing room outlines, source islands, native slab holes, walls and columns are excluded. No room number or door was invented."}}};
    } catch { /* Numerical or invalid source geometry requires manual review. */ }
  }
  return {reason:"The enclosed area could not be recovered with native obstacles preserved and two adjoining circulation areas. Review the boundary manually."};
}
