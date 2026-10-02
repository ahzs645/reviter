import { routingFloorPlateRecords } from "../../lib/reviter/routing-floor-support.ts";
import type {LocalBuildingConnection} from "../../lib/reviter/building-transitions.ts";
import polygonClipping from "polygon-clipping";
import {directoryStairFootprints,isStairArea,type DirectoryStairFootprint,type UpperStairContext} from "../../lib/reviter/directory-stair-geometry.ts";
import type {BuildingConnection} from "../../lib/reviter/building-connections.ts";
import type { OpenPassage } from "../../lib/reviter/directory-openings.ts";
import * as THREE from "three";
import type { Bounds3, ConvertResult } from "../../lib/reviter/types.ts";
import { containsRoomPoint, isHallway, isWalkable, type DirectoryRoom, type RoomPoint, type RoomPortal } from "../../lib/reviter/room-directory.ts";
import { connectedFloorPlanGroup } from "../../lib/reviter/connected-floor-plans.ts";
import { floorPlateRecords } from "../../lib/reviter/export-svg.ts";
import { directoryAreas, connectedCirculationAreas, type DirectoryArea, type AreaMetadata, type AreaRelationship } from "../../lib/reviter/directory-areas.ts";

export type DirectoryModelFloor = {
  levelId: number;
  /** A reviewed campus storey can contain several unchanged native levels. */
  levelIds?: number[];
  cutBaseElevation?: number;
  suggestedCutHeight?: number;
  upperStairContext?:readonly UpperStairContext[];
  title: string;
  elevation: number;
  elevationSource: string;
  rooms: readonly DirectoryRoom[];
  selectedKey: string | null;
  boundsFeet: Bounds3;
  roomElevations: Record<string, {elevation: number; levelId: number; evidence: string}>;
  areas: DirectoryArea[];
  areaMetadata?: Record<string, AreaMetadata>;
  portals?: readonly RoomPortal[];
  openings?: readonly OpenPassage[];
  connectedCirculation?: boolean;
  areaRelationships?: readonly AreaRelationship[];
  primaryBuilding?:string;
  buildingConnections?:readonly BuildingConnection[];
  localBuildingConnections?:readonly LocalBuildingConnection[];
  stairFootprints?:readonly DirectoryStairFootprint[];
};

export function directoryModelFloor(result: Pick<ConvertResult, "levels"> & Partial<ConvertResult>, rooms: readonly DirectoryRoom[], levelId: number, selectedKey: string | null): DirectoryModelFloor | null {
  const level = result.levels.find(l => l.levelId === levelId);
  const floorRooms = rooms.filter(r => r.levelId === levelId && r.status !== "deleted");
  if (!level || !Number.isFinite(level.elevation) || !floorRooms.length) return null;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const room of floorRooms) for (const [x,y] of room.polygonFeet) {
    minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  }
  const roomElevations: DirectoryModelFloor["roomElevations"] = {};
  let minElevation=level.elevation;
  if (result.elementBounds) {
    const model=result as ConvertResult;
    const group=connectedFloorPlanGroup(model,levelId);
    const slabs=model.nativeAssociatedLevelRelations?.length
      ? (group?.levelIds ?? [levelId]).flatMap(id=>floorPlateRecords(model,id).map(record=>({record,levelId:id})))
      : [];
    const physical = routingFloorPlateRecords(model, level.elevation).map(record => ({record, levelId}));
    const known = new Set(slabs.map(s => s.record.elementId));
    slabs.push(...physical.filter(s => !known.has(s.record.elementId)));
    for (const room of floorRooms) {
      const candidates=slabs.filter(({record})=>{
        const {min,max}=record.boundsFeet; const p=room.labelPointFeet;
        if (p[0]<min.x || p[0]>max.x || p[1]<min.y || p[1]>max.y) return false;
        const loops=(record.loops ?? []).map(loop=>loop.map(p=>[p[0],p[1]] as [number,number]));
        return !!loops[0] && containsRoomPoint(p,loops[0]) && !loops.slice(1).some(h=>containsRoomPoint(p,h));
      }).sort((a,b)=>Math.abs(a.record.boundsFeet.max.z-level.elevation)-Math.abs(b.record.boundsFeet.max.z-level.elevation));
      const candidate=candidates[0];
      if (candidate) {
        const elevation=candidate.record.boundsFeet.max.z;
        roomElevations[room.key]={elevation,levelId:candidate.levelId,evidence:`Recovered slab #${candidate.record.elementId}`};
        minElevation=Math.min(minElevation,elevation);
      }
    }
  }
  for (const room of floorRooms) roomElevations[room.key] ??= {elevation:level.elevation,levelId,evidence:"Room level; slab match needs review"};
  return {
    levelId, title: [...new Set(floorRooms.map(r => r.dwg?.sectionId).filter(Boolean))].join(" · ") || level.name || `Level ${levelId}`,
    elevation: level.elevation, elevationSource: level.elevationSource === "level-element" ? "Revit level" : "Inferred from model geometry",
    stairFootprints:directoryStairFootprints(result,floorRooms),
    rooms: floorRooms, selectedKey, roomElevations, areas: directoryAreas(floorRooms, roomElevations),
    boundsFeet: {min: {x: minX - 8, y: minY - 8, z: minElevation - 2}, max: {x: maxX + 8, y: maxY + 8, z: level.elevation + 4}},
  };
}

