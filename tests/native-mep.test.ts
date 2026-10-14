import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { scanNativeMep, nativeMepElementKinds, type NativeMepElementKind, type NativeMepPage } from "../lib/reviter/native-mep.ts";
import { emitNativeMep } from "../lib/reviter/export-ifc-mep.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import type { SchemaSummary } from "../lib/reviter/schema.ts";

const schema: SchemaSummary = { byteLength: 1, rejectedCandidates: 0, referencedClasses: [], taggedClasses: [
  { name: "RbsHvacSystem", tag: 500, parent: "Element", offset: 0 },
  { name: "RbsPipingSystem", tag: 501, parent: "Element", offset: 0 },
  { name: "RbsElectricalSystem", tag: 502, parent: "Element", offset: 0 },
  { name: "RbsCurveConnectorManager", tag: 503, parent: "Element", offset: 0 },
  { name: "FamilyInstance", tag: 504, parent: "Element", offset: 0 },
] };
function object(id: number, tag: number, payload: Uint8Array): Uint8Array {
  const data = Buffer.alloc(24 + payload.length);
  data.writeUInt32LE(id, 0); data.writeUInt32LE(payload.length + 4, 12); data.writeUInt32LE(tag, 16);
  data.set(payload, 20); data.writeUInt32LE(payload.length + 4, data.length - 4);
  // zlib independently supplies the checksum, over class word + payload.
  const compressed = deflateSync(data.subarray(16, data.length - 4));
  data.writeUInt32LE(compressed.readUInt32BE(compressed.length - 4), 8);
  return data;
}
function name(text: string): Uint8Array {
  const body = Buffer.from(text, "utf16le"), data = Buffer.alloc(4 + body.length);
  data.writeUInt32LE(text.length); data.set(body, 4); return data;
}
function packet(own: number, index: number, other: number, otherIndex: number): Buffer {
  const data = Buffer.alloc(36); data.writeUInt32LE(2); data.writeBigUInt64LE(BigInt(own), 4); data.writeUInt32LE(index, 12); data.writeUInt32LE(1, 16);
  data.writeBigUInt64LE(BigInt(other), 20); data.writeUInt32LE(otherIndex, 28); data.writeUInt32LE(1, 32); return data;
}
const kinds = new Map<number, NativeMepElementKind>([[100, "curve"], [200, "fitting"], [300, "equipment"]]);
function scan(data: Uint8Array, version = 2025, pages?: NativeMepPage[]) {
  return scanNativeMep({ revitVersion: version, schema, elementKinds: kinds,
    readPartitions: () => pages ?? [{ stream: "Partitions/1", bytes: data }] });
}

test("systems and exact member references survive arbitrary page splits, with source offsets", () => {
  const own = Buffer.alloc(8); own.writeBigUInt64LE(900n);
  const data = Buffer.concat([object(100, 504, own), object(900, 500, name("Supply Air"))]);
  const pages: NativeMepPage[] = [];
  for (let p = 0; p < data.length; p += 7) pages.push({ stream: "Partitions/1", bytes: data.subarray(p, p + 7) });
  const out = scan(data, 2025, pages);
  assert.deepEqual(out.systems.map((s) => [s.elementId, s.name, s.candidateMembers]), [[900, "Supply Air", [100]]]);
  assert.deepEqual(out.systems[0]!.membershipCandidates, [{ stream: "Partitions/1", offset: 20, elementId: 100 }]);
  assert.equal(out.systems[0]!.evidence.length, 1);
  assert.equal(out.coverage.incompleteObjects, 0);
});

test("corrupted checksums, conflicting system names, and partial objects do not establish systems", () => {
  const broken = object(900, 500, name("Bad")); broken[8] = broken[8]! ^ 1;
  const bad = scan(broken);
  assert.equal(bad.systems.length, 0); assert.equal(bad.coverage.invalidSystemObjects, 1);
  const conflict = scan(Buffer.concat([object(900, 500, name("A")), object(900, 500, name("B"))]));
  assert.equal(conflict.systems.length, 0); assert.equal(conflict.coverage.conflictingSystems, 1);
  const partial = scan(object(900, 500, name("Partial")).subarray(0, 25));
  assert.equal(partial.systems.length, 0); assert.ok(partial.coverage.incompleteObjects > 0);
});

test("object state cannot join two partition streams", () => {
  const data = object(900, 500, name("Must not join"));
  const out = scan(data, 2025, [{ stream: "a", bytes: data.subarray(0, 25) }, { stream: "b", bytes: data.subarray(25) }]);
  assert.equal(out.systems.length, 0);
});

test("electrical systems use circuit numbers after the counted native entries", () => {
  const payload = Buffer.alloc(80); payload.fill(255, 0, 8); payload[8] = 1;
  payload.writeUInt32LE(1, 28); payload.set(name("L2-17"), 64);
  const out = scan(object(901, 502, payload));
  assert.equal(out.systems[0]!.name, "L2-17");
});

