import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeParameterInventory, makeNativeParameterInventoryCsv } from "../lib/reviter/native-parameter-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";

const SHA = "a".repeat(64);
const identifier = (n: number | string) => ({ m_id: { m_id64: n } });
test("a blocked empty parameter CSV preserves scope and status", () => {
  const report = fixture(); report.source.status = "budget-blocked";
  const csv = makeNativeParameterInventoryCsv(buildNativeParameterInventory(report));
  assert.ok(csv.includes("\r\ninventory,"));
  assert.ok(csv.includes("budget-blocked"));
  assert.ok(csv.includes("serialized-not-evaluated"));
  assert.ok(!csv.includes("\r\nvalue,"));
});
function fixture(): NativeEvidenceReport {
  const fields = { m_paramElemId: identifier(10), m_caption: "Width", m_specTypeId: { m_typeId: "autodesk.spec.aec:length-1.0.0" }, m_typeId: { m_typeId: "local:10" } };
  return {
    sourceSha256: SHA, readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", scope: "test",
    source: { apiVersion: 1, kind: "native-source-evidence", status: "complete", diagnostics: {},
      summary: { schema_sha256: "b".repeat(64), revit_version: 2025, definition_diagnostics: {},
        parameter_definitions: { "10": { parameter_id: 10, caption: "Width", definition_class: "ParamDefValue", owner_class: "ParamElemFamily", storage_type: "Double", spec_type_id: "autodesk.spec.aec:length-1.0.0", source_object: 1, definition_fields: fields, owner_fields: { m_famId: identifier(100), m_bindingIds: [identifier(30)] } } },
        unit_formats: { "autodesk.spec.aec:length-1.0.0": { m_unitTypeId: { m_typeId: "autodesk.unit.unit:millimeters-1.0.1" }, m_accuracy: 1 } },
        parameter_binding_context: { bindings: { "30": { binding_id: 30, parameter_id: 10, category_id: -2000014, elem_or_symbol: 2 } }, symbol_families: { "200": 100 }, family_categories: { "100": -2000014 } },
      }, records: [
        { status: "complete_bounded_graph", diagnostic: null, class_name: "ParamElemFamily", identity: { element_id: 10 }, source: { body_bytes: 50, body_sha256: SHA, stream: "Partitions/1", group_record_offset: 60 }, graph: { consumed_bytes: 50, objects: [
          { class_name: "ParamElemFamily", class_tag: 1, token: 0, start: 2, fields_end: 30, fields: { m_id: identifier(10), m_pParamDef: { offset: 22, pointer_token: 3, class_tag: 2 } } },
          { class_name: "ParamDefValue", class_tag: 2, token: 3, start: 30, fields_end: 50, fields },
        ], edges: [{ source_object_index: 0, pointer_offset: 22, pointer_token: 3, target_class_tag: 2, target_object_index: 1 }] } },
        { status: "complete_bounded_graph", diagnostic: null, class_name: "FamilySymbol", identity: { element_id: 200 }, source: { body_bytes: 60, body_sha256: SHA, stream: "Partitions/2", group_record_offset: 70 }, graph: { consumed_bytes: 60, objects: [
          { class_name: "FamilySymbol", class_tag: 3, token: 0, start: 2, fields_end: 45, fields: { m_id: identifier(200), m_familyId: identifier(100), m_pParams: { offset: 33, pointer_token: 4, class_tag: 4 } } },
          { class_name: "FamilyParams", class_tag: 4, token: 4, start: 45, fields_end: 60, fields: { m_params: [{ m_paramId: identifier(10), m_value: 2.5, m_int: 44, m_str: "wrong slot", m_elemId: identifier(55), m_instance: false, m_reporting: false, m_oExpression: { pointer_token: 0, offset: 50, class_tag: null } }] } },
        ], edges: [{ source_object_index: 0, pointer_offset: 33, pointer_token: 4, target_class_tag: 4, target_object_index: 1 }] } },
      ],
    },
  };
}
// Mutable fixture helpers intentionally operate only on test JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (v: unknown): Record<string, any> => v as Record<string, any>;

