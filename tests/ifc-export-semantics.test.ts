import assert from "node:assert/strict";
import test from "node:test";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { resolveIfcClass, commonIfcPropertySets } from "../lib/reviter/ifc-export-semantics.ts";
import { createIfcExportParameterCollector } from "../lib/reviter/native-ifc-export-parameters.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
const parameter = (parameterId: number, value: string | number) => ({ parameterId, value, name: `Parameter ${parameterId}` });
const slab = { entity: "IFCSLAB", typeEntity: "IFCSLABTYPE", predefinedType: ".FLOOR." };

test("instance export overrides precede type values; unsupported enums and entities fail closed", () => {
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019014, "IfcShadingDevice"), parameter(-1019016, "awning")], [parameter(-1019015, "IfcCoveringType"), parameter(-1019017, "CLADDING")]), { entity: "IFCSHADINGDEVICE", typeEntity: "IFCSHADINGDEVICETYPE", predefinedType: ".AWNING." });
  assert.deepEqual(resolveIfcClass(slab, [], [parameter(-1019015, "ifcCoveringType"), parameter(-1019017, "CLADDING")]), { entity: "IFCCOVERING", typeEntity: "IFCCOVERINGTYPE", predefinedType: ".CLADDING." });
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019014, "IfcSite"), parameter(-1019016, "AWNING")]), slab);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019014, "IFCSLAB);DROP"), parameter(-1019016, "BOGUS")]), slab);
  assert.equal(resolveIfcClass(slab, [parameter(-1019014, "NotExported")]), null);
  assert.equal(resolveIfcClass(slab, [], [parameter(-1019015, "NotExported")]), null);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019014, "IfcSlab")], [parameter(-1019015, "NotExported")]), slab);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019014, "NotExported"), parameter(-1019014, "IfcSlab")]), slab);
});

test("published Export to IFC flags apply instance/type precedence without guessing", () => {
  assert.equal(resolveIfcClass(slab, [parameter(-1019012, 2)]), null);
  assert.equal(resolveIfcClass(slab, [parameter(-1019012, 0)], [parameter(-1019013, 2)]), null);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019012, 1)], [parameter(-1019013, 2)]), slab);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019012, 8)], [parameter(-1019013, 2)]), slab);
  assert.deepEqual(resolveIfcClass(slab, [parameter(-1019012, 0), parameter(-1019012, 1)], [parameter(-1019013, 2)]), slab);
});

test("conflicting instance class evidence cannot inherit a type omission or type class override", () => {
  const own = [parameter(-1019014, "IfcSlab"), parameter(-1019014, "IfcCovering")];
  assert.deepEqual(resolveIfcClass(slab, own, [parameter(-1019015, "NotExported")]), slab);
  assert.deepEqual(resolveIfcClass(slab, own, [parameter(-1019015, "IfcShadingDevice")]), slab);
  const fixture = ifcExportFixture();
  const wall = fixture.elementBounds[0]!;
  wall.parameters = [parameter(-1019014, "IfcWall"), parameter(-1019014, "IfcCovering")];
  wall.typeParameters = [parameter(-1019015, "NotExported")];
  const text = makeIfc(fixture);
  assert.match(text, /IFCWALL\(/, "unresolved class evidence must preserve the source product");
  assert.match(text, /Walls:Exterior Wall/);
});

test("common properties require native parameter IDs and validated value domains", () => {
  const properties = commonIfcPropertySets("IFCSLAB", [parameter(-1001954, 1), parameter(-1001206, "60 minutes")], [parameter(-1001006, 1), parameter(-1001405, "S-01")])[0]!;
  assert.equal(properties.name, "Pset_SlabCommon");
  assert.deepEqual(properties.properties, [
    { name: "Reference", value: "S-01", type: "IFCLABEL" },
    { name: "FireRating", value: "60 minutes", type: "IFCLABEL" },
    { name: "IsExternal", value: true, type: "IFCBOOLEAN" },
    { name: "LoadBearing", value: true, type: "IFCBOOLEAN" },
  ]);
  assert.deepEqual(commonIfcPropertySets("IFCSLAB", [parameter(-1001954, 2), parameter(-1001006, 6), { parameterId: -999, name: "Fire Rating", value: "90" }]), []);
  assert.deepEqual(commonIfcPropertySets("IFCDOOR", [parameter(-1012100, 1), parameter(-1012101, -1)]), [], "phase ids do not establish standard lifecycle Status");
});

function framed(version: number, owner: number, id: number, value: string): Uint8Array {
  const bytes = new Uint8Array(110);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xffffffff, true);
  view.setUint16(4, version === 2024 ? 0x2d3 : version === 2025 ? 0x2ef : 0x2fd, true);
  view.setUint32(6, 1, true);
  view.setBigUint64(10, BigInt(owner), true);
  view.setBigInt64(30, BigInt(id), true);
  view.setUint32(38, value.length, true);
  for (let index = 0; index < value.length; index++) view.setUint16(42 + index * 2, value.charCodeAt(index), true);
  return bytes;
}

