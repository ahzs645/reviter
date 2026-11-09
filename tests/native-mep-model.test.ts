import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeMepModel, mergeNativeMepEvidence, MEP_MODEL_READER_COMMIT } from "../lib/reviter/native-mep-model.ts";
import { emitNativeMepIfc } from "../lib/reviter/export-ifc-mep.ts";
import type { NativeMepEvidence } from "../lib/reviter/native-mep.ts";

const context = { revitVersion: 2025, declaredElementIds: new Set([10, 20, 30]), readerCommit: MEP_MODEL_READER_COMMIT, readerMode: "typed-no-geometry" };
const products = [{ kind: "BuildingElement", type_guid: "10" }, { kind: "BuildingElement", type_guid: "20" }, { kind: "BuildingElement", type_guid: "30" }];
const connection = { kind: "PortConnection", a: 0, a_id: 10, a_index: 11, b: 1, b_id: 20, b_index: 0 };
test("pinned model preserves native unconnected ports and index identity with honest provenance", () => {
  const model = { entities: [...products, connection, { kind: "Port", element: 2, id: 30, index: 2 }] };
  const evidence = decodeNativeMepModel(model, context);
  assert.equal(evidence.connections.length, 1); assert.equal(evidence.ports!.length, 1);
  assert.equal(evidence.connections[0]!.connectorIndex, 11);
  assert.equal(evidence.connections[0]!.sources[0]!.byteOffset, null);
  const expressions: string[] = [];
  const count = emitNativeMepIfc({ add(s) { expressions.push(s); return expressions.length; } }, evidence, { ownerHistory: 1, elementEntities: new Map([[10, 100], [20, 101], [30, 102]]), guid: (_kind, key) => String(key), quoted: (s) => `'${s}'` });
  assert.equal(count.connectionCount, 1); assert.equal(count.portCount, 3);
  assert.ok(expressions.some((s) => s.includes("Port_30_2")));
});
test("invalid owner index, unknown id, commit, and release cannot import topology", () => {
  const model = { entities: [...products, { ...connection, a: 1 }, { ...connection, a_id: 999 }, { kind: "Port", element: 999, id: 30, index: 1 }] };
  assert.equal(decodeNativeMepModel(model, context).connections.length, 0);
  assert.equal(decodeNativeMepModel({ entities: [...products, connection] }, { ...context, readerCommit: "unknown" }).connections.length, 0);
  assert.equal(decodeNativeMepModel({ entities: [...products, connection] }, { ...context, revitVersion: 2027 }).connections.length, 0);
});
test("duplicate native identities and contradictory physical joins fail closed", () => {
  assert.equal(decodeNativeMepModel({ entities: [...products, products[0], connection] }, context).connections.length, 0);
  const evidence = decodeNativeMepModel({ entities: [...products, connection, { ...connection, b: 2, b_id: 30 }] }, context);
  assert.equal(evidence.connections.length, 0);
  assert.ok(evidence.limitations.some((l) => l.includes("ambiguous physical joins")));
  const legacy: NativeMepEvidence = { revitVersion: 2025, systems: [], connections: [{ elementId: 10, connectorIndex: 11, otherElementId: 20, otherConnectorIndex: 0, sources: [] }], limitations: [] };
  assert.equal(mergeNativeMepEvidence(legacy, evidence).connections.length, 0);
});
test("explicit native model replaces a conflicting legacy join without changing system evidence", () => {
  const page: NativeMepEvidence = { revitVersion: 2025, systems: [], connections: [{ elementId: 10, connectorIndex: 11, otherElementId: 30, otherConnectorIndex: 1, sources: [{ stream: "Partitions/1", chunkIndex: 1, byteOffset: 100, revitVersion: 2025, decoder: "RE-138" }] }], limitations: [] };
  const projection = decodeNativeMepModel({ entities: [...products, connection] }, context);
  const merged = mergeNativeMepEvidence(page, projection);
  assert.equal(merged.connections.length, 1);
  assert.equal(merged.connections[0]!.otherElementId, 20);
  assert.equal(merged.systems, page.systems);
  assert.ok(merged.limitations.some((l) => l.includes("contradictory legacy")));
});

test("dimensional merge suppresses conflicting fields while preserving other observed values", () => {
  const page: NativeMepEvidence = { revitVersion: 2025, systems: [], connections: [], limitations: [], dimensions: [{ elementId: 10, widthFeet: 1, heightFeet: 2, sources: [] }] };
  const projection: NativeMepEvidence = { revitVersion: 2025, systems: [], connections: [], limitations: [], dimensions: [{ elementId: 10, widthFeet: 3, lengthFeet: 5, sources: [] }, { elementId: 10, widthFeet: 1, sources: [] }] };
  const merged = mergeNativeMepEvidence(page, projection);
  assert.equal(merged.dimensions!.length, 1); assert.equal(merged.dimensions![0]!.widthFeet, undefined);
  assert.equal(merged.dimensions![0]!.heightFeet, 2); assert.equal(merged.dimensions![0]!.lengthFeet, 5);
});
