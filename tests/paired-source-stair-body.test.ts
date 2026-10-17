import assert from "node:assert/strict";
import test from "node:test";
import { expandedIfcGlobalId, pairedIfcGlobalIdMatchesNativeIdentity, pairedSourceItemMeshTopology } from "../lib/reviter/paired-source-stair-body.ts";
import type { NativeElementIdentity } from "../lib/reviter/native-identity.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPairedSourceStairBodyContext, validatePairedSourceStairBodyV3, pairedSourceBodyMeshHash, pairedSourceGraphHash, pairedSourceRecordsBoundToIfc } from "../lib/reviter/paired-source-stair-body.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

const samples = [
  [1514127, "6f202619-a979-4cd9-aa80-08b72aa399e1", "1l82OPgNbCsQg02BSgj8Dk"],
  [1514130, "6f202619-a979-4cd9-aa80-08b72aa399e1", "1l82OPgNbCsQg02BSgj8Dp"],
  [1514132, "6f202619-a979-4cd9-aa80-08b72aa399e1", "1l82OPgNbCsQg02BSgj8Dr"],
  [1696012, "bf41ff0b-3968-4e80-8983-495ac58db708", "2$GVyBEMXEW8c3ILh5b5O4"],
  [2439788, "389f2700-1c62-4587-b6ab-486360c94fb6", "0udoS07695XxQhI6DWx7NQ"],
  [1903837, "23735924-f1b2-40d8-aa91-dd1de0bbc2f3", "0ZSraayR90sAgHtHtWfiuk"],
] as const;
const identity = (id: number, episodeGuid: string): NativeElementIdentity => ({
  elementId: id, originalElementId: id, episodeGuid,
  uniqueId: `${episodeGuid}-${id.toString(16).padStart(8, "0")}`,
  creationEpisodeId: 1, lastModificationEpisodeId: 1, lastUserModificationEpisodeId: null,
  byteOffset: 34, provenance: "Global/ElemTable.ElementHistory+Global/History.Episode",
});

test("six independently recovered native original identities match the original IFC base GlobalIds exactly", () => {
  for (const [id, episode, globalId] of samples) assert.equal(pairedIfcGlobalIdMatchesNativeIdentity(globalId, identity(id, episode)), true);
});

test("native original element ids survive remapping and cannot be replaced by a current id or changed UUID", () => {
  const [id, episode, globalId] = samples[0];
  const source = identity(id, episode);
  source.elementId = 9000000;
  assert.equal(pairedIfcGlobalIdMatchesNativeIdentity(globalId, source), true);
  source.originalElementId = source.elementId;
  assert.equal(pairedIfcGlobalIdMatchesNativeIdentity(globalId, source), false);
  const wrong = identity(id, episode.replace("6f202619", "6f202618"));
  assert.equal(pairedIfcGlobalIdMatchesNativeIdentity(globalId, wrong), false);
});

test("a derived second occurrence is retained as a distinct identifier rather than aliasing the native base", () => {
  const source = identity(1903837, "23735924-f1b2-40d8-aa91-dd1de0bbc2f3");
  assert.equal(pairedIfcGlobalIdMatchesNativeIdentity("0ZSraayR90sAgHtHtWfiuk", source), true);
  assert.equal(pairedIfcGlobalIdMatchesNativeIdentity("2cA1O9LFB6CMr2gL2fxPsU", source), false);
  assert.notEqual(expandedIfcGlobalId("0ZSraayR90sAgHtHtWfiuk"), expandedIfcGlobalId("2cA1O9LFB6CMr2gL2fxPsU"));
});

test("malformed IFC encodings and incomplete original native identities fail closed", () => {
  for (const value of ["", "4l82OPgNbCsQg02BSgj8Dk", "1l82OPgNbCsQg02BSgj8D!", "1l82OPgNbCsQg02BSgj8Dk0"]) assert.equal(expandedIfcGlobalId(value), undefined);
  const [id, episode, globalId] = samples[0];
  for (const source of [
    { ...identity(id, episode), uniqueId: `${episode}-00000000` },
    { ...identity(id, episode), originalElementId: 0x1_0000_0000 },
    { ...identity(id, episode), provenance: "label" },
  ]) assert.equal(pairedIfcGlobalIdMatchesNativeIdentity(globalId, source as NativeElementIdentity), false);
});

