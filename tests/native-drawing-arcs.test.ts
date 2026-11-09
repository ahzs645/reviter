import assert from "node:assert/strict";
import test from "node:test";
import { makeNativeDrawingSvg } from "../lib/reviter/native-drawing-svg.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
const sha="a".repeat(64),id=(n:number)=>({m_id:{m_id64:n}});
function fixture(flags=0x01080004,range:[number,number]=[0,Math.PI/2]):NativeEvidenceReport{
 const record=(className:string,elementId:number,fields:Record<string,unknown>,children:Record<string,unknown>[]=[],edges:Record<string,unknown>[]=[])=>({class_name:className,status:"complete_bounded_graph",diagnostic:null,identity:{element_id:elementId},source:{stream:"Partitions/1",group_record_offset:elementId,body_bytes:1000,body_sha256:sha},graph:{consumed_bytes:1000,objects:[{class_name:className,class_tag:10,start:2,fields_end:200,fields:{m_id:id(elementId),...fields}},...children],edges}});
 return {sourceSha256:sha,readerCommit:"1c3d337dbd2a6810e9dfad68fe99857843d67387",readerPatch:"native-evidence",scope:"test",source:{apiVersion:1,kind:"native-source-evidence",status:"complete",diagnostics:{},summary:{revit_version:2025,schema_sha256:sha},records:[
  record("DBViewPlan",45,{m_isTemplate:false,m_origin:[0,0,0],m_horzDir:[1,0,0],m_vertDir:[0,1,0],m_viewDir:[0,0,1]}),
  record("CurveElem",50,{m_ownerDBViewId:id(45),m_detail:true,m_useOffsetPos:false,m_pCurveDriver:{class_tag:20,offset:150,pointer_token:1}},[
   {class_name:"CurveElemDriver",class_tag:20,token:1,start:200,fields_end:300,fields:{m_flip:false,m_pCrv:{class_tag:30,offset:220,pointer_token:2}}},
   {class_name:"GArc",class_tag:30,token:2,start:300,fields_end:500,fields:{m_GInfo:{m_flags:flags},m_center:[3,4,0],m_xVec:[1,0,0],m_yVec:[0,1,0],m_radius:2,m_endParams:range,m_bFilled:false}},
  ],[{source_object_index:0,pointer_offset:150,pointer_token:1,target_class_tag:20,target_object_index:1},{source_object_index:1,pointer_offset:220,pointer_token:2,target_class_tag:30,target_object_index:2}]),
 ]}};
}
const nodes=(r:NativeEvidenceReport)=>(r.source.records[1] as {graph:{objects:{fields:Record<string,unknown>}[];edges:Record<string,unknown>[]}}).graph;
test("bounded native GArc emits exact SVG arc with native handedness and pointer witnesses",()=>{
 const output=makeNativeDrawingSvg(fixture(),{viewId:"45"});assert.equal(output.status,"partial");assert.equal(output.primitives.length,1);
 const arc=output.primitives[0];assert.equal(arc.kind,"source-detail-arc");assert.deepEqual(arc.curve?.storedIntervalRadians,[0,Math.PI/2]);
 assert.ok(output.svg?.includes('d="M 5 -4 A 2 2 0 0 0 3 -6"'));
 assert.ok(arc.sourceFields.includes("storedArcFlags"));assert.equal(arc.recordSource.bodySha256,sha);assert.equal(arc.rawRecordIndex,1);
 for(const p of arc.pointsFeet)assert.ok(Math.abs(Math.hypot(p[0]-3,p[1]-4)-2)<1e-12);
 const reverse=fixture();nodes(reverse).objects[2].fields.m_yVec=[0,-1,0];assert.ok(makeNativeDrawingSvg(reverse,{viewId:"45"}).svg?.includes('d="M 5 -4 A 2 2 0 0 1 3 -2"'));
});
test("periodic circle requires exact RE100 tag plus zero stored range; bounded full turn uses two arcs",()=>{
 const circle=makeNativeDrawingSvg(fixture(0x00080004,[0,0]),{viewId:"45"});assert.equal(circle.primitives[0].kind,"source-detail-circle");assert.ok(circle.svg?.includes('data-kind="source-detail-circle" cx="3" cy="-4" r="2"'));
 assert.deepEqual(circle.primitives[0].curve?.storedIntervalRadians,[0,0]);assert.deepEqual(circle.primitives[0].curve?.evaluatedIntervalRadians,[0,2*Math.PI]);
 const bounded=makeNativeDrawingSvg(fixture(0x01080004,[0,2*Math.PI]),{viewId:"45"});assert.equal(bounded.primitives[0].kind,"source-detail-arc");assert.equal((bounded.svg?.match(/ A 2 2 /g)??[]).length,2);
 for(const [flag,range]of [[0x00080004,[0,Math.PI/2]],[0x01080004,[0,0]],[0x01080004,[0,3*Math.PI]],[1,[0,0]]] as [number,[number,number]][]){assert.equal(makeNativeDrawingSvg(fixture(flag,range),{viewId:"45"}).svg,null);}
});
test("unowned arc pointers, filled/offset/flipped curves and non-planar bases remain unresolved",()=>{
 for(const mutate of [
  (r:NativeEvidenceReport)=>{nodes(r).edges[1].pointer_token=99;},
  (r:NativeEvidenceReport)=>{nodes(r).objects[2].fields.m_bFilled=true;},
  (r:NativeEvidenceReport)=>{nodes(r).objects[1].fields.m_flip=true;},
  (r:NativeEvidenceReport)=>{nodes(r).objects[0].fields.m_useOffsetPos=true;},
  (r:NativeEvidenceReport)=>{nodes(r).objects[2].fields.m_yVec=[0,0,1];},
  (r:NativeEvidenceReport)=>{nodes(r).objects[2].fields.m_radius=-1;},
  (r:NativeEvidenceReport)=>{delete nodes(r).objects[2].fields.m_GInfo;},
 ]){const input=fixture();mutate(input);assert.equal(makeNativeDrawingSvg(input,{viewId:"45"}).svg,null);}
});
