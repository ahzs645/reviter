import assert from "node:assert/strict";
import test from "node:test";
import { nativeTerminalRepairPairs } from "../lib/reviter/native-terminal-repair-pairs.ts";

test("a distant isolated terminal is offered before a dense failing component pair consumes all24 attempts", () => {
  const dense = Array.from({length: 30}, (_, i) => ({a: {id: `a${i}`}, b: {id: `b${i}`}, distance: i + 1}));
  const orphan = {a: {id: "c"}, b: {id: "b0"}, distance: 100};
  const pairs = [...dense, orphan], original = JSON.stringify(pairs);
  const selected = nativeTerminalRepairPairs(pairs, id => id[0]!);
  assert.equal(selected.length, 24);
  assert.ok(selected.includes(orphan));
  assert.deepEqual(selected.slice(0, 23), dense.slice(0, 23));
  assert.equal(JSON.stringify(pairs), original);
});

test("pair selection retains caller order and never reoffers an already joined component", () => {
  const pairs = [
    {a: {id: "a"}, b: {id: "b"}},
    {a: {id: "c"}, b: {id: "d"}},
    {a: {id: "a"}, b: {id: "c"}},
  ];
  assert.deepEqual(nativeTerminalRepairPairs(pairs, id => id === "b" ? "a" : id, 2), pairs.slice(1));
  assert.deepEqual(nativeTerminalRepairPairs(pairs, id => id, 0), []);
  assert.throws(() => nativeTerminalRepairPairs(pairs, id => id, -1));
});
