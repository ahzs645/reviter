import test from "node:test";
import assert from "node:assert/strict";
import { createNativeStructuralSectionCollector, resolveNativeSectionFamilyRelations, STRUCTURAL_SECTION_PARAMETERS } from "../lib/reviter/native-structural-profiles.ts";
function block(owner = 42, values: number[] = [2, 3, .2, .3, 1, 1.5]) {
  const bytes = new Uint8Array(8 + 59 + 24 * values.length); const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(owner), true); bytes.fill(255, 8, 64);
  Object.values(STRUCTURAL_SECTION_PARAMETERS).slice(0, values.length).forEach((parameter, i) => {
    const at = 67 + i * 24; view.setFloat64(at, values[i]!, true); bytes.fill(255, at + 8, at + 16); view.setBigInt64(at + 16, BigInt(parameter), true);
  }); return bytes;
}
const location = { stream: "Partitions/1", chunkIndex: 0, rawOffset: 128, complete: true };
function collector() { return createNativeStructuralSectionCollector({ revitVersion: 2024, elementIds: new Set([42]) }); }
test("six native section parameters recover dimensions without names, geometry or IFC input", () => {
  const c = collector(); c.consume(block(), location); c.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "ignored", value: 8 }] });
  const [section] = c.finish(new Set([42])); assert.equal(section?.shape, "symmetric-I");
  assert.deepEqual([section?.widthFeet, section?.depthFeet, section?.webFeet, section?.flangeFeet], [2, 3, .2, .3]);
  assert.equal(section?.witnesses.length, 6); assert.equal(c.finish(new Set([43])).length, 0);
});
test("channels, incomplete owners, unqualified releases and disagreeing pages do not become I sections", () => {
  for (const bytes of [block(99), block(42, [2, 3, 2, .3, 1, 1.5]), block().slice(0, -24)]) {
    const c = collector(); c.consume(bytes, location); assert.equal(c.finish(new Set([42])).length, 0);
  }
  const c = collector(); c.consume(block(), location); c.consume(block(42, [2.1, 3, .2, .3, 1.05, 1.5]), { ...location, stream: "Partitions/2" }); c.consume(block(), location); assert.equal(c.finish(new Set([42])).length, 0);
  const wrongRelease = createNativeStructuralSectionCollector({ revitVersion: 2023, elementIds: new Set([42]) }); wrongRelease.consume(block(), location); assert.equal(wrongRelease.finish(new Set([42])).length, 0);
  const partial = collector(); partial.consume(block(), { ...location, complete: false }); assert.equal(partial.finish(new Set([42])).length, 0);
  const zeroOwner = block(0, []), unknown = block(99, []), tail = block().slice(67);
  for (const stop of [zeroOwner, unknown]) {
    const bytes = new Uint8Array(block().length + stop.length + tail.length); bytes.set(block()); bytes.set(stop, block().length); bytes.set(tail, block().length + stop.length);
    // A preceding owner's complete section survives, but following values
    // cannot create a disagreement attributed to that preceding owner.
    const joined = collector(); joined.consume(bytes, location); assert.equal(joined.finish(new Set([42])).length, 1);
  }
});

test("symmetric metrics need the owned section-shape code; HSS, asymmetric and conflicting codes stay unresolved", () => {
  for (const shape of [null, 14, 6, 8]) {
    const c = collector(); c.consume(block(), location);
    if (shape !== null) c.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "arbitrary", value: shape }] });
    assert.equal(c.finish(new Set([42]))[0]?.shape, shape === 6 || shape === 8 ? "symmetric-I" : "unresolved");
  }
  const conflict = collector(); conflict.consume(block(), location);
  for (const shape of [6, 14, 6]) conflict.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "ignored", value: shape }] });
  assert.equal(conflict.finish(new Set([42]))[0]?.shape, "unresolved");
  const asymmetric = collector(); asymmetric.consume(block(42, [2, 3, .2, .3, .5, 1.5]), location); asymmetric.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "ignored", value: 6 }] }); assert.equal(asymmetric.finish(new Set([42]))[0]?.shape, "unresolved");
});

test("section parameter ownership survives consecutive complete pages and cross-page markers but never a missing page", () => {
  const source = block();
  for (const split of [28, 70, 116, 170]) {
    const c = collector(); c.consume(source.subarray(0, split), location); c.consume(source.subarray(split), { ...location, chunkIndex: 1, rawOffset: 512 });
    assert.equal(c.finish(new Set([42])).length, 1, `split ${split}`);
    assert.ok(c.finish(new Set([42]))[0]!.witnesses.every(w => w.valueOffset >= 0));
  }
  const tiny = collector(); for (let at = 0; at < source.length; at += 28) tiny.consume(source.subarray(at, at + 28), { ...location, chunkIndex: at / 28 }); assert.equal(tiny.finish(new Set([42])).length, 1); assert.ok(tiny.finish(new Set([42]))[0]!.witnesses.every(w => w.valueOffset >= 0 && w.valueOffset < 28));
  const missing = collector(); missing.consume(source.subarray(0, 70), location); missing.consume(source.subarray(70), { ...location, chunkIndex: 2 }); assert.equal(missing.finish(new Set([42])).length, 0);
  const partial = collector(); partial.consume(source.subarray(0, 70), location); partial.consume(new Uint8Array(), { ...location, chunkIndex: 1, complete: false }); partial.consume(source.subarray(70), { ...location, chunkIndex: 2 }); assert.equal(partial.finish(new Set([42])).length, 0);
});

