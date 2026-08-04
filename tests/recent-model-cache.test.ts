import assert from "node:assert/strict";
import test from "node:test";

import {
  currentParserCacheVersion,
  recentModelCacheKey,
} from "../app/studio/recent-model-cache.ts";

test("the parsed cache version follows the deployed build", () => {
  const previous = globalThis.__REVITER_BUILD_VERSION__;
  try {
    globalThis.__REVITER_BUILD_VERSION__ = "commit-a";
    assert.equal(currentParserCacheVersion(), "2:commit-a");
    globalThis.__REVITER_BUILD_VERSION__ = "commit-b";
    assert.equal(currentParserCacheVersion(), "2:commit-b");
  } finally {
    globalThis.__REVITER_BUILD_VERSION__ = previous;
  }
});

test("cache keys distinguish revisions without exposing file contents", () => {
  const first = recentModelCacheKey({ name: "Model.rvt", size: 123, lastModified: 1 });
  const second = recentModelCacheKey({ name: "Model.rvt", size: 123, lastModified: 2 });
  assert.notEqual(first, second);
  assert.equal(first, '["Model.rvt",123,1]');
});
