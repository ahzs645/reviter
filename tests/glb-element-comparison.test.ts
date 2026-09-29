import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("element comparison measures indexed triangles and reports missing populations", () => {
  const run = spawnSync("python3", ["tests/glb-element-comparison.py"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
