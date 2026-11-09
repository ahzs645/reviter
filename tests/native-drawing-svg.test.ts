import assert from "node:assert/strict";
import test from "node:test";
import { extractNativeRtfPlainText, listNativeDrawingViews, makeNativeDrawingSvg } from "../lib/reviter/native-drawing-svg.ts";
import { buildNativeRecordInventory } from "../lib/reviter/native-record-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
const sha = "a".repeat(64);
const id = (n: number) => ({m_id:{m_id64:n}});
const bytes = (s: string) => [...new TextEncoder().encode(s)];
function fixture(): NativeEvidenceReport {
  const record = (className:string, elementId:number, fields:Record<string,unknown>, children:Record<string,unknown>[] = [], edges:Record<string,unknown>[] = []) => ({
    class_name:className, status:"complete_bounded_graph", diagnostic:null, identity:{element_id:elementId},
    source:{stream:"Partitions/1",group_record_offset:elementId,body_bytes:1000,body_sha256:sha},
    graph:{consumed_bytes:1000,objects:[{class_name:className,class_tag:10,start:2,fields_end:200,fields:{m_id:id(elementId),...fields}},...children],edges},
  });
  return { sourceSha256:sha,readerCommit:"1c3d337dbd2a6810e9dfad68fe99857843d67387",readerPatch:"native-evidence",scope:"test",source:{apiVersion:1,kind:"native-source-evidence",status:"complete",diagnostics:{},summary:{revit_version:2025,schema_sha256:sha},records:[
    record("DBViewPlan",312,{m_viewName:"<Level & 1>",m_isTemplate:false,m_origin:[10,20,30],m_horzDir:[0,1,0],m_vertDir:[0,0,1],m_viewDir:[1,0,0],m_scale:.01,m_explicitlyHiddenElements:[]}),
    record("TextNote",500,{m_ownerDBViewId:id(312),m_orig:[10,23,35],m_baseVec:[0,1,0],m_upVec:[0,0,1],m_oSavedRtfData:{class_tag:20,offset:100,pointer_token:1},m_leaders:[{class_tag:21,offset:150,pointer_token:2}]},[
      {class_name:"RtfData",class_tag:20,token:1,start:200,fields_end:600,fields:{m_arrRtfStream:bytes("{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}\\fs28 <script> & note\\par second}")}},
      {class_name:"Leader",class_tag:21,token:2,start:600,fields_end:900,fields:{m_anchor:[10,23,35],m_elbow:[10,21,34],m_end:[10,20,32],m_bStraight:true}},
    ],[{source_object_index:0,pointer_offset:100,pointer_token:1,target_class_tag:20,target_object_index:1},{source_object_index:0,pointer_offset:150,pointer_token:2,target_class_tag:21,target_object_index:2}]),
    record("LinearDimString",600,{m_ownerDBViewId:id(312),m_pDimLine:{class_tag:30,offset:180,pointer_token:3},m_ArrSegInfo:[{m_origin:[10,20,30],m_lockedValue:4,m_values:[{m_value:4},{m_value:-1}]}]},[
      {class_name:"GLine",class_tag:30,token:3,start:200,fields_end:500,fields:{m_origin:[10,20,30],m_dirVec:[0,1,0],m_endParams:[0,0]}},
    ],[{source_object_index:0,pointer_offset:180,pointer_token:3,target_class_tag:30,target_object_index:1}]),
  ]}};
}
const records = (r:NativeEvidenceReport) => r.source.records as {graph:{objects:{fields:Record<string,unknown>}[];edges:Record<string,unknown>[]}}[];

test("exact native owner frame projects text and straight owned leader with safe SVG text",()=>{
  const report=fixture(), preview=makeNativeDrawingSvg(report,{viewId:"312"});
  assert.equal(preview.status,"partial");assert.ok(preview.svg?.includes('points="3,-5 1,-4 0,-2"'));
  assert.ok(preview.svg?.includes('translate(3 -5) rotate(0)'));
  assert.ok(preview.svg?.includes('&lt;script&gt; &amp; note'));
  assert.ok(!preview.svg?.includes('<script>'));
  assert.deepEqual(preview.renderedElementIds,["500"]);
  assert.equal(preview.primitives[1].text,"<script> & note\nsecond");
  assert.equal(preview.omitted[0].elementId,"600");
  assert.match(preview.diagnostics[0],/crop boundaries/);
  assert.equal(listNativeDrawingViews(report)[0].name,"<Level & 1>");
});