test("2025 curve packets prefer later indices and deduplicate reciprocal fitting references", () => {
  const data = Buffer.alloc(2500);
  data.writeUInt16LE(503); data.fill(255, 2, 6); data.writeUInt16LE(504, 6);
  data.set(packet(100, 0, 200, 2), 1021); data.set(packet(100, 1, 200, 2), 1217);
  data.set(packet(200, 2, 100, 1), 2000);
  const out = scan(data, 2025, [{ stream: "a", bytes: data.subarray(0, 1300) }, { stream: "a", bytes: data.subarray(1300) }]);
  assert.equal(out.connections.length, 1);
  assert.deepEqual(out.connections[0]!.a, { elementId: 100, index: 1 });
  assert.deepEqual(out.connections[0]!.b, { elementId: 200, index: 2 });
  assert.deepEqual(out.connections[0]!.evidence.map((e) => e.layout).sort(), ["curve-later", "fitting-list"]);
  assert.equal(out.ports.length, 3);
  assert.equal(out.coverage.familyConnectorGraphs, "not-decoded");
});

test("early curve index is inverted only when there is no later copy", () => {
  const data = Buffer.alloc(2000); data.writeUInt16LE(503); data.fill(255, 2, 6); data.writeUInt16LE(504, 6);
  data.set(packet(100, 0, 200, 2), 1021);
  assert.equal(scan(data).connections[0]!.a.index, 1);
});

test("unsupported releases, unknown endpoints, invalid flags and conflicting partners fail closed", () => {
  const data = Buffer.concat([packet(200, 2, 100, 1), packet(200, 2, 300, 0)]);
  const conflict = scan(data); assert.equal(conflict.connections.length, 0); assert.equal(conflict.coverage.conflictingPorts, 1);
  const unknown = scan(packet(200, 2, 999, 0)); assert.equal(unknown.connections.length, 0);
  assert.equal(scan(packet(200, 2, 100, 7)).connections.length, 0, "curve endpoints are only 0 and 1");
  const broken = packet(200, 2, 100, 1); broken[16] = 4;
  assert.equal(scan(broken).connections.length, 0);
  for (const version of [2023, 2024, 2026, 2027, 2028]) {
    const result = scan(packet(200, 2, 100, 1), version);
    assert.equal(result.connections.length, 0); assert.equal(result.ports.length, 0);
    assert.equal(result.coverage.connectorLayout, "unsupported-release");
  }
});

test("only source-decoded exact categories nominate MEP kinds", () => {
  const records = [
    { elementId: 1, categoryId: -2008000, categorySource: "element-header" },
    { elementId: 2, categoryId: -2008049, categorySource: "element-header" },
    { elementId: 3, categoryId: -2008000, categorySource: "record-code-consensus" },
    { elementId: 4, categoryName: "Ducts", categorySource: "element-header" },
  ] as ElementBoundsRecord[];
  assert.deepEqual([...nativeMepElementKinds(records)], [[1, "curve"], [2, "fitting"]]);
});

