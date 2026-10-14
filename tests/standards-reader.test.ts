import assert from "node:assert/strict";
import test from "node:test";
import { enrichConvertResultWithStandardsReader, readStandardsEvidence, type RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { buildModel, richSpec } from "./rich-rvt-fixture.ts";

function loader(version = 2025, model: Record<string, unknown> = {}) {
  let fullCalls = 0;
  const readerMock: RvtWasmModule = {
    default: async () => undefined,
    quickSummary: () => ({ version, class_name_count: 42 }),
    openRvtBytesWithDiagnosticsModeAndLimits: (_bytes, mode, limits) => {
      fullCalls++;
      assert.equal(mode, "scaffold");
      assert.equal(limits.max_scan_bytes, 16 * 1024 * 1024);
      return { model, diagnostics: { input: { revit_version: version }, decoded: { production_walker_elements: 2 }, warnings: [] } };
    },
  };
  return { load: async () => readerMock, fullCalls: () => fullCalls };
}

test("optional reader retains its release gate and structured failure", async () => {
  const unknown = loader(2027);
  const evidence = await readStandardsEvidence(new Uint8Array(), unknown.load);
  assert.equal(evidence.diagnostics.exportLevel, "unsupported-version");
  assert.equal(unknown.fullCalls(), 0);
  const failed = await readStandardsEvidence(new Uint8Array(), async () => { throw Error("reader stopped"); });
  assert.equal(failed.diagnostics.available, false);
});

test("optional definitions and native graph evidence cannot replace scene buffers or assignments", async () => {
  const input = buildModel(richSpec());
  const result = convertRvtBytes(input, "model.rvt");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const meshes = result.meshes, materials = result.materials;
  const fidelity = result.decoderCoverage.materialFidelity;
  const reader = loader(2025, { materials: [{ name: "Reader evidence", color_packed: 0xabcdef }] });
  await enrichConvertResultWithStandardsReader(result, input, reader.load);
  assert.equal(result.meshes, meshes);
  assert.equal(result.materials, materials);
  assert.equal(result.decoderCoverage.materialFidelity, fidelity);
  assert.equal(result.standardsReaderMaterials?.length, 1);
  assert.equal(result.nativeMepEvidence?.revitVersion, 2027);
});
