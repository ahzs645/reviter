import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  evaluateCapability,
  capabilitySnapshot,
  REVITER_CAPABILITY_CONTRACTS,
} from "../lib/reviter/capabilities.ts";
import { activeElementIdBytes, setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";
import { decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { decodeRevitDocumentHistory } from "../lib/reviter/native-identity.ts";
import { NATIVE_ROOM_SOLID_RELEASES } from "../lib/reviter/native-source-rooms.ts";
import { MEP_SYSTEM_RELEASES, MEP_CONNECTION_RELEASES } from "../lib/reviter/native-mep.ts";
import { decodeNativeDesignOptions } from "../lib/reviter/design-options.ts";

test("element-record contract agrees with executable decoder admission across release boundaries", () => {
  const before = activeElementIdBytes();
  try {
    for (const version of [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2025.5]) {
      for (const width of [4, 8, null] as const) {
        setActiveElementIdBytes(width);
        const admitted = evaluateCapability("element-records", {
          revitVersion: version,
          schemaElementIdBytes: width,
          evidence: new Set(["record-framing"]),
        });
        // An explicit int32 schema in a wide release is refused by the
        // contract, even though the legacy gate only inspects release there.
        const expected = width === 4 && version >= 2024
          ? false
          : decoderPlanForVersion(version).elementBoundsDecoder !== null;
        assert.equal(admitted.admitted, expected, `Revit ${version}, schema width ${width}`);
      }
    }
  } finally {
    setActiveElementIdBytes(before);
  }
});

test("identity contract gates match the native parser on a complete valid history", () => {
  const data = new Uint8Array(131);
  const view = new DataView(data.buffer);
  view.setUint32(2, 1, true);
  view.setUint32(14, 1, true);
  view.setUint32(106, 1, true);
  data[110] = 1;
  data[126] = 0x28;
  const formats = [0x045d, 0x0468, 0x0482, 0x04a2, 0x04dc, 0x04ff, 0x051d, 0x0538, 0x0552];
  const before = activeElementIdBytes();
  try {
    for (const [index, format] of formats.entries()) {
      const version = 2019 + index;
      const width = version < 2024 ? 4 : 8;
      setActiveElementIdBytes(width);
      view.setUint16(0, format, true);
      const result = decodeRevitDocumentHistory(data, version);
      assert.notEqual(result.format, "unsupported", JSON.stringify(result));
      assert.equal(evaluateCapability("native-identities", {
        revitVersion: version,
        schemaElementIdBytes: width,
        evidence: new Set(["complete-history", "complete-element-history"]),
      }).admitted, true);
      assert.equal(decodeRevitDocumentHistory(data.subarray(0, 126), version).format, "unsupported");
    }
  } finally {
    setActiveElementIdBytes(before);
  }
});

test("admission requires record evidence and does not confer full model support", () => {
  const missing = evaluateCapability("stored-room-outlines", {
    revitVersion: 2025,
    schemaElementIdBytes: 8,
    evidence: new Set(["room-category", "placed-model-owner"]),
  });
  assert.equal(missing.admitted, false);
  assert.deepEqual(missing.missing, ["owner-confirmed-solid", "valid-room-topology"]);
  assert.equal(evaluateCapability("stored-room-outlines", {
    revitVersion: 2027,
    schemaElementIdBytes: 8,
    evidence: new Set(["room-category", "placed-model-owner", "owner-confirmed-solid", "valid-room-topology"]),
  }).admitted, false);
  const options = evaluateCapability("primary-design-options", {
    revitVersion: 2025,
    schemaElementIdBytes: 8,
    evidence: new Set(["design-option-set", "explicit-primary-option"]),
  });
  assert.equal(options.admitted, true);
  assert.equal(options.corpusMeasuredRelease, false);
});

test("contracts point to real executable regression suites and exact observed releases", () => {
  const ids = new Set<string>();
  for (const contract of REVITER_CAPABILITY_CONTRACTS) {
    assert.equal(ids.has(contract.id), false, `duplicate ${contract.id}`);
    ids.add(contract.id);
    assert.ok(contract.evidence.length > 0 && contract.limitations.length > 0);
    for (const version of contract.measuredReleases) {
      assert.ok(contract.admittedReleases.includes(version), `${contract.id}: observation outside admission`);
    }
    for (const suite of contract.tests) {
      assert.ok(existsSync(new URL(`../${suite}`, import.meta.url)), `${contract.id}: missing ${suite}`);
    }
  }
});

test("semantic admission contracts agree with the decoders' exact release gates", () => {
  const releases = (id: string) => REVITER_CAPABILITY_CONTRACTS.find(contract => contract.id === id)!.admittedReleases;
  assert.deepEqual(releases("stored-room-outlines"), NATIVE_ROOM_SOLID_RELEASES);
  assert.deepEqual(releases("mep-systems"), MEP_SYSTEM_RELEASES);
  assert.deepEqual(releases("mep-connectors"), MEP_CONNECTION_RELEASES);
  for (const version of [2023, 2024, 2025, 2026, 2027]) {
    assert.equal(decodeNativeDesignOptions([], version).status !== "unsupported-release", releases("primary-design-options").includes(version));
  }
});

test("snapshots remain serializable and missing proof cannot confer admission", () => {
  const snapshot = capabilitySnapshot({ revitVersion: 2025, schemaElementIdBytes: 8, evidence: new Set() });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.equal(snapshot.capabilities.length, REVITER_CAPABILITY_CONTRACTS.length);
  assert.ok(snapshot.capabilities.every(capability => !capability.admitted && capability.missing.length > 0));
});