test("IFC ports nest in typed existing products, systems group proven members only", () => {
  const own = Buffer.alloc(8); own.writeBigUInt64LE(900n);
  const data = Buffer.concat([object(100, 504, own), object(900, 500, name("AHU's Supply")), packet(200, 2, 100, 1)]);
  const nativeMep = scan(data);
  nativeMep.systems[0]!.candidateMembers.push(300); // unproven membership is rejected by writer
  const entities: string[] = [];
  const counts = emitNativeMep({ nativeMep, includeExperimentalMep: true, writer: { add: (text) => { entities.push(text); return entities.length + 10; } }, ownerHistory: 1, building: 2,
    productByElement: new Map([[100, 3], [200, 4], [300, 5]]), entityByElement: new Map([[100, "IFCDUCTSEGMENT"], [200, "IFCDUCTFITTING"], [300, "IFCBUILDINGELEMENTPROXY"]]),
    guid: (kind, id) => `${kind}-${id}`, quoted: (text) => `'${text.replaceAll("'", "''")}'` });
  assert.deepEqual(counts, { systems: 1, ports: 3, connections: 1, skippedConnections: 0, skippedPorts: 0 });
  assert.equal(entities.filter((e) => e.startsWith("IFCRELNESTS")).length, 2);
  assert.match(entities.find((e) => e.startsWith("IFCRELASSIGNSTOGROUP"))!, /\(#3\),\$,/);
  assert.match(entities.find((e) => e.startsWith("IFCSYSTEM"))!, /AHU''s Supply/);
  assert.ok(entities.every((e) => !e.includes("SOURCEANDSINK") && !e.includes("IFCCARTESIANPOINT")));
});

test("IFC emission drops connections to absent or overridden non-distribution products", () => {
  const nativeMep = scan(packet(200, 2, 100, 1));
  const entities: string[] = [];
  const counts = emitNativeMep({ nativeMep, includeExperimentalMep: true, writer: { add: (text) => { entities.push(text); return entities.length; } }, ownerHistory: 1, building: 2,
    productByElement: new Map([[100, 3], [200, 4]]), entityByElement: new Map([[100, "IFCBUILDINGELEMENTPROXY"], [200, "IFCDUCTFITTING"]]), guid: (kind, id) => `${kind}-${id}`, quoted: (text) => `'${text}'` });
  assert.equal(counts.connections, 0); assert.equal(counts.skippedConnections, 1);
  assert.equal(entities.filter((e) => e.startsWith("IFCDISTRIBUTIONPORT")).length, 1);
});

test("experimental MEP emission requires explicit opt-in", () => {
  const nativeMep = scan(packet(200, 2, 100, 1));
  const lines: string[] = [];
  const result = emitNativeMep({ nativeMep, writer: { add: (text) => { lines.push(text); return lines.length; } }, ownerHistory: 1, building: 2,
    productByElement: new Map([[100, 3], [200, 4]]), entityByElement: new Map([[100, "IFCDUCTSEGMENT"], [200, "IFCDUCTFITTING"]]), guid: (kind, id) => `${kind}-${id}`, quoted: (text) => `'${text}'` });
  assert.equal(lines.length, 0); assert.equal(result.connections, 0);
});

test("web-ifc independently reads emitted ports, nesting, joins and system membership", async () => {
  const { IfcAPI } = await import("web-ifc");
  const own = Buffer.alloc(8); own.writeBigUInt64LE(900n);
  const nativeMep = scan(Buffer.concat([object(100, 504, own), object(900, 500, name("Supply")), packet(200, 2, 100, 1)]));
  let next = 1;
  const gids = new Map<string, string>();
  const guid = (kind: string, key: string | number) => { const text = `${kind}:${key}`; if (!gids.has(text)) gids.set(text, String(next++).padStart(22, "0")); return gids.get(text)!; };
  const lines = [
    "#1=IFCPERSON($,$,'Test',$,$,$,$,$);",
    "#2=IFCORGANIZATION($,'Test',$,$,$);",
    "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
    "#4=IFCAPPLICATION(#2,'1','MEP tests','TEST');",
    "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,0,$,$,0);",
    `#6=IFCBUILDING('${guid("building", 1)}',#5,'Building',$,$,$,$,$,.ELEMENT.,$,$,$);`,
    `#7=IFCDUCTSEGMENT('${guid("product", 100)}',#5,'Duct',$,$,$,$,'100',.NOTDEFINED.);`,
    `#8=IFCDUCTFITTING('${guid("product", 200)}',#5,'Fitting',$,$,$,$,'200',.NOTDEFINED.);`,
  ];
  emitNativeMep({ nativeMep, includeExperimentalMep: true, writer: { add: (text) => { const id = lines.length + 1; lines.push(`#${id}=${text};`); return id; } }, ownerHistory: 5, building: 6,
    productByElement: new Map([[100, 7], [200, 8]]), entityByElement: new Map([[100, "IFCDUCTSEGMENT"], [200, "IFCDUCTFITTING"]]), guid, quoted: (s) => `'${s}'` });
  const source = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\nFILE_NAME('test.ifc','2026-10-14T00:00:00',(''),(''),'Reviter','Reviter','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`;
  const api = new IfcAPI(); await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source));
  try {
    assert.ok(model >= 0);
    const types = api.GetAllTypesOfModel(model);
    const ids = (name: string) => { const type = types.find((t) => t.typeName.toUpperCase() === name); const vector = type ? api.GetLineIDsWithType(model, type.typeID) : undefined; return vector ? Array.from({ length: vector.size() }, (_, i) => vector.get(i)) : []; };
    assert.equal(ids("IFCDISTRIBUTIONPORT").length, 3);
    assert.equal(ids("IFCRELNESTS").length, 2);
    assert.equal(ids("IFCRELCONNECTSPORTS").length, 1);
    assert.equal(ids("IFCSYSTEM").length, 1);
    const group = api.GetLine(model, ids("IFCRELASSIGNSTOGROUP")[0]!);
    assert.deepEqual(group.RelatedObjects.map((r: { value: number }) => r.value), [7]);
    const join = api.GetLine(model, ids("IFCRELCONNECTSPORTS")[0]!);
    assert.ok(ids("IFCDISTRIBUTIONPORT").includes(join.RelatingPort.value));
    assert.ok(ids("IFCDISTRIBUTIONPORT").includes(join.RelatedPort.value));
    assert.equal(api.GetLine(model, join.RelatingPort.value).FlowDirection.value, "NOTDEFINED");
  } finally { api.CloseModel(model); api.Dispose(); }
});