test("exact native class/storage/spec and owner edge choose one slot without numerical unit conversion", () => {
  const i = buildNativeParameterInventory(fixture());
  assert.equal(i.definitions.length, 1); assert.equal(i.values.length, 1);
  assert.equal(i.definitions[0].evidence, "retained-native-owner-edge");
  assert.equal(i.definitions[0].displayUnitTypeId, "autodesk.unit.unit:millimeters-1.0.1");
  assert.equal(i.values[0].rawValue, 2.5); assert.equal(i.values[0].valueSemantics, "serialized-not-evaluated");
  assert.equal(i.values[0].source.pointerOffset, 33); assert.equal(i.values[0].source.sourceObject, 1);
  assert.equal(i.bindings.length, 1);
});
test("captions and nonzero inactive slots do not recover unsupported storage", () => {
  const f = fixture(), d = raw(f.source.summary).parameter_definitions[10];
  d.definition_class = "UnsupportedWidthDefinition"; d.storage_type = null;
  const i = buildNativeParameterInventory(f);
  assert.equal(i.definitions[0].storageType, null); assert.equal(i.values.length, 0);
  assert.equal(i.unresolvedSlots[0].reason, "native-definition-storage-unresolved");
});
test("exact document pin and schema hash are required", () => {
  const noSource = fixture(); noSource.sourceSha256 = null; assert.equal(buildNativeParameterInventory(noSource).status, "unsupported");
  const noSchema = fixture(); raw(noSchema.source.summary).schema_sha256 = "bad"; assert.equal(buildNativeParameterInventory(noSchema).status, "unsupported");
  const f = fixture(); f.readerCommit = "bad"; assert.equal(buildNativeParameterInventory(f).values.length, 0);
});
test("ambiguous owner pointer edges, mismatched token/tag and duplicate owner records are refused", () => {
  for (const mode of ["duplicate-edge", "token", "tag", "duplicate-owner", "owner-id", "partial-graph"]) {
    const f = fixture(), r = raw(f.source.records[1]);
    if (mode === "duplicate-edge") r.graph.edges.push({ ...r.graph.edges[0] });
    if (mode === "token") r.graph.edges[0].pointer_token++;
    if (mode === "tag") r.graph.objects[1].class_tag++;
    if (mode === "duplicate-owner") f.source.records.push(structuredClone(r));
    if (mode === "owner-id") r.graph.objects[0].fields.m_id = identifier(201);
    if (mode === "partial-graph") r.status = "unsupported_graph";
    assert.equal(buildNativeParameterInventory(f).values.length, 0, mode);
  }
});
test("definition family contradiction remains raw and does not inherit another owner's values", () => {
  const f = fixture(); raw(f.source.records[1]).graph.objects[0].fields.m_familyId = identifier(101);
  const i = buildNativeParameterInventory(f); assert.equal(i.values.length, 0);
  assert.equal(i.unresolvedSlots[0].reason, "definition-family-owner-mismatch");
});
test("binding inventory needs the exact definition backlink, and native units conflicts suppress display unit claims", () => {
  const f = fixture(); raw(f.source.summary).parameter_definitions[10].owner_fields.m_bindingIds = [];
  raw(f.source.summary).definition_diagnostics = { 99: "conflicting native unit registries" };
  const i = buildNativeParameterInventory(f); assert.equal(i.bindings.length, 0);
  assert.equal(i.definitions[0].displayUnitTypeId, null);
  assert.equal(i.definitions[0].displayUnitResolution, "conflicting-native-project-units");
  assert.equal(i.values[0].rawValue, 2.5);
});
test("serialized expression pointer remains attached without evaluating formula or substituting another slot", () => {
  const f = fixture(), slot = raw(f.source.records[1]).graph.objects[1].fields.m_params[0];
  slot.m_oExpression = { pointer_token: 100, class_tag: 10, offset: 90 };
  const i = buildNativeParameterInventory(f);
  assert.deepEqual(i.values[0].expressionPointer, slot.m_oExpression); assert.equal(i.values[0].rawValue, 2.5);
});
test("unsafe integer slots remain exact decimal strings; unsafe JS integers are unresolved", () => {
  const f = fixture(), d = raw(f.source.summary).parameter_definitions[10], slot = raw(f.source.records[1]).graph.objects[1].fields.m_params[0];
  d.definition_class = "ParamDefInt"; d.storage_type = "Integer";
  d.spec_type_id = "autodesk.spec:spec.int64-2.0.0"; d.definition_fields.m_specTypeId.m_typeId = d.spec_type_id;
  slot.m_int = "9223372036854775807";
  assert.equal(buildNativeParameterInventory(f).values[0].rawValue, "9223372036854775807");
  slot.m_int = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(buildNativeParameterInventory(f).values.length, 0);
});
test("duplicate conflicting parameter values are withheld and built-in slots remain unresolved", () => {
  const f = fixture(), slots = raw(f.source.records[1]).graph.objects[1].fields.m_params;
  slots.push({ ...slots[0], m_value: 7 }); slots.push({ ...slots[0], m_paramId: identifier(-123) });
  const i = buildNativeParameterInventory(f); assert.equal(i.values.length, 0);
  assert.ok(i.unresolvedSlots.some(s => s.reason === "ambiguous-owner-value"));
  assert.ok(i.unresolvedSlots.some(s => s.reason === "built-in-definition-catalog-unavailable"));
});
test("CSV exports definitions and bindings with no selected values and neutralizes formula captions", () => {
  const f = fixture(); f.source.records = []; const d = raw(f.source.summary).parameter_definitions[10];
  d.caption = "=HYPERLINK(\"secret\")"; d.definition_fields.m_caption = d.caption;
  const csv = makeNativeParameterInventoryCsv(buildNativeParameterInventory(f), { excelBom: true });
  assert.ok(csv.startsWith("\ufeffrecord_kind,")); assert.ok(csv.includes("\r\ndefinition,")); assert.ok(csv.includes("\r\nbinding,"));
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(!csv.includes("\r\nvalue,"));
  assert.ok(csv.split("\r\n")[0].includes("source_sha256"));
});


