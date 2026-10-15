import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  IFC_GUID_PARAMETER, isIfcGlobalId, revitDoorWindowTypeGlobalId,
  revitHashedIfcGlobalId, revitIfcSubElementGlobalId, storedIfcGlobalId,
  revitProjectedTypeGlobalId, IFC_TYPE_GUID_PARAMETER, nativeIfcGlobalId,
} from "../lib/reviter/ifc-global-id.ts";
import {
  createNativeOriginalSymbolCollector, doorWindowSymbolFlipped,
  nativeFamilyTypeGlobalId, verifiedOriginalSymbolObject,
  nativeOriginalSymbolElementIds, nativeOriginalSymbolFromFifo,
  resolveNativeIfcTypeIdentityEvidence, resolveNativeFamilyTypeIdentity,
  type NativeIfcTypeIdentityEvidence,
} from "../lib/reviter/native-ifc-type-identity.ts";
import type { ElementObject } from "../lib/reviter/element-objects.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import { inventoryIfc } from "../scripts/lib/ifc-comparison-stats.ts";

const GLOBAL_ID = "1G_I00WlX2MBQekqB04dFi";
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function independentlyHash(key: string): string {
  const digest = createHash("md5").update(key).digest("hex");
  const canonical = [digest.slice(0, 8).match(/../g)!.reverse().join(""), digest.slice(8, 12).match(/../g)!.reverse().join(""), digest.slice(12, 16).match(/../g)!.reverse().join(""), digest.slice(16)].join("");
  let number = BigInt(`0x${canonical}`), encoded = "";
  for (let index = 0; index < 22; index += 1) { encoded = alphabet[Number(number % 64n)] + encoded; number /= 64n; }
  return encoded;
}

test("browser MD5/.NET GUID hashing agrees with the independent Node implementation", () => {
  for (const key of ["", "test", "éα 🦉", `${GLOBAL_ID}Sub-element:Flipped: False`, `${GLOBAL_ID}Sub-element:Flipped: True InAssembly: False`]) {
    assert.equal(revitHashedIfcGlobalId(key), independentlyHash(key));
  }
});

test("type flip variants respect explicit exporter suffix and assembly configuration", () => {
  for (const flipped of [false, true]) for (const year of [2024, 2025, 2027]) {
    const key = `${GLOBAL_ID}Sub-element:Flipped: ${flipped ? "True" : "False"}${year >= 2025 ? " InAssembly: False" : ""}`;
    assert.equal(revitDoorWindowTypeGlobalId(GLOBAL_ID, flipped, false, year), independentlyHash(key));
  }
  assert.notEqual(revitDoorWindowTypeGlobalId(GLOBAL_ID, false, false, 2025), revitDoorWindowTypeGlobalId(GLOBAL_ID, false, true, 2025));
  assert.equal(revitDoorWindowTypeGlobalId(GLOBAL_ID, false, true, 2024), null);
  assert.equal(revitDoorWindowTypeGlobalId(GLOBAL_ID, false, false, 2023), null);
});

test("B73 alternate entity/predefined type hashes preserve schema case and exporter generation", () => {
  for (const year of [2024, 2025, 2027]) {
    const suffix = year >= 2025 ? " InAssembly: False" : "";
    assert.equal(revitProjectedTypeGlobalId(GLOBAL_ID, "IFCSLABTYPE", ".FLOOR.", year), independentlyHash(`${GLOBAL_ID}Sub-element: Entity: IfcSlabType:FLOOR${suffix}`));
  }
  assert.equal(revitProjectedTypeGlobalId(GLOBAL_ID, "UNSUPPORTED", ".FLOOR.", 2025), null);
});

test("InstanceAsType index 2048 changes canonical bytes10/11 and validates bounds", () => {
  assert.equal(revitIfcSubElementGlobalId("0000000000000000000000", 2048), "0000000000000020000000");
  assert.equal(revitIfcSubElementGlobalId(GLOBAL_ID, 0), GLOBAL_ID);
  for (const index of [-1, 65536, NaN, 1.5]) assert.equal(revitIfcSubElementGlobalId(GLOBAL_ID, index), null);
  for (const invalid of ["4" + GLOBAL_ID.slice(1), " "+GLOBAL_ID, GLOBAL_ID.slice(1), GLOBAL_ID.slice(0, -1)+"!"]) {
    assert.equal(isIfcGlobalId(invalid), false);
    assert.equal(revitIfcSubElementGlobalId(invalid, 1), null);
  }
});