/** Assemble native floors for display; areas, placements and native IDs remain unchanged. */
export function directoryModelStorey(result: Pick<ConvertResult,"levels"> & Partial<ConvertResult>, rooms: readonly DirectoryRoom[], levelIds: readonly number[], selectedKey: string|null, title: string): DirectoryModelFloor|null {
  const floors=levelIds.map(id=>directoryModelFloor(result,rooms,id,selectedKey)).filter((f):f is DirectoryModelFloor=>!!f);
  if(!floors.length)return null;
  const first=floors[0]!;
  return {...first,title,levelIds:floors.map(f=>f.levelId),cutBaseElevation:Math.max(...floors.map(f=>f.elevation)),elevationSource:"Campus storey · native elevations retained",
    rooms:floors.flatMap(f=>f.rooms),areas:floors.flatMap(f=>f.areas),roomElevations:Object.assign({},...floors.map(f=>f.roomElevations)),stairFootprints:floors.flatMap(f=>f.stairFootprints??[]),
    boundsFeet:{min:{x:Math.min(...floors.map(f=>f.boundsFeet.min.x)),y:Math.min(...floors.map(f=>f.boundsFeet.min.y)),z:Math.min(...floors.map(f=>f.boundsFeet.min.z))},max:{x:Math.max(...floors.map(f=>f.boundsFeet.max.x)),y:Math.max(...floors.map(f=>f.boundsFeet.max.y)),z:Math.max(...floors.map(f=>f.boundsFeet.max.z))}}};
}

/** Keep both native elevations inside the 3D section box without merging their levels. */
export function withLocalBuildingContext(floor:DirectoryModelFloor,connections:readonly LocalBuildingConnection[]):DirectoryModelFloor {
  const min={...floor.boundsFeet.min},max={...floor.boundsFeet.max};
  for(const c of connections){min.x=Math.min(min.x,c.bounds[0]);min.y=Math.min(min.y,c.bounds[1]);max.x=Math.max(max.x,c.bounds[2]);max.y=Math.max(max.y,c.bounds[3]);min.z=Math.min(min.z,...c.endpoints.map(e=>e.elevation-2));}
  return {...floor,boundsFeet:{min,max},localBuildingConnections:connections};
}

export function directoryRoomColor(room: DirectoryRoom, selected = false): string {
  if (!isWalkable(room)) return "#c47086";
  if (selected) return "#a7dcd7";
  if ((room.source as {polygon?: string} | undefined)?.polygon === "native-floor-connection") return "#b9def7";
  return isHallway(room) ? "#d7eee3" : "#dfe9f0";
}

/** Shared circulation still lets reviewers focus one stair source and its real flight. */
export function directoryRoomFocusPoints(floor: DirectoryModelFloor, room: DirectoryRoom): RoomPoint[] {
  const upper=(floor.upperStairContext??[]).filter(c=>c.roomKeys.includes(room.key)).flatMap(c=>c.treads.flatMap(t=>t.polygon));
  if(isStairArea(room))return [...upper,...room.polygonFeet,...(floor.stairFootprints??[]).filter(f=>f.roomKey===room.key).flatMap(f=>f.polygons.flatMap(p=>p[0]!))];
  return [...upper,...(floor.areas.find(a=>a.roomKeys.includes(room.key))?.polygons.flatMap(p=>p[0]!)??room.polygonFeet)];
}

