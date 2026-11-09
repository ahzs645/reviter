import assert from "node:assert/strict";
import test from "node:test";
import { assertionReviewDigest, buildAssertionReview } from "../app/studio/assertion-review.ts";
import { emptyElementOverrideState, setElementOverride } from "../lib/reviter/element-overrides.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

const now = "2026-08-19T00:00:00Z";
const records = ifcExportFixture().elementBounds;
const stateFor = (patch: Parameters<typeof setElementOverride>[2]) =>
  setElementOverride(emptyElementOverrideState(), 10, patch, "reviewer", now).overrides;

test("review fingerprints cannot confuse separators in text with separate fields", () => {
  const combined = buildAssertionReview(records, stateFor({ typeName: "Type|note=Checked" }));
  const separate = buildAssertionReview(records, stateFor({ typeName: "Type", note: "Checked" }));
  assert.notEqual(assertionReviewDigest(combined), assertionReviewDigest(separate));
});

test("review fingerprints include decoded evidence, category ids and source/export context", () => {
  const overrides = stateFor({ category: { id: -2000170, name: "Panel" } });
  const rows = buildAssertionReview(records, overrides);
  assert.notEqual(assertionReviewDigest(rows, "source-a"), assertionReviewDigest(rows, "source-b"));
  assert.notEqual(assertionReviewDigest(rows), assertionReviewDigest(buildAssertionReview([], overrides)));
  assert.notEqual(assertionReviewDigest(rows), assertionReviewDigest(buildAssertionReview(records, [
    { ...overrides[0]!, category: { id: -2000171, name: "Panel" } },
  ])));
  const changedRecords = records.map(record => ({ ...record, categoryName: "Different source" }));
  assert.notEqual(assertionReviewDigest(rows), assertionReviewDigest(buildAssertionReview(changedRecords, overrides)));
});

test("review shows the same preferred source record that the export uses", () => {
  const source = records.find(record => record.elementId === 10)!;
  const lower = { ...source, typeName: undefined, categoryId: undefined, categoryName: undefined };
  const rows = buildAssertionReview([lower, source], stateFor({ typeName: "Reviewed type" }));
  assert.equal(rows[0]?.changes[0]?.decoded, source.typeName);
});
