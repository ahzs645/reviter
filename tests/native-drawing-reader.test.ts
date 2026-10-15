import assert from "node:assert/strict";
import test from "node:test";
import { readNativeDrawingEvidence, type NativeSourceEvidence, type NativeEvidenceOptions } from "../lib/reviter/native-evidence-reader.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
const sha="a".repeat(64), id=(n:number)=>({m_id:{m_id64:n}});
function record(className:string,elementId:number,fields:Record<string,unknown>,children:Record<string,unknown>[]=[]){
 return {class_name:className,status:"complete_bounded_graph",diagnostic:null,identity:{element_id:elementId},source:{stream:"Partitions/1",group_record_offset:elementId,body_bytes:500,body_sha256:sha},graph:{consumed_bytes:500,objects:[{class_name:className,class_tag:10,start:2,fields_end:200,fields:{m_id:id(elementId),...fields}},...children],edges:className==="TextNote"?[{source_object_index:0,pointer_offset:100,pointer_token:1,target_class_tag:20,target_object_index:1}]:[]}};
}
function source(records:unknown[]):NativeSourceEvidence{return {apiVersion:1,kind:"native-source-evidence",status:"complete",summary:{revit_version:2025,schema_sha256:sha,classes:{}},diagnostics:{retainedRecords:records.length},records};}
const view=()=>source([record("DBViewPlan",45,{m_isTemplate:false,m_viewName:"Level",m_origin:[0,0,0],m_horzDir:[1,0,0],m_vertDir:[0,1,0],m_viewDir:[0,0,1],m_scale:.01,m_explicitlyHiddenElements:[]})]);
const annotation=()=>source([record("TextNote",50,{m_ownerDBViewId:id(45),m_orig:[1,2,3],m_baseVec:[1,0,0],m_upVec:[0,1,0],m_oSavedRtfData:{class_tag:20,offset:100,pointer_token:1}},[{class_name:"RtfData",class_tag:20,token:1,start:200,fields_end:500,fields:{m_arrRtfStream:[...new TextEncoder().encode('{\\rtf1\\ansi\\fs28 source text}')]}}])]);
function mock(pass:NativeSourceEvidence[]){const calls:{bytes:Uint8Array;options:NativeEvidenceOptions}[]=[];return {calls,loader:async()=>({default:async()=>{},openNativeEvidence:(bytes:Uint8Array,options:NativeEvidenceOptions)=>{calls.push({bytes:bytes.slice(),options});return structuredClone(pass[calls.length-1]);}}) as unknown as RvtWasmModule};}

test("drawing reader selects frame first, then bounded annotations, and rebuilds source indices/adapters",async()=>{
 const loader=mock([view(),annotation()]), bytes=new Uint8Array([1,2,3]);
 const report=await readNativeDrawingEvidence(bytes,"45",loader.loader);
 assert.equal(loader.calls.length,2);assert.deepEqual(loader.calls[0].options,{selectedIds:["45"],selectedClasses:[],maxRecords:1});
 assert.deepEqual(loader.calls[1].options.selectedClasses,["TextNote","IndependentTag","RoomTag","AreaTag"]);
 assert.equal(loader.calls[1].options.maxRecords,2048);assert.equal(loader.calls[1].options.maxDecodedRecords,4096);assert.equal(loader.calls[1].options.maxOutputBytes,64*1024*1024);
 assert.deepEqual(loader.calls[0].bytes,loader.calls[1].bytes);
 assert.equal(report.recordInventory?.records[1].rawRecordIndex,1);
 assert.equal(report.drawingPreview?.primitives[0].rawRecordIndex,1);
 assert.equal(report.drawingPreview?.primitives[0].text,"source text");
 assert.ok(report.parameterInventory);assert.ok(report.scheduleInventory);assert.ok(report.spatialOrganization);
 assert.equal(report.source.status,"complete");
 assert.equal((report.source.diagnostics as {sameByteSchemaContext:boolean}).sameByteSchemaContext,true);
});

test("partial annotation selection remains explicitly partial after a valid frame merge",async()=>{
 const annotations=annotation();annotations.status="partial";annotations.diagnostics={droppedRecords:17};
 const report=await readNativeDrawingEvidence(new Uint8Array([1]),"45",mock([view(),annotations]).loader);
 assert.equal(report.source.status,"partial");assert.equal(report.drawingPreview?.sourceSelection.status,"partial");
 assert.match(report.drawingPreview?.diagnostics.join(" ")??"",/outside retained records/);
});

test("wrong schema/release contexts are rejected and never merged",async()=>{
 for(const mismatch of [{revit_version:2024},{schema_sha256:"b".repeat(64)}]){
  const annotations=annotation();annotations.summary={...(annotations.summary as Record<string,unknown>),...mismatch};
  await assert.rejects(readNativeDrawingEvidence(new Uint8Array([1]),"45",mock([view(),annotations]).loader),/contexts disagree/);
 }
});

test("budget-blocked or unsupported annotation passes retain failure context and cannot render the earlier frame",async()=>{
 for(const status of ["budget-blocked","unsupported"] as const){
  const annotations=annotation();annotations.status=status;annotations.summary=null;
  const report=await readNativeDrawingEvidence(new Uint8Array([1]),"45",mock([view(),annotations]).loader);
  assert.equal(report.source.status,status);assert.equal(report.source.records.length,1);assert.equal(report.drawingPreview?.svg,null);
  assert.equal(report.recordInventory?.records.length,0);
 }
});

test("missing/template/unsupported native views stop before annotation scanning; invalid IDs stop before loading",async()=>{
 const absent=mock([source([])]);assert.equal((await readNativeDrawingEvidence(new Uint8Array([1]),"45",absent.loader)).drawingPreview?.svg,null);assert.equal(absent.calls.length,1);
 const template=view();((template.records[0] as {graph:{objects:{fields:Record<string,unknown>}[]}}).graph.objects[0].fields).m_isTemplate=true;
 const templated=mock([template]);assert.equal((await readNativeDrawingEvidence(new Uint8Array([1]),"45",templated.loader)).drawingPreview?.svg,null);assert.equal(templated.calls.length,1);
 const blocked=view();blocked.status="budget-blocked";blocked.summary=null;
 const budget=mock([blocked]);assert.equal((await readNativeDrawingEvidence(new Uint8Array([1]),"45",budget.loader)).source.status,"budget-blocked");assert.equal(budget.calls.length,1);
 const invalid=mock([]);for(const viewId of ["0","-1","01","1.2","18446744073709551616"]){await assert.rejects(readNativeDrawingEvidence(new Uint8Array([1]),viewId,invalid.loader),/positive exact/);}
 assert.equal(invalid.calls.length,0);
});
