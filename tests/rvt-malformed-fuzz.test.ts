import assert from "node:assert/strict";
import test from "node:test";

import { activeElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { malformedCorpus, runMalformedFuzz } from "../scripts/lib/rvt-malformed-fuzz.ts";

test("the saved seed reaches parser acceptance, deliberate refusal and both conversion outcomes", { timeout: 30_000 }, () => {
  const report = runMalformedFuzz({ seed: 0x525654, cases: 128 });
  assert.deepEqual(report.failures, []);
  assert.equal(report.targets.length, 10);
  assert.ok(report.targets.every((row) => row.runs === 128));
  for (const name of ["schema", "history", "conversion-partition"]) {
    const row = report.targets.find((candidate) => candidate.target === name)!;
    assert.ok(row.accepted > 0, `${name} did not reach valid framing`);
    assert.ok(row.structuredRefusals > 0, `${name} did not exercise deliberate rejection`);
  }
  for (const name of ["element-framing-32", "element-framing-64"]) {
    const row = report.targets.find((candidate) => candidate.target === name)!;
    assert.ok(row.accepted > 0 && row.absent > 0, `${name} did not exercise both branches`);
  }
  const raw = report.targets.find((candidate) => candidate.target === "conversion-raw-refusal")!;
  assert.equal(raw.structuredRefusals, 128);
  assert.equal(activeElementIdBytes(), 8, "fuzzing leaked the narrow decoder gate");
});

test("seed, view offsets and input caps make failures reproducible without global randomness", () => {
  const first = malformedCorpus({ seed: 12345, cases: 84, maxInputBytes: 512 });
  const second = malformedCorpus({ seed: 12345, cases: 84, maxInputBytes: 512 });
  assert.deepEqual(first, second);
  assert.ok(first.every(({ data }) => data.byteOffset === 3 && data.length <= 512));
  assert.notDeepEqual(first, malformedCorpus({ seed: 54321, cases: 84, maxInputBytes: 512 }));
  assert.throws(() => malformedCorpus({ cases: 1_000_000 }), /cases must/);
  assert.throws(() => malformedCorpus({ seed: -1 }), /uint32/);
  assert.throws(() => malformedCorpus({ maxInputBytes: 1 << 20 }), /maxInputBytes must/);
});
