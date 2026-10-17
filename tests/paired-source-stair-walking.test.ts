import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pairedSourceHorizontalCoverage, inspectPairedSourceStairWalking, type PairedSourceStairWalkingInput } from "../lib/reviter/paired-source-stair-walking.ts";
import { createPairedSourceStairBodyContext, type PairedSourceBodyMesh } from "../lib/reviter/paired-source-stair-body.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { NativeSourceStairReceipt } from "../lib/reviter/native-source-stair-width.ts";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const rectangle = (x0: number, y0: number, x1: number, y1: number, z = 1): PairedSourceBodyMesh => ({
  positionsFeet: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], indices: [0, 1, 2, 0, 2, 3],
});
const demand = [[[[-1, -1], [1, -1], [1, 1], [-1, 1]]]] as [number, number][][][];

test("interior walking demand is covered by the exact original plane without requiring unrelated exterior edges to coincide", () => {
  const result = pairedSourceHorizontalCoverage(rectangle(-2, -2, 2, 2), 1, demand);
  assert.deepEqual(result, { covered: true, requiredAreaSquareFeet: ["4", "1"], missingAreaSquareFeet: ["0", "1"], exactHeightUpwardTriangleCount: 2, nearestUpwardHeightDifferenceFeet: ["0", "1"] });
});

test("a one-ULP source height difference stays unresolved rather than being grouped with native height", () => {
  const result = pairedSourceHorizontalCoverage(rectangle(-2, -2, 2, 2, 1 + Number.EPSILON), 1, demand)!;
  assert.equal(result.covered, false);
  assert.equal(result.exactHeightUpwardTriangleCount, 0);
  assert.deepEqual(result.missingAreaSquareFeet, ["4", "1"]);
  assert.deepEqual(result.nearestUpwardHeightDifferenceFeet, ["1", "4503599627370496"]);
});

test("every positive original gap is retained, including one smaller than prior display tolerances", () => {
  const left = rectangle(-2, -2, 0, 2), right = rectangle(2 ** -40, -2, 2, 2);
  left.positionsFeet.push(...right.positionsFeet); left.indices.push(...right.indices.map((i) => i + 4));
  const result = pairedSourceHorizontalCoverage(left, 1, demand)!;
  assert.equal(result.covered, false);
  assert.deepEqual(result.missingAreaSquareFeet, ["1", "549755813888"]);
});

test("an original body hole cannot be supported by its outer rectangle or erased as a tiny part", () => {
  const pieces = [rectangle(-2, -2, -.25, 2), rectangle(.25, -2, 2, 2), rectangle(-.25, -2, .25, -.25), rectangle(-.25, .25, .25, 2)];
  const mesh: PairedSourceBodyMesh = { positionsFeet: [], indices: [] };
  for (const piece of pieces) { const offset = mesh.positionsFeet.length / 3; mesh.positionsFeet.push(...piece.positionsFeet); mesh.indices.push(...piece.indices.map((i) => i + offset)); }
  const result = pairedSourceHorizontalCoverage(mesh, 1, demand)!;
  assert.equal(result.covered, false); assert.deepEqual(result.missingAreaSquareFeet, ["1", "4"]);
});

test("downward undersides and nonhorizontal triangles cannot grant a horizontal walking surface", () => {
  const mesh = rectangle(-2, -2, 2, 2);
  mesh.indices = [0, 2, 1, 0, 3, 2];
  assert.equal(pairedSourceHorizontalCoverage(mesh, 1, demand)!.covered, false);
  mesh.indices = [0, 1, 2, 0, 2, 3]; mesh.positionsFeet[2] = 0;
  assert.equal(pairedSourceHorizontalCoverage(mesh, 1, demand)!.covered, false);
});

test("source coordinates and exact required holes are preserved by the mathematical predicate", () => {
  const mesh = rectangle(-2, -2, 2, 2), before = JSON.stringify(mesh);
  const holeDemand = [structuredClone(demand[0]!)]; holeDemand[0]!.push([[-.25, -.25], [-.25, .25], [.25, .25], [.25, -.25]]);
  const result = pairedSourceHorizontalCoverage(mesh, 1, holeDemand)!;
  assert.equal(result.covered, true); assert.deepEqual(result.requiredAreaSquareFeet, ["15", "4"]); assert.equal(JSON.stringify(mesh), before);
  assert.equal(pairedSourceHorizontalCoverage(mesh, NaN, demand), undefined);
  assert.equal(pairedSourceHorizontalCoverage({ ...mesh, indices: [999, 1, 2] }, 1, demand), undefined);
});

