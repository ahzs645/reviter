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