test("family-wide shape classification follows only the exact source symbol-family edge", () => {
  const c = createNativeStructuralSectionCollector({ revitVersion: 2025, elementIds: new Set([42, 70, 71]) });
  c.consume(block(), location); c.consumeOwnedParameters({ elementId: 70, parameters: [{ parameterId: -1005501, name: "not a caption join", value: 6 }] }, location);
  const relation = { symbolId: 42, familyId: 70, recordOffset: 32, objectLength: 500, objectMarker: 0x0810 as const, evidence: "framed-family-symbol-family-id" as const };
  const [section] = c.finish(new Set([42]), [relation]); assert.equal(section?.shape, "symmetric-I");
  assert.equal(section?.shapeOwnerElementId, 70); assert.equal(section?.shapeResolution, "inherited-family"); assert.equal(section?.shapeSource, "native-symbol-family-owned-STRUCTURAL_SECTION_SHAPE");
  assert.deepEqual(section?.shapeFamilyRelation, relation); assert.equal(section?.shapeWitnesses?.[0]?.rawOffset, 128);
  assert.equal(c.finish(new Set([42]), [{ ...relation, symbolId: 71 }])[0]?.shape, "unresolved");
  assert.equal(c.finish(new Set([42]), [relation, { ...relation, familyId: 71 }])[0]?.shape, "unresolved");
});

test("present invalid, explicit NotDefined, conflicting symbol values and invalid links block family classification", () => {
  const relation = { symbolId: 42, familyId: 70, recordOffset: 32, objectLength: 500, objectMarker: 0x0810 as const, evidence: "framed-family-symbol-family-id" as const };
  for (const own of [0, -1, "bad", 1.5]) {
    const c = createNativeStructuralSectionCollector({ revitVersion: 2025, elementIds: new Set([42, 70]) }); c.consume(block(), location);
    c.consumeOwnedParameters({ elementId: 70, parameters: [{ parameterId: -1005501, name: "shape", value: 8 }] });
    c.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "shape", value: own }] });
    assert.equal(c.finish(new Set([42]), [relation])[0]?.shape, "unresolved", String(own));
  }
  const c = createNativeStructuralSectionCollector({ revitVersion: 2025, elementIds: new Set([42, 70]) }); c.consume(block(), location); c.consumeOwnedParameters({ elementId: 70, parameters: [{ parameterId: -1005501, name: "shape", value: 8 }] });
  assert.equal(c.finish(new Set([42]), [{ ...relation, familyId: -1 }, relation])[0]?.shape, "unresolved");
  c.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "shape", value: 6 }, { parameterId: -1005501, name: "shape", value: 0 }] });
  assert.equal(c.finish(new Set([42]), [relation])[0]?.shape, "unresolved");
});

test("explicit symbol classification cannot hide a contradictory known family classification", () => {
  const c = createNativeStructuralSectionCollector({ revitVersion: 2025, elementIds: new Set([42, 70]) }); c.consume(block(), location);
  c.consumeOwnedParameters({ elementId: 42, parameters: [{ parameterId: -1005501, name: "shape", value: 8 }] });
  c.consumeOwnedParameters({ elementId: 70, parameters: [{ parameterId: -1005501, name: "shape", value: 14 }] });
  assert.equal(c.finish(new Set([42]), [{ symbolId: 42, familyId: 70, recordOffset: 0, objectLength: 500, objectMarker: 0x0810, evidence: "framed-family-symbol-family-id" }])[0]?.shape, "unresolved");
});

test("section-only family links cover declared types outside geometry-cache ownership and reject all source conflicts", () => {
  const candidate = { symbolId: 42, familyId: 70, recordOffset: 32, objectLength: 500, objectMarker: 0x0810 as const };
  const set = { symbolId: 42, recordOffset: 32, objectLength: 500, objectMarker: 0x0810 as const, referencePairs: new Uint32Array(), staticTailReferencePairs: new Uint32Array([70, 449]) };
  const ids = new Set([42, 70, 71]), families = new Set([70, 71]);
  assert.equal(resolveNativeSectionFamilyRelations([candidate], [set], families, ids).length, 2);
  assert.equal(resolveNativeSectionFamilyRelations([candidate, { ...candidate, familyId: 71 }], [set], families, ids).length, 0);
  assert.equal(resolveNativeSectionFamilyRelations([candidate], [{ ...set, staticTailReferencePairs: new Uint32Array([70, 449, 71, 512]) }], families, ids).length, 0);
  assert.equal(resolveNativeSectionFamilyRelations([candidate], [set], families, new Set([70, 71])).length, 0);
});
