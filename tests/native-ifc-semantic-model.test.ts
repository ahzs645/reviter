import assert from "node:assert/strict";
import test from "node:test";
import { IfcParser } from "@ifc-lite/parser";
import { decodeNativeIfcSemanticModel, IFC_SEMANTIC_READER_COMMIT, refineIfcClassFromModel, mergeIfcPropertySets } from "../lib/reviter/native-ifc-semantic-model.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
const context = { revitVersion: 2025, readerCommit: IFC_SEMANTIC_READER_COMMIT, readerMode: "typed-no-geometry", declaredElementIds: new Set([10, 11]) };
const model = () => ({ entities: [
  { kind: "BuildingElement", type_guid: "10", ifc_type: "IFCDUCTSEGMENT", property_set: { name: "RvtElementRecordGeometry", properties: [
    { name: "TypeName", value: { kind: "Text", value: "Native duct type" } }, { name: "RevitClass", value: { kind: "Text", value: "RbsDuctCurve" } },
  ] } },
  { kind: "ElementPropertySet", element: 0, set: { name: "Pset_DuctSegmentTypeCommon", properties: [
    { name: "Length", value: { kind: "PositiveLengthFeet", value: 10 } }, { name: "Shape", value: { kind: "Enumerated", value: ["RECTANGULAR"] } },
  ] } },
] });

test("same-byte pinned model properties retain declared owner, units and schema value kinds", () => {
  const result = decodeNativeIfcSemanticModel(model(), context);
  assert.equal(result.elements[0]?.elementId, 10);
  assert.equal(result.elements[0]?.typeName, "Native duct type");
  assert.deepEqual(result.elements[0]?.propertySets[0]?.properties, [
    { name: "Length", type: "IFCPOSITIVELENGTHMEASURE", value: 3.048 },
    { name: "Shape", type: "IFCLABEL", kind: "enumerated", value: ["RECTANGULAR"] },
  ]);
});

test("model projection rejects release/commit drift, undeclared ids and duplicate ownership", () => {
  assert.deepEqual(decodeNativeIfcSemanticModel(model(), { ...context, readerCommit: "unknown" }).elements, []);
  assert.deepEqual(decodeNativeIfcSemanticModel(model(), { ...context, revitVersion: 2027 }).elements, []);
  assert.deepEqual(decodeNativeIfcSemanticModel(model(), { ...context, declaredElementIds: new Set([11]) }).elements, []);
  const duplicate = model(); duplicate.entities.push(duplicate.entities[0]!);
  assert.deepEqual(decodeNativeIfcSemanticModel(duplicate, context).elements, []);
});

test("unknown property sets, nonfinite measures, invalid shapes and bad entity references are rejected", () => {
  const corrupt = model();
  corrupt.entities[1]!.set!.properties[0]!.value = { kind: "PositiveLengthFeet", value: Infinity };
  corrupt.entities[1]!.set!.properties[1]!.value = { kind: "Enumerated", value: ["RECTANGULAR);INJECT"] };
  assert.deepEqual(decodeNativeIfcSemanticModel(corrupt, context).elements[0]?.propertySets, []);
  const badRef = model(); badRef.entities[1]!.element = 99;
  assert.deepEqual(decodeNativeIfcSemanticModel(badRef, context).elements[0]?.propertySets, []);
  const unreserved = model(); unreserved.entities[1]!.set!.name = "Pset_Invented";
  assert.deepEqual(decodeNativeIfcSemanticModel(unreserved, context).elements[0]?.propertySets, []);
});

test("source conflicts cannot become a standard property through a later duplicate", () => {
  const a = { name: "Pset_DuctSegmentTypeCommon", properties: [{ name: "Length", type: "IFCPOSITIVELENGTHMEASURE" as const, value: 1 }] };
  const b = { name: "Pset_DuctSegmentTypeCommon", properties: [{ name: "Length", type: "IFCPOSITIVELENGTHMEASURE" as const, value: 2 }] };
  assert.deepEqual(mergeIfcPropertySets([a], [b], [a]), []);
  assert.equal(mergeIfcPropertySets([a], [a])[0]?.properties.length, 1);
  const reordered = { name: a.name, properties: [{ type: "IFCPOSITIVELENGTHMEASURE" as const, value: 1, name: "Length" }] };
  assert.equal(mergeIfcPropertySets([a], [reordered])[0]?.properties.length, 1, "JSON key order is not source disagreement");
  const samePrecision = { name: a.name, properties: [{ name: "Length", type: "IFCPOSITIVELENGTHMEASURE" as const, value: 1.000000000000001 }] };
  assert.equal(mergeIfcPropertySets([a], [samePrecision])[0]?.properties.length, 1, "the last arithmetic bit does not alter an emitted measure");
});

