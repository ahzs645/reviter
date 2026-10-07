import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const cli = resolve(import.meta.dirname, "../scripts/analyze-dwg-floors.ts");
const run = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], { encoding: "utf8" });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
test("CLI refuses an existing output before writing or extracting", () => {
  const folder = mkdtempSync(resolve(tmpdir(), "reviter-cad-cli-"));
  try {
    const result = run(["--intake", folder, "--out", folder]);
    assert.equal(result.status, 1); assert.match(result.stderr, /Output already exists/); assert.deepEqual(readdirSync(folder), []);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test("stale controls and changed drawing bytes fail before starting Python or creating output", () => {
  const folder = mkdtempSync(resolve(tmpdir(), "reviter-cad-cli-")), out = resolve(folder, "output");
  try {
    mkdirSync(resolve(folder, "source")); mkdirSync(resolve(folder, "stage"));
    writeFileSync(resolve(folder, "source/source.dwg"), "dwg evidence"); writeFileSync(resolve(folder, "stage/floorplans.dxf"), "dxf evidence");
    writeFileSync(resolve(folder, "intake.json"), JSON.stringify({ format: "openindoormaps-cad-intake", version: 1,
      sourceSha256: sha("dwg evidence"), unitEvidence: { metresPerDrawingUnit: 0.001 },
      sourceFiles: [{ name: "source.dwg", sha256: sha("dwg evidence") }], conversionEvidence: { floorDxfSha256: sha("dxf evidence") } }));
    const controls = resolve(folder, "controls.json"); writeFileSync(controls, JSON.stringify({ format: "reviter-cad-floor-controls", version: 1,
      sourceSha256: sha("dwg evidence"), intakeSha256: "wrong", floors: [] }));
    let result = run(["--intake", folder, "--out", out, "--controls", controls, "--python", "deliberately-not-installed"]);
    assert.equal(result.status, 1); assert.match(result.stderr, /Controls do not match/);
    assert.ok(!readdirSync(folder).some(s => s.startsWith(".reviter-cad-candidate") || s === "output"));
    writeFileSync(resolve(folder, "source/source.dwg"), "changed");
    result = run(["--intake", folder, "--out", out, "--python", "deliberately-not-installed"]);
    assert.equal(result.status, 1); assert.match(result.stderr, /Source binding changed/);
    assert.ok(!readdirSync(folder).some(s => s.startsWith(".reviter-cad-candidate") || s === "output"));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