const tetrahedron = () => ({
  positionsFeet: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3],
});
test("an original source item's closed outward shell has exact positive volume without geometric tolerances", () => {
  assert.deepEqual(pairedSourceItemMeshTopology(tetrahedron()), {
    vertexCount: 4, triangleCount: 4, components: [{ triangleCount: 4, sixTimesSignedVolume: ["1", "1"] }],
  });
  const translated = tetrahedron();
  translated.positionsFeet = translated.positionsFeet.map((n, i) => n + [1048576, -4194304, 8388608][i % 3]!);
  assert.deepEqual(pairedSourceItemMeshTopology(translated), pairedSourceItemMeshTopology(tetrahedron()));
});

test("open, inverted, degenerate and nonmanifold item shells cannot advertise a positive complete body", () => {
  for (const mutation of ["open", "inverted", "flat", "duplicate", "nonfinite", "index"] as const) {
    const mesh = tetrahedron();
    if (mutation === "open") mesh.indices.splice(0, 3);
    if (mutation === "inverted") for (let i = 0; i < mesh.indices.length; i += 3) [mesh.indices[i], mesh.indices[i + 1]] = [mesh.indices[i + 1]!, mesh.indices[i]!];
    if (mutation === "flat") mesh.positionsFeet[11] = 0;
    if (mutation === "duplicate") mesh.indices.push(...mesh.indices.slice(0, 3));
    if (mutation === "nonfinite") mesh.positionsFeet[0] = NaN;
    if (mutation === "index") mesh.indices[0] = 4;
    assert.equal(pairedSourceItemMeshTopology(mesh), undefined, mutation);
  }
});

test("positive volume in one component cannot hide an inverted independent shell", () => {
  const mesh = tetrahedron(), second = tetrahedron();
  second.positionsFeet = second.positionsFeet.map((n, i) => n / 2 + (i % 3 === 0 ? 3 : 0));
  mesh.positionsFeet.push(...second.positionsFeet);
  for (let i = 0; i < second.indices.length; i += 3) mesh.indices.push(second.indices[i + 1]! + 4, second.indices[i]! + 4, second.indices[i + 2]! + 4);
  assert.equal(pairedSourceItemMeshTopology(mesh), undefined);
});

test("raw source slices cannot authorize changed bytes or a self-rehashed record", () => {
  const bytes = new TextEncoder().encode("#1=IFCCARTESIANPOINT((0.,0.,0.));\n");
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const record = { expressId: 1, byteOffset: 0, byteLength: bytes.length - 1, text: new TextDecoder().decode(bytes.subarray(0, -1)), sha256: sha(bytes.subarray(0, -1)) };
  assert.equal(pairedSourceRecordsBoundToIfc(bytes, sha(bytes), [record]), true);
  const changed = { ...record, text: record.text.replace("0.", "1.") };
  changed.sha256 = sha(new TextEncoder().encode(changed.text));
  assert.equal(pairedSourceRecordsBoundToIfc(bytes, sha(bytes), [changed]), false);
});

