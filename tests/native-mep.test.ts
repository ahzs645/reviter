import assert from "node:assert/strict";
import test from "node:test";
import { createNativeMepCollector } from "../lib/reviter/native-mep.ts";
import { emitNativeMepIfc } from "../lib/reviter/export-ifc-mep.ts";

const classes = [{ name: "RbsHvacSystem", tag: 123 }, { name: "RbsElectricalSystem", tag: 124 }, { name: "RbsCurveConnectorManager", tag: 200 }, { name: "RbsDuctCurve", tag: 125 }];
const location = { stream: "Partitions/7", chunkIndex: 0 };
function counted(text: string) {
  const bytes = new Uint8Array(4 + text.length * 2), v = new DataView(bytes.buffer);
  v.setUint32(0, text.length, true);
  [...text].forEach((c, i) => v.setUint16(4 + i * 2, c.charCodeAt(0), true));
  return bytes;
}
function object(id: number, tag: number, payload: Uint8Array) {
  const bytes = new Uint8Array(payload.length + 24), v = new DataView(bytes.buffer);
  v.setUint32(0, id, true); v.setUint32(12, payload.length + 4, true); v.setUint32(16, tag | 0x10000, true);
  bytes.set(payload, 20); v.setUint32(bytes.length - 4, payload.length + 4, true);
  let a = 1, b = 0;
  for (const byte of bytes.subarray(16, bytes.length - 4)) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  v.setUint32(8, b * 65536 + a, true);
  return bytes;
}
function join(bytes: Uint8Array, at: number, own: number, index: number, other: number, otherIndex: number) {
  const v = new DataView(bytes.buffer);
  v.setUint32(at, 2, true); v.setBigUint64(at + 4, BigInt(own), true); v.setUint32(at + 12, index, true); v.setUint32(at + 16, 1, true);
  v.setBigUint64(at + 20, BigInt(other), true); v.setUint32(at + 28, otherIndex, true); v.setUint32(at + 32, 1, true);
}
function collector(version = 2025) { return createNativeMepCollector({ revitVersion: version, classes, elementIds: new Set([10, 20, 30]), curveIds: new Set([20]), fittingIds: new Set([30]) }); }

test("system references resolve across page order with checksum and source evidence", () => {
  const c = collector(), member = new Uint8Array(8);
  new DataView(member.buffer).setUint32(1, 10, true);
  c.pushPage(object(20, 125, member), location);
  c.pushPage(object(10, 123, counted("Supply Air")), { ...location, chunkIndex: 1 });
  const evidence = c.finish();
  assert.equal(evidence.systems[0]!.name, "Supply Air");
  assert.deepEqual(evidence.systems[0]!.members, [20]);
  assert.equal(evidence.systems[0]!.memberSources[0]!.source.byteOffset, 21);
  const corrupt = object(30, 125, member); corrupt[20] ^= 1;
  c.pushPage(corrupt, location);
  assert.deepEqual(c.finish().systems[0]!.members, [20]);
});

test("conflicting names suppress name and unsupported releases emit no evidence", () => {
  const c = collector();
  c.pushPage(object(10, 123, counted("A")), location);
  c.pushPage(object(10, 123, counted("B")), location);
  assert.equal(c.finish().systems[0]!.name, undefined);
  const unsupported = collector(2023);
  unsupported.pushPage(object(10, 123, counted("A")), location);
  assert.deepEqual(unsupported.finish().systems, []);
});

test("electrical circuit number is read from its bounded counted-list marker", () => {
  const payload = new Uint8Array(80);
  payload.fill(255, 0, 8); payload[8] = 1;
  payload.set(counted("Circuit 1"), 32);
  const c = collector(); c.pushPage(object(10, 124, payload), location);
  assert.equal(c.finish().systems[0]!.name, "Circuit 1");
});

test("later curve reference takes precedence; reciprocal fitting lists deduplicate", () => {
  const bytes = new Uint8Array(1700), v = new DataView(bytes.buffer);
  v.setUint16(0, 200, true); v.setUint32(2, 0xffffffff, true); v.setUint16(6, 201, true);
  join(bytes, 1021, 20, 0, 30, 2); join(bytes, 1217, 20, 1, 30, 2);
  join(bytes, 1500, 30, 2, 20, 1);
  const c = collector(); c.pushPage(bytes, location);
  const connections = c.finish().connections;
  assert.equal(connections.length, 1);
  assert.equal(connections[0]!.connectorIndex, 1);
  assert.equal(connections[0]!.sources.length, 2);
  const older = collector(2024); older.pushPage(bytes, location);
  assert.equal(older.finish().connections.length, 0);
});

