import test from "node:test";
import assert from "node:assert/strict";
import type { NativeScheduleInventory, ScheduleWitness, StoredScheduleCell } from "../lib/reviter/native-schedule-inventory.ts";
import { buildNativeCachedScheduleLayout, makeNativeScheduleHtml } from "../lib/reviter/native-schedule-html.ts";
const SHA = "a".repeat(64);
const witness = (index: number): ScheduleWitness => ({ objectIndex: index, className: "TableCellData", pointerPath: [] });
function fixture(): NativeScheduleInventory {
  const cells: StoredScheduleCell[] = [];
  for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) cells.push({ sectionCode: 0, row, column, text: row === 0 && column === 0 ? 'Authored <script>globalThis.unwanted=1</script> & "name"' : column === 2 ? `Literal =${row}+2` : "", cellTypeCode: 987, parameterId: "-100", categoryId: "-200", storedCoverOffsets: column < 2 ? { top: -row, bottom: 1 - row, left: -column, right: 1 - column } : { top: 0, bottom: 0, left: 0, right: 0 }, source: witness(10 + row * 3 + column) });
  return { apiVersion: 1, kind: "native-schedule-inventory", sourceSha256: SHA, schemaSha256: "b".repeat(64), readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", revitVersion: 2025, status: "complete", diagnostics: [], limits: { records: 4096, graphObjects: 4096, fieldsPerSchedule: 1024, cellsPerSchedule: 10000, expressionNodes: 256, expressionDepth: 24, textCharacters: 16384, diagnostics: 256 }, scope: "stored test cells", schedules: [{ elementId: "1000", name: "<img src=https://private.example/data onerror=alert(1)>", title: "Stored title", categoryId: "-200", schemaObjectIndex: 1, source: { stream: "Partitions/1", groupRecordOffset: 44, bodySha256: SHA, rawRecordIndex: 0 }, settings: {}, fields: [], sorting: [], filters: [], cells,
    sections: [{ sectionCode: 0, storedHidden: false, layoutComplete: true, rows: [0.025, 0.05].map((valueFeet, i) => ({ valueFeet, source: witness(20 + i) })), columns: [0.1, 0.2, 0.3].map((valueFeet, i) => ({ valueFeet, source: witness(22 + i) })), source: { ...witness(2), className: "ScheduleSectionData" } }], diagnostics: [] }] };
}
test("reciprocal cover offsets establish exact owned merged rectangle and preserve source dimensions", () => {
  const inventory = fixture(), before = JSON.stringify(inventory), layout = buildNativeCachedScheduleLayout(inventory, "1000");
  assert.equal(layout.status, "complete"); assert.equal(layout.sections.length, 1); assert.equal(layout.sections[0].merges.length, 1);
  assert.deepEqual(layout.sections[0].merges[0], { top: 0, bottom: 1, left: 0, right: 1, anchorObjectIndex: 10, memberObjectIndices: [10, 11, 13, 14] });
  const preview = makeNativeScheduleHtml(inventory, { scheduleId: "1000" });
  assert.equal(preview.status, "complete"); assert.equal(preview.renderedSections, 1); assert.equal(preview.renderedCells, 3); assert.equal(preview.renderedMerges, 1); assert.equal(preview.renderedCoveredCells, 4);
  assert.ok(preview.html?.includes('rowspan="2" colspan="2"')); assert.ok(preview.html?.includes('data-width-feet="0.2"')); assert.ok(preview.html?.includes('width:2.40000000000in')); assert.ok(preview.html?.includes('height:0.300000000000in'));
  assert.equal(JSON.stringify(inventory), before);
});
test("standalone HTML escapes names/cell text and has no executable or external content", () => {
  const { html } = makeNativeScheduleHtml(fixture(), { scheduleId: "1000" }); assert.ok(html);
  assert.ok(html.includes("&lt;script&gt;globalThis.unwanted=1&lt;/script&gt; &amp; &quot;name&quot;"));
  assert.ok(html.includes("&lt;img src=https://private.example/data onerror=alert(1)&gt;"));
  assert.ok(!/<(?:script|img|iframe|link|object|embed)\b/iu.test(html)); assert.ok(!/\s(?:src|href|onerror)="/iu.test(html));
  assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("Literal =0+2")); assert.ok(html.includes("cached source preview"));
});
test("hidden sections default to omitted and explicit inclusion preserves source visibility provenance", () => {
  const i = fixture(); i.schedules[0].sections[0].storedHidden = true;
  const hidden = makeNativeScheduleHtml(i, { scheduleId: "1000" }); assert.equal(hidden.hiddenSections, 1); assert.equal(hidden.renderedCells, 0); assert.ok(!hidden.html?.includes("<td "));
  const included = makeNativeScheduleHtml(i, { scheduleId: "1000", includeHiddenSections: true }); assert.equal(included.renderedCells, 3); assert.ok(included.html?.includes('data-stored-hidden="true"')); assert.ok(included.html?.includes("source hidden; explicitly included"));
});
test("incomplete reciprocity, overlap and covered non-anchor text cannot silently lose source content", () => {
  for (const mode of ["broken-member", "overlap", "covered-text", "outside", "non-containing"] as const) {
    const i = fixture(), cells = i.schedules[0].cells;
    if (mode === "broken-member") cells[1].storedCoverOffsets = { top: 0, bottom: 0, left: 0, right: 0 };
    if (mode === "overlap") cells[2].storedCoverOffsets.left = -2;
    if (mode === "covered-text") cells[1].text = "Never discard this stored text";
    if (mode === "outside") cells[0].storedCoverOffsets.right = 5;
    if (mode === "non-containing") cells[0].storedCoverOffsets.left = 1;
    const preview = makeNativeScheduleHtml(i, { scheduleId: "1000" }); assert.equal(preview.status, "unsupported", mode); assert.equal(preview.html, null); assert.equal(preview.omittedSections.length, 1);
  }
});
test("missing cells, duplicate coordinates and absent or invalid owned dimensions refuse fabricated grid rows", () => {
  for (const mode of ["sparse", "duplicate", "off-grid", "zero-width", "negative-height", "incomplete", "missing-section", "duplicate-section", "old-inventory"] as const) {
    const i = fixture(), s = i.schedules[0];
    if (mode === "sparse") s.cells.pop();
    if (mode === "duplicate") s.cells[1] = structuredClone(s.cells[0]);
    if (mode === "off-grid") s.cells[0].row = 3;
    if (mode === "zero-width") s.sections[0].columns[0].valueFeet = 0;
    if (mode === "negative-height") s.sections[0].rows[0].valueFeet = -0.1;
    if (mode === "incomplete") s.sections[0].layoutComplete = false;
    if (mode === "missing-section") s.sections = [];
    if (mode === "duplicate-section") s.sections.push(structuredClone(s.sections[0]));
    if (mode === "old-inventory") Reflect.deleteProperty(s, "sections");
    const preview = makeNativeScheduleHtml(i, { scheduleId: "1000" }); assert.equal(preview.status, "unsupported", mode); assert.equal(preview.html, null, mode);
  }
});
test("source/reader/release and exact schedule identity are required; blocked evidence stays blocked", () => {
  for (const mode of ["source", "schema", "pin", "release", "absent-id", "duplicate-id", "blocked", "unsupported"] as const) {
    const i = fixture();
    if (mode === "source") i.sourceSha256 = "bad";
    if (mode === "schema") i.schemaSha256 = null;
    if (mode === "pin") i.readerCommit = "bad";
    if (mode === "release") i.revitVersion = 2027;
    if (mode === "duplicate-id") i.schedules.push(structuredClone(i.schedules[0]));
    if (mode === "blocked") i.status = "budget-blocked";
    if (mode === "unsupported") i.status = "unsupported";
    const preview = makeNativeScheduleHtml(i, { scheduleId: mode === "absent-id" ? "1001" : "1000" }); assert.equal(preview.html, null, mode); assert.ok(["unsupported", "budget-blocked"].includes(preview.status), mode);
  }
});
test("an unresolved section is omitted with reason while qualified sibling cached cells remain available", () => {
  const i = fixture(), s = i.schedules[0];
  const section = structuredClone(s.sections[0]); section.sectionCode = 1; section.layoutComplete = false; s.sections.push(section);
  s.cells.push(...s.cells.map(c => ({ ...structuredClone(c), sectionCode: 1 })));
  const preview = makeNativeScheduleHtml(i, { scheduleId: "1000" }); assert.equal(preview.status, "partial"); assert.equal(preview.renderedCells, 3); assert.equal(preview.omittedSections[0].sectionCode, 1); assert.ok(preview.html?.includes("dimensions or visibility are incomplete"));
});
test("empty owned sections remain empty; formula expressions do not invent body rows", () => {
  const i = fixture(), s = i.schedules[0]; s.sections[0].rows = []; s.sections[0].columns = []; s.cells = [];
  s.fields.push({ fieldId: "5", position: 0, parameterId: "-1", heading: "Calculated", hidden: false, sourceTypeCode: 999, displayTypeCode: 999, columnWidthFeet: 0.3, format: null, expression: { className: "BinaryOperatorExpression", objectIndex: 100, fields: { m_binaryOperator: 4 }, children: [], semantics: "serialized-not-evaluated" }, source: witness(101) });
  const preview = makeNativeScheduleHtml(i, { scheduleId: "1000" }); assert.equal(preview.status, "complete"); assert.equal(preview.renderedCells, 0); assert.ok(preview.html?.includes("<tbody></tbody>")); assert.ok(!preview.html?.includes("<td "));
});
test("HTML text growth, dimensions and explicit hidden-section options remain bounded", () => {
  const i = fixture();
  // 6 cells, each over the declared string cap: no giant document is built.
  for (const c of i.schedules[0].cells) c.text = "x".repeat(16_385);
  assert.equal(makeNativeScheduleHtml(i, { scheduleId: "1000" }).html, null);
  const large = fixture(), s = large.schedules[0]; s.sections[0].rows = Array.from({ length: 300 }, (_, n) => ({ valueFeet: 0.1, source: witness(100 + n) })); s.sections[0].columns = [{ valueFeet: 0.2, source: witness(500) }];
  s.cells = Array.from({ length: 300 }, (_, row) => ({ ...structuredClone(s.cells[2]), row, column: 0, text: "<&>".repeat(3000), source: witness(1000 + row) }));
  const limited = makeNativeScheduleHtml(large, { scheduleId: "1000" }); assert.equal(limited.status, "budget-blocked"); assert.equal(limited.html, null); assert.ok(limited.diagnostics.some(d => d.includes("preflight")));
  assert.equal(makeNativeScheduleHtml(fixture(), { scheduleId: "1000", includeHiddenSections: "yes" as unknown as boolean }).html, null);
});
