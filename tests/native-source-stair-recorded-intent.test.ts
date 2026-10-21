import test from "node:test";
import { assertStairBaseCompilerInputIdentityPreserved } from "../lib/reviter/native-source-stair-base-identity-guard.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  captureOriginalRecordedStairIntentDemand,
  originalRecordedStairIntentDemandFacts,
} from "../lib/reviter/native-source-stair-recorded-intent.ts";
const directory = new URL(
    "./fixtures/native-original-stair-recorded-intent/",
    import.meta.url,
  ),
  manifest = JSON.parse(
    readFileSync(new URL("manifest.json", directory), "utf8"),
  ),
  read = (name: string) => {
    const bytes = readFileSync(new URL(name, directory)),
      expected = manifest.files.find((f: { file: string }) => f.file === name);
    assert.equal(hash(bytes), expected.sha256);
    assert.equal(bytes.length, expected.bytes);
    return JSON.parse(bytes.toString("utf8"));
  },
  lower = read("lower-annotation.original.json"),
  upper = read("upper-annotation.original.json"),
  review = read("lower-review.original.json"),
  selection = {
    lowerRoomKey: lower.key as string,
    upperRoomKey: upper.key as string,
    nativeStairId: 1638837,
    nativeRunId: 1638854,
  };
function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function fixture() {
  return structuredClone({
    format: "reviter-room-annotations",
    version: 1,
    coordinateSystem: "revit-model-feet",
    model: { fileName: "unbc.rvt" },
    annotations: [lower, upper],
    areaMetadata: { [`room:${lower.key}`]: review },
  });
}
function capture(data = fixture(), choice = selection) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return captureOriginalRecordedStairIntentDemand(
    bytes,
    hash(bytes),
    manifest.sourceModelSha256,
    choice,
  );
}
test("exact original recorded stair IDs form detached identity demand without invented human, DWG, geometry or permission approval", () => {
  const demand = capture(),
    facts = originalRecordedStairIntentDemandFacts(demand);
  assert.equal(demand.scope, "original-recorded-identity-demand-only");
  assert.deepEqual(facts.originalRecordedAreaMetadata, review);
  assert.deepEqual(Object.keys(review).sort(), ["elementIds", "notes"]);
  assert.equal(facts.lowerRoom.levelId, 694);
  assert.equal(facts.upperRoom.levelId, 400176);
  assert.equal(facts.recordedMetadataAuthorshipEstablished, false);
  assert.equal(facts.rawDwgOrRegistrationIndependentlyVerified, false);
  assert.equal(facts.nativeRoomOwnershipApproved, false);
  assert.equal(facts.sourcePhysicsOrPermissionApproved, false);
  assert.equal(facts.routeApproved, false);
  facts.originalRecordedAreaMetadata.notes = "changed";
  facts.lowerRoom.originalAnnotation.levelId = 1;
  assert.deepEqual(
    originalRecordedStairIntentDemandFacts(demand).originalRecordedAreaMetadata,
    review,
  );
  assert.equal(
    originalRecordedStairIntentDemandFacts(demand).lowerRoom.levelId,
    694,
  );
});
test("copied handles, changed room bytes and substituted native identities cannot restore recorded intent", () => {
  const handle = capture();
  for (const forged of [
    { ...handle },
    structuredClone(handle),
    JSON.parse(JSON.stringify(handle)),
  ])
    assert.throws(
      () => originalRecordedStairIntentDemandFacts(forged),
      /Untrusted/,
    );
  const bytes = new TextEncoder().encode(JSON.stringify(fixture()));
  assert.throws(
    () =>
      captureOriginalRecordedStairIntentDemand(
        bytes,
        "0".repeat(64),
        manifest.sourceModelSha256,
        selection,
      ),
    /checksum/,
  );
  assert.throws(
    () => capture(fixture(), { ...selection, nativeStairId: 10 }),
    /flight intent/,
  );
  assert.throws(
    () => capture(fixture(), { ...selection, nativeRunId: 11 }),
    /incomplete/,
  );
});
test("both explicit source annotations and the canonical original area metadata association are required", () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => {
      d.annotations[1].stairFlightIds = [];
    },
    (d: ReturnType<typeof fixture>) => {
      d.annotations[0].status = "deleted";
    },
    (d: ReturnType<typeof fixture>) => {
      d.annotations[0].name = "Corridor";
    },
    (d: ReturnType<typeof fixture>) => {
      d.annotations[0].spaceUse = { kind: "atrium", evidence: "user-reported" };
    },
    (d: ReturnType<typeof fixture>) => {
      d.annotations.push(structuredClone(d.annotations[0]));
    },
    (d: ReturnType<typeof fixture>) => {
      delete d.areaMetadata[`room:${lower.key}`];
    },
    (d: ReturnType<typeof fixture>) => {
      d.areaMetadata[`room:${lower.key}`].elementIds = [1638837];
    },
  ]) {
    const data = fixture();
    change(data);
    assert.throws(() => capture(data));
  }
});

test("normalized compiler preserves both full selected annotations/header/review while unrelated input may change", () => {
  const recorded = originalRecordedStairIntentDemandFacts(capture());
  const data = fixture();
  (data as Record<string, unknown>).unrelatedDrawingReview = {version: 2};
  assert.equal(assertStairBaseCompilerInputIdentityPreserved(recorded, data).sourceAuthorityGranted, false);
  for (const change of [
    (d: ReturnType<typeof fixture>) => { d.annotations[0].levelId = 1; },
    (d: ReturnType<typeof fixture>) => { d.annotations[1].stairFlightIds = []; },
    (d: ReturnType<typeof fixture>) => { d.annotations[0].labelPointFeet[0]++; },
    (d: ReturnType<typeof fixture>) => { d.annotations.push(structuredClone(d.annotations[0])); },
    (d: ReturnType<typeof fixture>) => { d.annotations.splice(1, 1); },
    (d: ReturnType<typeof fixture>) => { d.model.fileName = "other.rvt"; },
    (d: ReturnType<typeof fixture>) => { d.version++; },
    (d: ReturnType<typeof fixture>) => { d.coordinateSystem = "other"; },
    (d: ReturnType<typeof fixture>) => { d.areaMetadata[`room:${lower.key}`].notes += " changed"; },
    (d: ReturnType<typeof fixture>) => { delete d.areaMetadata[`room:${lower.key}`]; },
  ]) {
    const changed = fixture();
    change(changed);
    assert.throws(() => assertStairBaseCompilerInputIdentityPreserved(recorded, changed));
  }
});