test("stored IFC parameters remain separate and malformed/duplicate values are rejected", () => {
  const parameter = { parameterId: IFC_GUID_PARAMETER, name: "IfcGUID", value: GLOBAL_ID };
  assert.equal(storedIfcGlobalId([parameter], IFC_GUID_PARAMETER), GLOBAL_ID);
  assert.equal(storedIfcGlobalId([parameter, parameter], IFC_GUID_PARAMETER), null);
  assert.equal(storedIfcGlobalId([{ ...parameter, value: 100 }], IFC_GUID_PARAMETER), null);
  assert.equal(storedIfcGlobalId([{ ...parameter, value: GLOBAL_ID + " " }], IFC_GUID_PARAMETER), null);
  assert.equal(storedIfcGlobalId(undefined, IFC_GUID_PARAMETER), null);
});

function object(id: number, classTag: number, originalId = 0, size = 80) {
  const bytes = new Uint8Array(20 + size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, id, true); view.setUint32(12, size, true); view.setUint16(16, classTag, true);
  view.setUint32(size, originalId, true); view.setUint32(bytes.length - 4, size, true);
  let a = 1, b = 0;
  for (const byte of bytes.subarray(16, bytes.length - 4)) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  view.setUint32(8, (b * 65536 + a) >>> 0, true);
  return { bytes, frame: { offset: 0, elementId: id, objectLength: size, marker: classTag, typeCode: 0 } satisfies ElementObject };
}
const classes = [{ tag: 10, name: "GElement" }, { tag: 11, name: "FamilyInstance" }, { tag: 12, name: "FamilySymbol" }];
const location = (partition: number) => ({ stream: `Partitions/${partition}`, chunkIndex: 0, rawOffset: 100, complete: true });

test("only complete checksum-verified original symbol objects become identity evidence", () => {
  const generated = object(100, 10, 200);
  assert.equal(verifiedOriginalSymbolObject(generated.bytes, 0)?.end, 100);
  const damaged = generated.bytes.slice(); damaged[30] = damaged[30]! ^ 1;
  assert.equal(verifiedOriginalSymbolObject(damaged, 0), null);
  assert.equal(verifiedOriginalSymbolObject(generated.bytes.subarray(0, 99), 0), null);
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2025, classes, elementIds: new Set([100, 200]) });
  for (const own of [object(100, 11), object(200, 12), generated]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  assert.equal(collector.finish()[0]?.originalSymbolId, 200);
});

test("original symbols outside current ElemTable require validated history and verified symbol objects", () => {
  const fixture = ifcExportFixture();
  const identity = fixture.nativeIdentity!.identities[1]!;
  const declared = new Set([10]);
  const historyDomain = nativeOriginalSymbolElementIds(declared, [identity]);
  assert.equal(declared.has(11), false, "scene declaration domain remains unchanged");
  assert.equal(historyDomain.has(11), true);
  assert.equal(nativeOriginalSymbolElementIds(declared, [{ ...identity, uniqueId: "invalid" }]).has(11), false);
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes, elementIds: declared, historyElementIds: historyDomain });
  for (const own of [object(10, 11), object(11, 12), object(10, 10, 11)]) collector.consumeObjects(own.bytes, location(325), [own.frame]);
  assert.equal(collector.finish()[0]?.originalSymbolId, 11);
  const damaged = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes, elementIds: declared, historyElementIds: historyDomain });
  const symbol = object(11, 12); symbol.bytes[30] = symbol.bytes[30]! ^ 1;
  for (const own of [object(10, 11), symbol, object(10, 10, 11)]) damaged.consumeObjects(own.bytes, location(325), [own.frame]);
  assert.deepEqual(damaged.finish(), [], "history alone cannot establish original symbol class/layout");
  const historicalInstance = { ...identity, elementId: 20, originalElementId: 20, uniqueId: `${identity.episodeGuid}-00000014` };
  const boundedHistory = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes, elementIds: declared,
    historyElementIds: nativeOriginalSymbolElementIds(declared, [identity, historicalInstance]) });
  for (const own of [object(11, 12), object(20, 10, 11)]) boundedHistory.consumeObjects(own.bytes, location(325), [own.frame]);
  assert.deepEqual(boundedHistory.finish(), [], "unclassified historical geometry must not enter the identity walk");
  for (const own of [object(20, 11), object(20, 10, 11)]) boundedHistory.consumeObjects(own.bytes, location(325), [own.frame]);
  assert.equal(boundedHistory.finish()[0]?.elementId, 20, "a verified native instance may recover a source type reference");
  const references = boundedHistory.finish();
  const resolved = { references, placements: [], elementBounds: fixture.elementBounds, hostRelations: [], revitVersion: 2027 };
  assert.deepEqual(resolveNativeIfcTypeIdentityEvidence(resolved), [], "history source reference alone cannot create a converted owner");
  assert.equal(resolveNativeIfcTypeIdentityEvidence({ ...resolved, certifiedMeshElementIds: new Set([20]) })[0]?.elementId, 20);
  const damagedInstance = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes, elementIds: declared,
    historyElementIds: nativeOriginalSymbolElementIds(declared, [identity, historicalInstance]) });
  const instance = object(20, 11); instance.bytes[30] = instance.bytes[30]! ^ 1;
  for (const own of [object(11, 12), instance, object(20, 10, 11)]) damagedInstance.consumeObjects(own.bytes, location(325), [own.frame]);
  assert.deepEqual(damagedInstance.finish(), [], "damaged instance class evidence cannot admit a wider-domain owner");
});

