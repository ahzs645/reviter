#!/usr/bin/env node
/** Reopen a saved source report, bind it to the original RVT hash, and compare
 * every projected value and owned pointer with the decoded source objects. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildNativeRecordInventory } from "../lib/reviter/native-record-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";

type ObjectFields = {class_name:string; fields:Record<string,unknown>};
type RecordGraph = {identity:{element_id:number|string};graph:{objects:ObjectFields[];edges:{source_object_index:number;pointer_offset:number;target_object_index:number}[]}};
function canonicalId(value: unknown): string {
  if (typeof value === "number") { assert.ok(Number.isSafeInteger(value)); return String(value); }
  if (typeof value === "string") return BigInt(value).toString();
  assert.ok(value && typeof value === "object");
  const object = value as Record<string,unknown>;
  return canonicalId(object.m_id64 ?? object.m_id);
}
async function run() {
  declareUsage("audit-native-record-inventory.ts evidence.json [disjoint-evidence.json ...] --source model.rvt [--out audit.json]");
  const evidenceFiles = positionals("--source", "--out"); const source = optionValue("--source");
  if (!evidenceFiles.length || !source) throw new Error("Supply evidence JSON and the original source RVT.");
  const sourceSha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
  const outputs = [];
  const owners = new Set<string>();
  for (const evidence of evidenceFiles) {
    const report = JSON.parse(readFileSync(evidence, "utf8")) as NativeEvidenceReport;
    assert.equal(report.sourceSha256, sourceSha256, "Evidence must refer to these exact RVT bytes.");
    const inventory = buildNativeRecordInventory(report), classCounts: Record<string,number> = {}, classFieldCounts: Record<string,number> = {};
    let comparedFields = 0, comparedPointerEdges = 0;
    const rows: unknown[] = [];
    for (const record of inventory.records) {
      assert.ok(!owners.has(record.elementId), "Aggregate queries must have disjoint projected owner identities.");
      owners.add(record.elementId);
      classCounts[record.className] = (classCounts[record.className] ?? 0) + 1;
      const raw = report.source.records[record.rawRecordIndex] as RecordGraph;
      assert.equal(canonicalId(raw.identity.element_id), record.elementId);
      assert.equal(canonicalId(raw.graph.objects[0].fields.m_id), record.elementId);
      for (const [name, projection] of Object.entries(record.values)) {
        let objectIndex = 0;
        for (const pointer of projection.source.pointerPath) {
          assert.equal(pointer.sourceObjectIndex, objectIndex);
          const rawPointer = raw.graph.objects[objectIndex].fields[pointer.field] as {offset:number;pointer_token:number};
          assert.equal(rawPointer.offset, pointer.pointerOffset); assert.equal(rawPointer.pointer_token, pointer.pointerToken);
          const edges = raw.graph.edges.filter(edge => edge.source_object_index === objectIndex && edge.pointer_offset === rawPointer.offset);
          assert.equal(edges.length, 1); assert.equal(edges[0].target_object_index, pointer.targetObjectIndex);
          objectIndex = edges[0].target_object_index; assert.equal(raw.graph.objects[objectIndex].class_name, pointer.targetClass);
          comparedPointerEdges++;
        }
        assert.equal(objectIndex, projection.source.objectIndex);
        const node = raw.graph.objects[objectIndex]; assert.equal(node.class_name, projection.source.objectClass);
        let rawValue: unknown = node.fields;
        for (const segment of projection.source.field.split(".")) rawValue = (rawValue as Record<string,unknown>)[segment];
        if (projection.type === "element-id") rawValue = canonicalId(rawValue);
        else if (projection.type === "element-id-list") rawValue = (rawValue as unknown[]).map(canonicalId);
        else if (projection.type === "point-feet") rawValue = (rawValue as {m_xyz?:unknown})?.m_xyz ?? rawValue;
        assert.deepEqual(rawValue, projection.value, `${record.elementId}.${name}`);
        comparedFields++; classFieldCounts[record.className] = (classFieldCounts[record.className] ?? 0) + 1;
        rows.push([record.elementId, name, projection.value, projection.source]);
      }
    }
    const output = {
      kind: "native-record-inventory-validation", sourceSha256, readerCommit: report.readerCommit,
      readerPatch: report.readerPatch, revitVersion: inventory.revitVersion, sourceStatus: report.source.status,
      inventoryStatus: inventory.status, retainedSourceRecords: report.source.records.length,
      projectedRecords: inventory.records.length, fallbackRecords: inventory.fallbacks.length,
      comparedFields, comparedPointerEdges, mismatches: 0, classCounts, classFieldCounts,
      projectedValueAndWitnessSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      sourceClassCoverage: inventory.coverage.sourceClasses,
      scope: "Every retained typed value and owner/pointer witness compared against independently reopened source graph JSON, bound to the original RVT bytes. This validates serialized projection; paired API drawing/space/coordinate truth is unavailable.",
    };
    outputs.push(output);
  }
  const output = outputs.length === 1 ? outputs[0] : {
    kind: "native-record-inventory-batch-validation", sourceSha256, queryCount: outputs.length,
    retainedSourceRecords: outputs.reduce((count, batch) => count + batch.retainedSourceRecords, 0),
    projectedRecords: owners.size, fallbackRecords: outputs.reduce((count, batch) => count + batch.fallbackRecords, 0),
    comparedFields: outputs.reduce((count, batch) => count + batch.comparedFields, 0),
    comparedPointerEdges: outputs.reduce((count, batch) => count + batch.comparedPointerEdges, 0),
    mismatches: 0, batches: outputs,
    scope: "Disjoint typed owner queries independently compared against their source graphs and the same exact source RVT bytes; source graph fallbacks and output limits retained per batch.",
  };
  const json = JSON.stringify(output, null, 2) + "\n", out = optionValue("--out");
  if (out) { writeFileSync(out, json); console.log(JSON.stringify({ ...output, sourceClassCoverage: undefined, batches: undefined })); }
  else console.log(json);
}
if (isEntryPoint(import.meta.url)) await run();
