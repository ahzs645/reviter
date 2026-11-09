import assert from "node:assert/strict";
import test from "node:test";
import * as WebIfc from "web-ifc";
import { IfcParser, extractQuantitiesOnDemand, extractEntityAttributesOnDemand, extractTypeEntityOwnProperties } from "@ifc-lite/parser";
import { categoryIfcClass } from "../lib/reviter/ifc-category-map.ts";
import { IFC_PREDEFINED_ENUMS, commonIfcPropertySets, nativeTypePropertySets, nativeIfcQuantities } from "../lib/reviter/ifc-export-semantics.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
const parameter = (parameterId: number, value: number | string) => ({ parameterId, value, name: `Parameter ${parameterId}` });

test("all supported predefined enums belong to the independent IFC4 schema", () => {
  const schema = WebIfc.IFC4 as unknown as Record<string, unknown>;
  for (const [entity, values] of Object.entries(IFC_PREDEFINED_ENUMS)) {
    const name = Object.keys(schema).find(name => name.toUpperCase() === `${entity}TYPEENUM`)!;
    assert.ok(name, `${entity} has an IFC4 type enumeration`);
    const enums = schema[name] as Record<string, unknown>;
    for (const value of values) assert.ok(Object.hasOwn(enums, value), `${entity}.${value} is schema-valid`);
  }
});

test("curtain and structural subtype mappings consume native class or numeric usage", () => {
  assert.equal(categoryIfcClass(-2000011, { wallKind: "curtain" }).entity, "IFCCURTAINWALL");
  assert.equal(categoryIfcClass(-2000011, { wallKind: "basic" }).entity, "IFCWALL");
  assert.equal(categoryIfcClass(-2000171).predefinedType, ".MULLION.");
  assert.equal(categoryIfcClass(-2000170).predefinedType, ".CURTAIN_PANEL.");
  assert.equal(categoryIfcClass(-2001320).entity, "IFCBEAM");
  assert.equal(categoryIfcClass(-2001320, { parameters: [parameter(-1001381, 7)] }).predefinedType, ".BRACE.");
  assert.equal(categoryIfcClass(-2001320, { parameters: [parameter(-1001381, 5)] }).predefinedType, ".PURLIN.");
  assert.equal(categoryIfcClass(-2001320, { parameters: [parameter(-1001381, "Brace")] }).entity, "IFCBEAM");
  assert.equal(categoryIfcClass(-2001320, { parameters: [parameter(-1001381, 4), parameter(-1001381, 7)] }).entity, "IFCBEAM");
});

const CATEGORY_ENTITIES: readonly [number, string][] = [
  [-2008000, "IfcDuctSegment"], [-2008010, "IfcDuctFitting"], [-2008044, "IfcPipeSegment"], [-2008049, "IfcPipeFitting"],
  [-2008013, "IfcAirTerminal"], [-2001160, "IfcSanitaryTerminal"], [-2001120, "IfcLightFixture"], [-2008085, "IfcAlarm"],
  [-2008083, "IfcElectricAppliance"], [-2001300, "IfcFooting"], [-2009000, "IfcReinforcingBar"], [-2001052, "IfcTransportElement"],
  [-2008130, "IfcCableCarrierSegment"], [-2008126, "IfcCableCarrierFitting"], [-2008099, "IfcFireSuppressionTerminal"],
];

