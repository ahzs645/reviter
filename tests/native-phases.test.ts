import assert from "node:assert/strict";
import test from "node:test";
import { collectNativePhaseEvidence, nativePhaseLayout, resolveNativePhaseEvidence } from "../lib/reviter/native-phases.ts";
import type { SchemaStreamClass, SchemaStreamProperty } from "../lib/reviter/schema-reader.ts";
import { parameterEnumName } from "../lib/reviter/revit-enum-tables.ts";

function schema(): SchemaStreamClass[] {
  const property = (name: string, index: number): SchemaStreamProperty => ({
    name, fieldType: index >= 17 ? 1 : 14, variant: { kind: index >= 17 ? "bool" : "object" },
    loadingMode: index <= 7 ? 1 : 0, itemMode: index === 6 ? 5 : 0,
    unknownWord: 0, offset: 0,
    ...([9,10,11,12,13,14,15,16].includes(index) ? { staticType: { kind: "reference", index: 20, name: "ElementId" } as const } : {}),
  });
  const cls = (name: string, index: number, properties: SchemaStreamProperty[], parent = false): SchemaStreamClass => ({
    name, index, version: 1, parent: parent ? { kind: "reference", index: 38, name: "Element" } : { kind: "none" },
    properties, propertyCount: properties.length, guids: [], unknownWord: 0, inline: false, offset: 0, endOffset: 0,
  });
  return [
    cls("Element",38,["m_pParamValueSetDouble","m_pParamValueSetInt","m_pParamValueSetAString","m_pParamValueSetElementId","m_geomSteps","m_pGeomTable","m_constrInfo","m_cellList","m_docAccess","m_id","m_assocLevelId","m_famId","m_unplacedOwnerId","m_ownerDBViewId","m_createdPhaseId","m_demolishedPhaseId","m_designOptionId","m_locked","m_moribund","m_dummy"].map(property)),
    cls("ProjectPhase",3403,["m_name","m_description"].map((name) => ({ ...property(name,8), variant: {kind:"string"},itemMode:6 })),true),
    cls("CellList",784,[{ ...property("m_cells",6), loadingMode:1,itemMode:5 }]),
    cls("Wall",2000,[],true),
  ];
}

function frame(id: number, tag: number, created = -1n, demolished = -1n, name = ""): Uint8Array {
  const size = 176 + name.length * 2, data = new Uint8Array(size + 20), view = new DataView(data.buffer);
  view.setBigUint64(0,BigInt(id),true);view.setUint32(8,0x1234,true);view.setUint32(12,size,true);view.setUint16(16,tag,true);
  // All six leading pointers, constraints, and CellList are null. The schema
  // walk therefore places docAccess at50, m_id54, assocLevel62.
  view.setUint32(50,1,true);view.setBigUint64(54,BigInt(id),true);
  for(let i=0;i<7;i++)view.setBigInt64(62+i*8,-1n,true);
  view.setBigInt64(94,created,true);view.setBigInt64(102,demolished,true);
  view.setUint32(121,name.length,true);for(let i=0;i<name.length;i++)view.setUint16(125+i*2,name.charCodeAt(i),true);
  view.setUint32(size+16,size,true);return data;
}
const location = { stream:"Partitions/1",chunkIndex:3 };

test("phase layout requires measured release and the declared native field order/types", () => {
  assert.ok(nativePhaseLayout(2027,schema()));
  assert.ok(nativePhaseLayout(2024,schema()));
  assert.equal(nativePhaseLayout(2026,schema()),null);
  const reordered=schema();[reordered[0]!.properties[14],reordered[0]!.properties[15]]=[reordered[0]!.properties[15]!,reordered[0]!.properties[14]!];
  assert.equal(nativePhaseLayout(2027,reordered),null);
  const type=schema();type[0]!.properties[14]!.variant={kind:"int32"};assert.equal(nativePhaseLayout(2027,type),null);
});