test("material browse definitions select ElementId despite string inheritance/caption; strings select their stored string slot", () => {
  for (const [definitionClass, storage, spec, expected] of [["ParamDefMaterialBrowse", "ElementId", "autodesk.spec.aec:material-1.0.0", "55"], ["ParamDefString", "String", "autodesk.spec:spec.string-2.0.0", "wrong slot"]]) {
    const f = fixture(), d = raw(f.source.summary).parameter_definitions[10];
    d.definition_class = definitionClass; d.storage_type = storage; d.spec_type_id = spec;
    d.definition_fields.m_specTypeId.m_typeId = spec;
    assert.equal(buildNativeParameterInventory(f).values[0].rawValue, expected);
  }
});
test("typed owner values require both exact pointer class and agreement with native definition storage", () => {
  const f = fixture(), r = raw(f.source.records[1]);
  r.graph.objects[0].fields.m_pParams.pointer_token = 0;
  r.graph.objects[0].fields.m_pParamValueSetDouble = { offset: 40, pointer_token: 5, class_tag: 5 };
  r.graph.objects.push({ class_name: "ParamValueSetDouble", class_tag: 5, token: 5, start: 50, fields_end: 60, fields: { m_paramSet: [{ m_paramId: identifier(10), m_value: 7.5 }] } });
  r.graph.edges.push({ source_object_index: 0, pointer_offset: 40, pointer_token: 5, target_class_tag: 5, target_object_index: 2 });
  let i = buildNativeParameterInventory(f); assert.equal(i.values[0].rawValue, 7.5); assert.equal(i.values[0].valueSource, "owner-typed-parameter-set");
  r.graph.objects[2].class_name = "ParamValueSetInt";
  i = buildNativeParameterInventory(f); assert.equal(i.values.length, 0);
});