test("two IFC readers recover new occurrences/type objects with schema attribute arity", async () => {
  const fixture = ifcExportFixture();
  fixture.meshes = [];
  fixture.nativeHostRelations = [];
  fixture.nativeCompoundLayerMaterialAssignments = [];
  fixture.elementBounds = CATEGORY_ENTITIES.map(([categoryId], index) => ({
    ...fixture.elementBounds[0]!, elementId: 100 + index, typeId: 200 + index, categoryId, categoryName: "Untrusted display name",
  }));
  const text = makeIfc(fixture);
  const bytes = new TextEncoder().encode(text);
  const store = await new IfcParser().parseColumnar(bytes.buffer);
  const api = new WebIfc.IfcAPI();
  await api.Init();
  const model = api.OpenModel(bytes);
  assert.ok(model >= 0);
  try {
    const entityIds = [...store.entities.expressId];
    const schema = WebIfc.IFC4 as unknown as Record<string, { length: number }>;
    for (const [, entity] of CATEGORY_ENTITIES) {
      const id = Number(new RegExp(`#(\\d+)=${entity.toUpperCase()}\\(`).exec(text)?.[1]);
      assert.ok(entityIds.includes(id), `${entity} identity reaches independent reader`);
      // ifc-lite 4.1.0 aliases IfcCableCarrierSegment to IfcCableSegment in
      // its compact display-type registry. Its identity remains correct;
      // web-ifc below verifies the actual IFC4 entity and attribute schema.
      if (entity !== "IfcCableCarrierSegment") assert.equal(store.entities.getTypeName(id), entity);
      const typeId = entityIds.find(id => store.entities.getTypeName(id) === `${entity}Type`)!;
      assert.ok(id, entity); assert.ok(typeId, `${entity}Type`);
      for (const [expressId, className] of [[id, entity], [typeId, `${entity}Type`]] as const) {
        const raw = api.GetRawLineData(model, expressId);
        assert.equal(raw.arguments.length, schema[className]!.length, `${className} attribute arity`);
        assert.ok(api.GetLine(model, expressId), `${className} is schema-readable`);
      }
    }
  } finally { api.CloseModel(model); api.Dispose(); }
});

test("standard MEP references and dimensional properties use typed source values", () => {
  const duct = commonIfcPropertySets("IFCDUCTSEGMENT", [parameter(-1004005, 10)], [], { typeName: "Rectangular duct" });
  assert.equal(duct.find(set => set.name === "Pset_DistributionFlowElementCommon")?.properties[0]?.type, "IFCIDENTIFIER");
  assert.deepEqual(duct.find(set => set.name === "Pset_DuctSegmentTypeCommon")?.properties, [{ name: "Length", value: 3.048, type: "IFCPOSITIVELENGTHMEASURE" }]);
  assert.ok(!duct.some(set => set.properties.some(property => property.name === "Shape")), "dimensions never guess a duct's section shape");
  const fitting = commonIfcPropertySets("IFCPIPEFITTING", [], [], { mepDimensions: { nominalDiameterFeet: 0.5 } });
  assert.deepEqual(fitting[0]?.properties, [{ name: "NominalDiameter", value: [0.1524], type: "IFCPOSITIVELENGTHMEASURE", kind: "list" }]);
  assert.deepEqual(commonIfcPropertySets("IFCPIPEFITTING", [parameter(-1140225, 0.5)]), [], "a pipe parameter is not all fitting-port diameters");
  assert.ok(!commonIfcPropertySets("IFCDUCTSEGMENT", [parameter(-1004005, NaN)]).length);
});

test("source conflicts do not inherit a type value and type sets use exact parameter ids", () => {
  const sets = commonIfcPropertySets("IFCDOOR", [parameter(-1001206, "30"), parameter(-1001206, "60")], [parameter(-1001206, "90")]);
  assert.ok(!sets.some(set => set.properties.some(property => property.name === "FireRating")));
  const typeSets = nativeTypePropertySets([parameter(-1010108, "Acme"), parameter(-1010109, "M1"), { parameterId: -999, name: "Manufacturer", value: "Unknown" }], { familyName: "Native family" });
  assert.deepEqual(typeSets[0]?.properties, [{ name: "Manufacturer", value: "Acme", type: "IFCLABEL" }, { name: "ModelReference", value: "M1", type: "IFCLABEL" }]);
});

