import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { capabilityManifest } from "../lib/reviter/capabilities.ts";
import { decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { standardsReaderSupports } from "../lib/reviter/reader-support.ts";
import { setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";

const get = (release: number | null, id: string, narrow = false) => {
  const row = capabilityManifest(release, narrow).capabilities.find((entry) => entry.id === id);
  assert.ok(row, id);
  return row;
};

test("metadata cannot promote semantic or geometry support, including 2027 WASM", () => {
  for (const release of [null, 2014, 2016, 2018, 2028, NaN, 2026.5, Infinity]) {
    assert.equal(get(release, "reviter.container-schema").eligible, true);
    assert.equal(get(release, "reviter.native-geometry").status, "unsupported");
    assert.equal(get(release, "reviter.native-element-records").eligible, false);
  }
  assert.equal(get(2027, "vendored.schema-metadata").eligible, true);
  assert.equal(get(2027, "vendored.element-materials").eligible, false);
  assert.equal(get(2027, "reviter.native-geometry").eligible, true);
  for (const release of [2015, 2016, 2026, 2027, 2026.5, NaN, Infinity]) {
    assert.equal(get(release, "vendored.element-materials").eligible, standardsReaderSupports(release));
  }
});

test("release eligibility follows actual native plan including schema-confirmed narrow ids", () => {
  try {
    for (const width of [4, 8] as const) {
      setActiveElementIdBytes(width);
      for (let release = 2016; release <= 2028; release += 1) {
        const eligible = decoderPlanForVersion(release).elementBoundsDecoder != null;
        assert.equal(get(release, "reviter.native-element-records", width === 4).eligible, eligible, `${release}/${width}`);
      }
    }
  } finally {
    setActiveElementIdBytes(8);
  }
});

test("each contract carries checkable evidence and an explicit claim ceiling", () => {
  const manifest = capabilityManifest(2025);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(new Set(manifest.capabilities.map((row) => row.id)).size, manifest.capabilities.length);
  for (const row of manifest.capabilities) {
    assert.ok(row.scope.length > 0 && row.limitations.length > 0 && row.evidence.length > 0);
    assert.ok(["partial", "experimental", "unsupported"].includes(row.status));
    for (const path of row.evidence) {
      assert.ok(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), path);
    }
  }
  const roundTrip = JSON.parse(JSON.stringify(manifest));
  assert.deepEqual(roundTrip, manifest);
});
