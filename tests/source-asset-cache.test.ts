import assert from "node:assert/strict";
import test from "node:test";

import { SourceAssetCache } from "../app/studio/source-asset-cache.ts";

test("source assets are reused only while their immutable owners match", () => {
  const disposed: string[] = [];
  const cache = new SourceAssetCache<{ name: string }>(3, (value) => disposed.push(value.name));
  const result = {};
  const visibility = new Set<number>();

  const first = cache.acquire("recovered:shaded", [result, visibility], () => ({ name: "first" }));
  const reused = cache.acquire("recovered:shaded", [result, visibility], () => ({ name: "unused" }));
  assert.equal(first.hit, false);
  assert.equal(reused.hit, true);
  assert.equal(reused.value, first.value);
  assert.deepEqual(disposed, []);

  const changed = cache.acquire(
    "recovered:shaded",
    [result, new Set<number>()],
    () => ({ name: "changed" }),
  );
  assert.equal(changed.hit, false);
  assert.deepEqual(disposed, ["first"]);
});

test("source asset LRU retains recently revisited sources and disposes evictions", () => {
  const disposed: string[] = [];
  const owner = {};
  const cache = new SourceAssetCache<{ name: string }>(2, (value) => disposed.push(value.name));

  cache.acquire("recovered", [owner], () => ({ name: "rvt" }));
  cache.acquire("reference", [owner], () => ({ name: "ifc" }));
  cache.acquire("recovered", [owner], () => ({ name: "unused" }));
  cache.acquire("reference-model", [owner], () => ({ name: "glb" }));

  assert.equal(cache.has("recovered"), true);
  assert.equal(cache.has("reference"), false);
  assert.equal(cache.has("reference-model"), true);
  assert.deepEqual(disposed, ["ifc"]);

  cache.clear();
  assert.deepEqual(disposed.sort(), ["glb", "ifc", "rvt"]);
});

test("source asset LRU evicts before constructing a large replacement", () => {
  const live = new Set<string>();
  const cache = new SourceAssetCache<{ name: string }>(2, ({ name }) => live.delete(name));
  const create = (name: string) => {
    // At no point may construction observe more than the configured number of
    // roots. This catches a short-lived but large capacity + 1 memory spike.
    assert.ok(live.size < 2);
    live.add(name);
    return { name };
  };

  cache.acquire("recovered", [{}], () => create("rvt"));
  cache.acquire("reference", [{}], () => create("ifc"));
  cache.acquire("reference-model", [{}], () => create("glb"));
  assert.deepEqual([...live].sort(), ["glb", "ifc"]);
});

test("source keys never return assets owned by another result generation", () => {
  const disposed: string[] = [];
  const cache = new SourceAssetCache<{ name: string; index: object }>(4, ({ name }) => {
    disposed.push(name);
  });
  const firstResult = {};
  const secondResult = {};
  const firstIndex = {};
  const secondIndex = {};

  cache.acquire("recovered", [firstResult], () => ({ name: "old-rvt", index: firstIndex }));
  cache.acquire("reference", [firstResult], () => ({ name: "ifc", index: {} }));
  const replaced = cache.acquire("recovered", [secondResult], () => ({
    name: "new-rvt",
    index: secondIndex,
  }));

  assert.equal(replaced.hit, false);
  assert.equal(replaced.value.index, secondIndex);
  assert.notEqual(replaced.value.index, firstIndex);
  assert.deepEqual(disposed, ["old-rvt"]);
  assert.equal(cache.acquire("reference", [firstResult], () => {
    throw new Error("reference source should still be cached");
  }).hit, true);
});

test("geometry walk data is reusable across style-specific scene roots", () => {
  const result = {};
  const visibility = new Set<number>();
  const sceneCache = new SourceAssetCache<{ style: string }>(4, () => {});
  const walkCache = new SourceAssetCache<{ surface: object }>(4, () => {});

  const technicalScene = sceneCache.acquire(
    "recovered:technical",
    [result, visibility],
    () => ({ style: "technical" }),
  );
  const technicalWalk = walkCache.acquire(
    "recovered",
    [result, visibility],
    () => ({ surface: {} }),
  );
  const shadedScene = sceneCache.acquire(
    "recovered:shaded",
    [result, visibility],
    () => ({ style: "shaded" }),
  );
  const shadedWalk = walkCache.acquire(
    "recovered",
    [result, visibility],
    () => ({ surface: {} }),
  );

  assert.equal(technicalScene.hit, false);
  assert.equal(shadedScene.hit, false);
  assert.equal(technicalWalk.hit, false);
  assert.equal(shadedWalk.hit, true);
  assert.equal(shadedWalk.value, technicalWalk.value);
});