test("highest numeric partition copy wins, conflicts at that priority are not guessed", () => {
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2024, classes, elementIds: new Set([100, 200, 300]) });
  for (const own of [object(100, 11), object(200, 12), object(300, 12)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  for (const [partition, originalId] of [[9, 200], [11, 300], [2, 200]]) {
    const own = object(100, 10, originalId); collector.consumeObjects(own.bytes, location(partition), [own.frame]);
  }
  assert.equal(collector.finish()[0]?.originalSymbolId, 300);
  const conflicting = object(100, 10, 200); collector.consumeObjects(conflicting.bytes, location(11), [conflicting.frame]);
  assert.deepEqual(collector.finish(), []);
});

test("original-symbol type, own-geometry type and unknown flip remain distinct", () => {
  const evidence: NativeIfcTypeIdentityEvidence = { elementId: 100, originalSymbolId: 200, source: "checksum-verified-GElement.original-symbol", revitVersion: 2025, ...location(1), objectOffset: 0 };
  const options = { evidence, nativeGuids: new Map([[100, GLOBAL_ID], [200, "0000000000000000000001"]]), instanceEntity: "IFCCOLUMN", exporterVersion: 2025 };
  assert.equal(nativeFamilyTypeGlobalId(options), "0000000000000000000001");
  assert.equal(nativeFamilyTypeGlobalId({ ...options, evidence: { ...evidence, originalSymbolId: null } }), revitIfcSubElementGlobalId(GLOBAL_ID, 2048));
  assert.equal(nativeFamilyTypeGlobalId({ ...options, instanceEntity: "IFCDOOR" }), null);
  assert.equal(nativeFamilyTypeGlobalId({ ...options, instanceEntity: "IFCDOOR", evidence: { ...evidence, flipped: true, flipSource: "native-instance-facing+native-host-wall-axis" } }), revitDoorWindowTypeGlobalId("0000000000000000000001", true, false, 2025));
});

test("door/window flip uses native facing against its host axis, including reversed axes", () => {
  assert.equal(doorWindowSymbolFlipped([0, 1], [0, 0], [1, 0], [0, 1]), false);
  assert.equal(doorWindowSymbolFlipped([0, 1], [0, 0], [1, 0], [0, -1]), true);
  assert.equal(doorWindowSymbolFlipped([0, 1], [0, 0], [-1, 0], [0, -1]), true);
  assert.equal(doorWindowSymbolFlipped([0, 1], [0, 0], [0, 0], [0, -1]), null);
});

test("declared native string tables preserve stored IFC ids and reject neighbour borrowing", () => {
  const bytes = new Uint8Array(300), view = new DataView(bytes.buffer);
  view.setBigUint64(0, 100n, true); view.setUint32(12, 280, true); view.setUint16(16, 0x0810, true);
  view.setInt32(26, -1, true); view.setUint16(30, 0x0100, true);
  bytes.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 1, 0, 0, 0], 48);
  view.setBigUint64(58, 100n, true);
  view.setUint32(125, 1, true); view.setBigInt64(129, BigInt(IFC_GUID_PARAMETER), true); view.setUint32(137, 22, true);
  for (let index = 0; index < GLOBAL_ID.length; index += 1) view.setUint16(141 + index * 2, GLOBAL_ID.charCodeAt(index), true);
  view.setUint32(296, 280, true);
  const decoded = collectElementParameters(bytes);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0]?.elementId, 100);
  assert.equal(storedIfcGlobalId(decoded[0]?.parameters, IFC_GUID_PARAMETER), GLOBAL_ID);
  view.setBigUint64(58, 101n, true);
  assert.deepEqual(collectElementParameters(bytes), [], "a header/anchor id disagreement cannot assign another element's GUID");
});

