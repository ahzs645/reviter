import assert from "node:assert/strict";
import test from "node:test";
import { IfcAPI } from "web-ifc";
import { IfcParser, extractPropertiesOnDemand } from "@ifc-lite/parser";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import type { NativeMepDecode } from "../lib/reviter/native-mep.ts";
import { isRecoveryTaggedProduct } from "../scripts/lib/ifc-recovery-scope.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

function mepFixture() {
  const result = ifcExportFixture();
  result.elementBounds[0]!.categoryId = -2008000;
  result.elementBounds[0]!.categoryName = "Ducts";
  result.elementBounds[1]!.categoryId = -2008010;
  result.elementBounds[1]!.categoryName = "Duct Fittings";
  result.nativeHostRelations = [];
  const evidence = { stream: "Partitions/1", offset: 50 };
  result.nativeMep = {
    revitVersion: 2025,
    coverage: {
      systemLayout: "supported", connectorLayout: "supported", familyConnectorGraphs: "not-decoded",
      systemMembership: "candidate-object-id-references", invalidSystemObjects: 0, incompleteObjects: 0,
      conflictingSystems: 0, conflictingPorts: 0, limitReached: false, skippedPartitions: [],
    },
    systems: [{ elementId: 900, className: "RbsHvacSystem", name: "Supply Air", candidateMembers: [10, 11], evidence: [evidence],
      membershipCandidates: [{ ...evidence, elementId: 10 }, { ...evidence, elementId: 11 }] }],
    ports: [
      { elementId: 10, index: 0, source: "measured-curve-end" },
      { elementId: 10, index: 1, source: "native-connector-list" },
      { elementId: 11, index: 2, source: "native-connector-list" },
    ],
    connections: [{ a: { elementId: 10, index: 1 }, b: { elementId: 11, index: 2 }, evidence: [{ ...evidence, layout: "curve-later" }] }],
  } satisfies NativeMepDecode;
  return result;
}

test("makeIfc requires MEP opt-in and preserves exact endpoint ownership when enabled", async () => {
  const result = mepFixture();
  const ordinary = makeIfc(result);
  assert.doesNotMatch(ordinary, /IFCDISTRIBUTIONPORT\(|IFCRELCONNECTSPORTS\(|IFCSYSTEM\(/);
  const source = makeIfc(result, { includeExperimentalMep: true });
  const api = new IfcAPI(); await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source));
  try {
    const types = api.GetAllTypesOfModel(model);
    const ids = (name: string) => {
      const type = types.find((entry) => entry.typeName.toUpperCase() === name);
      const vector = type && api.GetLineIDsWithType(model, type.typeID);
      return vector ? Array.from({ length: vector.size() }, (_, i) => vector.get(i)) : [];
    };
    const duct = ids("IFCDUCTSEGMENT")[0]!, fitting = ids("IFCDUCTFITTING")[0]!;
    assert.ok(duct && fitting);
    const ports = ids("IFCDISTRIBUTIONPORT").map((id) => api.GetLine(model, id));
    assert.equal(ports.length, 3);
    const portByName = new Map(ports.map((port) => [port.Name.value, port.expressID]));
    const ownerByPort = new Map<number, number>();
    for (const id of ids("IFCRELNESTS")) {
      const nest = api.GetLine(model, id);
      for (const child of nest.RelatedObjects) ownerByPort.set(child.value, nest.RelatingObject.value);
    }
    assert.equal(ownerByPort.get(portByName.get("Port_10_0")!), duct);
    assert.equal(ownerByPort.get(portByName.get("Port_10_1")!), duct);
    assert.equal(ownerByPort.get(portByName.get("Port_11_2")!), fitting);
    const joins = ids("IFCRELCONNECTSPORTS").map((id) => api.GetLine(model, id));
    assert.equal(joins.length, 1);
    assert.deepEqual(new Set([joins[0]!.RelatingPort.value, joins[0]!.RelatedPort.value]), new Set([portByName.get("Port_10_1"), portByName.get("Port_11_2")]));
    const systems = ids("IFCSYSTEM"); assert.equal(systems.length, 1);
    assert.match(api.GetLine(model, systems[0]!).Description.value, /Experimental membership candidates/);
    const members = api.GetLine(model, ids("IFCRELASSIGNSTOGROUP")[0]!);
    assert.equal(members.RelatingGroup.value, systems[0]);
    assert.deepEqual(new Set(members.RelatedObjects.map((ref: { value: number }) => ref.value)), new Set([duct, fitting]));
    const services = api.GetLine(model, ids("IFCRELSERVICESBUILDINGS")[0]!);
    assert.equal(services.RelatingSystem.value, systems[0]);
    assert.equal(services.RelatedBuildings[0].value, ids("IFCBUILDING")[0]);
  } finally { api.CloseModel(model); api.Dispose(); }
});

test("makeIfc uses the overridden emitted class when deciding whether a port endpoint exists", () => {
  const result = mepFixture();
  result.nativeIfcExportParameters = [{ elementId: 11, exportAs: "IfcWall", provenance: "owned-element-parameter-table" }];
  const source = makeIfc(result, { includeExperimentalMep: true });
  assert.match(source, /IFCWALL\(/);
  assert.doesNotMatch(source, /IFCDUCTFITTING\(|IFCRELCONNECTSPORTS\(|Port_11_2/);
  assert.match(source, /Port_10_0/);
  assert.match(source, /Port_10_1/);
});

test("independent recovery audit excludes generated ports and retains their recovered parent products", async () => {
  const bytes = new TextEncoder().encode(makeIfc(mepFixture(), { includeExperimentalMep: true }));
  const log = console.log;
  console.log = (...args: unknown[]) => { if (typeof args[0] !== "string" || !/^\[(?:parseLite|IfcParser)\]/.test(args[0])) log(...args); };
  let store;
  try { store = await new IfcParser().parseColumnar(bytes.buffer); } finally { console.log = log; }
  const parents: number[] = [], ports: number[] = [];
  for (const id of store.entities.expressId) {
    const type = store.entities.getTypeName(id);
    if (isRecoveryTaggedProduct(type)) parents.push(id);
    if (type === "IfcDistributionPort") ports.push(id);
  }
  assert.equal(parents.length, 2);
  assert.equal(ports.length, 3);
  for (const id of parents) assert.ok(extractPropertiesOnDemand(store, id)?.some((set) => set.name === "Reviter_Recovery"));
  for (const id of ports) {
    assert.equal(isRecoveryTaggedProduct(store.entities.getTypeName(id)), false);
    assert.ok(!extractPropertiesOnDemand(store, id)?.some((set) => set.name === "Reviter_Recovery"));
  }
  for (const type of ["IfcBuilding", "IfcOpeningElement", "IfcSystem", "IfcSIUnit"]) assert.equal(isRecoveryTaggedProduct(type), false, type);
  for (const type of ["IfcWall", "IfcDuctSegment", "IfcDuctFitting"]) assert.equal(isRecoveryTaggedProduct(type), true, type);
});
