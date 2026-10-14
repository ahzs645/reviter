import assert from "node:assert/strict";
import test from "node:test";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { standardIfcPropertySets, emitStandardIfcPropertySets } from "../lib/reviter/ifc-standard-properties.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import type { ElementParameter } from "../lib/reviter/element-parameters.ts";

const param = (parameterId: number, value: number | string): ElementParameter => ({ parameterId, name: "localized label is irrelevant", value });

test("common properties retain known values, explicit false, and native parameter evidence", () => {
  const sets = standardIfcPropertySets("IfcWall", {
    typeName: "W-200",
    parameters: [param(-1_001_206, "60 minutes"), param(-1_001_596, 0), param(-1_001_006, 1)],
  });
  const wall = sets.find((set) => set.name === "Pset_WallCommon")!;
  assert.deepEqual(wall.properties.map(({ name, type, value }) => ({ name, type, value })), [
    { name: "Reference", type: "IFCIDENTIFIER", value: "W-200" },
    { name: "FireRating", type: "IFCLABEL", value: "60 minutes" },
    { name: "LoadBearing", type: "IFCBOOLEAN", value: false },
    { name: "IsExternal", type: "IFCBOOLEAN", value: true },
  ]);
  assert.match(wall.properties[1]!.evidence, /-1001206/);
  assert.equal(sets[1]!.name, "Pset_QuantityTakeOff");
});

test("missing, conflicting, malformed and unsupported values do not create defaults", () => {
  assert.deepEqual(standardIfcPropertySets("IFCWALL", {}), []);
  assert.deepEqual(standardIfcPropertySets("IFCWALL", { parameters: [
    param(-1_001_596, 2), param(-1_001_006, 4), param(-1_001_206, ""),
  ] }), []);
  assert.deepEqual(standardIfcPropertySets("IFCWALL", { parameters: [
    param(-1_001_206, "60"), param(-1_001_206, "90"),
  ] }), []);
  assert.deepEqual(standardIfcPropertySets("IFCFURNITURE", { typeName: "Chair", parameters: [param(-1_001_596, 1)] }), []);
  // Category-specific flags and source record labels are not generic synonyms.
  assert.deepEqual(standardIfcPropertySets("IFCCOLUMN", { parameters: [param(-1_001_596, 1)] }), []);
});

test("IFC4 stair-flight measures use standard names/types and convert feet once", () => {
  const parameters = [param(-1_151_305, 12), param(-1_151_306, 11), param(-1_151_307, 0.5), param(-1_151_308, 1)];
  const before = structuredClone(parameters);
  const properties = standardIfcPropertySets("IFCSTAIRFLIGHT", { parameters })[0]!.properties;
  assert.deepEqual(properties.map(({ name, type, value }) => ({ name, type, value })), [
    { name: "NumberOfRiser", type: "IFCCOUNTMEASURE", value: 12 },
    { name: "NumberOfTreads", type: "IFCCOUNTMEASURE", value: 11 },
    { name: "RiserHeight", type: "IFCPOSITIVELENGTHMEASURE", value: 0.1524 },
    { name: "TreadLength", type: "IFCPOSITIVELENGTHMEASURE", value: 0.3048 },
  ]);
  assert.deepEqual(parameters, before);
  assert.deepEqual(standardIfcPropertySets("IFCSTAIRFLIGHT", { parameters: [param(-1_151_305, 1.5), param(-1_151_307, 0), param(-1_151_308, Infinity)] }), []);
});

test("phasing requires a positive native id joined to an explicit phase-name table", () => {
  const source = { parameters: [param(-1_012_100, 100), param(-1_012_101, -1)] };
  assert.deepEqual(standardIfcPropertySets("IFCWALL", source), []);
  const phases = standardIfcPropertySets("IFCWALL", source, new Map([[100, "Existing"]]));
  assert.deepEqual(phases[0]!.properties.map(({ name, value }) => ({ name, value })), [{ name: "Phase Created", value: "Existing" }]);
  assert.match(phases[0]!.properties[0]!.evidence, /phase element 100/);
  // The parameter value enum-label helper is not a native phase-name lookup.
  assert.deepEqual(standardIfcPropertySets("IFCWALL", { parameters: [{ ...param(-1_012_100, 100), valueName: "Guess" }] }), []);
  const explicit = standardIfcPropertySets("IFCWALL", { nativePhase: { createdPhaseId:100,demolishedPhaseId:200 } },new Map([[100,"Existing"],[200,"Demolition"]]));
  assert.equal(explicit[0]!.properties.length,2);
  assert.match(explicit[0]!.properties[0]!.evidence,/Native Element.m_createdPhaseId/);
  assert.match(explicit[0]!.properties[1]!.evidence,/Native Element.m_demolishedPhaseId/);
  assert.deepEqual(standardIfcPropertySets("IFCWALL", { ...source,nativePhase:{createdPhaseId:200,demolishedPhaseId:null} },new Map([[100,"Existing"],[200,"Different"]])),[]);
});

test("independent IFC reader recovers typed properties, SI measures and raw recovery together", async () => {
  const fixture = ifcExportFixture();
  const text = makeIfc(fixture);
  const wall = Number(text.match(/#(\d+)=IFCWALL\(/)![1]);
  const history = Number(text.match(/#(\d+)=IFCOWNERHISTORY\(/)![1]);
  let nextId = Math.max(...Array.from(text.matchAll(/#(\d+)=/g), (match) => Number(match[1]))) + 1;
  const rows: string[] = [];
  const sets = standardIfcPropertySets("IFCWALL", { typeName: "W-200", parameters: [param(-1_001_206, "60' minutes"), param(-1_001_596, 0)] });
  // Exercise measure emission too, with a separate set attached to the fixture
  // product: the reader test concerns serialization, not class applicability.
  sets.push(...standardIfcPropertySets("IFCSTAIRFLIGHT", { parameters: [param(-1_151_307, 0.5)] }));
  const guids = new Set<string>();
  emitStandardIfcPropertySets({
    add(value) { const id = nextId++; rows.push(`#${id}=${value};`); return id; },
    refs(values) { return `(${values.map((value) => `#${value}`).join(",")})`; },
  }, sets, history, wall, {
    quoted(value) { return `'${value.replaceAll("'", "''")}'`; },
    number(value) { return Number.isInteger(value) ? `${value}.` : String(value); },
    guid(kind) { assert.ok(!guids.has(kind)); guids.add(kind); return `00000000000000000000${String(guids.size).padStart(2, "0")}`; },
  });
  const complete = text.replace(/ENDSEC;\s*END-ISO-10303-21;/, `${rows.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`);
  const bytes = new TextEncoder().encode(complete);
  const store = await new IfcParser().parseColumnar(bytes.buffer);
  const recovered = new Map((extractPropertiesOnDemand(store, wall) ?? []).map((set) => [set.name, new Map(set.properties.map((property) => [property.name, property.value]))]));
  assert.equal(recovered.get("Pset_WallCommon")!.get("FireRating"), "60' minutes");
  assert.equal(recovered.get("Pset_WallCommon")!.get("LoadBearing"), false);
  assert.equal(recovered.get("Pset_StairFlightCommon")!.get("RiserHeight"), 0.1524);
  assert.equal(recovered.get("Reviter_RevitInstanceParameters")!.get("Unconnected Height [-1001105]"), 3);
  assert.equal(recovered.get("Reviter_Recovery")!.get("RevitElementId"), 10);
  assert.match(complete, /IFCPOSITIVELENGTHMEASURE\(0\.1524\)/);
});
