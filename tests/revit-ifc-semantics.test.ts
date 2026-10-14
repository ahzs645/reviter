import assert from "node:assert/strict";
import test from "node:test";
import { IfcExportParameterCollector, resolveIfcExportClass, revitIfcGlobalId, revitIfcGlobalIdFromUniqueId } from "../lib/reviter/revit-ifc-semantics.ts";

const base = { entity: "IFCWALL", typeEntity: "IFCWALLTYPE", predefinedType: ".NOTDEFINED." };

test("Revit GlobalIds agree with upstream paired Snowdon exports, including byte order", () => {
  // Source-authoring IFC witness vectors from rvt-rs, see vendor/rvt-rs/NOTICE.md.
  assert.equal(revitIfcGlobalId("50f92000-82f8-4258-b6a8-bb42c01b00a0", 619340), "1G_I00WlX2MBQekqB04dFi");
  assert.equal(revitIfcGlobalId("50f92000-82f8-4258-b6a8-bb42c01b00a0", 619404), "1G_I00WlX2MBQekqB04dCi");
  assert.equal(revitIfcGlobalIdFromUniqueId("50f92000-82f8-4258-b6a8-bb42c01b00a0-0009734c"), "1G_I00WlX2MBQekqB04dFi");
});

test("GlobalId reconstruction rejects invalid GUIDs and handles without truncation", () => {
  for (const id of [0, -1, 0x1_0000_0000, 1.5, NaN, Infinity]) {
    assert.equal(revitIfcGlobalId("50f92000-82f8-4258-b6a8-bb42c01b00a0", id), null);
  }
  assert.equal(revitIfcGlobalId("00000000-0000-0000-0000-000000000000", 1), null);
  assert.equal(revitIfcGlobalId("invalid", 10), null);
  assert.equal(revitIfcGlobalIdFromUniqueId("50f92000-82f8-4258-b6a8-bb42c01b00a0-100000000"), null);
  assert.equal(revitIfcGlobalIdFromUniqueId(undefined), null);
});

test("owned export parameters discard conflicting copies permanently and inherit unset text", () => {
  const collector = new IfcExportParameterCollector();
  const parameter = (parameterId: number, value: number | string) => ({ parameterId, name: "test", value });
  collector.add(10, [parameter(-1019014, "IfcSlab"), parameter(-1019016, "ROOF")]);
  collector.add(10, [parameter(-1019014, "IfcCovering")]);
  collector.add(10, [parameter(-1019014, "IfcSlab"), parameter(-1019016, "ROOF")]);
  collector.add(20, [parameter(-1019015, "  IfcCoveringType  "), parameter(-1019017, "CLADDING")]);
  collector.add(30, [parameter(-1019014, "   "), parameter(-1019016, 5)]);
  assert.deepEqual(collector.entries(), [
    { elementId: 10, provenance: "owned-element-parameter-table", predefinedType: "ROOF" },
    { elementId: 20, provenance: "owned-element-parameter-table", typeExportAs: "IfcCoveringType", typePredefinedType: "CLADDING" },
  ]);
});

test("instance class and predefined type take precedence over type settings", () => {
  const inherited = resolveIfcExportClass(base, {}, { typeExportAs: "iFcCoveringType", typePredefinedType: "cLaDdInG" });
  assert.deepEqual(inherited.ifcClass, { entity: "IFCCOVERING", typeEntity: "IFCCOVERINGTYPE", predefinedType: ".CLADDING." });
  assert.equal(inherited.entityStatus, "type-override");
  const instance = resolveIfcExportClass(base, { exportAs: "ifcSlab", predefinedType: "ROOF" }, { typeExportAs: "IfcCoveringType", typePredefinedType: "CLADDING" });
  assert.deepEqual(instance.ifcClass, { entity: "IFCSLAB", typeEntity: "IFCSLABTYPE", predefinedType: ".ROOF." });
  assert.equal(instance.entityStatus, "instance-override");
});

test("unimplemented entities and invalid or cross-entity enums remain explicit unsupported evidence", () => {
  for (const entity of ["IfcSpace", "IfcDistributionPort", "IfcUnknown", "IfcWallType", "IfcWall);#9=IFCWALL("]) {
    const resolved = resolveIfcExportClass(base, { exportAs: entity, predefinedType: "ROOF" }, { typeExportAs: "IfcCoveringType" });
    assert.deepEqual(resolved.ifcClass, base);
    assert.equal(resolved.entityStatus, "unsupported-override");
    assert.equal(resolved.predefinedTypeStatus, "unsupported");
  }
  assert.equal(resolveIfcExportClass(base, { predefinedType: "ROOF" }, undefined).predefinedTypeStatus, "unsupported");
  assert.equal(resolveIfcExportClass(base, { predefinedType: "USERDEFINED" }, undefined).predefinedTypeStatus, "unsupported");
  assert.equal(resolveIfcExportClass(base, { predefinedType: "USERDEFINED" }, undefined, true).ifcClass.predefinedType, ".USERDEFINED.");
});

test("IFC settings are read from their owning element table, including a type without geometry", async () => {
  const { collectElementParameters } = await import("../lib/reviter/element-parameters.ts");
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  const start = 16;
  const elementId = 20; // Type element, which needs no scene/bounds record.
  view.setUint32(start, elementId, true);
  view.setUint32(start + 12, 300, true);
  let at = start + 18;
  for (let field = 0; field < 6; field += 1) {
    if (field === 2) { view.setInt32(at, -1, true); at += 6; }
    else at += 4;
  }
  at += 4; // m_constrInfo
  data.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0, 0, 0], at);
  view.setUint32(at + 10, elementId, true);
  at += 10 + 8 + 7 * 8 + 3;
  view.setUint32(at, 2, true); at += 4;
  for (const [id, value] of [[-1019015, "IfcCoveringType"], [-1019017, "CLADDING"]] as const) {
    view.setBigInt64(at, BigInt(id), true);
    view.setUint32(at + 8, value.length, true);
    at += 12;
    for (const character of value) { view.setUint16(at, character.charCodeAt(0), true); at += 2; }
  }
  view.setUint32(start + 300 + 16, 300, true);
  const collector = new IfcExportParameterCollector();
  const tables = collectElementParameters(data);
  assert.equal(tables.length, 1);
  collector.add(tables[0]!.elementId, tables[0]!.parameters);
  assert.deepEqual(collector.entries(), [{ elementId: 20, typeExportAs: "IfcCoveringType", typePredefinedType: "CLADDING", provenance: "owned-element-parameter-table" }]);
  // Without the owner's live string-value-set pointer, nearby text is not evidence.
  view.setInt32(start + 18 + 8, 0, true);
  assert.equal(collectElementParameters(data).length, 0);
});
