import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { originalNativePlanarComponentEnvelope, planarComponentEnvelopeGeometry, outwardNativeRationalBound } from "../lib/reviter/native-planar-component-envelopes.ts";
import { nativeSourcePlanarComponentEnvelopes, prepareNativeMaterialSource } from "../lib/reviter/native-material-source.ts";
import { prepareNativeLocalStairMaterial } from "../lib/reviter/native-local-transition-qualification.ts";
import { validNativeSourceStairMaterial } from "../lib/reviter/native-source-stair-material.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import { Rational, rational } from "../lib/reviter/native-rational-overlay.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/native-planar-component-envelopes.json", import.meta.url), "utf8"));
const raw = (id: number) => Uint8Array.from(Buffer.from(fixture.frames.find((f: { elementId: number }) => f.elementId === id).frameHex, "hex"));
function replay(id = 1496327) {
  const bytes = raw(id), root = decodeRevit2027FramedGRepRoot(bytes, {offset: 0, elementId: id, marker: 2246, objectLength: bytes.length - 20, typeCode: 0}, 2027);
  assert.ok(root.ok); const result = replayRevit2027GRepFifo(bytes, root.value); assert.ok(result.ok); return result.value;
}
function sourceFixture() {
  const fact = originalNativePlanarComponentEnvelope(raw(1496327))!;
  assert.ok(fact);
  const record = {elementId: fact.nativeElementId, categoryId: -2000921, boundsFeet: structuredClone(fact.boundsFeet)};
  const headers = [{elementId: fact.nativeElementId, categoryId: record.categoryId, familyId: null, ownerViewId: null, designOptionId: null}];
  const model = {origin: {x: 0, y: 0, z: 0}, meshes: [], elementBounds: [record], elementOwnership: undefined} as unknown as ConvertResult;
  const refresh = () => {model.nativeMaterialSource = prepareNativeMaterialSource(fixture.sourceModelSha256, headers, [], undefined, [], [fact]);};
  refresh(); return {model, fact, headers, refresh};
}

test("four actual complete original upper-finish frames retain every one of 66 faces in eleven conservative components", () => {
  for (const id of [1496327, 1498365, 1500196, 2474573]) {
    const input = raw(id), before = Buffer.from(input).toString("hex"), result = originalNativePlanarComponentEnvelope(input)!;
    assert.ok(result); assert.equal(result.use, "foreign-material-envelope-only"); assert.equal(result.components.length, 11);
    const faces = result.components.flatMap((c) => c.faceTokens); assert.equal(faces.length, 66); assert.equal(new Set(faces).size, 66);
    assert.equal(Buffer.from(input).toString("hex"), before); assert.equal(result.originalFrameHex, before);
  }
});

test("complete original frames above the legacy 65,535-byte scanner limit retain all their source components", () => {
  for (const id of [1496324, 1498362, 1500193, 2474570, 2160669, 2161354]) {
    const input = raw(id); assert.ok(input.length > 65535);
    const result = originalNativePlanarComponentEnvelope(input)!; assert.ok(result);
    assert.equal(result.components.length, [2160669, 2161354].includes(id) ? 51 : 23);
    const faces = result.components.flatMap((c) => c.faceTokens);
    assert.equal(new Set(faces).size, faces.length); assert.equal(faces.length, replay(id).spans.filter((s) => s.readerId === "Revit2027Face").length);
  }
});

test("directed IEEE bounds include exact rational endpoints of both signs, subnormal residuals and exactly representable coordinates", () => {
  const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
  for (const q of [new Rational(1n, 3n), new Rational(-1n, 3n), new Rational(1n, 10n ** 330n), new Rational(-1n, 10n ** 330n), rational(42)]) {
    assert.ok(compare(rational(outwardNativeRationalBound(q, -1)), q) <= 0n);
    assert.ok(compare(rational(outwardNativeRationalBound(q, 1)), q) >= 0n);
  }
});

test("unequal original twin coordinates widen envelopes without snapping or mutating the source", () => {
  const source = replay(), before = JSON.stringify(source, (_, v) => typeof v === "bigint" ? v.toString() : v);
  const baseline = planarComponentEnvelopeGeometry(source)!; assert.equal(baseline.length, 11);
  const surface = source.spans.find((s) => s.readerId === "Revit2027AnalyticSurface:634")!.value as {surface: {envelope: {secondCorner: number[]}}};
  surface.surface.envelope.secondCorner[0] += 2;
  const widened = planarComponentEnvelopeGeometry(source)!; assert.equal(widened.length, 11);
  assert.ok(widened.some((c, i) => c.boundsFeet.max.x > baseline[i]!.boundsFeet.max.x || c.boundsFeet.max.y > baseline[i]!.boundsFeet.max.y));
  assert.notEqual(JSON.stringify(source, (_, v) => typeof v === "bigint" ? v.toString() : v), before);
  const snapshot = JSON.stringify(source, (_, v) => typeof v === "bigint" ? v.toString() : v); planarComponentEnvelopeGeometry(source);
  assert.equal(JSON.stringify(source, (_, v) => typeof v === "bigint" ? v.toString() : v), snapshot);
});