const sourceDirectory = process.env.UNBC_PAIRED_STAIR_SOURCE_DIR;
const reviewDirectory = process.env.UNBC_ORIGINAL_STAIR_REVIEW_DIR;
const sourceEnabled = Boolean(sourceDirectory && reviewDirectory);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let loaded: ReturnType<typeof loadOriginalSource> | undefined;
function loadOriginalSource() {
  const manifest = JSON.parse(readFileSync(join(sourceDirectory!, "ifc-body-candidate-v3-manifest.json"), "utf8"));
  const ifc = readFileSync(join(sourceDirectory!, "UNBC.fixed-library.ifc"));
  const context = createPairedSourceStairBodyContext(ifc, manifest.ifcSha256)!; assert.ok(context);
  const original = JSON.parse(readFileSync(join(reviewDirectory!, "priority-stair-original-elements.json"), "utf8"));
  const geometry = JSON.parse(readFileSync(join(reviewDirectory!, "pipeline/priority-original-owner-meshes.json"), "utf8"));
  const doc = JSON.parse(readFileSync(join(sourceDirectory!, "native-source-identities.json"), "utf8"));
  assert.equal(original.sourceModelSha256, manifest.sourceModelSha256); assert.equal(geometry.sourceModelSha256, manifest.sourceModelSha256);
  const model = {
    nativeIdentity: original.nativeIdentity, nativeStairAssemblies: original.assemblies, elementOwnership: geometry.ownership,
    elementBounds: [...new Map([...original.elements, ...geometry.elements.map((e: { record: ConvertResult["elementBounds"][number] }) => e.record)].filter(Boolean).map((e) => [e.elementId, e])).values()],
  } as Pick<ConvertResult, "nativeIdentity" | "nativeStairAssemblies" | "elementOwnership" | "elementBounds">;
  const document = { sourceModelSha256: doc.sourceModelSha256, documentGuidSlots: doc.documentGuidSlots,
    uniqueDocumentGuid: doc.basicFileInfo.uniqueDocumentGuid, uniqueDocumentIncrements: doc.basicFileInfo.uniqueDocumentIncrements };
  return { manifest, ifc, context, model, document };
}
function originalCandidate(id: number) {
  const source = loaded ??= loadOriginalSource();
  const record = source.manifest.candidates.find((c: { nativeElementId: number }) => c.nativeElementId === id)!;
  assert.ok(record);
  const bytes = readFileSync(record.path), data = JSON.parse(bytes.toString());
  assert.equal(sha(bytes), record.sha256);
  return { ...source, record, bytes, data };
}

for (const [id, stair] of [[1514127, 1514126], [1514130, 1514126], [1514132, 1514126], [1696012, 1696006], [1903837, 1903824], [2439788, 2439748]]) {
  test(`actual original v3 Body ${id} verifies immutable source operands without claiming route approval`, { skip: !sourceEnabled }, () => {
    const v = originalCandidate(id!);
    const result = validatePairedSourceStairBodyV3(v.context, v.bytes, v.record.sha256, v.model, v.manifest.sourceModelSha256, stair!, v.document);
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (result.ok) {
      assert.equal(result.certificate.nativeElementId, id);
      assert.equal(result.certificate.provenance, "reference-ifc");
      assert.equal(result.certificate.versionGuidMismatchRetained, true);
      assert.equal(result.certificate.originalNativeWalkingCorrespondenceApproved, false);
      assert.equal(result.certificate.routeApproved, false);
      if (id === 1903837) assert.equal(result.certificate.retainedOccurrenceExpressIds.length, 2);
      if (id === 1514127 || id === 1514130 || id === 1696012 || id === 1903837) assert.ok(result.certificate.independentProductControlRawDifference.missingTriangles > 0);
    }
  });
}

