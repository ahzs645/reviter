import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesignOptionCollector, decodeNativeDesignOptions, designOptionExportDecision,
  OST_DESIGN_OPTION_SETS, selectDesignOptionExportElements,
} from "../lib/reviter/design-options.ts";

function setRecord(setId: number, options: number[], version = 2024) {
  const size = 0x5a + 8 * (options.length + 1);
  const bytes = Buffer.alloc(size + 16);
  bytes.writeBigUInt64LE(BigInt(setId), 0);
  bytes.writeUInt32LE(size, 8);
  bytes.writeUInt16LE(version === 2024 ? 0x059f : 0x05c7, 12);
  bytes.writeBigInt64LE(BigInt(OST_DESIGN_OPTION_SETS), 0x12);
  bytes.writeUInt32LE(options.length + 1, 0x56);
  [setId, ...options].forEach((id, index) => bytes.writeBigUInt64LE(BigInt(id), 0x5a + index * 8));
  bytes.writeUInt32LE(size, size + 12);
  return bytes;
}
function nameEntry(options: number[], name: string, primary: number) {
  const nameBytes = Buffer.from(name, "utf16le");
  const bytes = Buffer.alloc(12 + options.length * 8 + nameBytes.length + 8);
  bytes.writeUInt32LE(options.length);
  options.forEach((id, index) => bytes.writeBigUInt64LE(BigInt(id), 4 + index * 8));
  bytes.writeUInt32LE(1, 4 + options.length * 8);
  bytes.writeUInt32LE(nameBytes.length / 2, 8 + options.length * 8);
  nameBytes.copy(bytes, 12 + options.length * 8);
  bytes.writeBigUInt64LE(BigInt(primary), bytes.length - 8);
  return bytes;
}
const part = (stream: string, ...bytes: Uint8Array[]) => ({ stream, bytes: Buffer.concat(bytes) });

test("RE-40 option ordering cannot imply primary: use the name entry's actual id", () => {
  // Snowdon's measured ids and names: primary is smallest in one set, largest
  // in the other. These synthetic records pin the grammar, not corpus coverage.
  const options = decodeNativeDesignOptions([
    part("Partitions/1", setRecord(1500723, [1500724, 1500727, 2220520, 2237100]), setRecord(2059966, [2059967, 2059970])),
    part("Partitions/68", nameEntry([1500724, 1500727, 2220520, 2237100], "Bandstand Options", 1500724), nameEntry([2059967, 2059970], "Bleacher Seating", 2059970)),
  ], 2024);
  assert.equal(options.status, "decoded");
  assert.equal(options.positiveEvidence, "measured-2024");
  assert.deepEqual(options.sets.map(set => [set.name, set.primaryOptionId]), [["Bandstand Options", 1500724], ["Bleacher Seating", 2059970]]);
  assert.deepEqual(options.sets[1]?.recordSources, [{ stream: "Partitions/1", offset: setRecord(1500723, [1500724, 1500727, 2220520, 2237100]).length }]);
  assert.equal(designOptionExportDecision({ designOptionId: 2059967 }, options).include, true);
  assert.deepEqual(designOptionExportDecision({ designOptionId: 2059967 }, options, "main-and-primary"), { include: false, reason: "non-primary-option", optionId: 2059967, setId: 2059966 });
  assert.equal(designOptionExportDecision({ designOptionId: 2059970 }, options, "main-and-primary").reason, "primary-option");
});

test("selection retains unknown memberships and missing headers with explicit reasons", () => {
  const options = decodeNativeDesignOptions([part("P", setRecord(100, [101, 102]), nameEntry([101, 102], "Set", 101))], 2024);
  const selected = selectDesignOptionExportElements([1, 2, 3, 4, 5].map(elementId => ({ elementId })), new Map([
    [1, { designOptionId: null }], [2, { designOptionId: 101 }], [3, { designOptionId: 102 }], [4, { designOptionId: 999 }],
  ]), options, "main-and-primary");
  assert.deepEqual(selected.elements.map(element => element.elementId), [1, 2, 4, 5]);
  assert.deepEqual(selected.excluded.map(element => element.elementId), [3]);
  assert.deepEqual(selected.unresolved.map(element => element.decision.reason), ["unresolved-option", "missing-header"]);
});

test("conflicting name entries, missing entries, and overlapping set ownership never exclude", () => {
  for (const partitions of [
    [part("P", setRecord(100, [101, 102]))],
    [part("P", setRecord(100, [101, 102]), nameEntry([101, 102], "Set", 101), nameEntry([101, 102], "Set", 102))],
    [part("P", setRecord(100, [101, 102]), nameEntry([101, 102], "Set", 101), nameEntry([101, 102], "Other", 101))],
    [part("P", setRecord(100, [101, 102]), setRecord(200, [102, 103]), nameEntry([101, 102], "Set", 101), nameEntry([102, 103], "Set2", 103))],
    [part("P", setRecord(100, [101, 102])), part("P2", setRecord(100, [101, 103]), nameEntry([101, 102], "Set", 101))],
  ]) {
    const options = decodeNativeDesignOptions(partitions, 2024);
    assert.equal(options.sets.length, 0);
    assert.ok(options.unresolvedSets.length > 0);
    assert.equal(designOptionExportDecision({ designOptionId: 102 }, options, "main-and-primary").reason, "unresolved-option");
  }
});