test("an independent reader recovers native dimensions, stair attributes, type sets and computed quantities", async () => {
  const fixture = ifcExportFixture();
  fixture.elementBounds[0]!.parameters = [parameter(-1012805, 12), parameter(-1012806, 24)];
  fixture.elementBounds[0]!.typeParameters = [parameter(-1010108, "Acme")];
  const door = fixture.elementBounds[1]!;
  door.parameters = [parameter(-1001300, 7), parameter(-1001301, 3)];
  const text = makeIfc(fixture);
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(text).buffer);
  const ids = [...store.entities.expressId];
  const wall = ids.find(id => store.entities.getTypeName(id) === "IfcWall")!;
  const wallType = ids.find(id => store.entities.getTypeName(id) === "IfcWallType")!;
  const doorId = ids.find(id => store.entities.getTypeName(id) === "IfcDoor")!;
  const sourceQto = extractQuantitiesOnDemand(store, wall);
  assert.ok(sourceQto.some(set => set.name === "Reviter_RevitComputedQuantities"));
  const typeProperties = extractTypeEntityOwnProperties(store, wallType);
  assert.ok(typeProperties.some(set => set.name === "Pset_ManufacturerTypeInformation"));
  const attrs = extractEntityAttributesOnDemand(store, doorId);
  assert.ok(attrs, "door dimensions are parsed independently");
  assert.match(text, /IFCDOOR\([^\n]*,2\.1336,0\.9144,\.DOOR\./);
  assert.match(text, /IFCQUANTITYAREA\('HostAreaComputed',\$,\$,1\.11483648,\$\)/);
  assert.doesNotMatch(text, /Qto_WallBaseQuantities|NetSideArea|GrossArea/);
  fixture.elementBounds[0]!.categoryId = -2000919;
  fixture.elementBounds[0]!.parameters = [parameter(-1151305, 12), parameter(-1151306, 11), parameter(-1151307, 0.5), parameter(-1151308, 1)];
  const stairs = makeIfc(fixture);
  assert.match(stairs, /IFCSTAIRFLIGHT\([^\n]*,12,11,0\.1524,0\.3048,\.NOTDEFINED\./);
  assert.match(stairs, /'NumberOfRiser',\$,IFCCOUNTMEASURE\(12\.\)/);
});

test("computed source quantities retain unclassified definitions and reject nonfinite or negative input", () => {
  assert.equal(nativeIfcQuantities("IFCWALL", [parameter(-1012805, Infinity)]), null);
  assert.equal(nativeIfcQuantities("IFCWALL", [parameter(-1012806, -1)]), null);
  assert.equal(nativeIfcQuantities("IFCWALL", [parameter(-1012806, 1), parameter(-1012806, 2)]), null);
});

test("native MEP dimension context exports measured list values only with supported provenance", async () => {
  const fixture = ifcExportFixture();
  fixture.elementBounds[1]!.categoryId = -2008049;
  fixture.nativeMepEvidence = {
    revitVersion: 2025, systems: [], connections: [], limitations: [],
    dimensions: [{ elementId: 11, nominalDiameterFeet: 0.5, sources: [{ stream: "Partitions/1", chunkIndex: 0, byteOffset: 40, revitVersion: 2025, decoder: "RE-165" }] }],
  };
  const source = makeIfc(fixture);
  assert.match(source, /IFCPROPERTYLISTVALUE\('NominalDiameter',\$,\(IFCPOSITIVELENGTHMEASURE\(0\.1524\)\),\$\)/);
  const store = await new IfcParser().parseColumnar(new TextEncoder().encode(source).buffer);
  assert.ok([...store.entities.expressId].some(id => store.entities.getTypeName(id) === "IfcPipeFitting"));
  fixture.nativeMepEvidence.revitVersion = 2027;
  assert.doesNotMatch(makeIfc(fixture), /Pset_PipeFittingTypeCommon/);
});


test("contradictory native stair counts do not become authored standard dimensions", () => {
  const sets = commonIfcPropertySets("IFCSTAIRFLIGHT", [parameter(-1151305, 12)], [], { nativeStairRiserCount: 13 });
  assert.ok(!sets.some(set => set.properties.some(property => property.name === "NumberOfRiser")));
});