/** A section box in the recovered model's translated, Z-up coordinate frame. */
export function directoryFloorPlanes(floor: DirectoryModelFloor, origin: ConvertResult["origin"], cutHeight: number): THREE.Plane[] {
  const {min, max} = floor.boundsFeet;
  return [
    new THREE.Plane(new THREE.Vector3(1,0,0), origin.x-min.x),
    new THREE.Plane(new THREE.Vector3(-1,0,0), max.x-origin.x),
    new THREE.Plane(new THREE.Vector3(0,1,0), origin.y-min.y),
    new THREE.Plane(new THREE.Vector3(0,-1,0), max.y-origin.y),
    new THREE.Plane(new THREE.Vector3(0,0,1), origin.z-min.z),
    new THREE.Plane(new THREE.Vector3(0,0,-1), (floor.cutBaseElevation??floor.elevation)+cutHeight-origin.z),
  ];
}

/** Flat review surfaces, preserving concavity and enclosed holes; these are not native room volumes. */
export function landingWithoutTreads(polygons: DirectoryRoom["polygonFeet"][][], treads: readonly DirectoryRoom["polygonFeet"][][][]) {
  // Imported drawing and native tread edges differ at floating-point precision.
  // Snap only the temporary clipping inputs to a millionth of a foot, avoiding
  // cyclic ring nesting at coincident edges. Original review coordinates stay intact.
  const snap = (shape: DirectoryRoom["polygonFeet"][][]) => shape.map(p=>p.map(r=>r.map(([x,y])=>[Math.round(x*1e6)/1e6,Math.round(y*1e6)/1e6] as RoomPoint)));
  return polygonClipping.difference(snap(polygons),...treads.map(snap)) as DirectoryRoom["polygonFeet"][][];
}