test("phase names require full frame, native identity, valid UTF16 and phase class", () => {
  const layout=nativePhaseLayout(2027,schema()),ids=new Set([100]);
  const good=frame(100,3403,-1n,-1n,"Existing");
  assert.equal(collectNativePhaseEvidence(good,layout,ids,location).phases[0]!.name,"Existing");
  assert.deepEqual(collectNativePhaseEvidence(good,layout,new Set(),location).phases,[]);
  assert.deepEqual(collectNativePhaseEvidence(frame(100,2000,-1n,-1n,"Looks like phase"),layout,ids,location).phases,[]);
  for(const name of [""," ","bad\nname","\ud800","\ufffd"]) assert.deepEqual(collectNativePhaseEvidence(frame(100,3403,-1n,-1n,name),layout,ids,location).phases,[]);
  const broken=good.slice();broken[broken.length-4]=0;assert.deepEqual(collectNativePhaseEvidence(broken,layout,ids,location).phases,[]);
  const wrongId=good.slice();new DataView(wrongId.buffer).setUint32(54,200,true);assert.deepEqual(collectNativePhaseEvidence(wrongId,layout,ids,location).phases,[]);
});

test("lifecycle reads explicit distinct created/demolished fields; design sentinel is independent", () => {
  const data=frame(100,2000,101n,102n),view=new DataView(data.buffer);
  view.setBigInt64(110,-4n,true);
  const evidence=collectNativePhaseEvidence(data,nativePhaseLayout(2027,schema()),new Set([100]),location);
  assert.deepEqual(evidence.relations.map(({createdPhaseId,demolishedPhaseId})=>({createdPhaseId,demolishedPhaseId})),[{createdPhaseId:101,demolishedPhaseId:102}]);
  view.setBigInt64(94,-4n,true);
  assert.deepEqual(collectNativePhaseEvidence(data,nativePhaseLayout(2027,schema()),new Set([100]),location).relations,[]);
});

test("unframed phase-name candidate requires independent phase category; conflicts remain unresolved", () => {
  const data=new Uint8Array(200),view=new DataView(data.buffer),name="Existing";
  view.setUint32(0,0xffff_ffff,true);view.setUint16(4,784,true);view.setUint32(6,1,true);view.setBigUint64(10,100n,true);
  data.fill(255,18,74);view.setUint32(77,name.length,true);for(let i=0;i<name.length;i++)view.setUint16(81+i*2,name.charCodeAt(i),true);
  const evidence=collectNativePhaseEvidence(data,nativePhaseLayout(2027,schema()),new Set([100]),location);
  assert.equal(evidence.phases.length,1);
  assert.deepEqual(resolveNativePhaseEvidence([evidence]).phases,[]);
  const accepted=resolveNativePhaseEvidence([evidence],new Set([100]));assert.equal(accepted.phases[0]!.evidence,"phase-category-element-data");
  const conflict={phases:[{...accepted.phases[0]!,name:"Different"}],relations:[]};
  assert.deepEqual(resolveNativePhaseEvidence([accepted,conflict,accepted]).phases,[]);
  const relation=collectNativePhaseEvidence(frame(100,2000,101n),nativePhaseLayout(2027,schema()),new Set([100]),location);
  const empty=collectNativePhaseEvidence(frame(100,2000),nativePhaseLayout(2027,schema()),new Set([100]),location);
  assert.deepEqual(resolveNativePhaseEvidence([relation,empty,relation]).relations,[]);
});

test("standard property ids agree with the generated Autodesk descriptor enumerators", () => {
  for(const [id,enumerator] of [[-1001206,"FIRE_RATING"],[-1001208,"GENERIC_FINISH"],[-1001596,"WALL_STRUCTURAL_SIGNIFICANT"],[-1001954,"FLOOR_PARAM_IS_STRUCTURAL"],[-1001006,"FUNCTION_PARAM"],[-1151305,"STAIRS_RUN_ACTUAL_NUMBER_OF_RISERS"],[-1151306,"STAIRS_RUN_ACTUAL_NUMBER_OF_TREADS"],[-1151307,"STAIRS_RUN_ACTUAL_RISER_HEIGHT"],[-1151308,"STAIRS_RUN_ACTUAL_TREAD_DEPTH"],[-1012100,"PHASE_CREATED"],[-1012101,"PHASE_DEMOLISHED"]] as const)assert.equal(parameterEnumName(id),enumerator);
});