test("wrong view owners and explicit hidden IDs cannot appear in drawing output",()=>{
  const input=fixture();records(input)[1].graph.objects[0].fields.m_ownerDBViewId=id(313);
  assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).svg,null);
  records(input)[1].graph.objects[0].fields.m_ownerDBViewId=id(312);
  records(input)[0].graph.objects[0].fields.m_explicitlyHiddenElements=[id(500)];
  const result=makeNativeDrawingSvg(input,{viewId:"312"});assert.equal(result.svg,null);assert.match(result.omitted[0].reason,/hidden/);
});

test("incomplete context and non-orthonormal, mirrored or template frames are refused",()=>{
  for (const mutate of [
    (r:NativeEvidenceReport)=>{r.sourceSha256=null;},
    (r:NativeEvidenceReport)=>{r.readerCommit="changed";},
    (r:NativeEvidenceReport)=>{records(r)[0].graph.objects[0].fields.m_horzDir=[0,2,0];},
    (r:NativeEvidenceReport)=>{records(r)[0].graph.objects[0].fields.m_viewDir=[-1,0,0];},
    (r:NativeEvidenceReport)=>{records(r)[0].graph.objects[0].fields.m_isTemplate=true;},
  ]){const input=fixture();mutate(input);assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).svg,null);}
  assert.equal(makeNativeDrawingSvg(fixture(),{viewId:"0"}).svg,null);
});

test("unowned leader, curved leader and unbounded dimension lines are withheld",()=>{
  const input=fixture();records(input)[1].graph.edges[1].pointer_token=8;
  assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).primitives.some(p=>p.kind==="straight-leader"),false);
  const curved=fixture();records(curved)[1].graph.objects[2].fields.m_bStraight=false;
  assert.equal(makeNativeDrawingSvg(curved,{viewId:"312"}).primitives.some(p=>p.kind==="straight-leader"),false);
  const dimension=fixture();records(dimension)[2].graph.objects[1].fields.m_endParams=[-1,2];
  const preview=makeNativeDrawingSvg(dimension,{viewId:"312"});
  assert.deepEqual(preview.primitives.find(p=>p.kind==="bounded-dimension-line")?.pointsFeet,[[10,19,30],[10,22,30]]);
  assert.equal(buildNativeRecordInventory(dimension).records[2].values.segment0StoredValue1.value,-1);
});

test("RTF Unicode, escape, destination, depth and byte budgets do not evaluate content",()=>{
  const plain=extractNativeRtfPlainText(bytes("{\\rtf1\\ansi\\ansicpg1252{\\fonttbl Hidden font;}\\fs28 A\\u945? \\'ae\\par \\{x\\}\\\\{\\*\\unknown SECRET}{\\field HIDDEN}}"));
  assert.equal(plain.text,"Aα ®\n{x}\\");assert.equal(plain.firstFontSizeHalfPoints,28);
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1\\v hidden\\v0 visible}')).text,"visible");
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1\\upr{double text}}')).text,null);
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1\\bin2 XX}')).text,null);
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1\\ansicpg932 x}')).text,null);
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1 unbalanced')).text,null);
  assert.equal(extractNativeRtfPlainText(bytes('{\\rtf1 '+"{".repeat(70)+"}".repeat(70)+'}')).text,null);
  assert.equal(extractNativeRtfPlainText(new Array(262145).fill(65)).text,null);
});