test("malformed option membership cannot borrow bytes outside its own record", () => {
  const bad = setRecord(100, [101, 102]);
  bad.writeUInt32LE(65, 0x56);
  const result = decodeNativeDesignOptions([part("P", bad, nameEntry([101, 102], "Set", 101))], 2024);
  assert.equal(result.unresolvedSets[0]?.reason, "invalid-members");
  assert.equal(result.sets.length, 0);
  for (const invalidMembers of [[101, 101], [100, 101], [0, 101]]) {
    assert.equal(decodeNativeDesignOptions([part("P", setRecord(100, invalidMembers))], 2024).unresolvedSets[0]?.reason, "invalid-members");
  }
});

test("record framing rejects bad trailers and trailing embedded family records", () => {
  const bad = setRecord(100, [101, 102]);
  bad.writeUInt32LE(99, bad.length - 4);
  assert.equal(decodeNativeDesignOptions([part("P", bad, nameEntry([101, 102], "Set", 101))], 2024).sets.length, 0);
  const trailing = part("P", Buffer.alloc(16), setRecord(100, [101, 102]), nameEntry([101, 102], "Set", 101));
  assert.equal(decodeNativeDesignOptions([trailing], 2024).sets.length, 0);
});

test("invalid UTF16, control names, wrong primary and truncation leave set unresolved", () => {
  const record = setRecord(100, [101, 102]);
  const surrogate = nameEntry([101, 102], "A", 101);
  surrogate.writeUInt16LE(0xd800, 28);
  for (const entry of [surrogate, nameEntry([101, 102], "\u0001", 101), nameEntry([101, 102], " ", 101), nameEntry([101, 102], "Set", 999), nameEntry([101, 102], "Set", 101).subarray(0, 30)]) {
    assert.equal(decodeNativeDesignOptions([part("P", record, entry)], 2024).unresolvedSets[0]?.reason, "missing-name-entry");
  }
});

test("release and schema gates never expand measured primary option coverage", () => {
  for (const year of [2019, 2023, 2026, 2027, undefined]) assert.equal(decodeNativeDesignOptions([], year).status, "unsupported-release");
  assert.equal(decodeNativeDesignOptions([], 2024, [0, 0]).status, "schema-marker-mismatch");
  const result = decodeNativeDesignOptions([part("P", setRecord(100, [101, 102], 2025), nameEntry([101, 102], "Set", 101))], 2025);
  assert.equal(result.sets.length, 1);
  assert.equal(result.positiveEvidence, "unvalidated-positive-2025");
});

test("collector joins split record/name pages and fails closed if input incomplete", () => {
  const data = part("P", setRecord(100, [101, 102]), nameEntry([101, 102], "Set", 101)).bytes;
  const collector = createDesignOptionCollector(2024);
  for (let at = 0; at < data.length; at += 19) collector.pushPage("P", data.subarray(at, at + 19));
  assert.equal(collector.finish().sets[0]?.primaryOptionId, 101);
  for (const reason of ["cap", "skipped-page"]) {
    const limited = createDesignOptionCollector(2024, undefined, reason === "cap" ? 1 : undefined);
    limited.pushPage("P", data);
    if (reason === "skipped-page") limited.invalidate();
    const result = limited.finish();
    assert.equal(result.status, "incomplete-partitions");
    assert.equal(designOptionExportDecision({ designOptionId: 102 }, result, "main-and-primary").include, true);
  }
});

test("streaming and full-stream readers agree across page boundaries and long record bodies", () => {
  const small = setRecord(100, [101, 102]);
  const large = Buffer.alloc(200_000 + 16);
  small.copy(large, 0, 0, small.length - 16);
  large.writeUInt32LE(200_000, 8);
  large.writeUInt32LE(200_000, large.length - 4);
  const data = Buffer.concat([large, setRecord(200, [201, 202]), nameEntry([101, 102], "Set 🏢", 101), nameEntry([201, 202], "Other", 202)]);
  const expected = decodeNativeDesignOptions([part("P", data)], 2024);
  for (const step of [1, 7, 613, 10_003, 131_073, data.length]) {
    const input = step === 1 ? Buffer.concat([small, nameEntry([101, 102], "Set 🏢", 101)]) : data;
    const collector = createDesignOptionCollector(2024);
    for (let at = 0; at < input.length; at += step) collector.pushPage("P", input.subarray(at, at + step));
    assert.deepEqual(collector.finish(), step === 1 ? decodeNativeDesignOptions([part("P", input)], 2024) : expected, `split step ${step}`);
  }
  const truncated = createDesignOptionCollector(2024);
  truncated.pushPage("P", large.subarray(0, large.length - 1));
  assert.equal(truncated.finish().incompleteReason, "truncated-leading-record");
});