test("native IFC parameter scan is release bounded, declared-owner checked and conflict rejecting", () => {
  for (const version of [2024, 2025, 2026]) {
    const collector = createIfcExportParameterCollector(version, new Set([10]));
    collector.pushPage(framed(version, 10, -1019014, "IfcShadingDevice"));
    assert.equal(collector.snapshot().get(10)?.[0]?.value, "IfcShadingDevice");
    collector.pushPage(framed(version, 10, -1019014, "IfcSlab"));
    collector.pushPage(framed(version, 10, -1019014, "IfcShadingDevice"));
    const recovered = collector.snapshot().get(10)!;
    assert.deepEqual(recovered.map(parameter => parameter.value), ["IfcShadingDevice", "IfcSlab"], "a later matching value cannot clear a conflict");
    assert.deepEqual(resolveIfcClass(slab, recovered, [parameter(-1019015, "NotExported")]), slab, "conflict presence prevents inherited omission");
  }
  for (const version of [2023, 2027]) {
    const collector = createIfcExportParameterCollector(version, new Set([10]));
    collector.pushPage(framed(2024, 10, -1019014, "IfcShadingDevice"));
    assert.equal(collector.snapshot().size, 0);
  }
  const collector = createIfcExportParameterCollector(2024, new Set([10]));
  collector.pushPage(framed(2024, 11, -1019014, "IfcShadingDevice"));
  collector.pushPage(framed(2024, 10, -1019016, "AWNING").subarray(0, 50));
  assert.equal(collector.snapshot().size, 0);
});

test("native override conflict evidence stays bounded and cannot become a type omission", () => {
  const collector = createIfcExportParameterCollector(2025, new Set([10]));
  for (const value of ["IfcWall", "IfcSlab", "IfcCovering", "IfcWall"]) collector.pushPage(framed(2025, 10, -1019014, value));
  const own = collector.snapshot().get(10)!;
  assert.equal(own.length, 2, "two distinct witnesses prove permanent ambiguity without unbounded storage");
  assert.deepEqual(resolveIfcClass(slab, own, [parameter(-1019015, "NotExported")]), slab);
  const typeCollector = createIfcExportParameterCollector(2025, new Set([11]));
  typeCollector.pushPage(framed(2025, 11, -1019015, "NotExported"));
  typeCollector.pushPage(framed(2025, 11, -1019015, "IfcWallType"));
  assert.deepEqual(resolveIfcClass(slab, [], typeCollector.snapshot().get(11)), slab);
});

test("an independent IFC reader recovers overrides, standard typed properties and raw evidence", async () => {
  const fixture = ifcExportFixture();
  const wall = fixture.elementBounds[0]!;
  wall.parameters!.push(parameter(-1019014, "IfcShadingDevice"), parameter(-1019016, "AWNING"));
  wall.typeParameters = [parameter(-1001405, "SHADE-A")];
  const door = fixture.elementBounds[1]!;
  door.parameters = [parameter(-1001206, "60 minutes")];
  door.typeParameters = [parameter(-1001006, 1), parameter(-1001405, "D-01")];
  const buffer = new TextEncoder().encode(makeIfc(fixture)).buffer;
  const store = await new IfcParser().parseColumnar(buffer);
  const ids = [...store.entities.expressId];
  const shade = ids.find(id => store.entities.getTypeName(id) === "IfcShadingDevice")!;
  const doorId = ids.find(id => store.entities.getTypeName(id) === "IfcDoor")!;
  assert.ok(shade);
  assert.ok(ids.some(id => store.entities.getTypeName(id) === "IfcShadingDeviceType"));
  const properties = extractPropertiesOnDemand(store, doorId);
  const common = properties.find(set => set.name === "Pset_DoorCommon")!;
  assert.ok(common);
  assert.equal(common.properties.find(p => p.name === "FireRating")?.value, "60 minutes");
  assert.equal(common.properties.find(p => p.name === "IsExternal")?.value, true);
  assert.ok(properties.some(set => set.name === "Reviter_RevitInstanceParameters"));
  assert.ok(properties.some(set => set.name === "Reviter_RevitTypeParameters"));
  const text = makeIfc(fixture);
  assert.match(text, /IFCSHADINGDEVICE\([^\n]*\.AWNING\.\)/);
});

test("NotExported excludes owned triangles from fallback and does not suppress siblings", () => {
  const fixture = ifcExportFixture();
  fixture.elementBounds[0]!.parameters = [parameter(-1019014, "NotExported")];
  const text = makeIfc(fixture);
  assert.doesNotMatch(text, /IFCWALL\(/);
  assert.doesNotMatch(text, /IFCBUILDINGELEMENTPROXY\(/);
  assert.match(text, /IFCDOOR\(/);
  assert.doesNotMatch(text, /Walls:Exterior Wall/);
});

test("same Revit type projected to distinct predefined enums gets separate valid type objects", () => {
  const fixture = ifcExportFixture();
  fixture.elementBounds[1]!.categoryId = fixture.elementBounds[0]!.categoryId;
  fixture.elementBounds[1]!.typeId = fixture.elementBounds[0]!.typeId;
  fixture.elementBounds[1]!.typeName = fixture.elementBounds[0]!.typeName;
  fixture.elementBounds[1]!.familyId = undefined;
  fixture.elementBounds[1]!.familyName = undefined;
  fixture.elementBounds[0]!.parameters = [parameter(-1019016, "SHEAR")];
  fixture.elementBounds[1]!.parameters = [parameter(-1019016, "PARTITIONING")];
  const text = makeIfc(fixture);
  assert.equal((text.match(/=IFCWALLTYPE\(/g) ?? []).length, 2);
});