test("stored instance GUID export is opt-in, preserves raw values and avoids native-id theft", () => {
  const result = ifcExportFixture();
  const original = nativeIfcGlobalId(result.nativeIdentity!.identities[0]!)!;
  result.elementBounds[0]!.parameters = [{ parameterId: IFC_GUID_PARAMETER, name: "IfcGUID", value: GLOBAL_ID }];
  assert.ok(makeIfc(result).includes(`IFCWALL('${original}'`));
  const override = makeIfc(result, { allowGuidParameterOverride: true });
  assert.ok(override.includes(`IFCWALL('${GLOBAL_ID}'`));
  assert.ok(override.includes(`IFCTEXT('${GLOBAL_ID}')`), "raw stored parameter survives independently");
  const door = nativeIfcGlobalId(result.nativeIdentity!.identities[1]!)!;
  result.elementBounds[0]!.parameters[0]!.value = door;
  const collision = makeIfc(result, { allowGuidParameterOverride: true });
  assert.ok(collision.includes(`IFCWALL('${original}'`));
  assert.ok(collision.includes(`IFCDOOR('${door}'`));
});

test("stored GUID collisions with synthesized property sets retain unique IFC root identities", () => {
  const result = ifcExportFixture();
  const recoveryGuid = /IFCPROPERTYSET\('([^']+)',#\d+,'Reviter_Recovery'/.exec(makeIfc(result))?.[1];
  assert.ok(recoveryGuid);
  result.elementBounds[0]!.parameters = [{ parameterId: IFC_GUID_PARAMETER, name: "IfcGUID", value: recoveryGuid }];
  const source = makeIfc(result, { allowGuidParameterOverride: true });
  assert.ok(source.includes(`IFCWALL('${recoveryGuid}'`));
  assert.deepEqual(inventoryIfc(source).duplicateRootGlobalIds, []);
  assert.equal(source, makeIfc(result, { allowGuidParameterOverride: true }));
});

test("a later stored GUID colliding with an earlier property set falls back to native identity", () => {
  const result = ifcExportFixture();
  const recoveryGuid = /IFCPROPERTYSET\('([^']+)',#\d+,'Reviter_Recovery'/.exec(makeIfc(result))?.[1];
  assert.ok(recoveryGuid);
  const native = nativeIfcGlobalId(result.nativeIdentity!.identities[1]!)!;
  result.elementBounds[1]!.parameters = [{ parameterId: IFC_GUID_PARAMETER, name: "IfcGUID", value: recoveryGuid }];
  const source = makeIfc(result, { allowGuidParameterOverride: true });
  assert.ok(source.includes(`IFCDOOR('${native}'`));
  assert.ok(source.includes(`IFCTEXT('${recoveryGuid}')`), "the conflicting stored value remains raw evidence");
  assert.deepEqual(inventoryIfc(source).duplicateRootGlobalIds, []);
  assert.equal(source, makeIfc(result, { allowGuidParameterOverride: true }));
});

