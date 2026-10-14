import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import init, { openNativeEvidence } from "../lib/rvt-wasm/rvt.js";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { basicFileInfo, container } from "./rich-rvt-fixture.ts";

const wasmUrl = new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url);
await init({ module_or_path: readFileSync(wasmUrl) });

test("native evidence binding returns explicit unsupported and file-budget results", () => {
  const malformed = new Uint8Array([1, 2, 3]);
  const unsupported = openNativeEvidence(malformed, {}) as { status: string; kind: string; records: unknown[]; summary: unknown };
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.kind, "native-source-evidence");
  assert.deepEqual(unsupported.records, []);
  assert.equal(unsupported.summary, null);
  const blocked = openNativeEvidence(malformed, { maxFileBytes: 1 }) as { status: string; kind: string };
  assert.equal(blocked.status, "budget-blocked");
  assert.equal(blocked.kind, "native-source-evidence");
});

test("native evidence binding rejects unbounded selection, unsafe numeric IDs and invalid limits", () => {
  const bytes = new Uint8Array(3);
  for (const options of [
    { selectedClasses: [] }, { selectedIds: [Number.MAX_SAFE_INTEGER + 1] },
    { selectedIds: ["18446744073709551616"] }, { selectedIds: ["-1"] },
    { maxGraphValues: 0 }, { maxDecodedRecords: 20_001 }, { maxOutputBytes: 128 },
    { maxFileBytes: 513 * 1024 * 1024 },
  ]) assert.throws(() => openNativeEvidence(bytes, options), JSON.stringify(options));
  const exactId = openNativeEvidence(bytes, { selectedIds: ["18446744073709551615"] }) as { status: string };
  assert.equal(exactId.status, "unsupported");
});

test("native evidence adapter binds reports to the exact source bytes", async () => {
  const wasmModule = await import("../lib/rvt-wasm/rvt.js");
  const bytes = new Uint8Array([3, 2, 1]);
  const report = await readNativeSourceEvidence(bytes, {}, async () => wasmModule as unknown as RvtWasmModule);
  assert.equal(report.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(report.source.status, "unsupported");
  assert.equal(report.readerPatch, "native-evidence");
  assert.match(report.scope, /does not evaluate formulas/);
});

test("native evidence preflight blocks inflated-member, aggregate and gzip-member budgets", () => {
  const member = gzipSync(Buffer.alloc(2048, 7));
  const generated = container([
    { path: "BasicFileInfo", bytes: basicFileInfo("2025") },
    { path: "Partitions/1", bytes: new Uint8Array(Buffer.concat([member, member])) },
  ]);
  const bytes = new Uint8Array(Math.max(generated.length, 129 * 512));
  bytes.set(generated);
  for (const options of [{ maxMemberBytes: 1024 }, { maxInflatedBytes: 3072 }, { maxGzipMembers: 1 }]) {
    const result = openNativeEvidence(bytes, options) as { status: string; summary: unknown; records: unknown[]; diagnostics: { error: string } };
    assert.equal(result.status, "budget-blocked", JSON.stringify(result));
    assert.equal(result.summary, null);
    assert.deepEqual(result.records, []);
    assert.match(result.diagnostics.error, /inflate budget|maxGzipMembers/);
  }
});

test("native evidence patch is declared and its exact bytes match build provenance", () => {
  const root = new URL("../lib/rvt-wasm/", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("patches/manifest.json", root), "utf8"));
  assert.equal(manifest.baseCommit, provenance.commit);
  assert.equal(provenance.localPatches.length, manifest.patches.length);
  const patch = provenance.localPatches.find((value: { path: string }) => value.path.endsWith("native-evidence.patch"));
  assert.ok(patch);
  assert.equal(createHash("sha256").update(readFileSync(new URL("patches/native-evidence.patch", root))).digest("hex"), patch.sha256);
  assert.deepEqual([...patch.files].sort(), ["Cargo.lock", "rvt-wasm/Cargo.toml", "rvt-wasm/src/lib.rs", "rvt-wasm/src/native_evidence.rs"]);
});