test("curtain classification refines only an unresolved native wall type and never a display name", () => {
  const fallback = { entity: "IFCWALL", typeEntity: "IFCWALLTYPE", predefinedType: ".NOTDEFINED." };
  const e = { elementId: 10, entityIndex: 0, ifcClass: { entity: "IFCCURTAINWALL", typeEntity: "IFCCURTAINWALLTYPE", predefinedType: ".NOTDEFINED." }, revitClass: "SWall", propertySets: [] };
  assert.equal(refineIfcClassFromModel(fallback, undefined, e).entity, "IFCCURTAINWALL");
  assert.equal(refineIfcClassFromModel(fallback, "basic", e).entity, "IFCWALL");
  assert.equal(refineIfcClassFromModel(fallback, undefined, { ...e, revitClass: "Curtain-looking label" }).entity, "IFCWALL");
});

test("export emits measured duct shape enumeration without modifying geometry", async () => {
  const result = ifcExportFixture();
  result.elementBounds[0]!.categoryId = -2008000;
  result.nativeIfcSemanticEvidence = decodeNativeIfcSemanticModel(model(), context);
  const before = Array.from(result.meshes[0]!.positions);
  const source = makeIfc(result);
  assert.match(source, /IFCPROPERTYENUMERATEDVALUE\('Shape',\$,\(IFCLABEL\('RECTANGULAR'\)\),\$\)/);
  assert.match(source, /'Length',\$,IFCPOSITIVELENGTHMEASURE\(3\.048\)/);
  const parsed = await new IfcParser().parseColumnar(new TextEncoder().encode(source).buffer);
  assert.ok([...parsed.entities.expressId].some(id => parsed.entities.getTypeName(id) === "IfcDuctSegment"));
  assert.deepEqual(Array.from(result.meshes[0]!.positions), before);
});

test("native type ids require declared source identity and model booleans cannot supply defaults", () => {
  const sample = { entities: [...model().entities, { kind: "ElementPropertySet", element: 0, set: { name: "Other", properties: [{ name: "Type Id", value: { kind: "Label", value: "20" } }] } }] };
  assert.equal(decodeNativeIfcSemanticModel(sample, context).elements[0]?.typeId, undefined);
  assert.equal(decodeNativeIfcSemanticModel(sample, { ...context, declaredElementIds: new Set([10, 11, 20]) }).elements[0]?.typeId, 20);
  const wall = { entities: [
    { kind: "BuildingElement", type_guid: "10", ifc_type: "IFCWALL" },
    { kind: "ElementPropertySet", element: 0, set: { name: "Pset_WallCommon", properties: [{ name: "IsExternal", value: { kind: "Boolean", value: false } }] } },
  ] };
  assert.deepEqual(decodeNativeIfcSemanticModel(wall, context).elements[0]?.propertySets, []);
});

test("native horizontal export override refinement remains limited to its original record family", () => {
  const slab = { entity: "IFCSLAB", typeEntity: "IFCSLABTYPE", predefinedType: ".FLOOR." };
  const e = { elementId: 10, entityIndex: 0, ifcClass: { entity: "IFCSHADINGDEVICE", typeEntity: "IFCSHADINGDEVICETYPE", predefinedType: ".AWNING." }, revitClass: "Floor", propertySets: [] };
  assert.equal(refineIfcClassFromModel(slab, undefined, e).entity, "IFCSHADINGDEVICE");
  assert.equal(refineIfcClassFromModel(slab, undefined, { ...e, revitClass: "FamilyInstance" }).entity, "IFCSLAB");
});