test("type parameter overrides share a stable type object across instances", () => {
  const result = ifcExportFixture();
  for (const element of result.elementBounds) Object.assign(element, {
    categoryId: -2_000_011, categoryName: "Walls", typeId: 20, typeName: "Same wall type",
    familyId: undefined, familyName: undefined,
    typeParameters: [{ parameterId: IFC_TYPE_GUID_PARAMETER, name: "IfcTypeGUID", value: GLOBAL_ID }],
  });
  const source = makeIfc(result, { allowGuidParameterOverride: true });
  assert.equal((source.match(/=IFCWALLTYPE\(/g) ?? []).length, 1);
  assert.ok(source.includes(`IFCWALLTYPE('${GLOBAL_ID}'`));
});

function typedDoorFixture() {
  const result = ifcExportFixture();
  for (const element of result.elementBounds) Object.assign(element, {
    categoryId: -2_000_023, categoryName: "Doors", typeId: 21,
    typeName: "Same door type", familyId: 22, familyName: "Same family",
  });
  const original = { ...result.nativeIdentity!.identities[0]!, elementId: 200, originalElementId: 200, uniqueId: "11111111-2222-3333-4444-555555555555-000000c8" };
  result.nativeIdentity!.identities.push(original);
  result.nativeIfcTypeIdentityEvidence = [10, 11].map(elementId => ({
    elementId, originalSymbolId: 200, source: "checksum-verified-GElement.original-symbol" as const,
    revitVersion: 2027, stream: "Partitions/1", chunkIndex: 0, rawOffset: 0, objectOffset: elementId,
    flipped: elementId === 11, flipSource: "native-instance-facing+native-host-wall-axis" as const,
  }));
  return result;
}

test("different door flips create distinct types while equal flips share their original-symbol type", () => {
  const result = typedDoorFixture();
  const original = nativeIfcGlobalId(result.nativeIdentity!.identities.at(-1)!)!;
  const source = makeIfc(result);
  assert.equal((source.match(/=IFCDOORTYPE\(/g) ?? []).length, 2);
  for (const flipped of [false, true]) assert.ok(source.includes(`IFCDOORTYPE('${revitDoorWindowTypeGlobalId(original, flipped, false, 2027)}'`));
  result.nativeIfcTypeIdentityEvidence![1]!.flipped = false;
  assert.equal((makeIfc(result).match(/=IFCDOORTYPE\(/g) ?? []).length, 1);
});

test("instance-owned geometry creates one distinct native sub-element type per instance", () => {
  const result = typedDoorFixture();
  for (const evidence of result.nativeIfcTypeIdentityEvidence!) evidence.originalSymbolId = null;
  const source = makeIfc(result);
  assert.equal((source.match(/=IFCDOORTYPE\(/g) ?? []).length, 2);
  for (const identity of result.nativeIdentity!.identities.slice(0, 2)) {
    assert.ok(source.includes(`IFCDOORTYPE('${revitIfcSubElementGlobalId(nativeIfcGlobalId(identity)!, 2048)}'`));
  }
});


/** Complete framed graphics with InstanceInfo followed by a queued GLine.
 * The symbol field is not at end−20; this is the deferred-body regression. */
function deferredSymbolObject(symbol: bigint, embedded = false, lineCount = 1) {
  const rootEnd = 166, instanceBytes = embedded ? 46 : 44, groupEnd = rootEnd + instanceBytes + 24 + lineCount * 6;
  const infoEnd = groupEnd + 112, lineEnd = infoEnd + lineCount * 84, end = lineEnd + (embedded ? 136 : 0);
  const bytes = new Uint8Array(end + 4), view = new DataView(bytes.buffer);
  const size = bytes.length - 20;
  view.setUint32(0, 100, true); view.setUint32(12, size, true); view.setUint16(16, 2246, true);
  const ginfo = (p: number, tag = 0) => { view.setBigInt64(p, -1n, true); view.setInt32(p + 8, tag, true); view.setUint32(p + 16, 0x00088004, true); };
  const descriptor = (p: number, token: number, slot: number) => { view.setInt32(p, token, true); if (token) view.setInt16(p + 4, slot, true); };
  ginfo(18, 100); view.setInt32(38, 2, true); descriptor(42, 3, 2215); descriptor(48, 4, 2248);
  view.setBigInt64(150, 100n, true); // two valid zero bounds at54; root owner tail
  ginfo(rootEnd); descriptor(rootEnd + 20, -1, 2513); descriptor(rootEnd + 26, embedded ? 5 : 0, 2246);
  ginfo(rootEnd + instanceBytes); view.setInt32(rootEnd + instanceBytes + 20, lineCount, true);
  for (let index = 0; index < lineCount; index++) descriptor(rootEnd + instanceBytes + 24 + index * 6, (embedded ? 6 : 5) + index, 1973);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30].forEach((v, i) => view.setFloat64(groupEnd + i * 8, v, true));
  view.setBigInt64(groupEnd + 96, symbol, true); view.setInt32(groupEnd + 108, 1, true);
  // FIFO: InstanceInfo, optional embedded GElement, then sibling's GLine.
  let lineStart = infoEnd;
  if (embedded) { ginfo(infoEnd); view.setBigInt64(infoEnd + 120, -1n, true); lineStart += 136; }
  for (let index = 0; index < lineCount; index++) { const start = lineStart + index * 84; ginfo(start); view.setFloat64(start + 20 + 6 * 8, 1, true); }
  view.setUint32(bytes.length - 4, size, true);
  let a = 1, b = 0;
  for (const byte of bytes.subarray(16, bytes.length - 4)) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  view.setUint32(8, (b * 65536 + a) >>> 0, true);
  return { bytes, frame: { offset: 0, elementId: 100, objectLength: size, marker: 2246, typeCode: 0 } satisfies ElementObject };
}

test("structural symbol decoding follows FIFO siblings rather than a geometry tail", () => {
  const fixture = deferredSymbolObject(200n);
  assert.notEqual(new DataView(fixture.bytes.buffer).getUint32(fixture.bytes.length - 20, true), 200);
  const symbol = nativeOriginalSymbolFromFifo(fixture.bytes, fixture.frame, 2027);
  assert.equal(symbol?.originalSymbolId, 200);
  assert.equal(symbol?.symbolFieldOffset, 336);
  assert.equal(symbol?.embeddedSymbolGeometry, false);
  const damaged = fixture.bytes.slice(); damaged[200] ^= 1;
  assert.equal(nativeOriginalSymbolFromFifo(damaged, fixture.frame, 2027), null);
  assert.equal(nativeOriginalSymbolFromFifo(fixture.bytes, fixture.frame, 2023), null);
  assert.equal(nativeOriginalSymbolFromFifo(fixture.bytes, { ...fixture.frame, elementId: 101 }, 2027), null);
});

test("embedded instance geometry retains the stored symbol but withholds its IFC recipe", () => {
  const fixture = deferredSymbolObject(200n, true);
  const symbol = nativeOriginalSymbolFromFifo(fixture.bytes, fixture.frame, 2027);
  assert.equal(symbol?.originalSymbolId, 200);
  assert.equal(symbol?.embeddedSymbolGeometry, true);
  const evidence: NativeIfcTypeIdentityEvidence = { elementId: 100, source: "checksum-verified-GElement.original-symbol", revitVersion: 2027, ...location(1), objectOffset: 0, ...symbol! };
  assert.equal(nativeFamilyTypeGlobalId({ evidence, nativeGuids: new Map([[100, GLOBAL_ID], [200, GLOBAL_ID]]), instanceEntity: "IFCCOLUMN", exporterVersion: 2027 }), null);
  assert.equal(nativeFamilyTypeGlobalId({ evidence: { ...evidence, originalSymbolId: null }, nativeGuids: new Map([[100, GLOBAL_ID]]), instanceEntity: "IFCCOLUMN", exporterVersion: 2027 }), null);
});


test("the original-symbol collector retains FIFO field provenance and embedded ambiguity", () => {
  for (const embedded of [false, true]) {
    const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100, 200]) });
    for (const own of [object(100, 11), object(200, 12), deferredSymbolObject(200n, embedded)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
    const reference = collector.finish()[0];
    assert.equal(reference?.originalSymbolId, 200);
    assert.equal(reference?.embeddedSymbolGeometry, embedded);
    assert.equal(typeof reference?.symbolFieldOffset, "number");
  }
});


test("a same-partition embedded graphics copy cannot lose its recipe ambiguity", () => {
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100, 200]) });
  for (const own of [object(100, 11), object(200, 12), deferredSymbolObject(200n, true), deferredSymbolObject(200n, false)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  assert.equal(collector.finish()[0]?.embeddedSymbolGeometry, true);
});


