/** Reopen existing comparison IFCs and publish compact evidence; never reconvert RVT. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { IfcAPI } from "web-ifc";
import { compareIfcGlobalIds, taggedIfcRoots } from "./audit-rvt-semantic-integration.ts";
import { compareIfcTypeGlobalIds } from "./lib/ifc-type-comparison.ts";
import { analyzeGlbDocument, readGlbDocument } from "./glb-statistics.ts";

type EngineResult = {
  state: string; elapsedMs: number; error?: string;
  reusedFrom?: unknown;
  result?: { input: { sha256: string; byteLength: number; release: number }; binaryProvenance: unknown;
    diagnostics: unknown; inventory: Record<string, unknown>; conversion: unknown; outputIfc: string };
};
type Model = { input: string; identicalInputHash: boolean; upstream: EngineResult; reviter: EngineResult;
  geometryBaseline: unknown; identities: unknown; typeIdentities: unknown };
function compareProducts(output: string, reference: string) {
  const index = (text: string) => {
    const groups = new Map<string, string[]>();
    for (const root of taggedIfcRoots(text)) if (root.kind === "product") {
      const values = groups.get(root.tag) ?? []; values.push(root.globalId); groups.set(root.tag, values);
    }
    return groups;
  };
  const own = index(output), truth = index(reference);
  let matched = 0, mismatched = 0, ambiguous = 0, outputOnly = 0, referenceOnly = 0;
  for (const [tag, ids] of own) {
    const expected = truth.get(tag);
    if (!expected) { outputOnly++; continue; }
    if (ids.length !== 1 || expected.length !== 1) { ambiguous++; continue; }
    if (ids[0] === expected[0]) matched++; else mismatched++;
  }
  for (const tag of truth.keys()) if (!own.has(tag)) referenceOnly++;
  return { join: "Products only, exact decimal IfcElement.Tag; duplicate tags excluded", compared: matched + mismatched, matched, mismatched, ambiguous, outputOnly, referenceOnly };
}
const [inputPath, outputPath, referencePath] = process.argv.slice(2).map(value => resolve(value));
if (!inputPath || !outputPath) throw new Error("Usage: summarize-rvt-reader-comparison.ts comparison.json output.json [unbc-reference.ifc]");
const source = JSON.parse(readFileSync(inputPath, "utf8")) as { settings: { reuseUpstream?: string }; models: Model[]; limitations: string[] };
const models = [];
for (const model of source.models) {
  const readers: Record<string, unknown> = {};
  for (const engine of ["upstream", "reviter"] as const) {
    const run = model[engine];
    if (!run.result?.outputIfc) { readers[engine] = { state: run.state, error: run.error }; continue; }
    const bytes = readFileSync(run.result.outputIfc);
    const api = new IfcAPI();
    await api.Init();
    const id = api.OpenModel(new Uint8Array(bytes));
    try {
      if (id < 0) throw new Error(`web-ifc refused ${engine} ${model.input}`);
      readers[engine] = { state: run.state, input: run.result.input, elapsedMs: run.elapsedMs,
        reusedFrom: run.reusedFrom,
        binaryProvenance: run.result.binaryProvenance, diagnostics: run.result.diagnostics,
        conversion: run.result.conversion, inventory: run.result.inventory,
        ifc: { byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
        reopened: { reader: "web-ifc", schema: api.GetModelSchema(id),
          entities: Object.fromEntries(api.GetAllTypesOfModel(id).map(type => [type.typeName.toUpperCase(), api.GetLineIDsWithType(id, type.typeID).size()])),
          scope: "Entity population reopen only; no tessellation, geometric accuracy or full IFC template conformance claim." } };
    } finally { if (id >= 0) api.CloseModel(id); api.Dispose(); }
  }
  const pairedReference = basename(model.input) === "unbc.rvt" && referencePath ? (() => {
    const reference = readFileSync(referencePath, "utf8");
    return { sha256: createHash("sha256").update(reference).digest("hex"),
      upstream: model.upstream.result?.outputIfc ? compareIfcGlobalIds(readFileSync(model.upstream.result.outputIfc, "utf8"), reference) : null,
      reviter: model.reviter.result?.outputIfc ? compareIfcGlobalIds(readFileSync(model.reviter.result.outputIfc, "utf8"), reference) : null,
      upstreamProducts: model.upstream.result?.outputIfc ? compareProducts(readFileSync(model.upstream.result.outputIfc, "utf8"), reference) : null,
      reviterProducts: model.reviter.result?.outputIfc ? compareProducts(readFileSync(model.reviter.result.outputIfc, "utf8"), reference) : null,
      upstreamTypes: model.upstream.result?.outputIfc ? compareIfcTypeGlobalIds(readFileSync(model.upstream.result.outputIfc, "utf8"), reference) : null,
      reviterTypes: model.reviter.result?.outputIfc ? compareIfcTypeGlobalIds(readFileSync(model.reviter.result.outputIfc, "utf8"), reference) : null };
  })() : undefined;
  models.push({ model: basename(model.input), identicalInputHash: model.identicalInputHash,
    readers, geometryBaseline: model.geometryBaseline, identities: model.identities, typeIdentities: model.typeIdentities, pairedReference,
    referenceGlbInventory: (() => {
      const path = model.input.replace(/\.rvt$/i, "-reference.glb");
      if (!existsSync(path)) return undefined;
      const bytes = readFileSync(path);
      return { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length,
        ...analyzeGlbDocument(readGlbDocument(bytes)), scope: "Reference topology/extent inventory only; recorded baseline checks distinguish preserved data from measured source-body selection changes. They do not establish agreement with these reference surfaces." };
    })() });
  process.stdout.write(`Reopened ${basename(model.input)} outputs\n`);
}
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, generatedBy: "scripts/summarize-rvt-reader-comparison.ts",
  comparisonGeneratedBy: "scripts/compare-rvt-readers.ts", settings: source.settings, models,
  limitations: [...source.limitations, "The two binary bundles are separate: untouched pinned upstream and locally patched Reviter optional evidence reader.",
    source.settings.reuseUpstream ? "Fresh Reviter conversions use the unchanged upstream IFCs from a previous independently reopened run; input/binary/output hashes and mode/walker settings are verified and recorded. Reopens/reference joins do not reconvert RVT." :
      "All RVT inputs were converted only once per engine in this final batch; these reopens and reference joins reuse generated IFC bytes."] }, null, 2)}\n`);
