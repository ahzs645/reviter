import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { basicFileInfo, boundsPage, container, gzipChunk } from "./rich-rvt-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = fileURLToPath(new URL("../scripts/compare-rvt-readers.ts", import.meta.url));
const loader = fileURLToPath(new URL("../scripts/register-test-typescript.mjs", import.meta.url));
const preserved = fileURLToPath(new URL("../../rvt-rs-vanilla-pkg/rvt.js", import.meta.url));
const vanilla = process.env.REVITER_VANILLA_WASM_JS ?? (existsSync(preserved) ? preserved : fileURLToPath(new URL("../lib/rvt-wasm/rvt.js", import.meta.url)));
const vanillaProvenance = existsSync(vanilla) ? JSON.parse(readFileSync(join(vanilla, "..", "provenance.json"), "utf8")) : null;
const hasVanilla = vanillaProvenance?.hashes?.["rvt_bg.wasm"] === "dff0170996bfbeeb76b4a176b34235e20b5ebd676173284caee4d646b1464b06" && !vanillaProvenance.localPatches?.length;
const requireVanilla = hasVanilla ? false : "Set REVITER_VANILLA_WASM_JS to the separately rebuilt untouched pinned bundle for dual-reader integration checks.";

function fixture() {
  const generated = container([
    { path: "/BasicFileInfo", bytes: basicFileInfo("2027") },
    { path: "/Partitions/Sheet0", bytes: gzipChunk(boundsPage([{
      elementId: 101, categoryId: -2_000_011, recordCode: 1,
      box: { min: [0, 0, 0], max: [4, 1, 8] },
    }])) },
  ]);
  // SheetJS emits 128 FAT slots even for a tiny compound file. The Rust CFB
  // reader rejects a FAT larger than the physical file; free-sector padding
  // makes the fixture readable by both independent container implementations.
  const padded = new Uint8Array(Math.max(generated.length, 129 * 512));
  padded.set(generated);
  return padded;
}

test("head-to-head CLI hashes the same source and records sparse upstream versus recovered Reviter exports", { skip: requireVanilla }, () => {
  const directory = mkdtempSync(join(tmpdir(), "reviter-reader-comparison-"));
  try {
    const input = join(directory, "synthetic.rvt"), output = join(directory, "comparison.json");
    writeFileSync(input, fixture());
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, command,
      "--input", input, "--output", output, "--upstream-wasm", vanilla, "--timeout-ms", "30000", "--heap-mib", "1024"], { cwd: root, encoding: "utf8", timeout: 70_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(output, "utf8"));
    const result = report.models[0];
    assert.equal(result.identicalInputHash, true);
    assert.equal(result.upstream.state, "converted");
    assert.equal(result.reviter.state, "converted");
    assert.equal(result.upstream.result.input.release, 2027);
    assert.equal(result.reviter.result.input.release, 2027);
    assert.equal(result.upstream.result.input.sha256, result.reviter.result.input.sha256);
    assert.equal(result.upstream.result.binaryProvenance.commit, "1c3d337dbd2a6810e9dfad68fe99857843d67387");
    assert.ok(result.reviter.result.inventory.products > 0);
    assert.ok(result.upstream.result.inventory.products < result.reviter.result.inventory.products);
    assert.equal(result.reviter.result.diagnostics.supportedVersion, false, "app enrichment gate must remain distinct from upstream open behavior");
    assert.equal(report.settings.ifcOptions.nativeRooms, true);
    assert.equal(report.settings.upstreamLimits.max_scan_bytes, 128 << 20);
    assert.equal(result.typeIdentities.reviterAgainstUpstream.compared, 0, "sparse model must not fabricate a type identity witness");
    assert.ok(readFileSync(result.upstream.result.outputIfc, "utf8").startsWith("ISO-10303-21;"));
    assert.ok(readFileSync(result.reviter.result.outputIfc, "utf8").startsWith("ISO-10303-21;"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the comparison deadline yields explicit timeout states without fabricated inventories", { skip: requireVanilla }, () => {
  const directory = mkdtempSync(join(tmpdir(), "reviter-reader-timeout-"));
  try {
    const input = join(directory, "synthetic.rvt"), output = join(directory, "comparison.json");
    writeFileSync(input, fixture());
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, command,
      "--input", input, "--output", output, "--upstream-wasm", vanilla, "--timeout-ms", "1", "--heap-mib", "1024"], { cwd: root, encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(output, "utf8")).models[0];
    assert.equal(result.upstream.state, "timeout");
    assert.equal(result.reviter.state, "timeout");
    assert.equal(result.identicalInputHash, null);
    assert.equal(result.inputHashComparison, "unavailable");
    assert.equal(result.identities, undefined);
    assert.equal(result.upstream.result, undefined);
    assert.equal(result.reviter.result, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a patched optional evidence reader cannot become the upstream baseline", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, command,
    "--input", "unread-input.rvt", "--output", "unwritten-report.json"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /requires the untouched vanilla pinned bundle/);
});

test("upstream reuse verifies source and IFC hashes while freshly converting Reviter", { skip: requireVanilla }, () => {
  const directory = mkdtempSync(join(tmpdir(), "reviter-reader-reuse-"));
  try {
    const input = join(directory, "synthetic.rvt"), initial = join(directory, "initial.json"), proof = join(directory, "proof.json"), updated = join(directory, "updated.json");
    const bytes = fixture(); writeFileSync(input, bytes);
    const invoke = (output: string, reuse?: string) => spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, command,
      "--input", input, "--output", output, "--upstream-wasm", vanilla, "--timeout-ms", "30000", "--heap-mib", "1024", ...(reuse ? ["--reuse-upstream", reuse] : [])], { cwd: root, encoding: "utf8", timeout: 70_000 });
    const first = invoke(initial); assert.equal(first.status, 0, first.stderr);
    const summarize = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader,
      fileURLToPath(new URL("../scripts/summarize-rvt-reader-comparison.ts", import.meta.url)), initial, proof], { cwd: root, encoding: "utf8", timeout: 30_000 });
    assert.equal(summarize.status, 0, summarize.stderr);
    const repeated = invoke(updated, proof); assert.equal(repeated.status, 0, repeated.stderr);
    const report = JSON.parse(readFileSync(updated, "utf8")), prior = JSON.parse(readFileSync(proof, "utf8"));
    assert.equal(report.models[0].upstream.reusedFrom.ifcSha256, prior.models[0].readers.upstream.ifc.sha256);
    assert.equal(report.models[0].identicalInputHash, true);
    assert.equal(report.models[0].reviter.reusedFrom, undefined, "Reviter must run a new worker");
    const changed = bytes.slice(); changed[changed.length - 1] = changed[changed.length - 1]! ^ 1; writeFileSync(input, changed);
    const wrongInput = invoke(join(directory, "changed-input.json"), proof);
    assert.equal(wrongInput.status, 1); assert.match(wrongInput.stderr, /input SHA-256\/length changed/);
    writeFileSync(input, bytes);
    const upstreamIfc = JSON.parse(readFileSync(initial, "utf8")).models[0].upstream.result.outputIfc;
    writeFileSync(upstreamIfc, `${readFileSync(upstreamIfc, "utf8")}\n/* changed */`);
    const wrongIfc = invoke(join(directory, "changed-ifc.json"), proof);
    assert.equal(wrongIfc.status, 1); assert.match(wrongIfc.stderr, /IFC SHA-256\/length changed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
