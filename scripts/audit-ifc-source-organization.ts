#!/usr/bin/env node
/** Reopen ordinary/source-metadata exports of the same actual RVT bytes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { IfcAPI, IFCSITE, IFCGEOMETRICREPRESENTATIONCONTEXT, IFCSPATIALZONE, IFCSPACE, IFCRELAGGREGATES, IFCRELREFERENCEDINSPATIALSTRUCTURE, IFCBUILDINGSTOREY, IFCBUILDING } from "web-ifc";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { enrichConvertResultWithStandardsReader, type RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import { readNativeSpatialCategoryEvidence } from "../lib/reviter/native-spatial-categories.ts";
import { buildNativeSpatialOrganization, NATIVE_SPATIAL_ORGANIZATION_CLASSES, type NativeSpatialOrganization } from "../lib/reviter/native-spatial-organization.ts";
import { sourceIfcCoordinateMetadata } from "../lib/reviter/export-ifc-source-organization.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { nativeIfcGlobalIds } from "../lib/reviter/ifc-global-id.ts";
const [path, output] = process.argv.slice(2); if (!path || !output) throw new Error("Usage: audit-ifc-source-organization.ts model.rvt report.json");
const bytes = new Uint8Array(readFileSync(path));
const loader = async () => { const wasm = await import("../lib/rvt-wasm/rvt.js"); await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) }); return wasm as unknown as RvtWasmModule; };
const result = convertRvtBytes(bytes, basename(path)); if (!result.ok) throw new Error(result.error);
await enrichConvertResultWithStandardsReader(result, bytes, loader);
const evidence = await readNativeSourceEvidence(bytes, {selectedClasses:[...NATIVE_SPATIAL_ORGANIZATION_CLASSES],maxRecords:2048}, loader);
const inventory = evidence.spatialOrganization ?? buildNativeSpatialOrganization(evidence, readNativeSpatialCategoryEvidence(bytes, evidence));
(result as typeof result & {nativeSpatialOrganization:NativeSpatialOrganization}).nativeSpatialOrganization = inventory;
const sourceMeshDigest = () => {
  const hash = createHash("sha256"); for (const mesh of result.meshes) for (const buffer of [mesh.positions,mesh.indices,mesh.colors,mesh.elementIds]) if (buffer) hash.update(new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength)); return hash.digest("hex");
};
const inputMeshSha = sourceMeshDigest();
const ordinary = makeIfc(result), expanded = makeIfc(result, {includeSourceSpatial:true,sourceCoordinateMetadata:true});
const api = new IfcAPI(); await api.Init();
function reopen(source: string) {
  const model = api.OpenModel(new TextEncoder().encode(source), {COORDINATE_TO_ORIGIN:false}); if (model < 0) throw new Error("IFC reopen failed");
  const owners = new Map<string, {globalId:string;triangles:number;hash:string}>();
  api.StreamAllMeshes(model, mesh => {
    const owner = api.GetLine(model,mesh.expressID), key = owner.Tag?.value ?? `global:${owner.GlobalId?.value ?? "anonymous"}`, chunks:string[] = []; let triangles=0;
    for(let p=0;p<mesh.geometries.size();p++) {
      const placed=mesh.geometries.get(p), m=placed.flatTransformation, geometry=api.GetGeometry(model,placed.geometryExpressID);
      try { const vertices=api.GetVertexArray(geometry.GetVertexData(),geometry.GetVertexDataSize()),indices=api.GetIndexArray(geometry.GetIndexData(),geometry.GetIndexDataSize());
        const xyz=(index:number)=>{const x=vertices[index*6],y=vertices[index*6+1],z=vertices[index*6+2];return[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]].map(v=>Math.round(v*1e6)).join(",");};
        const faces:string[]=[];for(let i=0;i<indices.length;i+=3)faces.push([xyz(indices[i]),xyz(indices[i+1]),xyz(indices[i+2])].join(";"));triangles+=indices.length/3;chunks.push(`${JSON.stringify(placed.color)}:${faces.sort().join("|")}`);
      }finally{geometry.delete();}
    }
    if(owners.has(String(key)))throw new Error("Duplicate independently reopened geometry owner");owners.set(String(key),{globalId:owner.GlobalId?.value,triangles,hash:createHash("sha256").update(chunks.sort().join("\n")).digest("hex")});
  });return{model,owners};
}
const before=reopen(ordinary),after=reopen(expanded),mismatches:string[]=[];
for(const[key,value]of before.owners)if(JSON.stringify(value)!==JSON.stringify(after.owners.get(key)))mismatches.push(key);
for(const key of after.owners.keys())if(!before.owners.has(key))mismatches.push(key);
const guids=nativeIfcGlobalIds(result.nativeIdentity?.identities??[]), nativeByGuid=new Map([...guids].map(([id,guid])=>[guid,id]));
const products=[];
for(const type of [IFCSPATIALZONE,IFCSPACE]){const ids=api.GetLineIDsWithType(after.model,type);for(let i=0;i<ids.size();i++){const row=api.GetLine(after.model,ids.get(i));if(row.ObjectType?.value!=='RevitArea'&&row.ObjectType?.value!=='RevitMEPSpace')continue;const elementId=nativeByGuid.get(row.GlobalId.value);products.push({expressId:row.expressID,elementId,globalId:row.GlobalId.value,type:api.GetNameFromTypeCode(row.type),objectType:row.ObjectType.value,representation:row.Representation,placement:row.ObjectPlacement});}}
let sourceParentChecks=0;const sourceParentDisagreements:number[]=[];
for(const product of products){const source=inventory.spatialElements.find(r=>r.elementId===String(product.elementId))!;const relations=[];const expectedType=product.type==='IFCSPATIALZONE'?IFCRELREFERENCEDINSPATIALSTRUCTURE:IFCRELAGGREGATES;const ids=api.GetLineIDsWithType(after.model,expectedType);for(let i=0;i<ids.size();i++){const relation=api.GetLine(after.model,ids.get(i)),members=relation.RelatedElements??relation.RelatedObjects;if(members?.some((r:{value:number})=>r.value===product.expressId))relations.push(relation);}sourceParentChecks++;if(relations.length!==1){sourceParentDisagreements.push(product.elementId!);continue;}const parent=api.GetLine(after.model,(relations[0].RelatingStructure??relations[0].RelatingObject).value),levelId=Number(source.levelId),expectedLevel=result.levels.some(l=>l.levelId===levelId)?levelId:null;if(expectedLevel===null?parent.type!==IFCBUILDING:parent.type!==IFCBUILDINGSTOREY||parent.GlobalId?.value!==guids.get(expectedLevel))sourceParentDisagreements.push(product.elementId!);}
const site=api.GetLine(after.model,api.GetLineIDsWithType(after.model,IFCSITE).get(0)),ctx=api.GetLine(after.model,api.GetLineIDsWithType(after.model,IFCGEOMETRICREPRESENTATIONCONTEXT).get(0)),north=ctx.TrueNorth?api.GetLine(after.model,ctx.TrueNorth.value).DirectionRatios.map((v:{value:number})=>v.value):null;
const parsed=await new IfcParser().parseColumnar(new TextEncoder().encode(expanded).buffer);
let independentlyRecoveredSpatial=0,sourcePropertyDisagreements=0;
for(const id of parsed.entities.expressId){if(!['IfcSpatialZone','IfcSpace'].includes(parsed.entities.getTypeName(id)))continue;const pset=extractPropertiesOnDemand(parsed,id).find(s=>s.name==='Reviter_SourceSpatial');if(!pset)continue;independentlyRecoveredSpatial++;const sourceId=pset.properties.find(p=>p.name==='NativeElementId')?.value;if(!inventory.spatialElements.some(r=>r.elementId===sourceId)||pset.properties.find(p=>p.name==='CertifiedForRouting')?.value!==false)sourcePropertyDisagreements++;}
const coordinates=sourceIfcCoordinateMetadata(inventory,result.sourceSha256),proof = {sourceSha256:result.sourceSha256,inputByteSha256:createHash('sha256').update(bytes).digest('hex'),sourceStatus:inventory.status,spatialKinds:inventory.spatialElements.reduce<Record<string,number>>((a,r)=>(a[r.kind]=(a[r.kind]??0)+1,a),{}),sourceCoordinatesStatus:inventory.coordinates.status,ordinaryIfcBytes:Buffer.byteLength(ordinary),expandedIfcBytes:Buffer.byteLength(expanded),sourceMeshSha256:inputMeshSha,postExportSourceMeshSha256:sourceMeshDigest(),geometryOwnersBefore:before.owners.size,geometryOwnersAfter:after.owners.size,independentlyReopenedGeometryMismatches:mismatches,sourceSpatialProducts:products,sourceParentChecks,sourceParentDisagreements,independentSchema:parsed.schemaVersion,independentlyRecoveredSpatial,sourcePropertyDisagreements,siteLatitude:site.RefLatitude?.value??null,siteLongitude:site.RefLongitude?.value??null,trueNorth:north,expectedSourceTrueNorth:coordinates?.northStep??null,projectedCrsEmitted:/IFCPROJECTEDCRS\(|IFCMAPCONVERSION\(/.test(expanded),limitations:['Identity-only source zones/spaces have no body, placement, quantity or access certification.','Metamorphic geometry comparison reopens both outputs using web-ifc and compares transformed oriented triangles/materials rounded to one micrometre; it does not compare either output to Revit geometry.']};
api.CloseModel(before.model);api.CloseModel(after.model);api.Dispose();writeFileSync(output,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({output,products:products.length,geometryMismatches:mismatches.length,sourcePropertyDisagreements,north}));if(mismatches.length||sourcePropertyDisagreements||sourceParentDisagreements.length||proof.sourceMeshSha256!==proof.postExportSourceMeshSha256||proof.projectedCrsEmitted||products.some(p=>p.elementId===undefined||p.representation!==null||p.placement!==null)||independentlyRecoveredSpatial!==products.length)process.exitCode=1;
