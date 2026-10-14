import assert from "node:assert/strict";
import test from "node:test";
import { createIfcGuidParameterWitnessCollector, type IfcGuidParameterWitness } from "../lib/reviter/ifc-guid-parameter-witnesses.ts";
import { IFC_GUID_PARAMETER, IFC_TYPE_GUID_PARAMETER, storedIfcGlobalId } from "../lib/reviter/ifc-global-id.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

const A = "1G_I00WlX2MBQekqB04dFi", B = "1G_I00WlX2MBQekqB04dCi";
const source = (chunkIndex: number) => ({ stream: "Partitions/1", chunkIndex, rawOffset: chunkIndex * 100 });
const table = (value: string, parameterId = IFC_GUID_PARAMETER) => ({ elementId: 10, parameters: [{ parameterId, name: "IFC GUID", value }] });

test("repeated identical native GUID values share one witness with occurrence provenance", () => {
  const collector = createIfcGuidParameterWitnessCollector(new Set([10]));
  collector.consume(table(A), source(0)); collector.consume(table(A), source(1));
  const snapshot = collector.snapshot();
  assert.equal(storedIfcGlobalId(snapshot[0]!.parameters, IFC_GUID_PARAMETER), A);
  const witness = snapshot[0]!.parameters[0] as IfcGuidParameterWitness;
  assert.equal(witness.occurrences, 2);
  assert.deepEqual(witness.sourceLocations, [source(0), source(1)]);
  witness.sourceLocations[0]!.rawOffset = 999;
  assert.equal((collector.snapshot()[0]!.parameters[0] as IfcGuidParameterWitness).sourceLocations[0]!.rawOffset, 0);
});

test("distinct stored GUID values are retained before generic last-value-wins merging", () => {
  const collector = createIfcGuidParameterWitnessCollector(new Set([10]));
  collector.consume(table(A), source(0)); collector.consume(table(B), source(1)); collector.consume(table(A), source(2));
  const snapshot = collector.snapshot();
  assert.deepEqual(snapshot[0]!.parameters.map(parameter => parameter.value), [A, B]);
  assert.equal(storedIfcGlobalId(snapshot[0]!.parameters, IFC_GUID_PARAMETER), null);
  const fixture = ifcExportFixture();
  fixture.nativeIfcGuidParameters = snapshot;
  fixture.elementBounds[0]!.parameters = table(B).parameters;
  const exported = makeIfc(fixture, { allowGuidParameterOverride: true });
  assert.ok(!exported.includes(`IFCWALL('${B}'`), "the merged bounds parameter cannot resurrect a conflicted override");
});

test("type and instance GUID parameter conflicts are independent and undeclared owners are omitted", () => {
  const collector = createIfcGuidParameterWitnessCollector(new Set([10]));
  collector.consume(table(A), source(0)); collector.consume(table(B, IFC_TYPE_GUID_PARAMETER), source(1));
  collector.consume({ ...table(A), elementId: 999 }, source(2));
  const snapshot = collector.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(storedIfcGlobalId(snapshot[0]!.parameters, IFC_GUID_PARAMETER), A);
  assert.equal(storedIfcGlobalId(snapshot[0]!.parameters, IFC_TYPE_GUID_PARAMETER), B);
});