test("owned graph targets require matching native tokens and owner/target byte bounds", () => {
  for (const mode of ["target-token", "pointer-before-owner", "pointer-after-owner", "target-start", "target-end", "target-empty", "owner-end", "body-size"]) {
    const f = fixture(), r = raw(f.source.records[1]), owner = r.graph.objects[0], target = r.graph.objects[1];
    if (mode === "target-token") target.token = 9;
    if (mode === "pointer-before-owner") { owner.fields.m_pParams.offset = 1; r.graph.edges[0].pointer_offset = 1; }
    if (mode === "pointer-after-owner") { owner.fields.m_pParams.offset = 45; r.graph.edges[0].pointer_offset = 45; }
    if (mode === "target-start") target.start = -1;
    if (mode === "target-end") target.fields_end = 61;
    if (mode === "target-empty") target.start = target.fields_end;
    if (mode === "owner-end") owner.fields_end = 61;
    if (mode === "body-size") r.source.body_bytes = 59;
    assert.equal(buildNativeParameterInventory(f).values.length, 0, mode);
  }
});
test("native parameter contracts are restricted to measured Revit 2024–2026 schemas", () => {
  for (const year of [2019, 2023, 2027, 9999]) {
    const f = fixture(); raw(f.source.summary).revit_version = year;
    const i = buildNativeParameterInventory(f); assert.equal(i.status, "unsupported"); assert.equal(i.values.length, 0); assert.equal(i.definitions.length, 0);
  }
  for (const year of [2024, 2025, 2026]) {
    const f = fixture(); raw(f.source.summary).revit_version = year; assert.equal(buildNativeParameterInventory(f).values.length, 1);
  }
});