export function directoryRoomGroup(floor: DirectoryModelFloor, origin: ConvertResult["origin"], selectedKey: string | null, reverseDepthBuffer = false): THREE.Group {
  const group = new THREE.Group();
  const context = floor.connectedCirculation ? connectedCirculationAreas(floor.areas, floor.portals??[], selectedKey,floor.areaRelationships,floor.openings) : new Set<string>();
  for (const area of floor.areas) {
    const room = floor.rooms.find(r=>r.key===area.roomKeys[0])!;
    const ring = (points: DirectoryRoom["polygonFeet"]) => points.map(p=>new THREE.Vector2(p[0]-origin.x,p[1]-origin.y));
    const active = !!selectedKey && area.roomKeys.includes(selectedKey);
    const steps=(floor.stairFootprints??[]).filter(f=>area.roomKeys.includes(f.roomKey));
    // Steps below this floor replace its flat fill. An overhead flight does not
    // remove the landing beneath it; its elevated surfaces occlude that fill naturally.
    const below=steps.flatMap(f=>f.treads).filter(t=>t.elevation<=(floor.roomElevations[room.key]?.elevation??floor.elevation)+.15);
    const polygons=below.length?landingWithoutTreads(area.polygons,below.map(t=>t.polygons)):area.polygons;
    for (const polygon of polygons) {
    const shape = new THREE.Shape(ring(polygon[0]!));
    shape.holes = polygon.slice(1).map(h=>new THREE.Path(ring(h)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({color: floor.primaryBuilding&&area.building!==floor.primaryBuilding?"#d9c8ee":directoryRoomColor(area.kind!=="room"?{...room,name:area.kind==="atrium"?"Atrium":"Corridor"}:room,active||context.has(area.key)), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: reverseDepthBuffer ? 2 : -2, polygonOffsetUnits: reverseDepthBuffer ? 2 : -2}));
    mesh.position.z = (floor.roomElevations[room.key]?.elevation ?? floor.elevation)-origin.z + .15;
    mesh.userData.roomKey = active ? selectedKey : room.key;
    mesh.userData.areaKey = area.key;
    const outline = new THREE.Group();
    for (const points of polygon) {
      const geometry = new THREE.BufferGeometry().setFromPoints([...points,points[0]!].map(p=>new THREE.Vector3(p[0]-origin.x,p[1]-origin.y,mesh.position.z+.025)));
      const uncertain = area.roomKeys.some(key=>(floor.rooms.find(r=>r.key===key)?.confidence??1)<.75);
      const line = new THREE.Line(geometry, uncertain ? new THREE.LineDashedMaterial({color: 0xbc852b, dashSize: .7, gapSize: .4}) : new THREE.LineBasicMaterial({color: active ? 0x087d7b : 0x425569}));
      if (uncertain) line.computeLineDistances();
      outline.add(line);
    }
    const flightUnrecovered=area.kind==="room"&&isStairArea(room)&&room.stairAccess!=="local-only"&&!steps.some(f=>f.sourceOverlap!==false);
    if (area.walkability === "void" || flightUnrecovered&&!room.floorOpeningsFeet?.length) {
      mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
      outline.userData.areaKey = area.key; outline.userData.roomKey = room.key;
      outline.userData.walkability = area.walkability;
      outline.userData.flightUnrecovered = flightUnrecovered;
      if(flightUnrecovered)outline.traverse(o=>{if(o instanceof THREE.Line)(o.material as THREE.LineBasicMaterial).color.set("#bc852b");});
      else outline.traverse(o => {if (o instanceof THREE.Line) (o.material as THREE.LineBasicMaterial).color.set("#b94c6f");});
      group.add(outline);
    } else group.add(mesh,outline);
    }
  }
  for(const f of floor.stairFootprints??[])for(const tread of f.treads)for(const polygon of tread.polygons){
    const shape=new THREE.Shape(polygon[0]!.map(p=>new THREE.Vector2(p[0]-origin.x,p[1]-origin.y)));
    shape.holes=polygon.slice(1).map(h=>new THREE.Path(h.map(p=>new THREE.Vector2(p[0]-origin.x,p[1]-origin.y))));
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:tread.localToStorey?"#d7eee3":"#bba6df",side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:reverseDepthBuffer?2:-2,polygonOffsetUnits:reverseDepthBuffer?2:-2}));
    mesh.position.z=tread.elevation-origin.z+.15;mesh.userData.roomKey=f.roomKey;mesh.userData.areaKey=`room:${f.roomKey}`;mesh.userData.stairTreadElementId=tread.elementId;mesh.userData.localToStorey=tread.localToStorey;group.add(mesh);
  }
  for(const c of floor.upperStairContext??[])for(const t of c.treads){
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([...t.polygon,t.polygon[0]!].map(p=>new THREE.Vector3(p[0]-origin.x,p[1]-origin.y,t.elevation-origin.z+.2))),new THREE.LineDashedMaterial({color:0x79579e,dashSize:.4,gapSize:.25}));
    line.computeLineDistances();line.userData.upperStairContext=true;line.userData.stairElementId=c.stairElementId;line.userData.runId=t.runId;group.add(line);
  }
  for(const c of floor.buildingConnections??[]){
    const p=c.door.portal!,z=c.elevation-origin.z+.3;
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.from,p.point,p.to].map(v=>new THREE.Vector3(v[0]-origin.x,v[1]-origin.y,z))),new THREE.LineBasicMaterial({color:0x8054be}));
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.65,12,8),new THREE.MeshBasicMaterial({color:0x8054be}));dot.position.set(p.point[0]-origin.x,p.point[1]-origin.y,z);
    dot.userData.buildingConnectionDoorId=p.doorId;line.userData.buildingConnectionDoorId=p.doorId;group.add(line,dot);
  }
  for(const c of floor.localBuildingConnections??[]){
    const addSurface=(polygon:DirectoryRoom["polygonFeet"][],z:number,color:string,elementId:number)=>{
      const shape=new THREE.Shape(polygon[0]!.map(p=>new THREE.Vector2(p[0]-origin.x,p[1]-origin.y)));
      shape.holes=polygon.slice(1).map(h=>new THREE.Path(h.map(p=>new THREE.Vector2(p[0]-origin.x,p[1]-origin.y))));
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
      mesh.position.z=z-origin.z+.06;mesh.userData.localBuildingConnectionId=c.report.id;mesh.userData.nativeSurfaceElementId=elementId;group.add(mesh);
    };
    for(const s of c.surfaces)for(const polygon of s.polygons)addSurface(polygon,s.elevation,"#d7eee3",s.elementId);
    for(const t of c.treads)addSurface([t.polygon],t.elevation,"#d7eee3",t.elementId);
    if(c.surfaceSupported){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.samples.map(s=>new THREE.Vector3(s.point[0]-origin.x,s.point[1]-origin.y,s.elevation-origin.z+.25))),new THREE.LineBasicMaterial({color:0x087d7b}));line.userData.localBuildingConnectionId=c.report.id;group.add(line);}
  }
  return group;
}
