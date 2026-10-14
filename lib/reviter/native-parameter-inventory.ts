/** File-local definitions and serialized values. Captions never select a value slot.
 * Source contracts: pinned rvt-rs native_parameter_definitions.rs/native_metadata.rs.
 */
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";
import { scheduleCsvCell } from "./export-schedules.ts";

type Fields = Record<string, unknown>;
export type NativeParameterStorage = "Double" | "Integer" | "String" | "ElementId";
export type NativeParameterSource = {
  stream: string; groupRecordOffset: number; bodySha256: string;
  sourceObject: number; rootPointerField: string; pointerOffset: number;
};
export type NativeParameterDefinition = {
  parameterId: string; caption: string; definitionClass: string; ownerClass: string;
  storageType: NativeParameterStorage | null; specTypeId: string | null; typeId: string | null;
  groupTypeId: string | null; sharedGuid: string | null; familyId: string | null;
  instanceParameter: boolean | null; bindingIds: string[]; sourceObject: number;
  evidence: "retained-native-owner-edge" | "native-registry-projection";
  source: NativeParameterSource | null;
  displayUnitTypeId: string | null;
  displayUnitResolution: "resolved-native-project-units" | "not-applicable" | "unresolved" | "conflicting-native-project-units";
  displayUnitFormat: unknown;
};
export type NativeParameterBinding = {
  bindingId: string; parameterId: string; categoryId: string; ownerKind: "instance" | "symbol";
  evidence: "native-category-binding-with-definition-backlink";
};
export type NativeParameterValue = {
  ownerElementId: string; ownerClass: string; parameterId: string; storageType: NativeParameterStorage;
  rawValue: string | number; valueSemantics: "serialized-not-evaluated";
  valueSource: "family-slot" | "owner-typed-parameter-set";
  source: NativeParameterSource; expressionPointer: unknown;
  storedInstanceFlag: boolean | null; reporting: boolean | null;
};
export type NativeUnresolvedParameterSlot = {
  ownerElementId: string; parameterId: string | null; sourceObject: number | null;
  reason: string; raw: unknown;
};
export type NativeParameterInventory = {
  apiVersion: 1; kind: "native-parameter-inventory"; sourceSha256: string | null;
  readerCommit: string; schemaSha256: string | null; revitVersion: number | null;
  status: NativeEvidenceReport["source"]["status"];
  definitions: NativeParameterDefinition[]; bindings: NativeParameterBinding[];
  values: NativeParameterValue[]; unresolvedSlots: NativeUnresolvedParameterSlot[];
  diagnostics: string[]; limits: typeof LIMITS;
  scope: string;
};
export const NATIVE_PARAMETER_DEFINITION_CLASSES = ["UnitsElem", "ParamElemExternal", "ParamElemFamily", "ParamElemProject", "ParamElemGlobal", "ParamBinding"] as const;
export const NATIVE_PARAMETER_OWNER_CLASSES = ["Family", "FamilySymbol", "FamilyInstance"] as const;
export const NATIVE_PARAMETER_INVENTORY_CLASSES = [...NATIVE_PARAMETER_DEFINITION_CLASSES, ...NATIVE_PARAMETER_OWNER_CLASSES] as const;
const LIMITS = { definitions: 20_000, bindings: 20_000, records: 4096, values: 100_000, units: 4096, diagnostics: 256 } as const;
const STORE: Record<string, NativeParameterStorage> = {
  ParamDefString: "String", ParamDefValue: "Double", ParamDefInt: "Integer",
  ParamDefYesNo: "Integer", ParamDefMaterialBrowse: "ElementId",
};
const SPEC: Record<string, string> = {
  ParamDefString: "autodesk.spec:spec.string-2.0.0", ParamDefInt: "autodesk.spec:spec.int64-2.0.0",
  ParamDefYesNo: "autodesk.spec:spec.bool-1.0.0", ParamDefMaterialBrowse: "autodesk.spec.aec:material-1.0.0",
};
const SETS: Record<string, [string, NativeParameterStorage]> = {
  m_pParamValueSetDouble: ["ParamValueSetDouble", "Double"],
  m_pParamValueSetInt: ["ParamValueSetInt", "Integer"],
  m_pParamValueSetAString: ["ParamValueSetAString", "String"],
  m_pParamValueSetElementId: ["ParamValueSetElementId", "ElementId"],
};
const obj = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string | null => typeof v === "string" ? v : null;
const index = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const hash = (v: unknown): string | null => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : null;
function id(v: unknown, depth = 0): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : null;
  if (typeof v === "string") return /^-?(0|[1-9][0-9]*)$/.test(v) && v !== "-0" && v.length <= 21 ? v : null;
  if (depth > 4) return null;
  const o = obj(v); return "m_id" in o ? id(o.m_id, depth + 1) : "m_id64" in o ? id(o.m_id64, depth + 1) : null;
}
const positive = (v: string | null): v is string => v !== null && /^[1-9][0-9]*$/.test(v);
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, n) => same(v, b[n]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ak = Object.keys(a), bk = Object.keys(b); return ak.length === bk.length && ak.every(k => k in b && same(obj(a)[k], obj(b)[k]));
  }
  return false;
};
function rawValue(v: unknown, storage: NativeParameterStorage): string | number | null {
  if (storage === "ElementId") return id(v);
  if (storage === "String") return str(v);
  if (storage === "Integer") return id(v);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function linked(graph: Fields, owner: number, field: string): { target: number; offset: number } | null {
  const objects = array(graph.objects), root = obj(objects[owner]);
  const pointer = obj(obj(root.fields)[field]);
  const offset = index(pointer.offset), consumedBytes = index(graph.consumed_bytes);
  const ownerStart = index(root.start), ownerEnd = index(root.fields_end);
  if (consumedBytes === null || consumedBytes === 0 || ownerStart === null || ownerEnd === null || ownerStart >= ownerEnd || ownerEnd > consumedBytes || offset === null || offset < ownerStart || offset >= ownerEnd || index(pointer.pointer_token) === null || pointer.pointer_token === 0) return null;
  const edges = array(graph.edges).map(obj).filter(e => e.source_object_index === owner && e.pointer_offset === offset);
  if (edges.length !== 1 || edges[0].pointer_token !== pointer.pointer_token || edges[0].target_class_tag !== pointer.class_tag) return null;
  const target = index(edges[0].target_object_index);
  if (target === null) return null;
  const targetObject = obj(objects[target]), targetStart = index(targetObject.start), targetEnd = index(targetObject.fields_end);
  if (targetObject.class_tag !== pointer.class_tag || targetObject.token !== pointer.pointer_token || targetStart === null || targetEnd === null || targetStart >= targetEnd || targetEnd > consumedBytes) return null;
  return { target, offset };
}
function source(record: Fields, sourceObject: number, field: string, offset: number): NativeParameterSource | null {
  const s = obj(record.source); const bodySha256 = hash(s.body_sha256);
  const stream = str(s.stream), groupRecordOffset = index(s.group_record_offset);
  return bodySha256 && stream && groupRecordOffset !== null ? { stream, groupRecordOffset, bodySha256, sourceObject, rootPointerField: field, pointerOffset: offset } : null;
}

export function buildNativeParameterInventory(report: NativeEvidenceReport): NativeParameterInventory {
  const summary = obj(report.source.summary);
  const inventory: NativeParameterInventory = {
    apiVersion: 1, kind: "native-parameter-inventory", sourceSha256: hash(report.sourceSha256), readerCommit: report.readerCommit,
    schemaSha256: hash(summary.schema_sha256), revitVersion: index(summary.revit_version), status: report.source.status,
    definitions: [], bindings: [], values: [], unresolvedSlots: [], diagnostics: [], limits: LIMITS,
    scope: "File-local native definitions, category bindings and present owner values from retained complete graphs. Values remain internal serialized units; display-unit identifiers do not convert them. No formula evaluation, type inheritance, built-in definition catalog or HasValue claim for absent values.",
  };
  const diagnostic = (message: string) => { if (inventory.status === "complete") inventory.status = "partial"; if (inventory.diagnostics.length < LIMITS.diagnostics) inventory.diagnostics.push(message); };
  if (report.source.apiVersion !== 1 || report.source.kind !== "native-source-evidence" || !inventory.sourceSha256 || !inventory.schemaSha256 || report.readerPatch !== "native-evidence" || report.readerCommit !== "1c3d337dbd2a6810e9dfad68fe99857843d67387") {
    diagnostic("Exact source SHA-256, native-evidence reader pin and file-local schema SHA-256 are required.");
    inventory.status = "unsupported"; return inventory;
  }
  if (![2024, 2025, 2026].includes(inventory.revitVersion ?? 0)) {
    diagnostic("Native parameter definition/value contracts are qualified for Revit 2024–2026 only.");
    inventory.status = "unsupported"; return inventory;
  }
  if (inventory.status === "budget-blocked" || inventory.status === "unsupported") return inventory;
  const definitionDiagnostics = Object.values(obj(summary.definition_diagnostics));
  const conflictingUnits = definitionDiagnostics.some(v => typeof v === "string" && v.includes("conflicting native unit registries"));
  if (conflictingUnits) diagnostic("Conflicting native UnitsElem registries: display units remain unresolved for the whole document.");
  const formats = obj(summary.unit_formats);
  const unitEntries = Object.entries(formats);
  if (unitEntries.length > LIMITS.units) { diagnostic("Unit format inventory exceeds its limit."); inventory.status = "partial"; }
  const unitsUsable = !conflictingUnits && unitEntries.length <= LIMITS.units;
  const definitions = new Map<string, NativeParameterDefinition>();
  for (const [key, raw] of Object.entries(obj(summary.parameter_definitions)).slice(0, LIMITS.definitions)) {
    const d = obj(raw), fields = obj(d.definition_fields), owner = obj(d.owner_fields);
    const parameterId = id(d.parameter_id), definitionClass = str(d.definition_class), ownerClass = str(d.owner_class);
    if (!positive(parameterId) || parameterId !== key || id(fields.m_paramElemId) !== parameterId || !definitionClass || !ownerClass || typeof d.caption !== "string" || fields.m_caption !== d.caption || index(d.source_object) === null) {
      diagnostic(`Definition ${key} has inconsistent native identity or fields.`); continue;
    }
    const expectedStorage = STORE[definitionClass] ?? null;
    if (expectedStorage !== (d.storage_type ?? null)) { diagnostic(`Definition ${key} storage disagrees with its concrete class.`); continue; }
    const savedSpec = str(obj(fields.m_specTypeId).m_typeId), specTypeId = savedSpec ?? SPEC[definitionClass] ?? null;
    if ((savedSpec && SPEC[definitionClass] && savedSpec !== SPEC[definitionClass]) || specTypeId !== (d.spec_type_id ?? null)) {
      diagnostic(`Definition ${key} specification disagrees with native fields/class.`); continue;
    }
    const bindingIds = array(owner.m_bindingIds).map(v => id(v));
    if (bindingIds.some(v => v === null)) { diagnostic(`Definition ${key} has an invalid binding backlink.`); continue; }
    const format = unitsUsable && specTypeId ? formats[specTypeId] : undefined;
    const displayUnitTypeId = str(obj(obj(format).m_unitTypeId).m_typeId);
    definitions.set(parameterId, {
      parameterId, caption: d.caption, definitionClass, ownerClass, storageType: expectedStorage, specTypeId,
      typeId: str(obj(fields.m_typeId).m_typeId), groupTypeId: str(obj(fields.m_groupTypeId).m_typeId),
      sharedGuid: typeof d.shared_guid === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(d.shared_guid) ? d.shared_guid : null,
      familyId: id(owner.m_famId), instanceParameter: typeof owner.m_instanceParam === "boolean" ? owner.m_instanceParam : null,
      bindingIds: bindingIds as string[], sourceObject: d.source_object as number,
      evidence: "native-registry-projection", source: null,
      displayUnitTypeId: displayUnitTypeId || null,
      displayUnitResolution: conflictingUnits && expectedStorage === "Double" ? "conflicting-native-project-units" : displayUnitTypeId ? "resolved-native-project-units" : expectedStorage && expectedStorage !== "Double" ? "not-applicable" : "unresolved",
      displayUnitFormat: displayUnitTypeId ? format : null,
    });
  }
  if (Object.keys(obj(summary.parameter_definitions)).length > LIMITS.definitions) { diagnostic("Definition inventory truncated at its limit."); inventory.status = "partial"; }
  const context = obj(summary.parameter_binding_context);
  for (const [key, raw] of Object.entries(obj(context.bindings)).slice(0, LIMITS.bindings)) {
    const b = obj(raw), bindingId = id(b.binding_id), parameterId = id(b.parameter_id), categoryId = id(b.category_id);
    const definition = parameterId ? definitions.get(parameterId) : undefined;
    if (!positive(bindingId) || bindingId !== key || !definition || !categoryId || !definition.bindingIds.includes(bindingId) || (b.elem_or_symbol !== 1 && b.elem_or_symbol !== 2)) {
      diagnostic(`Binding ${key} lacks a consistent native definition backlink/category/kind.`); continue;
    }
    inventory.bindings.push({ bindingId, parameterId: definition.parameterId, categoryId, ownerKind: b.elem_or_symbol === 1 ? "instance" : "symbol", evidence: "native-category-binding-with-definition-backlink" });
  }
  if (Object.keys(obj(context.bindings)).length > LIMITS.bindings) { diagnostic("Binding inventory truncated at its limit."); inventory.status = "partial"; }
  const records = report.source.records.slice(0, LIMITS.records).map(obj);
  const ownerCounts = new Map<string, number>();
  for (const r of records) { const n = id(obj(r.identity).element_id); if (n) ownerCounts.set(n, (ownerCounts.get(n) ?? 0) + 1); }
  const values = new Map<string, NativeParameterValue>(), rejectedKeys = new Set<string>();
  const unresolved = (ownerElementId: string, parameterId: string | null, sourceObject: number | null, reason: string, raw: unknown) => {
    if (inventory.unresolvedSlots.length < LIMITS.values) inventory.unresolvedSlots.push({ ownerElementId, parameterId, sourceObject, reason, raw });
    else inventory.status = "partial";
    if (reason === "ambiguous-owner-value" || reason === "definition-family-owner-mismatch" || reason === "typed-owner-value-definition-disagreement" || reason === "invalid-native-slot-fields") inventory.status = "partial";
  };
  const add = (v: NativeParameterValue) => {
    const key = `${v.ownerElementId}:${v.parameterId}`, previous = values.get(key);
    if (rejectedKeys.has(key)) return;
    if (previous && (!same(previous.rawValue, v.rawValue) || previous.storageType !== v.storageType || previous.source.sourceObject !== v.source.sourceObject || previous.valueSource !== v.valueSource)) {
      values.delete(key); rejectedKeys.add(key); unresolved(v.ownerElementId, v.parameterId, v.source.sourceObject, "ambiguous-owner-value", [previous, v]); return;
    }
    if (values.size >= LIMITS.values) { inventory.status = "partial"; return; }
    values.set(key, v);
  };
  for (const record of records) {
    const graph = obj(record.graph), objects = array(graph.objects), root = obj(objects[0]), fields = obj(root.fields);
    const ownerElementId = id(obj(record.identity).element_id);
    if (!positive(ownerElementId) || ownerCounts.get(ownerElementId) !== 1 || record.status !== "complete_bounded_graph" || record.diagnostic != null || id(fields.m_id) !== ownerElementId || root.class_name !== record.class_name || graph.consumed_bytes !== obj(record.source).body_bytes) {
      if ((ownerElementId && definitions.has(ownerElementId)) || ["Family", "FamilySymbol", "FamilyInstance"].includes(String(record.class_name))) diagnostic(`Parameter owner ${ownerElementId ?? "unresolved"} lacks consistent complete graph identity/body bounds.`);
      continue;
    }
    const definition = definitions.get(ownerElementId);
    if (definition) {
      const edge = linked(graph, 0, "m_pParamDef"), target = edge ? obj(objects[edge.target]) : {};
      if (root.class_name === definition.ownerClass && edge && edge.target === definition.sourceObject && target.class_name === definition.definitionClass && same(target.fields, obj(obj(summary.parameter_definitions)[ownerElementId]).definition_fields)) {
        const witness = source(record, edge.target, "m_pParamDef", edge.offset);
        if (witness) { definition.evidence = "retained-native-owner-edge"; definition.source = witness; }
      }
    }
    const ownerClass = str(root.class_name);
    if (!ownerClass || !["Family", "FamilySymbol", "FamilyInstance"].includes(ownerClass)) continue;
    let familyId: string | null = ownerClass === "Family" ? ownerElementId : ownerClass === "FamilySymbol" ? id(fields.m_familyId) : null;
    if (ownerClass === "FamilyInstance") {
      const symbolId = id(fields.m_masterSymbolId); familyId = symbolId ? id(obj(context.symbol_families)[symbolId]) : null;
    }
    const field = ownerClass === "Family" ? "m_familyParams" : ownerClass === "FamilySymbol" ? "m_pParams" : "m_pInstParams";
    const edge = linked(graph, 0, field), familyParams = edge ? obj(objects[edge.target]) : {};
    if (field in fields && obj(fields[field]).pointer_token !== 0 && (!edge || familyParams.class_name !== "FamilyParams")) diagnostic(`Parameter owner ${ownerElementId} ${field} has inconsistent native pointer token/class/byte bounds.`);
    if (edge && familyParams.class_name === "FamilyParams") {
      for (const raw of array(obj(familyParams.fields).m_params)) {
        const slot = obj(raw), parameterId = id(slot.m_paramId), definition = parameterId ? definitions.get(parameterId) : undefined;
        if (!definition?.storageType) { unresolved(ownerElementId, parameterId, edge.target, parameterId && parameterId.startsWith("-") ? "built-in-definition-catalog-unavailable" : "native-definition-storage-unresolved", slot); continue; }
        if (positive(definition.familyId) && (!familyId || definition.familyId !== familyId)) { unresolved(ownerElementId, parameterId, edge.target, "definition-family-owner-mismatch", slot); continue; }
        const fieldName = { Double: "m_value", Integer: "m_int", String: "m_str", ElementId: "m_elemId" }[definition.storageType];
        const value = rawValue(slot[fieldName], definition.storageType), witness = source(record, edge.target, field, edge.offset);
        if (value === null || !witness || typeof slot.m_instance !== "boolean" || typeof slot.m_reporting !== "boolean" || !("m_oExpression" in slot)) { unresolved(ownerElementId, parameterId, edge.target, "invalid-native-slot-fields", slot); continue; }
        add({ ownerElementId, ownerClass, parameterId: definition.parameterId, storageType: definition.storageType, rawValue: value, valueSource: "family-slot", source: witness, expressionPointer: slot.m_oExpression, storedInstanceFlag: slot.m_instance, reporting: slot.m_reporting, valueSemantics: "serialized-not-evaluated" });
      }
    }
    for (const [pointerField, [setClass, storageType]] of Object.entries(SETS)) {
      const setEdge = linked(graph, 0, pointerField), setObject = setEdge ? obj(objects[setEdge.target]) : {};
      if (!setEdge || setObject.class_name !== setClass) {
        if (pointerField in fields && obj(fields[pointerField]).pointer_token !== 0) diagnostic(`Parameter owner ${ownerElementId} ${pointerField} has inconsistent native pointer token/class/byte bounds.`);
        continue;
      }
      for (const raw of array(obj(setObject.fields).m_paramSet)) {
        const pair = obj(raw), parameterId = id(pair.m_paramId);
        if (!positive(parameterId)) continue;
        const definition = definitions.get(parameterId), value = rawValue(pair.m_value, storageType), witness = source(record, setEdge.target, pointerField, setEdge.offset);
        if (!definition || definition.storageType !== storageType || value === null || !witness) { unresolved(ownerElementId, parameterId, setEdge.target, "typed-owner-value-definition-disagreement", pair); continue; }
        if (positive(definition.familyId) && (!familyId || definition.familyId !== familyId)) { unresolved(ownerElementId, parameterId, setEdge.target, "definition-family-owner-mismatch", pair); continue; }
        add({ ownerElementId, ownerClass, parameterId, storageType, rawValue: value, valueSource: "owner-typed-parameter-set", source: witness, expressionPointer: null, storedInstanceFlag: null, reporting: null, valueSemantics: "serialized-not-evaluated" });
      }
    }
  }
  if (report.source.records.length > LIMITS.records) { inventory.status = "partial"; diagnostic("Retained owner records truncated at the adapter limit."); }
  if (values.size >= LIMITS.values || inventory.unresolvedSlots.length >= LIMITS.values) diagnostic("Owner values/slots reached the adapter limit.");
  inventory.definitions = [...definitions.values()]; inventory.values = [...values.values()];
  if (Object.keys(obj(summary.definition_diagnostics)).length) diagnostic(`${Object.keys(obj(summary.definition_diagnostics)).length} native definition/units extraction diagnostics remain in the raw evidence.`);
  return inventory;
}

/** CSV is a source inventory, not a Revit schedule/formula evaluation. */
export function makeNativeParameterInventoryCsv(inventory: NativeParameterInventory, options: { excelBom?: boolean } = {}): string {
  const definitions = new Map(inventory.definitions.map(d => [d.parameterId, d]));
  const rows: Array<Array<string | number | boolean | null | undefined>> = [["record_kind", "source_sha256", "schema_sha256", "inventory_status", "owner_element_id", "owner_class", "parameter_id", "caption", "storage_type", "raw_internal_value", "spec_type_id", "display_unit_type_id", "display_unit_resolution", "shared_guid", "binding_id", "category_id", "binding_owner_kind", "evidence", "value_semantics", "source_stream", "group_record_offset", "source_object", "pointer_field", "pointer_offset", "body_sha256", "stored_expression"]];
  for (const d of inventory.definitions) {
    const s = d.source;
    rows.push(["definition", inventory.sourceSha256, inventory.schemaSha256, inventory.status, d.parameterId, d.ownerClass, d.parameterId, d.caption, d.storageType, null, d.specTypeId, d.displayUnitTypeId, d.displayUnitResolution, d.sharedGuid, null, null, null, d.evidence, null, s?.stream, s?.groupRecordOffset, d.sourceObject, s?.rootPointerField, s?.pointerOffset, s?.bodySha256, null]);
  }
  for (const b of inventory.bindings) {
    const d = definitions.get(b.parameterId);
    rows.push(["binding", inventory.sourceSha256, inventory.schemaSha256, inventory.status, b.bindingId, "ParamBinding", b.parameterId, d?.caption, d?.storageType, null, d?.specTypeId, d?.displayUnitTypeId, d?.displayUnitResolution, d?.sharedGuid, b.bindingId, b.categoryId, b.ownerKind, b.evidence]);
  }
  for (const v of inventory.values) {
    const d = definitions.get(v.parameterId);
    rows.push(["value", inventory.sourceSha256, inventory.schemaSha256, inventory.status, v.ownerElementId, v.ownerClass, v.parameterId, d?.caption, v.storageType, v.rawValue, d?.specTypeId, d?.displayUnitTypeId, d?.displayUnitResolution, d?.sharedGuid, null, null, null, v.valueSource, v.valueSemantics, v.source.stream, v.source.groupRecordOffset, v.source.sourceObject, v.source.rootPointerField, v.source.pointerOffset, v.source.bodySha256, v.expressionPointer == null ? "" : JSON.stringify(v.expressionPointer)]);
  }
  if (rows.length === 1) rows.push(["inventory", inventory.sourceSha256, inventory.schemaSha256, inventory.status,
    null, null, null, null, null, null, null, null, null, null, null, null, null,
    inventory.scope, "serialized-not-evaluated"]);
  for (const row of rows) while (row.length < rows[0].length) row.push(null);
  return (options.excelBom ? "\ufeff" : "") + rows.map(row => row.map(scheduleCsvCell).join(",")).join("\r\n") + "\r\n";
}
