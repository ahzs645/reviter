import type {CadStairAssumptions} from './dwg-stair-assumptions.ts';
import type {CadFloorSurfaces} from './dwg-floor-surfaces.ts';
import pc from 'polygon-clipping';
import {cadPathReviewRegions} from './dwg-path-regions.ts';
import type {CadDrawingPaths} from './dwg-drawing-paths.ts';
import {cadDoorDisplayStrokes} from './dwg-door-display.ts';
import { ShapeUtils, Vector2 } from 'three';
import type { analyzeCadFloors } from './dwg-floor-analysis.ts';

type Point = [number, number];
type Rings = Point[][];
type Footprint = {id:string;ringsMetres:Rings};
type DrawingFloor = {
 id:string;buildingCode:string;name:string;
 primitives:{pointsMetres:Point[];sourceHandle?:string;type?:string}[];wallCandidates:Footprint[];
 regions:{roomKey:string;number:string;name:string;ringsMetres:Rings;sharedRoomKeys:string[]}[];
 doors:{id?:string;arcHandle?:string;widthMetres?:number;supportingWallHandles?:string[];closedLeafMetres:Point[];arcHandles?:string[];leafHandles?:string[];leafSegmentsMetres?:Point[][]}[];
 stairs:{treads:{pointsMetres:Point[]}[]}[];stairAreas:Footprint[];
};
export type CadSceneFloor = {
 id:string;name:string;ordinal:number;alignmentStatus:string;
 walls:Float32Array;source:Float32Array;abstractSource:Float32Array;doors:Float32Array;treads:Float32Array;stairs:Float32Array;
 regions:{roomKey:string;title:string;shared:boolean;positions:Float32Array}[];
 surfaces:{id:string;roomKey:string;title:string;positions:Float32Array;openingEdges:Float32Array;reason:string;remainingReview:string[]}[];
 doorSymbols:{id:string;handle:string;widthMetres:number;supportingWallHandles:string[];positions:Float32Array}[];
 bounds:[number,number,number,number];
};
export type CadBuildingScene = {
 code:string;floors:CadSceneFloor[];
 sourceSha256:string;geometrySha256:string;
 links:{id:string;fromFloorId:string;toFloorId:string;from:Point;to:Point;status:string;overlapRatio:number}[];
 assumptionWarnings:string[];
 assumedLinks:{id:string;family:string;fromFloorId:string;toFloorId:string;from:Point;to:Point;missingIntermediateOrdinals:number[];reason:string}[];
 stairFamilies:{family:string;status:string;missingDrawingOrdinals:number[]}[];
 evidenceNotes:string[];
};
export type CadBuildingEvidence = {
 format:'reviter-cad-building-evidence';version:1;sourceSha256:string;geometrySha256:string;
 documents:{path:string;sha256:string;title:string}[];
 buildings:{code:string;notes:string[];floorLabels:{floorId:string;label:string}[]}[];
};

