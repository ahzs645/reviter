import assert from "node:assert/strict";
import test from "node:test";
import { DesignOptionsCollector, createDesignOptionSelector, createDesignOptionElementSelector } from "../lib/reviter/design-options.ts";
import type { SchemaSummary } from "../lib/reviter/schema.ts";

const schema: SchemaSummary = {
  byteLength: 0, rejectedCandidates: 0, referencedClasses: [], taggedClasses: [
    { name: "ElementHeader", tag: 1439, parent: "", version: 24, declaredFieldCount: 12, offset: 0 },
    { name: "Outline", tag: 326, parent: "", offset: 0 },
    { name: "ElementParents", tag: 1451, parent: "", offset: 0 },
  ],
};
const collector = () => new DesignOptionsCollector({ revitVersion: 2024, schema });
function concat(...arrays: Uint8Array[]) {
  const out = new Uint8Array(arrays.reduce((n, arr) => n + arr.length, 0));
  let at = 0; for (const arr of arrays) { out.set(arr, at); at += arr.length; } return out;
}
function setRecord(setId = 50, options = [101, 102], length = 0x5a + (options.length + 1) * 8) {
  const out = new Uint8Array(length + 16);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt(setId), true);
  view.setUint32(8, length, true);
  view.setUint16(12, 1439, true);
  view.setBigInt64(0x12, -2_006_112n, true);
  view.setUint32(0x56, options.length + 1, true);
  [setId, ...options].forEach((id, i) => view.setBigUint64(0x5a + i * 8, BigInt(id), true));
  view.setUint32(length + 12, length, true);
  return out;
}
function entry(options = [101, 102], primary = 101, name = "Bandstand Options") {
  const out = new Uint8Array(4 + options.length * 8 + 8 + name.length * 2 + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, options.length, true);
  options.forEach((id, i) => view.setBigUint64(4 + i * 8, BigInt(id), true));
  let at = 4 + options.length * 8;
  view.setUint32(at, 1, true); view.setUint32(at + 4, name.length, true); at += 8;
  for (const unit of name.split("")) { view.setUint16(at, unit.charCodeAt(0), true); at += 2; }
  view.setBigUint64(at, BigInt(primary), true);
  return out;
}
function decode(...partitions: Uint8Array[]) {
  const scan = collector();
  for (const partition of partitions) { scan.pushPage(partition); scan.finishPartition(); }
  return scan.finish();
}

test("resolves source-authored primary and retains alternatives by default", () => {
  const result = decode(concat(setRecord(), entry()));
  assert.deepEqual(result.sets, [{ setId: 50, name: "Bandstand Options", optionIds: [101, 102], primaryOptionId: 101 }]);
  assert.deepEqual(result.unresolvedSets, []);
  assert.equal(createDesignOptionSelector(result)(102).include, true);
  const select = createDesignOptionSelector(result, "primary");
  assert.deepEqual(select(102), { include: false, state: "non-primary", optionId: 102, setId: 50 });
  assert.equal(select(101).state, "primary");
  assert.equal(select(null).state, "main-model");
  assert.equal(select(undefined).include, true);
  assert.equal(select(999).state, "unresolved");
});

test("leading record chain and name entries survive every byte split", () => {
  const bytes = concat(setRecord(50, [101, 102], 800), entry());
  for (let split = 1; split < bytes.length; split++) {
    const scan = collector();
    scan.pushPage(bytes.subarray(0, split)); scan.pushPage(bytes.subarray(split)); scan.finishPartition();
    assert.equal(scan.finish().sets[0]?.primaryOptionId, 101, `split ${split}`);
  }
  const scan = collector();
  for (const byte of bytes) scan.pushPage(new Uint8Array([byte]));
  assert.equal(scan.finish().sets[0]?.primaryOptionId, 101);
});

test("names can precede membership in another partition, but do not cross partitions", () => {
  assert.equal(decode(entry(), setRecord()).sets.length, 1);
  const name = entry();
  assert.equal(decode(setRecord(), name.subarray(0, 20), name.subarray(20)).sets.length, 0);
});

test("loaded-family records after a broken chain cannot introduce a project set", () => {
  const result = decode(concat(new Uint8Array(8), setRecord(), entry()));
  assert.equal(result.sets.length, 0);
  assert.equal(result.unresolvedSets.length, 0);
});

test("a size echo, flag word and member self-reference must verify", () => {
  for (const mutation of [(v: DataView, length: number) => v.setUint32(length + 12, 0, true), (v: DataView, length: number) => v.setUint32(length + 8, 3, true), (v: DataView) => v.setBigUint64(0x5a, 99n, true)]) {
    const bytes = setRecord(); mutation(new DataView(bytes.buffer), bytes.length - 16);
    assert.equal(decode(concat(bytes, entry())).sets.length, 0);
  }
});

test("conflicting primaries, names, members and shared options remain unresolved", () => {
  for (const [bytes, reason] of [
    [concat(setRecord(), entry(), entry([101, 102], 102)), "conflicting-primary-options"],
    [concat(setRecord(), entry(), entry([101, 102], 101, "Other name")), "conflicting-set-names"],
    [concat(setRecord(), setRecord(50, [101, 103]), entry()), "conflicting-member-lists"],
    [concat(setRecord(), setRecord(60, [102, 103]), entry(), entry([102, 103], 103)), "option-in-multiple-sets"],
  ] as const) {
    const result = decode(bytes);
    assert.equal(result.sets.length, 0);
    assert.ok(result.unresolvedSets[0]?.reasons.includes(reason), reason);
    assert.equal(createDesignOptionSelector(result, "primary")(102).include, true);
  }
});

test("missing names and invalid UTF16/primary leave a known set unresolved", () => {
  for (const bytes of [new Uint8Array(), entry([101, 102], 999), entry([101, 102], 101, "bad\u0001"), entry([101, 102], 101, "\ud800")]) {
    const result = decode(concat(setRecord(), bytes));
    assert.deepEqual(result.unresolvedSets[0]?.reasons, ["missing-name-entry"]);
  }
});

test("unsupported releases, missing or changed schemas do not infer a primary", () => {
  for (const opts of [
    { revitVersion: 2027, schema }, { revitVersion: 2023, schema }, { revitVersion: 2024 },
    { revitVersion: 2024, schema: { ...schema, taggedClasses: schema.taggedClasses.map(c => c.name === "ElementHeader" ? { ...c, version: 99 } : c) } },
  ]) {
    const scan = new DesignOptionsCollector(opts); scan.pushPage(concat(setRecord(), entry()));
    assert.equal(scan.finish().status, "unsupported"); assert.equal(scan.finish().sets.length, 0);
  }
});

test("element selection joins only native option ids; missing/conflicting membership is retained", () => {
  const scan = collector(); scan.pushPage(concat(setRecord(), entry()));
  const result = scan.finish([{ elementId: 1, categoryId: null, familyId: null, ownerViewId: null, designOptionId: 102 }]);
  const select = createDesignOptionElementSelector(result, "primary");
  assert.equal(select(1).include, false);
  assert.equal(select(2).include, true);
  result.elementOptions.push({ elementId: 1, optionId: 101 });
  assert.equal(createDesignOptionElementSelector(result, "primary")(1).include, true);
});

test("a missing page invalidates project framing until the next partition", () => {
  const scan = collector();
  scan.pushPage(new Uint8Array(5));
  scan.invalidatePartition();
  scan.pushPage(concat(setRecord(), entry()));
  assert.equal(scan.finish().sets.length, 0);
  scan.finishPartition();
  scan.pushPage(setRecord());
  assert.equal(scan.finish().sets.length, 1);
});
