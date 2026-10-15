/** Isolated head-to-head conversion with pinned binary provenance and shared hashes. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareIfcIdentities, inventoryIfc, type IfcInventory } from "./lib/ifc-comparison-stats.ts";
import { compareIfcTypeGlobalIds } from "./lib/ifc-type-comparison.ts";
import { compareGeometrySnapshot, geometrySnapshot } from "./lib/geometry-baseline.ts";

type Engine = "upstream" | "reviter" | "reference";
const PINNED_UPSTREAM_COMMIT = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
const VANILLA_HASHES: Record<string, string> = {
  "rvt.js": "6ab0a2b3d388f202f7dc585634b6ccce87c9b20f68e80e4155d8bd033ad769e1",
  "rvt.d.ts": "950b044a0a88b1f7997209773eb3b6ab529cc78bbb33f1114eb77429d7555178",
  "rvt_bg.wasm": "dff0170996bfbeeb76b4a176b34235e20b5ebd676173284caee4d646b1464b06",
  "rvt_bg.wasm.d.ts": "828f23ecabb3fae1ae1e75a35a9c31d170294476fd22c052c80d6e13650e14ef",
};
type Config = {
  inputs: string[];
  output: string;
  referenceIfc?: string;
  baselineDirectory?: string;
  reuseUpstream?: string;
  upstreamMode: "scaffold" | "typed-no-geometry" | "geometry" | "strict";
  timeoutMs: number;
  heapMiB: number;
  upstreamWasmJs: string;
  reviterWasmJs: string;
  upstreamLimits: Record<string, number>;
  reviterOptions: { maxSegments: number; maxNativeMeshBytes: number };
  ifcOptions: { nativeRooms: boolean; mep: boolean; designOptions: "all" | "main-and-primary" };
};
type WorkerResult = {
  engine: Engine;
  state: "converted" | "refused" | "error";
  input: { path: string; sha256: string; byteLength: number; release?: number | null };
  elapsedMs: number;
  error?: string;
  settings: unknown;
  binaryProvenance?: unknown;
  diagnostics?: unknown;
  conversion?: unknown;
  inventory?: IfcInventory;
  outputIfc?: string;
};

const DEFAULT_LIMITS = {
  max_scan_bytes: 128 << 20,
  max_candidates: 100_000,
  max_trial_offsets: 16_000_000,
  max_record_decode_bytes: 1 << 20,
  max_container_records: 1000,
};
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Map ? Object.fromEntries(item) : item instanceof Set ? [...item] : typeof item === "bigint" ? item.toString() : item, 2);

function configuration(args: string[]): Config {
  const config: Config = {
    inputs: [], output: resolve("outputs/rvt-reader-comparison.json"), upstreamMode: "scaffold", timeoutMs: 600_000, heapMiB: 6144,
    upstreamWasmJs: fileURLToPath(new URL("../lib/rvt-wasm/rvt.js", import.meta.url)),
    reviterWasmJs: fileURLToPath(new URL("../lib/rvt-wasm/rvt.js", import.meta.url)),
    upstreamLimits: { ...DEFAULT_LIMITS },
    reviterOptions: { maxSegments: 12_000, maxNativeMeshBytes: 256 << 20 },
    ifcOptions: { nativeRooms: true, mep: true, designOptions: "all" },
  };
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at], value = args[at + 1];
    if (value == null) throw new Error(`Missing value for ${flag}`);
    if (flag === "--input") config.inputs.push(resolve(value));
    else if (flag === "--output") config.output = resolve(value);
    else if (flag === "--reference-ifc") config.referenceIfc = resolve(value);
    else if (flag === "--baseline-dir") config.baselineDirectory = resolve(value);
    else if (flag === "--reuse-upstream") config.reuseUpstream = resolve(value);
    else if (flag === "--upstream-wasm") config.upstreamWasmJs = resolve(value);
    else if (flag === "--reviter-wasm") config.reviterWasmJs = resolve(value);
    else if (flag === "--upstream-mode") {
      if (!["scaffold", "typed-no-geometry", "geometry", "strict"].includes(value)) throw new Error("Invalid upstream export mode");
      config.upstreamMode = value as Config["upstreamMode"];
    } else if (flag === "--design-options") {
      if (value !== "all" && value !== "main-and-primary") throw new Error("Invalid design option selection");
      config.ifcOptions.designOptions = value;
    } else if (flag === "--native-rooms" || flag === "--mep") {
      if (value !== "true" && value !== "false") throw new Error(`${flag} must be true or false`);
      if (flag === "--native-rooms") config.ifcOptions.nativeRooms = value === "true";
      else config.ifcOptions.mep = value === "true";
    } else {
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`${flag} must be a positive integer`);
      if (flag === "--timeout-ms") config.timeoutMs = numeric;
      else if (flag === "--heap-mib") config.heapMiB = numeric;
      else if (flag === "--upstream-max-scan-bytes") config.upstreamLimits.max_scan_bytes = numeric;
      else if (flag === "--upstream-max-candidates") config.upstreamLimits.max_candidates = numeric;
      else if (flag === "--upstream-max-trial-offsets") config.upstreamLimits.max_trial_offsets = numeric;
      else if (flag === "--upstream-max-record-bytes") config.upstreamLimits.max_record_decode_bytes = numeric;
      else if (flag === "--upstream-max-container-records") config.upstreamLimits.max_container_records = numeric;
      else if (flag === "--reviter-max-segments") config.reviterOptions.maxSegments = numeric;
      else if (flag === "--reviter-max-native-mesh-bytes") config.reviterOptions.maxNativeMeshBytes = numeric;
      else throw new Error(`Unknown option ${flag}`);
    }
  }
  if (!config.inputs.length) throw new Error("Usage: compare-rvt-readers.ts --input model.rvt [--input other.rvt] --output report.json [--reference-ifc model.ifc]");
  if (config.referenceIfc && config.inputs.length !== 1) throw new Error("A reference IFC must be paired with exactly one --input");
  if (config.timeoutMs > 3_600_000 || config.heapMiB > 16_384 || config.upstreamLimits.max_scan_bytes! > 1 << 30) throw new Error("Timeout/heap/scan limit exceeds command safety bounds");
  return config;
}

function verifyPinnedWasm(wasmJs: string, engine: "upstream" | "reviter") {
  const root = dirname(wasmJs);
  const provenance = JSON.parse(readFileSync(join(root, "provenance.json"), "utf8")) as { commit: string; hashes: Record<string, string>; localPatches?: unknown[]; patches?: unknown[] };
  if (!/^[a-f0-9]{40}$/.test(provenance.commit)) throw new Error("WASM provenance has no full commit hash");
  if (provenance.commit !== PINNED_UPSTREAM_COMMIT) throw new Error("The semantic projection requires the pinned upstream commit; rebuild from the recorded pin");
  for (const [name, expected] of Object.entries(provenance.hashes)) {
    if (basename(name) !== name) throw new Error("Invalid binary provenance path");
    const actual = sha256(readFileSync(join(root, name)));
    if (actual !== expected) throw new Error(`Pinned artifact hash mismatch: ${name}`);
  }
  if (!provenance.hashes[basename(wasmJs)] || !provenance.hashes["rvt_bg.wasm"]) throw new Error("Binary provenance does not include JS and WASM hashes");
  const vanilla = Object.entries(VANILLA_HASHES).every(([name, expected]) => provenance.hashes[name] === expected);
  const patches = provenance.localPatches ?? provenance.patches;
  if (engine === "upstream" && (!vanilla || patches?.length)) {
    throw new Error("Upstream comparison requires the untouched vanilla pinned bundle; pass its separate --upstream-wasm path");
  }
  if (engine === "reviter" && !vanilla && (!Array.isArray(patches) || !patches.length)) {
    throw new Error("A locally patched optional reader must declare localPatches/patches in its build provenance");
  }
  return provenance;
}

async function worker(engine: Engine, path: string, output: string, config: Config) {
  const started = performance.now();
  const bytes = new Uint8Array(readFileSync(path));
  const input: WorkerResult["input"] = { path, sha256: sha256(bytes), byteLength: bytes.length };
  const result: WorkerResult = { engine, state: "error", input, elapsedMs: 0, settings: engine === "upstream" ? { mode: config.upstreamMode, walkerLimits: config.upstreamLimits } : engine === "reviter" ? { conversion: config.reviterOptions, export: config.ifcOptions, adapter: "core convertRvtBytes plus app's optional standards-reader enrichment; no reference-assisted geometry", enrichment: { mode: "scaffold", walkerLimits: { max_scan_bytes: 16 << 20, max_candidates: 10_000, max_trial_offsets: 1_000_000, max_record_decode_bytes: 1 << 20, max_container_records: 256 } } } : { pairedReference: true } };
  try {
    let text: string;
    if (engine === "reference") text = new TextDecoder().decode(bytes);
    else if (engine === "upstream") {
      result.binaryProvenance = verifyPinnedWasm(config.upstreamWasmJs, "upstream");
      const wasm = await import(pathToFileURL(config.upstreamWasmJs).href);
      wasm.initSync({ module: readFileSync(join(dirname(config.upstreamWasmJs), "rvt_bg.wasm")) });
      const summary = wasm.quickSummary(bytes);
      input.release = summary.version ?? null;
      const opened = wasm.openRvtBytesWithDiagnosticsModeAndLimits(bytes, config.upstreamMode, config.upstreamLimits);
      result.diagnostics = opened.diagnostics;
      input.release = opened.diagnostics?.input?.revit_version ?? input.release;
      result.conversion = {
        modelEntityCount: opened.model?.entities?.length ?? 0,
        modelEntityKinds: (opened.model?.entities ?? []).reduce((counts: Record<string, number>, entity: { kind?: string }) => {
          const kind = entity.kind ?? "unknown"; counts[kind] = (counts[kind] ?? 0) + 1; return counts;
        }, {}),
        materials: opened.model?.materials?.length ?? 0,
        storeys: opened.model?.building_storeys?.length ?? 0,
      };
      text = wasm.modelToIfcStep(opened.model);
    } else {
      const { convertRvtBytes } = await import("../lib/reviter/convert.ts");
      const { makeIfc } = await import("../lib/reviter/export-ifc.ts");
      const { elementManifest } = await import("../lib/reviter/export-report.ts");
      const { enrichConvertResultWithStandardsReader } = await import("../lib/reviter/standards-reader.ts");
      const converted = convertRvtBytes(bytes, basename(path), config.reviterOptions);
      if (!converted.ok) { result.state = "refused"; result.error = converted.error; return result; }
      input.release = converted.decoderCoverage.revitVersion;
      const beforeEnrichment = geometrySnapshot(converted);
      result.binaryProvenance = verifyPinnedWasm(config.reviterWasmJs, "reviter");
      const enrichment = await enrichConvertResultWithStandardsReader(converted, bytes, async () => {
        const wasm = await import(pathToFileURL(config.reviterWasmJs).href);
        wasm.initSync({ module: readFileSync(join(dirname(config.reviterWasmJs), "rvt_bg.wasm")) });
        return wasm;
      });
      result.diagnostics = enrichment.diagnostics;
      const scene = geometrySnapshot(converted);
      const baselinePath = join(config.baselineDirectory ?? dirname(path), `${basename(path, extname(path))}-base.json`);
      const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, unknown> : undefined;
      const sources: Record<string, number> = {}, provenance: Record<string, number> = {};
      for (const element of elementManifest(converted)) {
        sources[element.geometry.source] = (sources[element.geometry.source] ?? 0) + 1;
        provenance[element.geometry.finalProvenance] = (provenance[element.geometry.finalProvenance] ?? 0) + 1;
      }
      result.conversion = {
        ...scene,
        geometryPreservedByEnrichment: beforeEnrichment.geometryHash === scene.geometryHash,
        geometryBaseline: baseline ? {
          path: baselinePath, checks: compareGeometrySnapshot(scene, baseline),
          sourceHashMatches: typeof baseline.sourceSha256 === "string" ? baseline.sourceSha256 === input.sha256 : null,
          inputIdentityScope: typeof baseline.sourceSha256 === "string" ? "Baseline declares its source SHA-256" : "Older baseline has no source SHA-256; byte length/release/path are context, not authenticated source identity",
          interpretation: "Exact prior mesh bytes/counts/origin/bounds preservation; this is not proof of Revit shape accuracy.",
        } : { path: baselinePath, state: "not-provided" },
        method: converted.method, stats: converted.stats,
        decoderCoverage: converted.decoderCoverage, warnings: converted.warnings,
        meshes: converted.meshes.length, triangles: converted.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
        recoveredRecords: converted.elementBounds.length,
        geometry: (() => {
          const digest = createHash("sha256");
          for (const mesh of converted.meshes) for (const key of ["positions", "indices", "colors", "elementIds"] as const) {
            const data = mesh[key];
            if (data) digest.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          }
          return { geometryHash: digest.digest("hex"), meshes: converted.meshes.length,
            triangles: converted.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
            bounds: converted.elementBounds.length, origin: converted.origin, bbox: converted.bbox };
        })(),
        nativeSourceRooms: converted.nativeSourceRooms?.length ?? 0,
        nativeMepSystems: converted.nativeMepEvidence?.systems.length ?? 0,
        nativeMepConnections: converted.nativeMepEvidence?.connections.length ?? 0,
        nativeMepPorts: converted.nativeMepEvidence?.ports?.length ?? 0,
        nativeMepDimensions: converted.nativeMepEvidence?.dimensions?.length ?? 0,
        nativeDesignOptionSets: converted.nativeDesignOptions?.sets.length ?? 0,
        nativePhaseDefinitions: converted.nativePhaseEvidence?.phases.length ?? 0,
        nativePhaseElements: converted.nativePhaseEvidence?.elementPhases.length ?? 0,
        nativeExtraLevelParameters: converted.nativePhaseEvidence?.levelParameters.length ?? 0,
        nativeRoomFloorFinishes: converted.nativePhaseEvidence?.roomFloorFinishes.length ?? 0,
        nativeOriginalTypeIdentityEvidence: converted.nativeIfcTypeIdentityEvidence?.length ?? 0,
        nativeIfcGuidParameterTables: converted.nativeIfcGuidParameters?.length ?? 0,
        nativeIfcSemanticElements: converted.nativeIfcSemanticEvidence?.elements.length ?? 0,
        geometrySources: sources, geometryProvenance: provenance,
      };
      text = makeIfc(converted, config.ifcOptions);
    }
    if (engine !== "reference") { writeFileSync(output, text); result.outputIfc = output; }
    result.inventory = inventoryIfc(text);
    result.state = "converted";
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally { result.elapsedMs = performance.now() - started; }
  return result;
}

function child(engine: Engine, path: string, directory: string, configPath: string, config: Config) {
  return new Promise<{ state: string; result?: WorkerResult; elapsedMs: number; error?: string; stderr?: string }>((done) => {
    const started = performance.now(), resultPath = join(directory, `${engine}.json`);
    let stderr = "", expired = false;
    const processChild = spawn(process.execPath, [
      "--experimental-strip-types", `--max-old-space-size=${config.heapMiB}`,
      "--import", fileURLToPath(new URL("./register-test-typescript.mjs", import.meta.url)),
      fileURLToPath(import.meta.url), "--worker", engine, path, join(directory, `${engine}.ifc`), resultPath, configPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    processChild.stderr.on("data", chunk => { stderr = `${stderr}${chunk.toString()}`.slice(-8192); });
    const deadline = setTimeout(() => { expired = true; processChild.kill("SIGKILL"); }, config.timeoutMs);
    processChild.once("error", error => { clearTimeout(deadline); done({ state: "worker-start-error", error: error.message, elapsedMs: performance.now() - started }); });
    processChild.once("close", (status, signal) => {
      clearTimeout(deadline);
      if (expired || status !== 0) return done({ state: expired ? "timeout" : "worker-failed", error: `exit=${status}, signal=${signal}`, stderr, elapsedMs: performance.now() - started });
      try {
        const result = JSON.parse(readFileSync(resultPath, "utf8")) as WorkerResult;
        done({ state: result.state, result, stderr: stderr || undefined, elapsedMs: performance.now() - started });
      } catch (error) { done({ state: "worker-report-error", error: String(error), stderr, elapsedMs: performance.now() - started }); }
    });
  });
}

function compact(result: WorkerResult | undefined) {
  if (!result?.inventory) return result;
  const { rootGlobalIds, productGlobalIds, elementIds, ...inventory } = result.inventory;
  return { ...result, inventory: { ...inventory, uniqueRootGlobalIds: rootGlobalIds.length, uniqueProductGlobalIds: productGlobalIds.length, uniqueElementIds: elementIds.length } };
}

type UpstreamReuseProof = {
  generatedBy: string;
  settings: Config;
  models: Array<{ model: string; readers: { upstream: {
    state: string; input: WorkerResult["input"]; elapsedMs: number;
    binaryProvenance: { hashes: Record<string, string> };
    diagnostics: unknown; conversion: unknown;
    ifc: { sha256: string; byteLength: number };
  } } }>;
};
function reusedUpstream(input: string, folder: string, config: Config, proof: UpstreamReuseProof, proofSha256: string) {
  const started = performance.now();
  if (proof.generatedBy !== "scripts/summarize-rvt-reader-comparison.ts") throw new Error("Upstream reuse requires the independently reopened comparison summary");
  if (proof.settings.upstreamMode !== config.upstreamMode || json(proof.settings.upstreamLimits) !== json(config.upstreamLimits)) throw new Error("Reused upstream mode/walker settings differ from this comparison");
  const index = proof.models.findIndex(model => model.readers.upstream.input.path === input);
  if (index < 0) throw new Error(`No exact input path in upstream reuse proof: ${input}`);
  const original = proof.models[index]!.readers.upstream;
  if (original.state !== "converted") throw new Error("Cannot reuse an upstream export that did not convert");
  const bytes = readFileSync(input);
  if (sha256(bytes) !== original.input.sha256 || bytes.length !== original.input.byteLength) throw new Error("Upstream reuse input SHA-256/length changed");
  const current = verifyPinnedWasm(config.upstreamWasmJs, "upstream");
  if (json(current.hashes) !== json(original.binaryProvenance.hashes)) throw new Error("Upstream reuse binary artifact hashes changed");
  const sourceIfc = join(`${proof.settings.output}.artifacts`, `${index}-${basename(input).replace(/[^A-Za-z0-9_.-]/g, "_")}`, "upstream.ifc");
  const sourceBytes = readFileSync(sourceIfc);
  if (sha256(sourceBytes) !== original.ifc.sha256 || sourceBytes.length !== original.ifc.byteLength) throw new Error("Reused upstream IFC SHA-256/length changed");
  const outputIfc = join(folder, "upstream.ifc");
  writeFileSync(outputIfc, sourceBytes);
  const result: WorkerResult = { engine: "upstream", state: "converted", input: original.input,
    elapsedMs: original.elapsedMs, settings: { mode: config.upstreamMode, walkerLimits: config.upstreamLimits },
    binaryProvenance: current, diagnostics: original.diagnostics, conversion: original.conversion,
    inventory: inventoryIfc(new TextDecoder().decode(sourceBytes)), outputIfc };
  writeFileSync(join(folder, "upstream.json"), `${json(result)}\n`);
  return { state: "converted", result, elapsedMs: performance.now() - started,
    reusedFrom: { proof: config.reuseUpstream, proofSha256, sourceIfc, ifcSha256: original.ifc.sha256,
      originalElapsedMs: original.elapsedMs, scope: "Only the unchanged upstream output is reused; exact input/binary/output hashes and mode/walker settings verified. Reviter is freshly converted." } };
}

if (process.argv[2] === "--worker") {
  const [, , , engine, path, outputIfc, outputJson, configPath] = process.argv;
  const config = JSON.parse(readFileSync(configPath!, "utf8")) as Config;
  const result = await worker(engine as Engine, path!, outputIfc!, config);
  writeFileSync(outputJson!, `${json(result)}\n`);
} else {
  const config = configuration(process.argv.slice(2));
  // Fail before running any conversions if a patched app reader was selected
  // as the upstream baseline, or if either artifact's recorded hash changed.
  verifyPinnedWasm(config.upstreamWasmJs, "upstream");
  verifyPinnedWasm(config.reviterWasmJs, "reviter");
  const directory = `${config.output}.artifacts`;
  mkdirSync(dirname(config.output), { recursive: true });
  mkdirSync(directory, { recursive: true });
  const configPath = join(directory, "settings.json");
  writeFileSync(configPath, `${json(config)}\n`);
  const proofBytes = config.reuseUpstream ? readFileSync(config.reuseUpstream) : undefined;
  const proof = proofBytes ? JSON.parse(new TextDecoder().decode(proofBytes)) as UpstreamReuseProof : undefined;
  if (proofBytes) writeFileSync(join(directory, "reused-upstream-proof.json"), proofBytes);
  const models: unknown[] = [];
  for (const [index, input] of config.inputs.entries()) {
    const folder = join(directory, `${index}-${basename(input).replace(/[^A-Za-z0-9_.-]/g, "_")}`);
    mkdirSync(folder, { recursive: true });
    process.stdout.write(`Comparing ${basename(input)}: upstream ${config.upstreamMode}, then Reviter\n`);
    const upstream = proof ? reusedUpstream(input, folder, config, proof, sha256(proofBytes!)) : await child("upstream", input, folder, configPath, config);
    const reviter = await child("reviter", input, folder, configPath, config);
    const reference = config.referenceIfc ? await child("reference", config.referenceIfc, folder, configPath, config) : undefined;
    const hashesAgree = upstream.result && reviter.result
      ? upstream.result.input.sha256 === reviter.result.input.sha256 : null;
    const compared = hashesAgree && upstream.result?.inventory && reviter.result?.inventory
      ? compareIfcIdentities(upstream.result.inventory, reviter.result.inventory) : undefined;
    const upstreamText = upstream.result?.outputIfc && existsSync(upstream.result.outputIfc) ? readFileSync(upstream.result.outputIfc, "utf8") : undefined;
    const reviterText = reviter.result?.outputIfc && existsSync(reviter.result.outputIfc) ? readFileSync(reviter.result.outputIfc, "utf8") : undefined;
    const referenceText = reference?.result?.inventory && config.referenceIfc ? readFileSync(config.referenceIfc, "utf8") : undefined;
    const typeIdentities = hashesAgree && upstreamText != null && reviterText != null ? {
      reviterAgainstUpstream: compareIfcTypeGlobalIds(reviterText, upstreamText),
      upstreamAgainstReference: referenceText != null ? compareIfcTypeGlobalIds(upstreamText, referenceText) : undefined,
      reviterAgainstReference: referenceText != null ? compareIfcTypeGlobalIds(reviterText, referenceText) : undefined,
      interpretation: "Type GlobalIds joined through each product's actual IfcRelDefinesByType and decimal Tag; class-pair and ambiguity counts remain explicit. Identity agreement is not shape accuracy.",
    } : undefined;
    const baselinePath = config.baselineDirectory ? join(config.baselineDirectory, `${basename(input).replace(/\.rvt$/i, "")}-base.json`) : undefined;
    const baseline = baselinePath && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : undefined;
    const actualGeometry = (reviter.result?.conversion as { geometry?: Record<string, unknown> } | undefined)?.geometry;
    const geometryBaseline = baselinePath ? { path: baselinePath, state: baseline && actualGeometry ? "compared" : "unavailable",
      checks: baseline && actualGeometry ? Object.fromEntries(["geometryHash", "triangles", "meshes", "bounds", "origin", "bbox"].map(key => [key,
        { expected: baseline[key] ?? null, actual: actualGeometry[key], matches: baseline[key] == null ? null : JSON.stringify(baseline[key]) === JSON.stringify(actualGeometry[key]) }])) : undefined } : undefined;
    models.push({ input, identicalInputHash: hashesAgree, inputHashComparison: hashesAgree == null ? "unavailable" : hashesAgree ? "identical" : "different",
      upstream: { ...upstream, result: compact(upstream.result) }, reviter: { ...reviter, result: compact(reviter.result) },
      reference: reference ? { ...reference, result: compact(reference.result) } : undefined,
      identities: compared,
      typeIdentities,
      geometryBaseline,
      referenceIdentities: reference?.result?.inventory ? {
        upstream: upstream.result?.inventory ? compareIfcIdentities(upstream.result.inventory, reference.result.inventory) : undefined,
        reviter: reviter.result?.inventory ? compareIfcIdentities(reviter.result.inventory, reference.result.inventory) : undefined,
      } : undefined,
    });
    process.stdout.write(`${basename(input)}: upstream=${upstream.state}, Reviter=${reviter.state}, sameInput=${hashesAgree}\n`);
    if (!hashesAgree || !compared) process.exitCode = 1;
    if (geometryBaseline?.checks && Object.values(geometryBaseline.checks).some(check => check.matches === false)) process.exitCode = 1;
    if (reference && !reference.result?.inventory) process.exitCode = 1;
    writeFileSync(config.output, `${json({ schemaVersion: 1, generatedBy: "scripts/compare-rvt-readers.ts", settings: config, models,
      limitations: ["Sequential isolated child processes; deadlines and Node heap budgets are recorded and failures/timeouts remain explicit.", "Walker scan limits constrain particular upstream scans, not total inflation/model work; stronger upstream modes may refuse rather than emit a sparse model.", "Native-room IFC export is enabled by this comparison tool by default; ordinary Reviter export defaults remain independent.", "Reference IFC remains an external observation; matching counts, IDs and representations do not establish geometric or semantic accuracy.", "No reference IFC geometry is fed into either converter."] })}\n`);
  }
}