test("tag heads and host/link references require the entire owned cell/pointer path",()=>{
  const input=fixture();const tagged=input.source.records[1] as {class_name:string;graph:{objects:Record<string,unknown>[];edges:Record<string,unknown>[]}};
  tagged.class_name="IndependentTag";
  tagged.graph.objects=[
    {class_name:"IndependentTag",class_tag:10,start:2,fields_end:200,fields:{m_id:id(500),m_ownerDBViewId:id(312),m_oTagOrientationCell:{class_tag:40,pointer_token:5,offset:100},m_cellList:{class_tag:41,pointer_token:6,offset:150}}},
    {class_name:"TagOrientationCell",class_tag:40,token:5,start:200,fields_end:300,fields:{m_headLocation:[10,23,35],m_orientation:0,m_rotationAngle:0}},
    {class_name:"CellList",class_tag:41,token:6,start:300,fields_end:400,fields:{m_cells:[{class_tag:42,pointer_token:7,offset:350}]}},
    {class_name:"TagReferencesWithLeaderCell",class_tag:42,token:7,start:400,fields_end:500,fields:{m_references:[{class_tag:43,pointer_token:8,offset:450}]}},
    {class_name:"TagReferenceWithLeader",class_tag:43,token:8,start:500,fields_end:600,fields:{m_referenceIdKey:{m_hostOrLinkElemId:{m_linkInstOrHostId:id(778),m_linkRef:{m_id64:-1}}},m_isLeaderEnabled:false}},
  ];
  tagged.graph.edges=[
    {source_object_index:0,pointer_offset:100,pointer_token:5,target_class_tag:40,target_object_index:1},
    {source_object_index:0,pointer_offset:150,pointer_token:6,target_class_tag:41,target_object_index:2},
    {source_object_index:2,pointer_offset:350,pointer_token:7,target_class_tag:42,target_object_index:3},
    {source_object_index:3,pointer_offset:450,pointer_token:8,target_class_tag:43,target_object_index:4},
  ];
  const record=buildNativeRecordInventory(input).records[1];
  assert.equal(record.values.reference0_0HostId.value,"778");assert.equal(record.values.reference0_0LinkedId.value,"-1");
  assert.equal(record.values.reference0_0HostId.source.pointerPath.length,3);
  assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).primitives[0].kind,"tag-head-marker");
  tagged.graph.edges[3].pointer_token=99;
  assert.equal(buildNativeRecordInventory(input).records[1].values.reference0_0HostId,undefined);
  assert.equal(buildNativeRecordInventory(input).records[1].values.headLocationFeet.value instanceof Array,true);
});

test("finite detail lines retain driver ownership and require exact view plane, detail and offset gates",()=>{
  const input=fixture();const curve=input.source.records[2] as {class_name:string;graph:{objects:Record<string,unknown>[];edges:Record<string,unknown>[]}};
  curve.class_name="CurveElem";curve.graph.objects=[
    {class_name:"CurveElem",class_tag:10,start:2,fields_end:200,fields:{m_id:id(600),m_ownerDBViewId:id(312),m_detail:true,m_useOffsetPos:false,m_pCurveDriver:{class_tag:31,offset:180,pointer_token:4}}},
    {class_name:"CurveElemDriver",class_tag:31,token:4,start:200,fields_end:300,fields:{m_pCrv:{class_tag:30,offset:220,pointer_token:3}}},
    {class_name:"GLine",class_tag:30,token:3,start:300,fields_end:500,fields:{m_origin:[10,20,30],m_dirVec:[0,1,0],m_endParams:[0,5]}},
  ];curve.graph.edges=[{source_object_index:0,pointer_offset:180,pointer_token:4,target_class_tag:31,target_object_index:1},{source_object_index:1,pointer_offset:220,pointer_token:3,target_class_tag:30,target_object_index:2}];
  let preview=makeNativeDrawingSvg(input,{viewId:"312"});assert.deepEqual(preview.primitives.find(p=>p.kind==="source-detail-line")?.pointsFeet,[[10,20,30],[10,25,30]]);
  assert.equal(buildNativeRecordInventory(input).records[2].values.storedLineOriginFeet.source.pointerPath.length,2);
  const fields=curve.graph.objects[0].fields as Record<string,unknown>;fields.m_detail=false;
  assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).primitives.some(p=>p.kind==="source-detail-line"),false);
  fields.m_detail=true;fields.m_useOffsetPos=true;
  assert.equal(makeNativeDrawingSvg(input,{viewId:"312"}).primitives.some(p=>p.kind==="source-detail-line"),false);
  fields.m_useOffsetPos=false;curve.graph.edges[1].pointer_token=99;
  preview=makeNativeDrawingSvg(input,{viewId:"312"});assert.equal(preview.primitives.some(p=>p.kind==="source-detail-line"),false);
});