test("curved/unknown branches, omitted or null loops, open topology, foreign owners and nonfinite domains preserve conservative fallback", () => {
  assert.equal(originalNativePlanarComponentEnvelope(raw(2360983)), undefined);
  for (const mutation of ["extra-primitive", "missing-loop", "null-loop", "open-loop", "wrong-owner", "duplicate-token", "hole", "nan"] as const) {
    const copy = replay();
    if (mutation === "extra-primitive") copy.spans[0]!.readerId = "Revit2027GLine";
    if (mutation === "missing-loop") (copy.spans as Array<(typeof copy.spans)[number]>).splice(copy.spans.findIndex((s) => s.readerId === "Revit2027EdgeLoop"), 1);
    if (mutation === "null-loop") (copy.spans.find((s) => s.readerId === "Revit2027Face")!.value as {firstLoop: {token: number}}).firstLoop.token = 0;
    if (mutation === "open-loop") (copy.spans.find((s) => s.readerId === "Revit2027EdgeLoop")!.value as {open: boolean}).open = true;
    if (mutation === "wrong-owner") copy.spans[0]!.ownerElementId += 1n;
    if (mutation === "duplicate-token") copy.spans[1]!.propertyToken = copy.spans[0]!.propertyToken;
    if (mutation === "hole") (copy.spans.find((s) => s.readerId === "Revit2027Face")!.value as {faceRegions: {count: number}}).faceRegions.count = 1;
    if (mutation === "nan") (copy.spans.find((s) => s.readerId === "Revit2027AnalyticSurface:634")!.value as {origin: number[]}).origin[0] = NaN;
    assert.equal(planarComponentEnvelopeGeometry(copy), undefined, mutation);
  }
});

test("damaged/trailing frames fail original checksum and full-frame replay", () => {
  const damaged = raw(1496327); damaged[200] ^= 1;
  assert.equal(originalNativePlanarComponentEnvelope(damaged), undefined);
  const trailing = new Uint8Array(raw(1496327).length + 1); trailing.set(raw(1496327));
  assert.equal(originalNativePlanarComponentEnvelope(trailing), undefined);
});

test("source consumer refuses stale model, changed headers/bounds/frames, duplicate facts and duplicate native records", () => {
  for (const mutation of ["model", "header", "bounds", "frame", "duplicate-fact", "duplicate-record"] as const) {
    const {model, fact, headers, refresh} = sourceFixture();
    assert.equal(nativeSourcePlanarComponentEnvelopes(model, fixture.sourceModelSha256).size, 1);
    if (mutation === "model") model.nativeMaterialSource!.sourceModelSha256 = "f".repeat(64);
    if (mutation === "header") {headers[0]!.categoryId = 123; refresh();}
    if (mutation === "bounds") model.elementBounds[0]!.boundsFeet.max.z += 1;
    if (mutation === "frame") {const bytes = Buffer.from(fact.originalFrameHex, "hex"); bytes[200] ^= 1; fact.originalFrameHex = bytes.toString("hex"); refresh();}
    if (mutation === "duplicate-fact") model.nativeMaterialSource!.planarComponentEnvelopes!.push(structuredClone(fact));
    if (mutation === "duplicate-record") model.elementBounds.push(structuredClone(model.elementBounds[0]!));
    assert.equal(nativeSourcePlanarComponentEnvelopes(model, fixture.sourceModelSha256).size, 0, mutation);
  }
});

test("material bands retain enclosing solid boxes and actual component collisions, preserving source and caller geometry", () => {
  const {model, fact} = sourceFixture(), component = fact.components[0]!.boundsFeet;
  const x = (component.min.x + component.max.x) / 2, y = (component.min.y + component.max.y) / 2, z = (component.min.z + component.max.z) / 2;
  const receipt = {nativeStairId: 99, nativeRunIds: [100], nativeFloorElementIds: [101, 102] as [number, number], pointsFeet: [[x - 0.1, y, z], [x + 0.1, y, z]] as [number, number, number][]};
  const data = {source: {modelSha256: fixture.sourceModelSha256}} as IndoorDataset;
  const before = JSON.stringify([model, receipt]);
  const material = prepareNativeLocalStairMaterial(model, data, receipt, []);
  assert.equal(validNativeSourceStairMaterial(material, fixture.sourceModelSha256, 99, receipt.pointsFeet, undefined, undefined, undefined, true), false);
  assert.ok(material.bands[0]!.sections.some((s) => s.nativeElementId === fact.nativeElementId));
  assert.equal(JSON.stringify([model, receipt]), before);
});

test("verified finite source components remove an empty whole-flight box overlap without waiving real component material", () => {
  const {model} = sourceFixture(), receipt = {nativeStairId: 99, nativeRunIds: [100], nativeFloorElementIds: [101, 102] as [number, number], pointsFeet: [[53, 774.5, 31.5], [54, 774.5, 31.5]] as [number, number, number][]};
  const data = {source: {modelSha256: fixture.sourceModelSha256}} as IndoorDataset;
  const before = JSON.stringify([model, receipt]);
  const withSource = prepareNativeLocalStairMaterial(model, data, receipt, []);
  assert.equal(validNativeSourceStairMaterial(withSource, fixture.sourceModelSha256, 99, receipt.pointsFeet, undefined, undefined, undefined, true), true);
  const fallback = structuredClone(model); delete fallback.nativeMaterialSource;
  const withoutSource = prepareNativeLocalStairMaterial(fallback, data, receipt, []);
  assert.equal(validNativeSourceStairMaterial(withoutSource, fixture.sourceModelSha256, 99, receipt.pointsFeet, undefined, undefined, undefined, true), false);
  assert.equal(JSON.stringify([model, receipt]), before);
});