/** Triangulate only recovered polygons. Inner rings are real drawing holes. */
export function cadPolygonTriangles(rings:Rings, transform:(p:Point)=>Point, height=0):number[] {
 const clean=rings.map(r=>{
  if(r.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new Error('Non-finite CAD footprint.');
  const points=r.map(transform);
  if(points.length>1&&points[0]![0]===points.at(-1)![0]&&points[0]![1]===points.at(-1)![1])points.pop();
  return points.map(p=>new Vector2(...p));
 });
 if(!clean[0]||clean[0].length<3)return [];
 const triangles=ShapeUtils.triangulateShape(clean[0],clean.slice(1));
 const points=clean.flat();
 return triangles.flatMap(t=>t.flatMap(i=>{const p=points[i]!;return [p.x,height,-p.y];}));
}

/** Worker-only review mesh preparation. Nothing is applied to source/native geometry. */
export function buildCadBuildingScenes(geometry:{floors:DrawingFloor[];sourceSha256?:string},analysis:ReturnType<typeof analyzeCadFloors>&{geometrySha256?:string},evidence?:CadBuildingEvidence|null,paths?:CadDrawingPaths|null,assumptions?:CadStairAssumptions|null,surfaceReview?:CadFloorSurfaces|null):CadBuildingScene[] {
 const reports=new Map(analysis.floors.map(f=>[f.id,f]));
 const transforms=new Map(analysis.floors.map(f=>[f.id,(p:Point):Point=>{
  const t=f.additionalTransform;return [t.a*p[0]+t.c*p[1]+t.e,t.b*p[0]+t.d*p[1]+t.f];
 }]));
 const centroids=new Map<string,Point>();
 const floors=geometry.floors.map(f=>{
  const report=reports.get(f.id),project=transforms.get(f.id);
  if(!report||!project)throw new Error('Missing CAD building floor alignment.');
  const bounds:[number,number,number,number]=[Infinity,Infinity,-Infinity,-Infinity];
  const lines=(polylines:Point[][],y:number)=>{
   const out:number[]=[];
   for(const points of polylines)for(let i=1;i<points.length;i++)for(const point of [points[i-1]!,points[i]!]){
    if(!point.every(Number.isFinite))throw new Error('Non-finite CAD source stroke.');
    const p=project(point);out.push(p[0],y,-p[1]);
    bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);
   }
   return new Float32Array(out);
  };
  const abstractSource=lines(cadDoorDisplayStrokes(f,false),.018);
  const source=lines(f.primitives.map(p=>p.pointsMetres),.018);
  const walls:number[]=[];
  for(const w of f.wallCandidates){
   walls.push(...cadPolygonTriangles(w.ringsMetres,project,2.7));
   for(const ring of w.ringsMetres)for(let i=0;i<ring.length;i++){
    const a=project(ring[i]!),b=project(ring[(i+1)%ring.length]!);
    walls.push(a[0],0,-a[1],b[0],0,-b[1],b[0],2.7,-b[1],a[0],0,-a[1],b[0],2.7,-b[1],a[0],2.7,-a[1]);
   }
  }
  const painted=new Set<string>();
  const pathFloor=paths?.floors.find(p=>p.id===f.id);
  const reviewed=surfaceReview?.surfaces.filter(s=>s.floorId===f.id)??[];
  const protectedHoles=reviewed.flatMap(s=>s.ringsMetres.slice(1).map(h=>[h]));
  const surfaces=reviewed.map(s=>({id:s.id,roomKey:s.roomKey,title:s.title,positions:new Float32Array(cadPolygonTriangles(pathFloor?.cells.find(c=>c.roomKeys.includes(s.roomKey))?.ringsMetres??s.ringsMetres,project)),openingEdges:lines(s.ringsMetres.slice(1),.03),reason:s.reason,remainingReview:s.remainingReview}));
  const reviewedRooms=new Set(reviewed.flatMap(s=>pathFloor?.cells.find(c=>c.roomKeys.includes(s.roomKey))?.roomKeys??[s.roomKey]));
  const regions=(pathFloor?cadPathReviewRegions(f.regions,pathFloor):f.regions).flatMap(r=>{
   if(reviewedRooms.has(r.roomKey))return [];
   const key=JSON.stringify(r.ringsMetres);if(!r.ringsMetres.length||painted.has(key))return [];
   painted.add(key);const polygons=protectedHoles.length?pc.difference(r.ringsMetres,...protectedHoles):[r.ringsMetres];return polygons.map(p=>({roomKey:r.roomKey,title:r.number+' · '+r.name,shared:r.sharedRoomKeys.length>1,positions:new Float32Array(cadPolygonTriangles(p,project))}));
  });
  const stairs:number[]=[];
  for(const a of f.stairAreas){const triangles=cadPolygonTriangles(a.ringsMetres,project,.025);stairs.push(...triangles);
   // Use a point inside an actual triangle, never an area bounding-box centre in a hole.
   if(triangles.length>=9)centroids.set(a.id,[(triangles[0]!+triangles[3]!+triangles[6]!)/3,-(triangles[2]!+triangles[5]!+triangles[8]!)/3]);
  }
  const doorPlanes:number[]=[],doorSymbols:CadSceneFloor['doorSymbols']=[];
  for(const d of f.doors){if(d.closedLeafMetres.length<2)continue;const a=project(d.closedLeafMetres[0]!),b=project(d.closedLeafMetres.at(-1)!);
   const positions=[a[0],0,-a[1],b[0],0,-b[1],b[0],2.1,-b[1],a[0],0,-a[1],b[0],2.1,-b[1],a[0],2.1,-a[1]];doorPlanes.push(...positions);
   doorSymbols.push({id:d.id??'door-'+doorSymbols.length,handle:d.arcHandle??'unassigned',widthMetres:d.widthMetres??Math.hypot(a[0]-b[0],a[1]-b[1]),supportingWallHandles:d.supportingWallHandles??[],positions:new Float32Array(positions)});
  }
  const label=evidence?.buildings.find(b=>b.code===f.buildingCode)?.floorLabels.find(l=>l.floorId===f.id)?.label;
  return {code:f.buildingCode,floor:{id:f.id,name:label?label+' · '+f.name:f.name,ordinal:report.ordinal,alignmentStatus:report.alignment.status,
   walls:new Float32Array(walls),source,abstractSource,regions,surfaces,doorSymbols,stairs:new Float32Array(stairs),doors:new Float32Array(doorPlanes),
   treads:lines(f.stairs.flatMap(s=>s.treads.map(t=>t.pointsMetres)),.045),bounds} satisfies CadSceneFloor};
 });
 return [...new Set(floors.map(f=>f.code))].map(code=>{
  const levels=floors.filter(f=>f.code===code).map(f=>f.floor).sort((a,b)=>a.ordinal-b.ordinal);
  const ordinals=new Map(levels.map(f=>[f.id,f.ordinal]));
  return {code,floors:levels,sourceSha256:geometry.sourceSha256??'unbound',geometrySha256:analysis.geometrySha256??'unbound',evidenceNotes:evidence?.buildings.find(b=>b.code===code)?.notes??[],links:analysis.candidates.flatMap((c,i)=>{
   const from=centroids.get(c.fromAreaId),to=centroids.get(c.toAreaId);
   if(c.buildingCode!==code||!from||!to||ordinals.get(c.toFloorId)!-ordinals.get(c.fromFloorId)!!==1)return [];
   return [{id:'cad-comparison-'+i,fromFloorId:c.fromFloorId,toFloorId:c.toFloorId,from,to,status:c.alignmentStatus,overlapRatio:c.overlapRatio}];
  }),assumptionWarnings:(assumptions?.unresolved??[]).filter(u=>analysis.stairFamilies.some(f=>f.buildingCode===code&&f.family===u.family)).map(u=>u.family+' · '+u.fromFloorId+' ↔ '+u.toFloorId+': '+u.reason),assumedLinks:(assumptions?.connections??[]).filter(c=>c.buildingCode===code).map(c=>({id:c.id,family:c.family,fromFloorId:c.fromFloorId,toFloorId:c.toFloorId,from:transforms.get(c.fromFloorId)!(c.fromPointMetres),to:transforms.get(c.toFloorId)!(c.toPointMetres),missingIntermediateOrdinals:c.missingIntermediateOrdinals,reason:c.reason})),stairFamilies:analysis.stairFamilies.filter(f=>f.buildingCode===code).map(f=>({family:f.family,status:f.status,missingDrawingOrdinals:f.missingDrawingOrdinals}))};
 });
}
