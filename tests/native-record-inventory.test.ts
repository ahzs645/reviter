import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeRecordInventory, makeNativeRecordInventoryCsv } from "../lib/reviter/native-record-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";

const sha = "a".repeat(64);
function report(className = "TextNote", id: number | string = 123): NativeEvidenceReport {
  return {
    sourceSha256: sha, readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", scope: "test",
    source: { apiVersion: 1, kind: "native-source-evidence", status: "complete", diagnostics: {},
      summary: { revit_version: 2025, schema_sha256: sha, classes: {} },
      records: [{ class_name: className, status: "complete_bounded_graph", diagnostic: null, identity: { element_id: id },
        source: { stream: "Partitions/1", group_record_offset: 100, body_bytes: 400, body_sha256: sha },
        graph: { consumed_bytes: 400, objects: [{ class_name: className, class_tag: 10, start: 2, fields_end: 120, fields: {
          m_id: { m_id: { m_id64: id } }, m_ownerDBViewId: { m_id: { m_id64: 45 } },
          m_orig: [1, 2, 3], m_oSavedRtfData: { class_tag: 20, offset: 109, pointer_token: 4294967295 },
        } }, { class_name: "RtfData", class_tag: 20, token: 4294967295, start: 120, fields_end: 400, fields: { m_arrRtfStream: [123, 92, 114, 116, 102, 125] } }],
        edges: [{ source_object_index: 0, pointer_offset: 109, pointer_token: 4294967295, target_class_tag: 20, target_object_index: 1 }],
        },
      }],
    },
  };
}
const raw = (input: NativeEvidenceReport) => input.source.records[0] as { class_name: string; status: string; diagnostic: string | null; source: {body_sha256: string; body_bytes:number}; graph: { consumed_bytes: number; objects: { class_name: string; start:number; fields_end:number; fields: Record<string, unknown> }[]; edges: Record<string, unknown>[] } };

test("owned RTF and annotation location retain exact source object and pointer witness", () => {
  const inventory = buildNativeRecordInventory(report());
  assert.equal(inventory.status, "complete");
  assert.equal(inventory.records[0].elementId, "123");
  assert.deepEqual(inventory.records[0].values.originFeet.value, [1, 2, 3]);
  assert.equal(inventory.records[0].values.ownerViewId.value, "45");
  const rtf = inventory.records[0].values.storedRtfBytes;
  assert.deepEqual(rtf.value, [123, 92, 114, 116, 102, 125]);
  assert.equal(rtf.source.objectIndex, 1);
  assert.equal(rtf.source.pointerPath[0].field, "m_oSavedRtfData");
  assert.equal(inventory.records[0].rawRecordIndex, 0);
});

test("unowned or contradictory text objects never become annotation content", () => {
  for (const change of [
    (input: NativeEvidenceReport) => { raw(input).graph.edges = []; },
    (input: NativeEvidenceReport) => { raw(input).graph.edges.push({ ...raw(input).graph.edges[0] }); },
    (input: NativeEvidenceReport) => { raw(input).graph.edges[0].target_class_tag = 21; },
    (input: NativeEvidenceReport) => { raw(input).graph.edges[0].pointer_token = 3; },
    (input: NativeEvidenceReport) => { raw(input).graph.objects[1].class_name = "Unrelated"; },
    (input: NativeEvidenceReport) => { raw(input).graph.objects[1].fields_end = 401; },
    (input: NativeEvidenceReport) => { (raw(input).graph.objects[0].fields.m_oSavedRtfData as {offset:number}).offset = 999; },
  ]) {
    const input = report(); change(input); const inventory = buildNativeRecordInventory(input);
    assert.equal(inventory.records[0].values.storedRtfBytes, undefined);
    assert.equal(inventory.status, "partial");
    assert.ok(inventory.records[0].diagnostics.length);
  }
});

test("conflicting current owner records are withheld and preserve raw fallback indices", () => {
  const input = report(); const duplicate = structuredClone(input.source.records[0]);
  input.source.records.push(duplicate); (duplicate as {source:{body_sha256:string}}).source.body_sha256 = "b".repeat(64);
  const inventory = buildNativeRecordInventory(input);
  assert.equal(inventory.records.length, 0);
  assert.equal(inventory.fallbacks[0].rawRecordIndex, 1);
  assert.match(inventory.fallbacks[0].reason, /Conflicting/);
});