test("unresolved-slot inventory cap preserves partial status rather than silently claiming completeness", () => {
  const f = fixture(), r = raw(f.source.records[1]), slot = r.graph.objects[1].fields.m_params[0];
  r.graph.objects[1].fields.m_params = Array.from({ length: 100_001 }, () => ({ ...slot, m_paramId: identifier(-123) }));
  const i = buildNativeParameterInventory(f);
  assert.equal(i.unresolvedSlots.length, 100_000); assert.equal(i.status, "partial");
  assert.ok(i.diagnostics.some(s => s.includes("reached the adapter limit")));
});
function inheritanceFixture(): NativeEvidenceReport {
  const f = fixture();
  for (const [elementId, className, relation] of [[100, "Family", {}], [300, "FamilyInstance", { m_masterSymbolId: identifier(200) }]] as const) {
    f.source.records.push({ status: "complete_bounded_graph", diagnostic: null, class_name: className, identity: { element_id: elementId }, source: { body_bytes: 40, body_sha256: SHA, stream: "Partitions/3", group_record_offset: elementId }, graph: { consumed_bytes: 40, objects: [{ class_name: className, class_tag: 500, token: 0, start: 2, fields_end: 40, fields: { m_id: identifier(elementId), ...relation } }], edges: [] } });
  }
  return f;
}
test("serialized symbol type values resolve through retained exact instance→symbol→family identity", () => {
  const i = buildNativeParameterInventory(inheritanceFixture());
  assert.equal(i.values.length, 1); assert.equal(i.resolvedValues.length, 2);
  const v = i.resolvedValues[1]; assert.equal(v.resolution, "inherited-symbol"); assert.equal(v.ownerElementId, "300"); assert.equal(v.valueOwnerElementId, "200");
  assert.equal(v.rawValue, 2.5); assert.equal(v.sourceValueIndex, 0); assert.deepEqual(v.relationshipWitnesses.map(r => r.ownerElementId), ["300", "200", "100"]);
  assert.equal(v.relationshipWitnesses[0].source.fieldByteOffset, null);
  assert.ok(makeNativeParameterInventoryCsv(i).includes("\r\nresolved-value,"));
});
test("missing/contradictory retained namespace or current symbol links do not infer inherited values", () => {
  for (const mode of ["family-missing", "symbol-missing", "registry-mismatch", "instance-symbol-mismatch", "duplicate-instance", "invalid-instance-span"]) {
    const f = inheritanceFixture();
    if (mode === "family-missing") f.source.records.splice(2, 1);
    if (mode === "symbol-missing") f.source.records.splice(1, 1);
    if (mode === "registry-mismatch") raw(f.source.summary).parameter_binding_context.symbol_families[200] = 101;
    if (mode === "instance-symbol-mismatch") raw(f.source.records[3]).graph.objects[0].fields.m_masterSymbolId = identifier(201);
    if (mode === "duplicate-instance") f.source.records.push(structuredClone(f.source.records[3]));
    if (mode === "invalid-instance-span") raw(f.source.records[3]).graph.objects[0].fields_end = 50;
    assert.equal(buildNativeParameterInventory(f).resolvedValues.filter(v => v.resolution === "inherited-symbol").length, 0, mode);
  }
});
test("stored instance flags and definition instance parameters block symbol type inheritance", () => {
  for (const mode of ["slot-instance", "definition-instance", "no-type-proof"]) {
    const f = inheritanceFixture();
    if (mode === "slot-instance") raw(f.source.records[1]).graph.objects[1].fields.m_params[0].m_instance = true;
    if (mode === "definition-instance") raw(f.source.summary).parameter_definitions[10].owner_fields.m_instanceParam = true;
    if (mode === "no-type-proof") { raw(f.source.records[1]).graph.objects[1].fields.m_params[0].m_instance = null; raw(f.source.summary).parameter_definitions[10].owner_class = "ParamElemGlobal"; raw(f.source.summary).parameter_definitions[10].owner_fields.m_bindingIds = []; }
    assert.equal(buildNativeParameterInventory(f).resolvedValues.filter(v => v.resolution === "inherited-symbol").length, 0, mode);
  }
});
test("present instance values take precedence; contradictory present slots block fallback to a symbol", () => {
  for (const conflict of [false, true]) {
    const f = inheritanceFixture(), instance = raw(f.source.records[3]);
    instance.graph = structuredClone(raw(f.source.records[1]).graph); instance.source.body_bytes = 60;
    instance.graph.objects[0].class_name = "FamilyInstance"; instance.graph.objects[0].fields.m_id = identifier(300);
    instance.graph.objects[0].fields.m_masterSymbolId = identifier(200);
    instance.graph.objects[0].fields.m_pInstParams = instance.graph.objects[0].fields.m_pParams; delete instance.graph.objects[0].fields.m_pParams;
    const slot = instance.graph.objects[1].fields.m_params[0]; slot.m_value = 7;
    if (conflict) instance.graph.objects[1].fields.m_params.push({ ...slot, m_value: 8 });
    const i = buildNativeParameterInventory(f);
    assert.equal(i.resolvedValues.filter(v => v.resolution === "inherited-symbol").length, 0);
    assert.equal(i.resolvedValues.find(v => v.ownerElementId === "300")?.rawValue, conflict ? undefined : 7);
  }
});
test("project type binding requires exact native category and symbol-kind proof", () => {
  for (const mode of ["valid", "instance-binding", "different-category", "missing-backlink"]) {
    const f = inheritanceFixture(), summary = raw(f.source.summary);
    summary.parameter_definitions[10].owner_class = "ParamElemProject";
    delete summary.parameter_definitions[10].owner_fields.m_famId;
    if (mode === "instance-binding") summary.parameter_binding_context.bindings[30].elem_or_symbol = 1;
    if (mode === "different-category") summary.parameter_binding_context.family_categories[100] = -2000000;
    if (mode === "missing-backlink") summary.parameter_definitions[10].owner_fields.m_bindingIds = [];
    const i = buildNativeParameterInventory(f);
    assert.equal(i.resolvedValues.filter(v => v.resolution === "inherited-symbol").length, mode === "valid" ? 1 : 0, mode);
  }
});