const sourceDirectory = process.env.UNBC_PAIRED_STAIR_SOURCE_DIR;
const reviewDirectory = process.env.UNBC_ORIGINAL_STAIR_REVIEW_DIR;
let actual: ReturnType<typeof loadSource> | undefined;
function loadSource() {
  const manifestBytes = readFileSync(join(sourceDirectory!, "ifc-body-candidate-v3-manifest.json"));
  assert.equal(sha(manifestBytes), "f51ec7edefb7668cecb99cb2ba016547633f1f4b281a2c61e1512fec0057b61b");
  const manifest = JSON.parse(manifestBytes.toString());
  const context = createPairedSourceStairBodyContext(readFileSync(join(sourceDirectory!, "UNBC.fixed-library.ifc")), manifest.ifcSha256)!;
  assert.ok(context);
  const original = JSON.parse(readFileSync(join(reviewDirectory!, "priority-stair-original-elements.json"), "utf8"));
  const geometry = JSON.parse(readFileSync(join(reviewDirectory!, "pipeline/priority-original-owner-meshes.json"), "utf8"));
  const doc = JSON.parse(readFileSync(join(sourceDirectory!, "native-source-identities.json"), "utf8"));
  const model = { nativeIdentity: original.nativeIdentity, nativeStairAssemblies: original.assemblies, elementOwnership: geometry.ownership,
    elementBounds: [...new Map([...original.elements, ...geometry.elements.map((e: { record: ConvertResult["elementBounds"][number] }) => e.record)].filter(Boolean).map((e) => [e.elementId, e])).values()],
  } as PairedSourceStairWalkingInput["originalModel"];
  const receipt = JSON.parse(readFileSync(join(sourceDirectory!, "../pipeline/original-1696012-platform-probe.json"), "utf8")).receipt as NativeSourceStairReceipt;
  const candidate = manifest.candidates.find((c: { nativeElementId: number }) => c.nativeElementId === 1696012)!;
  return { originalIfcContext: context, originalBodies: [{ bytes: readFileSync(candidate.path), expectedOriginalExtractionSha256: candidate.sha256 }],
    originalNativeRoleBytes: readFileSync(join(sourceDirectory!, "correspondence/native-role-1696012.json")),
    expectedOriginalNativeRolesSha256: "d7053e02806b5b9ec3d42f054c88fdfd65fc5234766f42ae54b4eebd29a8a4f4",
    originalModel: model, sourceModelSha256: manifest.sourceModelSha256, nativeStairId: 1696006,
    originalDocument: { sourceModelSha256: doc.sourceModelSha256, documentGuidSlots: doc.documentGuidSlots, uniqueDocumentGuid: doc.basicFileInfo.uniqueDocumentGuid, uniqueDocumentIncrements: doc.basicFileInfo.uniqueDocumentIncrements }, receipt,
  } satisfies PairedSourceStairWalkingInput;
}
test("actual original1696012 body and native inventory do not promote numerical correspondence or missing terminal authority", { skip: !(sourceDirectory && reviewDirectory) }, () => {
  const input = actual ??= loadSource(), before = JSON.stringify(input.receipt);
  const result = inspectPairedSourceStairWalking(input);
  assert.equal(result.preparedTreadInventoryMatchesOriginal, true, JSON.stringify(result.blockers));
  assert.equal(result.treads.length, 23);
  assert.equal(result.treads.filter((row) => row.result?.exactHeightUpwardTriangleCount === 0).length, 12);
  assert.equal(result.treads.filter((row) => row.result && row.result.exactHeightUpwardTriangleCount > 0 && BigInt(row.result.missingAreaSquareFeet[0]) > 0n).length, 11);
  assert.equal(result.requiredTreadPatchesCovered, false);
  assert.equal(result.routeApproved, false); assert.equal(result.originalNativeWalkingCorrespondenceApproved, false);
  assert.equal(result.terminalSupportApproved, false); assert.equal(result.riserAndLandingContinuityApproved, false);
  assert.equal(result.ownBodyClearanceApproved, false); assert.equal(JSON.stringify(input.receipt), before);
});
test("missing or changed physical source cannot borrow a prepared complete-body flag", { skip: !(sourceDirectory && reviewDirectory) }, () => {
  const input = actual ??= loadSource();
  const omitted = inspectPairedSourceStairWalking({ ...input, originalBodies: [] });
  assert.equal(omitted.requiredTreadPatchesCovered, false);
  assert.equal(omitted.treads.length, 23);
  assert.ok(omitted.treads.every((row) => row.blocker?.includes("Missing independently verified")));
  const bytes = Uint8Array.from(input.originalBodies[0]!.bytes); bytes[bytes.length - 2] ^= 1;
  const changed = inspectPairedSourceStairWalking({ ...input, originalBodies: [{ ...input.originalBodies[0]!, bytes }] });
  assert.equal(changed.requiredTreadPatchesCovered, false);
  assert.ok(changed.blockers.some((reason) => reason.includes("independent frozen source manifest")));
  assert.equal(changed.routeApproved, false);
});
test("a duplicated, omitted or changed prepared tread cannot stand in for independently recovered source roles", { skip: !(sourceDirectory && reviewDirectory) }, () => {
  const input = actual ??= loadSource();
  for (const mutation of ["duplicate", "omit", "height", "vertex", "native-hash"] as const) {
    const receipt = structuredClone(input.receipt), changed = { ...input, receipt };
    if (mutation === "duplicate") receipt.treads[1] = structuredClone(receipt.treads[0]!);
    if (mutation === "omit") receipt.treads.pop();
    if (mutation === "height") receipt.treads[0]!.elevationFeet += 1e-12;
    if (mutation === "vertex") receipt.treads[0]!.ringFeet[0]![0] += 1e-12;
    if (mutation === "native-hash") changed.expectedOriginalNativeRolesSha256 = "f".repeat(64);
    const result = inspectPairedSourceStairWalking(changed);
    assert.equal(result.preparedTreadInventoryMatchesOriginal, false, mutation); assert.equal(result.requiredTreadPatchesCovered, false, mutation);
    assert.equal(result.routeApproved, false, mutation);
  }
});
test("actual typed1514126 matches both original runs but one positive patch cannot certify the remaining body or landing/terminals", { skip: !(sourceDirectory && reviewDirectory) }, () => {
  const input = actual ??= loadSource();
  const manifest = JSON.parse(readFileSync(join(sourceDirectory!, "ifc-body-candidate-v3-manifest.json"), "utf8"));
  const result = inspectPairedSourceStairWalking({ ...input, nativeStairId: 1514126,
    originalNativeRoleBytes: readFileSync(join(sourceDirectory!, "walking-admission-20261015/1514126-original-role-union.json")),
    expectedOriginalNativeRolesSha256: "1e6de9cd69e5b256e8a477367ad03e23f92e063bb23224afa1617397af179482",
    originalBodies: manifest.candidates.filter((c: { nativeElementId: number }) => [1514127, 1514130, 1514132].includes(c.nativeElementId))
      .map((c: { path: string; sha256: string }) => ({ bytes: readFileSync(c.path), expectedOriginalExtractionSha256: c.sha256 })),
    receipt: JSON.parse(readFileSync(join(sourceDirectory!, "../pipeline/original-typed-1514126/source-typed-receipt-proposal.json"), "utf8")),
  });
  assert.equal(result.preparedTreadInventoryMatchesOriginal, true, JSON.stringify(result.blockers));
  assert.equal(result.treads.length, 18);
  assert.equal(result.treads.filter((row) => row.result?.covered).length, 1);
  assert.equal(result.treads.filter((row) => row.result?.exactHeightUpwardTriangleCount === 0).length, 9);
  assert.equal(result.requiredTreadPatchesCovered, false);
  assert.equal(result.terminalSupportApproved, false); assert.equal(result.riserAndLandingContinuityApproved, false);
  assert.equal(result.originalNativeWalkingCorrespondenceApproved, false); assert.equal(result.routeApproved, false);
});
