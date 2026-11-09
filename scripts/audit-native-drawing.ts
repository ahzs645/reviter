#!/usr/bin/env node
/** Reopens saved bounded evidence; compares projected fields/pointers/owners to
 * their original graph objects. Optional RVT bytes independently verify digest. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildNativeRecordInventory } from "../lib/reviter/native-record-inventory.ts";
import { makeNativeDrawingSvg } from "../lib/reviter/native-drawing-svg.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
type Obj = Record<string, unknown>;
const object = (value: unknown) => value as Obj;
function storedPath(value: unknown, field: string): unknown {
  for (const key of field.split(".")) value = Array.isArray(value) ? value[Number(key)] : object(value)[key];
  return value;
}
function id(value: unknown): string {
  while (value !== null && typeof value === "object") { const fields = object(value); value = fields.m_id64 ?? fields.m_id; }
  return String(value);
}
function normalize(value: unknown, type: string): unknown {
  if (type === "element-id") return id(value);
  if (type === "element-id-list") return (value as unknown[]).map(id);
  if (type === "point-feet" || type === "vector") return Array.isArray(value) ? value : object(value).m_xyz;
  if (type === "point-feet-list") return (value as unknown[]).map(p => normalize(p,"point-feet"));
  return value;
}
export function auditNativeDrawingEvidence(report: NativeEvidenceReport, viewId: string, rvtBytes?: Uint8Array) {
  if (rvtBytes) assert.equal(createHash("sha256").update(rvtBytes).digest("hex"),report.sourceSha256,"Supplied source RVT digest differs.");
  const inventory = buildNativeRecordInventory(report), preview = makeNativeDrawingSvg(report,{viewId});
  let fieldComparisons=0,pointerComparisons=0,ownerComparisons=0;
  for (const record of inventory.records) {
    const raw=object(report.source.records[record.rawRecordIndex]), graph=object(raw.graph), nodes=graph.objects as Obj[], edges=graph.edges as Obj[];
    for (const [key,evidence] of Object.entries(record.values)) {
      const src=evidence.source;
      assert.deepEqual(normalize(storedPath(nodes[src.objectIndex].fields,src.field),evidence.type),evidence.value,`${record.elementId}.${key}: source value differs`);fieldComparisons++;
      for (const pointer of src.pointerPath) {
        const matching=edges.filter(e=>e.source_object_index===pointer.sourceObjectIndex && e.pointer_offset===pointer.pointerOffset);
        assert.equal(matching.length,1);assert.equal(matching[0].target_object_index,pointer.targetObjectIndex);assert.equal(matching[0].pointer_token,pointer.pointerToken);
        assert.equal(nodes[pointer.targetObjectIndex].class_name,pointer.targetClass);pointerComparisons++;
      }
    }
  }
  for (const primitive of preview.primitives) {
    const raw=object(report.source.records[primitive.rawRecordIndex]), nodes=object(raw.graph).objects as Obj[];
    assert.equal(id(object(nodes[0].fields).m_ownerDBViewId),viewId,"Rendered primitive belongs to another native view");
    assert.equal(primitive.recordSource.bodySha256,object(raw.source).body_sha256);ownerComparisons++;
  }
  const countKinds:Record<string,number>={};for(const primitive of preview.primitives)countKinds[primitive.kind]=(countKinds[primitive.kind]??0)+1;
  return { kind:"native-drawing-source-audit",readerCommit:report.readerCommit,readerPatch:report.readerPatch,sourceSha256:report.sourceSha256,sourceBytesIndependentlyVerified:rvtBytes!==undefined,
    viewId,sourceSelection:preview.sourceSelection,projectedFieldsComparedAgainstRawGraph:fieldComparisons,ownedPointerEdgeComparisons:pointerComparisons,
    renderedPrimitiveOwnerAndRecordDigestComparisons:ownerComparisons,renderedOwners:preview.renderedElementIds.length,renderedPrimitives:countKinds,omittedOwnedAnnotations:preview.omitted.length,
    svgSha256:preview.svg?createHash("sha256").update(preview.svg).digest("hex"):null,status:preview.status,diagnostics:preview.diagnostics,
  };
}
async function run() {
  declareUsage("audit-native-drawing.ts evidence.json --view-id 123 [--rvt model.rvt] [--out audit.json]");
  const [input]=positionals("--view-id","--rvt","--out"), viewId=optionValue("--view-id");
  if(!input||!viewId)throw new Error("Supply saved source evidence and --view-id.");
  const report=JSON.parse(readFileSync(input,"utf8")) as NativeEvidenceReport, rvt=optionValue("--rvt");
  const audit=auditNativeDrawingEvidence(report,viewId,rvt?new Uint8Array(readFileSync(rvt)):undefined), json=JSON.stringify(audit,null,2)+"\n", output=optionValue("--out");
  if(output)writeFileSync(output,json);else console.log(json);
}
if(isEntryPoint(import.meta.url))await run();
