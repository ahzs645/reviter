import assert from "node:assert/strict";
import test from "node:test";

import { mergeRecentFile, withoutRecentFile, type RecentFile } from "../app/studio/recents.ts";

const first: RecentFile = {
  name: "First.rvt",
  size: 100,
  revitVersion: "2027",
  openedAt: 1,
  status: "ready",
};
const second: RecentFile = {
  name: "Second.rvt",
  size: 200,
  revitVersion: "2026",
  openedAt: 2,
  status: "partial",
};

test("removing a recent entry leaves the source-independent rows alone", () => {
  assert.deepEqual(withoutRecentFile([second, first], second), [first]);
  assert.deepEqual(withoutRecentFile([second, first], { name: "Missing.rvt", size: 1 }), [second, first]);
});

test("reopening a removed file can add it to Recents again", () => {
  const removed = withoutRecentFile([second, first], second);
  assert.deepEqual(mergeRecentFile(removed, { ...second, openedAt: 3 }), [
    { ...second, openedAt: 3 },
    first,
  ]);
});
