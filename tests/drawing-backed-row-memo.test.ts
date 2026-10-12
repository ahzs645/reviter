import assert from "node:assert/strict";
import test from "node:test";
import * as source from "../lib/reviter/native-provisional-corner-seals.ts";
import { drawingBackedSealFixture, rect } from "./fixtures/drawing-backed-seal.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
const { nativeProvisionalCornerSealsHash } = source;

type Module = {
  name: string;
  index: (data: IndoorDataset) => {
    rows: unknown[];
    partsAt: (cut: number) => unknown[];
  };
  stats: () => { enabled: boolean; entries: number; hits: number; misses: number };
  reset: () => void;
  enable: (on: boolean) => void;
};
const modules: Module[] = [
  {
    name: "compiler",
    index: (d) => source.createNativeProvisionalCornerSealIndex(d as never),
    stats: source.drawingBackedRowMemoStats,
    reset: source.resetDrawingBackedRowMemo,
    enable: source.setDrawingBackedRowMemoEnabled,
  },
];
const fresh = () => {
  const f = drawingBackedSealFixture();
  f.rehash();
  return f.data;
};
const output = (m: Module, d: IndoorDataset) => {
  const i = m.index(d);
  return JSON.stringify([i.rows, i.partsAt(0.1), i.partsAt(2)]);
};
const rehashSeals = (d: IndoorDataset) => {
  const v = d.nativeProvisionalCornerSeals!;
  v.geometrySha256 = nativeProvisionalCornerSealsHash(v);
};

for (const m of modules) {
  test(`${m.name}: memoized row checks give byte-identical seal indexes and a content-keyed hit`, () => {
    m.enable(false);
    const off = output(m, fresh());
    assert.equal(m.stats().hits, 0);
    m.enable(true);
    m.reset();
    const d = fresh();
    assert.equal(output(m, d), off, "first build (memo miss) equals no memo");
    assert.deepEqual(
      [m.stats().misses, m.stats().hits, m.stats().entries],
      [1, 0, 1],
    );
    assert.equal(output(m, d), off, "second build (memo hit) equals no memo");
    assert.equal(m.stats().hits, 1);
    // A structurally equal copy is the same content, so it hits; identity plays no part.
    assert.equal(output(m, structuredClone(d)), off);
    assert.equal(m.stats().hits, 2);
  });

  test(`${m.name}: a door edited in place invalidates the memo`, () => {
    m.enable(true);
    m.reset();
    const d = fresh();
    m.index(d);
    // Same array objects, new content: a door whose footprint crosses the row body.
    (d.doors as unknown[]).push({
      id: "door:1:9",
      levelId: 1,
      nativeElementId: 9,
      footprintFeet: [
        [1, -0.6],
        [1.1, -0.6],
        [1.1, -0.4],
        [1, -0.4],
      ],
    });
    (d.edges as unknown[]).push({
      id: "door:1:9",
      kind: "door",
      enabled: true,
      pointsFeet: [
        [0.9, -0.5, 0],
        [1.2, -0.5, 0],
      ],
    });
    assert.throws(() => m.index(d), /preserved physical doorway/);
    assert.equal(m.stats().hits, 0, "the edited door was checked, not remembered");
    (d.doors as unknown[]).pop();
    (d.edges as unknown[]).pop();
    m.index(d);
    assert.equal(m.stats().hits, 1, "restored content hits the earlier pass");
  });

  test(`${m.name}: an edited walking floor or row invalidates the memo`, () => {
    m.enable(true);
    m.reset();
    const d = fresh();
    m.index(d);
    const floor = (
      d as unknown as {
        walkingSupport: { floors: { partsFeet: unknown; ringsFeet: unknown }[] };
      }
    ).walkingSupport.floors[0]!;
    const before = [floor.partsFeet, floor.ringsFeet];
    const smaller = rect(-1, -2, 1.05, 2);
    floor.partsFeet = smaller;
    floor.ringsFeet = smaller[0];
    assert.throws(() => m.index(d), /unsupported native floor/);
    [floor.partsFeet, floor.ringsFeet] = before;
    m.index(d);
    assert.equal(m.stats().hits, 1);
    // The row itself: an acknowledgement edited in place and rehashed is a new row.
    const row = d.nativeProvisionalCornerSeals!.rows[0]! as unknown as {
      drawingBacked: { acknowledgedUnverifiedBodyIds: number[] };
    };
    row.drawingBacked.acknowledgedUnverifiedBodyIds = [77];
    rehashSeals(d);
    assert.throws(() => m.index(d), /not completely acknowledged/);
    assert.equal(m.stats().hits, 1);
  });

  test(`${m.name}: different original material is a different key, and failures are never remembered`, () => {
    m.enable(true);
    m.reset();
    m.index(fresh());
    const entries = m.stats().entries;
    // Same row, but the original material now has a foreign section across the joint.
    const blocked = drawingBackedSealFixture({ extraSection: rect(1, -1, 1.1, 0) });
    blocked.rehash();
    assert.throws(() => m.index(blocked.data), /foreign/);
    assert.throws(() => m.index(blocked.data), /foreign/);
    assert.equal(m.stats().hits, 0);
    assert.equal(m.stats().entries, entries, "a failing row adds no entry");
  });

  test(`${m.name}: a change the JSON digests cannot see (-0) is still a new key`, () => {
    m.enable(true);
    m.reset();
    const d = fresh();
    m.index(d);
    const material = d.nativeMaterialSections as unknown as {
      geometrySha256: string;
      levels: { sections: { partsFeet: number[][][][] }[] }[];
    };
    const digest = material.geometrySha256;
    const corner = material.levels[0]!.sections[0]!.partsFeet[0]![0]![0]!;
    assert.ok(Object.is(corner[0], 0));
    corner[0] = -0;
    m.index(d);
    assert.equal(material.geometrySha256, digest, "the JSON material digest is unchanged");
    assert.deepEqual([m.stats().hits, m.stats().misses], [0, 2]);
  });

  test(`${m.name}: the memo can be switched off for a run`, () => {
    m.enable(false);
    const d = fresh();
    m.index(d);
    m.index(d);
    assert.deepEqual(m.stats(), {
      enabled: false,
      entries: 0,
      hits: 0,
      misses: 0,
    });
    m.enable(true);
  });
}