test("unsafe numeric IDs, wrong owners, incomplete graphs and missing source boundaries remain raw", () => {
  const invalid = [report("TextNote", Number.MAX_SAFE_INTEGER + 1), report(), report(), report(), report()];
  raw(invalid[1]).graph.objects[0].fields.m_id = { m_id: 456 };
  raw(invalid[2]).status = "unsupported_graph";
  raw(invalid[3]).graph.consumed_bytes = 399;
  raw(invalid[4]).graph.objects[0].fields_end = 401;
  invalid.push(report("constructor"), report("toString"), report("__proto__"));
  for (const input of invalid) {
    const inventory = buildNativeRecordInventory(input);
    assert.equal(inventory.records.length, 0);
    assert.equal(inventory.fallbacks.length, 1);
  }
  assert.equal(buildNativeRecordInventory(report("TextNote", "9007199254740993")).records[0].elementId, "9007199254740993");
});

test("empty, reversed, negative or oversized root spans and record diagnostics withhold direct fields", () => {
  for (const change of [
    (input: NativeEvidenceReport) => { raw(input).graph.objects[0].start = -1; },
    (input: NativeEvidenceReport) => { raw(input).graph.objects[0].start = 121; },
    (input: NativeEvidenceReport) => { raw(input).graph.objects[0].fields_end = 2; },
    (input: NativeEvidenceReport) => { raw(input).graph.objects[0].fields_end = 401; },
    (input: NativeEvidenceReport) => { raw(input).source.body_bytes = 0; raw(input).graph.consumed_bytes = 0; },
    (input: NativeEvidenceReport) => { raw(input).diagnostic = "truncated source object"; },
  ]) {
    const input = report(); change(input);
    const inventory = buildNativeRecordInventory(input);
    assert.equal(inventory.records.length, 0);
    assert.equal(inventory.coverage.projectedFields, 0);
    assert.equal(inventory.fallbacks.length, 1);
    assert.equal(inventory.status, "partial");
  }
});

test("unknown releases, absent byte identity or changed reader context do not project records", () => {
  const invalid = [report(), report(), report(), report()];
  (invalid[0].source.summary as {revit_version:number}).revit_version = 2027;
  invalid[1].sourceSha256 = null;
  invalid[2].readerCommit = "unknown";
  invalid[3].source.status = "budget-blocked";
  for (const input of invalid.slice(0,3)) assert.equal(buildNativeRecordInventory(input).status, "unsupported");
  assert.equal(buildNativeRecordInventory(invalid[3]).status, "budget-blocked");
  assert.match(makeNativeRecordInventoryCsv(buildNativeRecordInventory(invalid[3])), /"budget-blocked"/);
});

test("stored native scale ratios, sentinel elevations and base point codes are preserved verbatim", () => {
  const input = report("DBViewPlan"); const fields = raw(input).graph.objects[0].fields;
  fields.m_viewName = "Level 1"; fields.m_scale = 0.01; fields.m_bottomClipElev = -999999999.9999999;
  const record = buildNativeRecordInventory(input).records[0];
  assert.equal(record.values.storedScaleRatio.value, 0.01);
  assert.equal(record.values.bottomClipElevationFeet.value, -999999999.9999999);
  const base = report("BasePoint"); const baseFields = raw(base).graph.objects[0].fields;
  baseFields.m_locationType = 1; baseFields.m_transformedPosition = {m_xyz:[10,20,30]};
  const point = buildNativeRecordInventory(base).records[0];
  assert.equal(point.values.locationTypeCode.value, 1);
  assert.deepEqual(point.values.storedTransformedPositionFeet.value, [10,20,30]);
  assert.equal(point.values.sharedCoordinateTransform, undefined);
});

test("CSV preserves provenance and neutralizes formula and multiline cells", () => {
  const input = report("ProjectRevision"); const fields = raw(input).graph.objects[0].fields;
  fields.m_description = "  =HYPERLINK(\"url\")"; fields.m_numberStr = "1\n2";
  const csv = makeNativeRecordInventoryCsv(buildNativeRecordInventory(input), {excelBom:true});
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"'  =HYPERLINK\(""url""\)"/);
  assert.match(csv, /"1\n2"/);
  assert.match(csv, /"Object index"/);
  assert.match(csv, /"m_description"/);
  assert.ok(csv.endsWith("\r\n"));
});

test("view/sheet-set ordering follows the exact inline saved field and preserves IDs", () => {
  const input = report("ViewSheetSet"); const fields = raw(input).graph.objects[0].fields;
  fields.m_name = "Set 1";
  fields.m_orderedViewSheetList = {m_dbDrawingIds:[{m_id:{m_id64:234}}, {m_id:{m_id64:345}}], m_isAutomatic:false};
  const record = buildNativeRecordInventory(input).records[0];
  assert.deepEqual(record.values.orderedDrawingIds.value, ["234", "345"]);
  assert.equal(record.values.orderedDrawingIds.source.field, "m_orderedViewSheetList.m_dbDrawingIds");
  assert.equal(record.values.automaticOrder.value, false);
});
