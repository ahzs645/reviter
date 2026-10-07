import {validateCadCirculationReview,cadInterpretedGeometry,type CadCirculationReview} from './dwg-circulation-review.ts';
import {validateCadStairAssumptions,type CadStairAssumptions} from './dwg-stair-assumptions.ts';
import {validateCadFloorSurfaces,validateCadSurfacePaths,type CadFloorSurfaces} from './dwg-floor-surfaces.ts';
import {validateCadDrawingPaths,type CadDrawingPaths} from './dwg-drawing-paths.ts';
import { unzipSync, strFromU8 } from "fflate";
import type { analyzeCadFloors } from "./dwg-floor-analysis.ts";
import type { CadBuildingEvidence } from './dwg-building-scene.ts';

/** Route by central-directory names only; the CAD worker still validates all evidence. */
export function isCadReviewArchive(bytes: Uint8Array): boolean {
  const names = new Set<string>();
  unzipSync(bytes, { filter: entry => { names.add(entry.name); return false; } });
  // A declared model project always goes through the strict project importer.
  return !names.has("manifest.json") && ["checksums.json", "geometry.json", "floor-analysis.json", "intake.json"].every(name => names.has(name));
}

/** Only source-bound JSON is imported. Never execute the package's HTML. */
export async function readCadReviewPackage(bytes: Uint8Array) {
  if(bytes.byteLength>256*1024*1024) throw new Error("CAD ZIP exceeds 256 MB.");
  const names=new Set(["checksums.json","geometry.json","floor-analysis.json","coverage-audit.json","intake.json","building-evidence.json","drawing-paths.json","stair-assumptions.json","floor-surfaces.json","circulation-review.json"]);
  let selectedBytes=0;
  const files=unzipSync(bytes,{filter:f=>{if(!names.has(f.name))return false;
    if((selectedBytes+=f.originalSize)>256*1024*1024||f.originalSize>160*1024*1024) throw new Error("CAD review file exceeds 160 MB.");return true;}});
  const read=(name:string)=>{if(!files[name])throw new Error("Missing CAD review file: "+name);return JSON.parse(strFromU8(files[name]!));};
  const manifest=read("checksums.json");
  const digest=async(data:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(data).buffer))).map(b=>b.toString(16).padStart(2,"0")).join("");
  for(const name of names){if(name==="checksums.json"||!files[name])continue;
    if(await digest(files[name]!)!==manifest[name])throw new Error("CAD file checksum changed: "+name);}
  const geometry=read("geometry.json"),analysis=read("floor-analysis.json"),intake=read("intake.json");
  if(geometry.format!=="openindoormaps-cad-geometry"||geometry.version!==1||analysis.format!=="reviter-cad-floor-analysis"||analysis.version!==1
    ||intake.format!=="openindoormaps-cad-intake"||[geometry,analysis,intake].some(v=>v.appliedToNativeGeometry!==false||!Array.isArray(v.graphEdges)||v.graphEdges.length))
    throw new Error("Expected a separate drawing-only Reviter CAD review ZIP.");
  if(analysis.geometrySha256!==await digest(files['geometry.json']!)||analysis.intakeSha256!==await digest(files['intake.json']!)
    ||analysis.sourceSha256!==geometry.sourceSha256||intake.sourceSha256!==geometry.sourceSha256)throw new Error("CAD evidence binding mismatch.");
  if(!Array.isArray(intake.sourceFiles)||!intake.sourceFiles.length)throw new Error('Original drawing identities are missing.');
  const sourceNames=new Set<string>(intake.sourceFiles.map((f:{name:string})=>{
    if(typeof f.name!=='string'||/[\\/]/.test(f.name))throw new Error('Invalid drawing filename.');return 'source/'+f.name;
  }));
  if(intake.conversionEvidence?.floorDxfSha256)sourceNames.add('stage/floorplans.dxf');
  const evidence:CadBuildingEvidence|null=files['building-evidence.json']?read('building-evidence.json'):null;
  if(evidence){
    if(evidence.format!=='reviter-cad-building-evidence'||evidence.version!==1||evidence.sourceSha256!==geometry.sourceSha256||evidence.geometrySha256!==analysis.geometrySha256
      ||!Array.isArray(evidence.documents)||!Array.isArray(evidence.buildings)||evidence.documents.some(d=>!/^evidence\/[\w .-]+\.pdf$/.test(d.path)||typeof d.sha256!=='string')
      ||evidence.buildings.some(b=>!Array.isArray(b.notes)||b.notes.some(n=>typeof n!=='string')||!Array.isArray(b.floorLabels)
        ||!geometry.floors.some((f:{buildingCode:string})=>f.buildingCode===b.code)
        ||b.floorLabels.some(l=>typeof l.label!=='string'||!geometry.floors.some((f:{buildingCode:string;id:string})=>f.buildingCode===b.code&&f.id===l.floorId))))throw new Error('Building supporting evidence does not match these drawings.');
    evidence.documents.forEach(d=>sourceNames.add(d.path));
  }
  const sources=unzipSync(bytes,{filter:f=>{if(!sourceNames.has(f.name))return false;
    if(f.originalSize>160*1024*1024)throw new Error('Source drawing exceeds 160 MB.');
    if((selectedBytes+=f.originalSize)>256*1024*1024)throw new Error('CAD source and review files exceed the total 256 MB import limit.');return true;}});
  for(const f of intake.sourceFiles){const name='source/'+f.name;
    if(!sources[name]||await digest(sources[name]!)!==f.sha256)throw new Error('Original drawing checksum changed: '+name);}
  for(const d of evidence?.documents??[])if(!sources[d.path]||await digest(sources[d.path]!)!==d.sha256)throw new Error('Supporting document checksum changed: '+d.path);
  if(intake.conversionEvidence?.floorDxfSha256&&(!sources['stage/floorplans.dxf']||await digest(sources['stage/floorplans.dxf']!)!==intake.conversionEvidence.floorDxfSha256))
    throw new Error('Converted drawing checksum changed.');
  if(!Array.isArray(geometry.floors)||!geometry.floors.length||geometry.floors.length>200||!Array.isArray(analysis.floors)
    ||new Set(geometry.floors.map((f:{id:string})=>f.id)).size!==geometry.floors.length
    ||geometry.floors.some((f:{id:string})=>!analysis.floors.some((r:{id:string})=>r.id===f.id)))throw new Error("Inconsistent CAD floor identities.");
  const circulation:CadCirculationReview|null=files['circulation-review.json']?validateCadCirculationReview(read('circulation-review.json'),geometry,analysis.geometrySha256):null;
  const interpreted=cadInterpretedGeometry(geometry,circulation);
  const paths:CadDrawingPaths|null=files['drawing-paths.json']?validateCadDrawingPaths(read('drawing-paths.json'),interpreted,geometry.sourceSha256,analysis.geometrySha256):null;
  if(circulation){if(!paths||paths.circulationReviewSha256!==await digest(files['circulation-review.json']!))throw new Error('Regenerated circulation path binding is missing.');}
  else if(paths?.circulationReviewSha256)throw new Error('Circulation review evidence is missing.');
  const surfaces:CadFloorSurfaces|null=files['floor-surfaces.json']?validateCadFloorSurfaces(read('floor-surfaces.json'),geometry,analysis.geometrySha256):null;
  if(surfaces){if(!paths)throw new Error('Reviewed floor surfaces require regenerated path evidence.');validateCadSurfacePaths(surfaces,paths,await digest(files['floor-surfaces.json']!),geometry);}
  else if(paths?.floorSurfacesSha256)throw new Error('Drawing path surface evidence is missing.');
  const assumptions:CadStairAssumptions|null=files['stair-assumptions.json']?validateCadStairAssumptions(read('stair-assumptions.json'),geometry,analysis):null;
  return {circulation,originalGeometry:geometry,surfaces,assumptions,paths,geometry:interpreted,analysis:analysis as ReturnType<typeof analyzeCadFloors>&{geometrySha256:string;sourceSha256:string},coverage:files['coverage-audit.json']?read('coverage-audit.json'):null,evidence};
}