test("type resolution distinguishes missing, unsupported and unproven exporter evidence", () => {
  const evidence: NativeIfcTypeIdentityEvidence = { elementId: 100, originalSymbolId: 200,
    source: "checksum-verified-GElement.original-symbol", revitVersion: 2027, ...location(1), objectOffset: 0 };
  const options = { evidence, nativeGuids: new Map([[100, GLOBAL_ID], [200, GLOBAL_ID]]), instanceEntity: "IFCCOLUMN", exporterVersion: 2027 };
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, evidence: undefined }), { status: "withheld", reason: "missing-source-reference" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, evidence: { ...evidence, elementId: NaN } }), { status: "withheld", reason: "invalid-source-reference" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, evidence: { ...evidence, embeddedSymbolGeometry: true } }), { status: "withheld", reason: "embedded-geometry-summary-unproven" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, nativeGuids: new Map() }), { status: "withheld", reason: "missing-native-creation-identity" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, nativeGuids: new Map([[200, "invalid"]]) }), { status: "withheld", reason: "missing-native-creation-identity" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, instanceEntity: "IFCDOOR" }), { status: "withheld", reason: "door-window-flip-unproven" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, exporterVersion: 2023, instanceEntity: "IFCWINDOW",
    evidence: { ...evidence, flipped: false, flipSource: "native-instance-facing+native-host-wall-axis" } }), { status: "withheld", reason: "unsupported-exporter-recipe" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity(options), { status: "resolved", globalId: GLOBAL_ID, recipe: "original-symbol" });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ ...options, evidence: { ...evidence, originalSymbolId: null } }),
    { status: "resolved", globalId: revitIfcSubElementGlobalId(GLOBAL_ID, 2048), recipe: "instance-as-type" });
});