test("actual source edits, missing Body operands, graph gaps and invented topology are refused after candidate rehash", { skip: !sourceEnabled }, () => {
  for (const mutation of ["frozen-hash", "drop-item", "drop-source-reference", "changed-source-record", "inverted-item", "foreign-owner", "drop-occurrence", "borrow-occurrence-record", "empty-guid", "false-native-guid", "different-source-entity", "conflicting-assembly"] as const) {
    const occurrenceCase = mutation === "drop-occurrence" || mutation === "borrow-occurrence-record";
    const v = originalCandidate(occurrenceCase ? 1903837 : 1514127), data = structuredClone(v.data), model = structuredClone(v.model);
    if (mutation === "frozen-hash") data.mesh.positionsFeet[0] += 0.001;
    if (mutation === "drop-item") data.physicalItems.pop();
    if (mutation === "drop-source-reference") {
      data.physicalItems[0].sourceGraph.records.shift();
      data.physicalItems[0].sourceGraph.sha256 = pairedSourceGraphHash(data.physicalItems[0].sourceGraph.records);
    }
    if (mutation === "changed-source-record") {
      const r = data.physicalItems[0].sourceGraph.records[0]; r.text = r.text.replace("0.", "1."); r.sha256 = sha(new TextEncoder().encode(r.text));
      data.physicalItems[0].sourceGraph.sha256 = pairedSourceGraphHash(data.physicalItems[0].sourceGraph.records);
    }
    if (mutation === "inverted-item") {
      const mesh = data.physicalItems[0].mesh; for (let i = 0; i < mesh.indices.length; i += 3) [mesh.indices[i], mesh.indices[i + 1]] = [mesh.indices[i + 1], mesh.indices[i]];
      data.physicalItems[0].meshSha256 = pairedSourceBodyMeshHash(mesh);
    }
    if (mutation === "foreign-owner") {
      const record = model.elementOwnership!.records.find((r) => r.elementId === data.nativeElementId)!; record.owningElementId = 1903824;
    }
    if (mutation === "drop-occurrence") data.allNativeTagOccurrences.pop();
    if (mutation === "borrow-occurrence-record") data.allNativeTagOccurrences[0].sourceProductRecord = structuredClone(data.allNativeTagOccurrences[1].sourceProductRecord);
    if (mutation === "empty-guid") data.sourceDocument.ifcContentGuid = "";
    if (mutation === "false-native-guid") data.sourceDocument.nativeUniqueDocumentGuid = data.sourceDocument.ifcVersionGuid;
    if (mutation === "different-source-entity") data.physicalItems[0].sourceEntity = structuredClone(data.physicalItems[1].sourceEntity);
    if (mutation === "conflicting-assembly") model.nativeStairAssemblies!.push({ ...structuredClone(model.nativeStairAssemblies![0]!), stairElementId: 8888888, runAndLandingIds: [data.nativeElementId] });
    const bytes = new TextEncoder().encode(JSON.stringify(data)), expected = mutation === "frozen-hash" ? v.record.sha256 : sha(bytes);
    const result = validatePairedSourceStairBodyV3(v.context, bytes, expected, model, v.manifest.sourceModelSha256, occurrenceCase ? 1903824 : 1514126, v.document);
    assert.equal(result.ok, false, mutation);
  }
});

test("original inverse cuts cannot be hidden by empty candidate operation arrays", { skip: !sourceEnabled }, () => {
  const v = originalCandidate(1514127), data = structuredClone(v.data);
  const cut = `#999999998=IFCOPENINGELEMENT('0000000000000000000000',#6,$,$,$,$,$,$);\r\n#999999999=IFCRELVOIDSELEMENT('1000000000000000000000',#6,$,$,#${data.ifcProduct.expressId},#999999998);\r\n`;
  const text = v.ifc.toString(), at = text.lastIndexOf("ENDSEC;"); assert.ok(at > 0);
  const bytes = new TextEncoder().encode(text.slice(0, at) + cut + text.slice(at));
  data.ifcSha256 = sha(bytes); data.ifcBytes = bytes.length;
  const context = createPairedSourceStairBodyContext(bytes, data.ifcSha256)!; assert.ok(context);
  const extraction = new TextEncoder().encode(JSON.stringify(data));
  const result = validatePairedSourceStairBodyV3(context, extraction, sha(extraction), v.model, v.manifest.sourceModelSha256, 1514126, v.document);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /cuts or projections/);
});

test("valid STEP whitespace cannot hide unimplemented original cuts or projections", { skip: !sourceEnabled }, () => {
  const v = originalCandidate(1514127), text = v.ifc.toString(), at = text.lastIndexOf("ENDSEC;");
  for (const type of ["IFCRELVOIDSELEMENT", "IFCRELPROJECTSELEMENT"]) {
    const record = `#999999999= ${type} ('1000000000000000000000',#6,$,$,#${v.data.ifcProduct.expressId},#999999998);\r\n`;
    const bytes = new TextEncoder().encode(text.slice(0, at) + record + text.slice(at));
    assert.equal(createPairedSourceStairBodyContext(bytes, sha(bytes)), undefined, type);
  }
});

test("a Node Buffer source context snapshots original bytes before caller mutation", { skip: !sourceEnabled }, () => {
  const v = originalCandidate(1514127), buffer = Buffer.from(v.ifc);
  const context = createPairedSourceStairBodyContext(buffer, v.manifest.ifcSha256)!; assert.ok(context);
  buffer.fill(0);
  const result = validatePairedSourceStairBodyV3(context, v.bytes, v.record.sha256, v.model, v.manifest.sourceModelSha256, 1514126, v.document);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});
