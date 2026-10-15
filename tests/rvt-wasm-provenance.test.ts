import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import init, { quickSummary, openRvtBytesWithDiagnosticsModeAndLimits } from "../lib/rvt-wasm/rvt.js";
import { container, basicFileInfo } from "./rich-rvt-fixture.ts";

test("vendored WASM hashes match pinned build provenance and has no network imports", async () => {
  const root = new URL("../lib/rvt-wasm/", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8"));
  assert.equal(provenance.commit, "1c3d337dbd2a6810e9dfad68fe99857843d67387");
  for (const [name, expected] of Object.entries(provenance.hashes)) {
    assert.equal(createHash("sha256").update(readFileSync(new URL(name, root))).digest("hex"), expected);
  }
  const bytes = readFileSync(new URL("rvt_bg.wasm", root));
  const compiled = await WebAssembly.compile(bytes);
  for (const entry of WebAssembly.Module.imports(compiled)) assert.doesNotMatch(entry.name, /fetch|XMLHttpRequest|WebSocket/i);
  await init({ module_or_path: compiled });
});

test("pinned reader exposes bounded quality modes and metadata without replacing geometry", async () => {
  await init({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
  const generated = container([{ path: "BasicFileInfo", bytes: basicFileInfo("2025") }]);
  // The JS fixture writer leaves trailing unused FAT entries without sectors;
  // Rust's stricter CFB parser requires those declared sectors to exist.
  const bytes = new Uint8Array(Math.max(generated.length, 129 * 512));
  bytes.set(generated);
  const summary = quickSummary(bytes);
  assert.equal(summary.version, 2025);
  assert.throws(() => openRvtBytesWithDiagnosticsModeAndLimits(bytes, "invalid-mode", {}));
  assert.throws(() => quickSummary(new Uint8Array(32)));
});