test("large identity records require full checksum and FIFO instead of geometry-tail bytes", () => {
  const fixture = deferredSymbolObject(200n, true, 800);
  assert.ok(fixture.frame.objectLength > 65535);
  const reference = nativeOriginalSymbolFromFifo(fixture.bytes, fixture.frame, 2027);
  assert.equal(reference?.originalSymbolId, 200);
  assert.equal(reference?.embeddedSymbolGeometry, true);
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100, 200]) });
  for (const own of [object(100, 11), object(200, 12)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  const damaged = fixture.bytes.slice(); damaged[60000] ^= 1;
  collector.consumeLargeObjects(damaged, location(1), [fixture.frame]);
  assert.deepEqual(collector.finish(), []);
  collector.consumeLargeObjects(fixture.bytes, { ...location(1), complete: false }, [fixture.frame]);
  assert.deepEqual(collector.finish(), []);
  collector.consumeLargeObjects(fixture.bytes, location(1), [fixture.frame]);
  assert.equal(collector.finish()[0]?.originalSymbolId, 200);
  assert.equal(collector.finish()[0]?.embeddedSymbolGeometry, true);
  assert.equal(collector.finish()[0]?.symbolFieldOffset, reference?.symbolFieldOffset);
});

test("optional large-object work cannot erase previous small-object identity evidence", () => {
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100, 200]) });
  for (const own of [object(100, 11), object(200, 12), deferredSymbolObject(200n)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  const large = deferredSymbolObject(200n, false, 800);
  for (let count = 0; count < 130 && !collector.largeObjectWork.capped; count++) collector.consumeLargeObjects(large.bytes, location(1), [large.frame]);
  assert.equal(collector.largeObjectWork.capped, true);
  assert.equal(collector.capped, false);
  assert.equal(collector.finish()[0]?.originalSymbolId, 200);
});


