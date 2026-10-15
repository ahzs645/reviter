import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeScheduleInventory, makeNativeScheduleInventoryCsv } from "../lib/reviter/native-schedule-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
const SHA = "a".repeat(64);
const eid = (n: number | string) => ({ m_id: { m_id64: n } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (n: unknown): Record<string, any> => n as Record<string, any>;
function fixture(): NativeEvidenceReport {
  const classes = ["DBViewSchedule", "ScheduleSchema", "ScheduleField", "ScheduleField", "ScheduleSortField", "ScheduleFilter", "ScheduleData", "ScheduleSectionData", "TableRowCellData", "TableCellData", "BinaryOperatorExpression", "NumberConstantExpression", "ScheduleFieldExpression", "TableRowData", "TableColumnData", "TableColumnData"];
  const objects = classes.map((class_name, i) => ({ class_name, class_tag: 100 + i, token: i === 0 ? 0 : 4294967295, start: i * 100 + 2, fields_end: (i + 1) * 100, fields: {} as Record<string, unknown> }));
  const edges: unknown[] = [];
  const pointer = (owner: number, target: number, offset: number) => { const p = { class_tag: objects[target].class_tag, pointer_token: objects[target].token, offset: objects[owner].start + offset }; edges.push({ source_object_index: owner, target_object_index: target, pointer_offset: p.offset, pointer_token: p.pointer_token, target_class_tag: p.class_tag }); return p; };
  const nil = { class_tag: null, pointer_token: 0, offset: 0 };
  objects[0].fields = { m_id: eid(1000), m_viewName: "=Authored Schedule", m_pSchema: pointer(0, 1, 20), m_pData: pointer(0, 6, 30) };
  objects[1].fields = { m_categoryId: eid(-2000014), m_altScheduleTitle: "Doors", m_fieldIds: [{ m_id: 0 }, { m_id: 8 }], m_pFields: [pointer(1, 2, 20), pointer(1, 3, 30)], m_sortFieldArr: [pointer(1, 4, 40)], m_filterArr: [pointer(1, 5, 50)], m_bIncludeLinkedFiles: false };
  objects[2].fields = { m_paramElemId: eid(-100), m_columnHeading: "Hidden Width", m_hidden: true, m_sourceType: 987, m_displayType: 654, m_columnWidth: 1 / 12, m_pFormatOptions: nil, m_pExpression: pointer(2, 10, 20) };
  objects[3].fields = { m_paramElemId: eid(77), m_columnHeading: "Count", m_hidden: false, m_sourceType: 2, m_displayType: 0, m_columnWidth: 0.5, m_pFormatOptions: nil, m_pExpression: nil };
  objects[4].fields = { m_fieldId: { m_id: 0 }, m_sortOrder: 99, m_groupingFlags: 123 };
  objects[5].fields = { m_fieldId: { m_id: 8 }, m_filterType: 99, m_value: { m_storageType: 333, m_dbl: 2.3, m_int: 27, m_str: { m_str: "test" }, m_elemId: eid("9223372036854775807") } };
  objects[6].fields = { m_SectionData: [pointer(6, 7, 20)] };
  objects[7].fields = { m_index: 1, m_hideSection: false, m_rows: [pointer(7, 13, 30)], m_cols: [pointer(7, 14, 40), pointer(7, 15, 50)], m_tableCells: [pointer(7, 8, 20)] };
  objects[8].fields = { m_arrCells: [pointer(8, 9, 20)] };
  objects[9].fields = { m_row: 0, m_column: 1, m_text: "@stored text", m_cellType: 2, m_paramId: eid(-100), m_categoryId: eid(-2000014), m_coverTop: 0, m_coverBottom: 0, m_coverLeft: -1, m_coverRight: 1 };
  objects[10].fields = { m_binaryOperator: 12345, m_pLeftSubexpression: pointer(10, 11, 20), m_pRightSubexpression: pointer(10, 12, 30) };
  objects[11].fields = { m_value: 1.5, m_specTypeId: { m_typeId: "autodesk.spec.aec:length-2.0.0" } };
  objects[12].fields = { m_fieldId: { m_id: 8 } };
  objects[13].fields = { m_dHeight: 1 / 72 }; objects[14].fields = { m_dWidth: 0.25 }; objects[15].fields = { m_dWidth: 0.5 };
  return { sourceSha256: SHA, readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", scope: "test", source: { apiVersion: 1, kind: "native-source-evidence", status: "complete", diagnostics: {}, summary: { schema_sha256: "b".repeat(64), revit_version: 2024 }, records: [{ class_name: "DBViewSchedule", status: "complete_bounded_graph", diagnostic: null, identity: { element_id: 1000 }, source: { stream: "Partitions/1", group_record_offset: 24, body_bytes: 1600, body_sha256: SHA }, graph: { objects, edges, consumed_bytes: 1600 } }] } };
}
test("stored order joins field IDs by owned pointer position, including hidden fields, filters and sort codes", () => {
  const i = buildNativeScheduleInventory(fixture()), s = i.schedules[0];
  assert.equal(i.status, "complete"); assert.deepEqual(s.fields.map(f => f.fieldId), ["0", "8"]); assert.equal(s.fields[0].hidden, true);
  assert.equal(s.sorting[0].fieldId, "0"); assert.equal(s.sorting[0].sortOrderCode, 99); assert.equal(s.filters[0].storageTypeCode, 333);
  assert.equal(s.filters[0].storedSlots.m_elemId, "9223372036854775807"); assert.equal(s.filters[0].storedSlots.m_dbl, 2.3);
  assert.equal(s.cells[0].text, "@stored text"); assert.equal(s.cells[0].storedCoverOffsets.left, -1);
});
test("expressions retain source enum codes, unit specs and field IDs without executing unknown operations", () => {
  const e = buildNativeScheduleInventory(fixture()).schedules[0].fields[0].expression!;
  assert.equal(e.semantics, "serialized-not-evaluated"); assert.equal(e.fields.m_binaryOperator, 12345); assert.equal(e.children[0].fields.m_value, 1.5);
  assert.equal(e.children[1].fields.m_fieldId, "8"); assert.equal(e.children.length, 2);
});
test("source/schema pins, release, complete root identity and body proof are required", () => {
  for (const mode of ["source", "schema", "pin", "release", "identity", "body", "span", "duplicate-owner", "partial"]) {
    const f = fixture(), r = raw(f.source.records[0]);
    if (mode === "source") f.sourceSha256 = "bad";
    if (mode === "schema") raw(f.source.summary).schema_sha256 = "bad";
    if (mode === "pin") f.readerCommit = "bad";
    if (mode === "release") raw(f.source.summary).revit_version = 2027;
    if (mode === "identity") r.graph.objects[0].fields.m_id = eid(1001);
    if (mode === "body") r.graph.consumed_bytes++;
    if (mode === "span") r.graph.objects[0].fields_end = 1601;
    if (mode === "duplicate-owner") f.source.records.push(structuredClone(r));
    if (mode === "partial") r.status = "unsupported_graph";
    assert.equal(buildNativeScheduleInventory(f).schedules.length, 0, mode);
  }
});
test("owned schema edges reject duplicate, token/class/offset/target-bound contradictions", () => {
  for (const mode of ["duplicate", "token", "tag", "offset", "target-token", "target-span"]) {
    const f = fixture(), g = raw(f.source.records[0]).graph;
    if (mode === "duplicate") g.edges.push({ ...g.edges[0] });
    if (mode === "token") g.edges[0].pointer_token--;
    if (mode === "tag") g.edges[0].target_class_tag++;
    if (mode === "offset") g.objects[0].fields.m_pSchema.offset = 1000;
    if (mode === "target-token") g.objects[1].token++;
    if (mode === "target-span") g.objects[1].fields_end = 5000;
    assert.equal(buildNativeScheduleInventory(f).schedules.length, 0, mode);
  }
});
test("field order contradictions withhold columns and dependent filter/sort declarations", () => {
  for (const mode of ["duplicate-field", "different-length", "unsafe-id", "duplicate-pointer"]) {
    const f = fixture(), g = raw(f.source.records[0]).graph, s = g.objects[1].fields;
    if (mode === "duplicate-field") s.m_fieldIds[1].m_id = 0;
    if (mode === "different-length") s.m_fieldIds.pop();
    if (mode === "unsafe-id") s.m_fieldIds[1].m_id = Number.MAX_SAFE_INTEGER + 1;
    if (mode === "duplicate-pointer") s.m_pFields[1] = s.m_pFields[0];
    const i = buildNativeScheduleInventory(f); assert.equal(i.status, "partial"); assert.ok(i.schedules[0].fields.length < 2, mode);
  }
});
test("cell text caches are exported as stored cells, CSV formulas neutralized and all rows rectangular", () => {
  const csv = makeNativeScheduleInventoryCsv(buildNativeScheduleInventory(fixture()), { excelBom: true });
  assert.ok(csv.startsWith("\ufeffrecord_kind,")); assert.ok(csv.includes("'=Authored Schedule")); assert.ok(csv.includes("'@stored text"));
  assert.ok(csv.includes("stored-cell,")); assert.ok(csv.includes("serialized-not-evaluated"));
  const columns: number[] = []; let quoted = false, count = 1;
  for (let n = 0; n < csv.length; n++) {
    if (csv[n] === '"') { if (quoted && csv[n + 1] === '"') n++; else quoted = !quoted; }
    else if (!quoted && csv[n] === ",") count++;
    else if (!quoted && csv[n] === "\n") { columns.push(count); count = 1; }
  }
  assert.equal(columns.length, 8); assert.ok(columns.every(n => n === columns[0]));
});
test("expression cycles and unsupported classes remain partial evidence without recursion", () => {
  const f = fixture(), g = raw(f.source.records[0]).graph, p = g.objects[10].fields.m_pLeftSubexpression;
  const edge = g.edges.find((e: Record<string, unknown>) => e.source_object_index === 10 && e.pointer_offset === p.offset);
  p.class_tag = g.objects[10].class_tag; edge.target_class_tag = p.class_tag; edge.target_object_index = 10;
  const i = buildNativeScheduleInventory(f); assert.equal(i.status, "partial"); assert.ok(i.schedules[0].diagnostics.some(d => d.includes("cycle"))); assert.equal(i.schedules[0].fields[0].expression!.children.length, 1);
});
test("blocked empty CSV retains status; overlong authored text and table pointers are bounded", () => {
  const f = fixture(); f.source.status = "budget-blocked";
  assert.equal(buildNativeScheduleInventory(f).schedules.length, 0); assert.ok(makeNativeScheduleInventoryCsv(buildNativeScheduleInventory(f)).includes("budget-blocked"));
  f.source.status = "complete"; raw(f.source.records[0]).graph.objects[9].fields.m_text = "x".repeat(16385);
  const i = buildNativeScheduleInventory(f); assert.equal(i.status, "partial"); assert.equal(i.schedules[0].cells.length, 0);
});
test("section dimensions require exact owned row/column pointer, token, class and positive stored length", () => {
  const valid = buildNativeScheduleInventory(fixture()).schedules[0].sections[0];
  assert.equal(valid.layoutComplete, true); assert.equal(valid.storedHidden, false);
  assert.deepEqual(valid.rows.map(r => r.valueFeet), [1 / 72]); assert.deepEqual(valid.columns.map(c => c.valueFeet), [0.25, 0.5]);
  for (const mode of ["row-token", "column-class", "duplicate-column", "row-height", "visibility", "column-order"]) {
    const f = fixture(), g = raw(f.source.records[0]).graph, fields = g.objects[7].fields;
    if (mode === "row-token") g.objects[13].token--;
    if (mode === "column-class") g.objects[14].class_name = "OtherDimension";
    if (mode === "duplicate-column") fields.m_cols[1] = fields.m_cols[0];
    if (mode === "row-height") g.objects[13].fields.m_dHeight = -1;
    if (mode === "visibility") fields.m_hideSection = "false";
    if (mode === "column-order") fields.m_cols[0].offset = 1400;
    const i = buildNativeScheduleInventory(f); assert.equal(i.status, "partial", mode); assert.equal(i.schedules[0].sections[0].layoutComplete, false, mode);
    assert.equal(i.schedules[0].cells.length, 1, "raw stored cells remain available");
  }
});