test("unknown endpoint, truncation, and invalid flags cannot create a join", () => {
  const bytes = new Uint8Array(36);
  join(bytes, 0, 30, 2, 999, 1);
  const c = collector(); c.pushPage(bytes, location);
  join(bytes, 0, 30, 2, 20, 1); c.pushPage(bytes.subarray(0, 35), location);
  new DataView(bytes.buffer).setUint32(32, 4, true); c.pushPage(bytes, location);
  assert.deepEqual(c.finish().connections, []);
});

test("curve references retain equipment connector indices above the fitting range", () => {
  const bytes = new Uint8Array(1700), v = new DataView(bytes.buffer);
  v.setUint16(0, 200, true); v.setUint32(2, 0xffffffff, true); v.setUint16(6, 201, true);
  join(bytes, 1217, 20, 1, 30, 11);
  const c = collector(); c.pushPage(bytes, location);
  assert.equal(c.finish().connections[0]!.otherConnectorIndex, 11);
  const expressions: string[] = [];
  const count = emitNativeMepIfc({ add(s) { expressions.push(s); return expressions.length; } }, c.finish(), { ownerHistory: 1, elementEntities: new Map([[20, 100], [30, 101]]), guid: (_kind, key) => String(key), quoted: (s) => `'${s}'` });
  assert.equal(count.connectionCount, 1);
});

test("fitting membership can be established after its connector bytes", () => {
  const c = createNativeMepCollector({ revitVersion: 2025, classes, elementIds: new Set([20, 30]) });
  const bytes = new Uint8Array(36); join(bytes, 0, 30, 2, 20, 1);
  c.pushPage(bytes, location);
  assert.equal(c.finish().connections.length, 0);
  c.observeElementHeaders([{ elementId: 30, categoryId: -2008049 }]);
  assert.equal(c.finish().connections.length, 1);
});

test("complete adjacent pages recover split objects and connector lists with original offsets", () => {
  const c = collector();
  const bytes = object(10, 123, counted("Split"));
  c.pushPage(bytes.subarray(0, 23), { ...location, complete: true });
  c.pushPage(bytes.subarray(23), { ...location, chunkIndex: 1, complete: true });
  assert.equal(c.finish().systems[0]!.name, "Split");
  assert.equal(c.finish().systems[0]!.sources[0]!.chunkIndex, 0);
  const list = new Uint8Array(36); join(list, 0, 30, 2, 20, 1);
  c.pushPage(list.subarray(0, 17), { ...location, chunkIndex: 2, complete: true });
  c.pushPage(list.subarray(17), { ...location, chunkIndex: 3, complete: true });
  assert.equal(c.finish().connections.length, 1);
  const damaged = collector();
  damaged.pushPage(list.subarray(0, 17), { ...location, complete: false });
  damaged.pushPage(list.subarray(17), { ...location, chunkIndex: 1, complete: true });
  assert.equal(damaged.finish().connections.length, 0);
});

test("IFC ports and joins only connect exported products and carry unknown direction", () => {
  const c = collector(), bytes = new Uint8Array(36), member = new Uint8Array(8);
  new DataView(member.buffer).setUint32(0, 10, true);
  c.pushPage(object(10, 123, counted("HVAC")), location); c.pushPage(object(20, 125, member), location);
  join(bytes, 0, 30, 2, 20, 1); c.pushPage(bytes, location);
  const expressions: string[] = [];
  const writer = { add(text: string) { expressions.push(text); return expressions.length + 100; } };
  const context = { ownerHistory: 1, elementEntities: new Map([[20, 70], [30, 80]]), guid: (_: string, key: string | number) => String(key), quoted: (s: string) => `'${s}'` };
  assert.deepEqual(emitNativeMepIfc(writer, c.finish(), context), { systemCount: 1, portCount: 2, connectionCount: 1 });
  assert.equal(expressions.filter((e) => e.startsWith("IFCRELNESTS")).length, 2);
  assert.ok(expressions.some((e) => e.includes("$,$,$,.NOTDEFINED.,.NOTDEFINED.,.NOTDEFINED.")));
  assert.deepEqual(emitNativeMepIfc(writer, c.finish(), { ...context, elementEntities: new Map([[20, 70]]) }), { systemCount: 1, portCount: 0, connectionCount: 0 });
});