function flipEnvelopeFixture() {
  const result = ifcExportFixture();
  const own = { ...result.elementBounds[1]!, elementId: 100, boundsFeet: { min: { x: 0, y: 1, z: 0 }, max: { x: 1, y: 2, z: 1 } } };
  const host = { ...result.elementBounds[0]!, elementId: 300, solid: { elementId: 300, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, baseElevation: 0, topElevation: 10, thickness: 1 } };
  const reference: NativeIfcTypeIdentityEvidence = { elementId: 100, originalSymbolId: 200,
    source: "checksum-verified-GElement.original-symbol", revitVersion: 2027, ...location(1), objectOffset: 0,
    originalSymbolEnvelope: { source: "checksum-verified-original-symbol-GElement.m_bBox", apiGeometryOptionsEquivalent: false,
      minimum: [0, -4, 0], maximum: [1, -2, 1], ...location(1), objectOffset: 10 } };
  const options = { references: [reference], placements: [{ elementId: 100, geometryId: 200, origin: [0, 0, 0] as [number, number, number], basis: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    elementBounds: [own, host], hostRelations: [{ elementId: 100, hostId: 300, kind: "host" as const, source: "Partitions/InsertableInst.m_hostId" as const, evidence: "persisted" as const,
      fieldOffset: 151 as const, recordOffset: 0, objectLength: 80, objectMarker: 0x07ef as const }], revitVersion: 2027 };
  return { reference, options };
}

test("conflicting instance and original-symbol envelopes withhold the flip instead of choosing a candidate", () => {
  const { options, reference } = flipEnvelopeFixture();
  reference.flipped = true; reference.flipSource = "native-instance-facing+native-host-wall-axis";
  const evidence = resolveNativeIfcTypeIdentityEvidence(options)[0]!;
  assert.equal(evidence.flipped, undefined);
  assert.deepEqual(evidence.flipEnvelopeComparison, { status: "conflict", instanceEnvelopeCandidate: false, originalSymbolEnvelopeCandidate: true, apiGeometryOptionsEquivalent: false });
  assert.deepEqual(resolveNativeFamilyTypeIdentity({ evidence, nativeGuids: new Map([[200, GLOBAL_ID]]), instanceEntity: "IFCDOOR", exporterVersion: 2027 }),
    { status: "withheld", reason: "original-geometry-envelope-conflict" });
  options.placements[0]!.basis = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
  const mirrored = resolveNativeIfcTypeIdentityEvidence(options)[0]!;
  assert.equal(mirrored.flipEnvelopeComparison?.status, "agree");
  assert.equal(mirrored.flipped, true);
  assert.equal(mirrored.flipEnvelopeComparison?.apiGeometryOptionsEquivalent, false);
});

test("partial original-symbol envelopes cannot invent a conflict or a replacement flip", () => {
  const { reference, options } = flipEnvelopeFixture();
  reference.originalSymbolEnvelope!.minimum = [0, NaN, 0];
  const evidence = resolveNativeIfcTypeIdentityEvidence(options)[0]!;
  assert.equal(evidence.flipped, false);
  assert.equal(evidence.flipEnvelopeComparison, undefined);
});

function symbolGraphicsEnvelope(minimumY: number, lineCount = 1) {
  const fixture = deferredSymbolObject(200n, false, lineCount), view = new DataView(fixture.bytes.buffer);
  view.setUint32(0, 200, true); view.setInt32(26, 200, true); view.setBigInt64(150, 200n, true); view.setUint32(158, 3, true);
  view.setFloat64(62, minimumY, true); view.setFloat64(86, minimumY + 2, true);
  let a = 1, b = 0;
  for (const byte of fixture.bytes.subarray(16, fixture.bytes.length - 4)) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  view.setUint32(8, (b * 65536 + a) >>> 0, true);
  return { bytes: fixture.bytes, frame: { ...fixture.frame, elementId: 200 } };
}

test("stored symbol envelopes need verified named owners and unique source bounds", () => {
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100, 200]) });
  for (const own of [object(100, 11), object(200, 12), symbolGraphicsEnvelope(-4), deferredSymbolObject(200n)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  assert.deepEqual(collector.finish()[0]?.originalSymbolEnvelope?.minimum, [0, -4, 0]);
  assert.equal(collector.finish()[0]?.originalSymbolEnvelope?.apiGeometryOptionsEquivalent, false);
  const conflicting = symbolGraphicsEnvelope(2);
  collector.consumeObjects(conflicting.bytes, location(1), [conflicting.frame]);
  assert.equal(collector.finish()[0]?.originalSymbolEnvelope, undefined, "same-partition graphics alternatives remain ambiguous");
  collector.consumeObjects(conflicting.bytes, location(2), [conflicting.frame]);
  assert.deepEqual(collector.finish()[0]?.originalSymbolEnvelope?.minimum, [0, 2, 0]);
});


test("historical symbol envelopes have separate bounded work and cannot erase native identities", () => {
  const collector = createNativeOriginalSymbolCollector({ revitVersion: 2027, classes: [{ tag: 2246, name: "GElement" }, ...classes.filter(c => c.name !== "GElement")], elementIds: new Set([100]), historyElementIds: new Set([200]) });
  for (const own of [object(100, 11), object(200, 12), deferredSymbolObject(200n), symbolGraphicsEnvelope(-4)]) collector.consumeObjects(own.bytes, location(1), [own.frame]);
  assert.deepEqual(collector.finish()[0]?.originalSymbolEnvelope?.minimum, [0, -4, 0]);
  const largeEnvelope = symbolGraphicsEnvelope(-4, 600);
  for (let count = 0; count < 650 && !collector.historicalEnvelopeWork.capped; count++) collector.consumeObjects(largeEnvelope.bytes, location(1), [largeEnvelope.frame]);
  assert.equal(collector.historicalEnvelopeWork.capped, true);
  assert.equal(collector.capped, false);
  assert.equal(collector.finish()[0]?.originalSymbolId, 200);
  assert.deepEqual(collector.finish()[0]?.originalSymbolEnvelope?.minimum, [0, -4, 0]);
});
