/** Reissue conservative material facts from complete original RVT frames.
 * Does not approve a walking body, clearance, graph edge or publication.
 * node --import /path/to/tsx/loader.mjs recover-native-material-source.ts original.rvt base-cache.json requests.json NEW-output-directory
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openRevitContainer } from "../../lib/reviter/convert-container.ts";
import { activeClassTagTranslation, setActiveClassTagTranslation } from "../../lib/reviter/revit-class-tags.ts";
import { activeElementIdBytes, setActiveElementIdBytes } from "../../lib/reviter/element-id-width.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "../../lib/reviter/revit-container.ts";
import { createSplitFrameStream } from "../../lib/reviter/split-frame-stream.ts";
import { originalNativePlanarComponentEnvelope } from "../../lib/reviter/native-planar-component-envelopes.ts";
import { originalForeignInstanceEnvelope, nativeMaterialSourceHash, nativeMaterialOwnershipHash, nativeSourcePlanarComponentEnvelopes, nativeStairMaterialContainerCoverage } from "../../lib/reviter/native-material-source.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const [rvtPath, cachePath, requestPath, destination] = process.argv.slice(2);
assert(rvtPath && cachePath && requestPath && destination, "original.rvt base-cache.json requests.json NEW-output-directory required");
const [rvt, base, requestBytes] = await Promise.all([readFile(rvtPath), readFile(cachePath), readFile(requestPath)]);
const request = JSON.parse(requestBytes.toString("utf8")) as {
  sourceModelSha256: string; baseCacheSha256: string; planarElementIds: number[];
  foreignInstances: { carrierElementId: number; definitionElementId: number; wrapperElementId: number }[];
};
assert.equal(sha(rvt), request.sourceModelSha256, "Original RVT differs from explicit request");
assert.equal(sha(base), request.baseCacheSha256, "Base converter cache differs from explicit request");
const cache = JSON.parse(base.toString("utf8")) as { sourceModelSha256: string; nativeModel: ConvertResult };
assert.equal(cache.sourceModelSha256, request.sourceModelSha256);
assert.equal(cache.nativeModel.ok, true);
const old = cache.nativeModel.nativeMaterialSource;
assert(old && old.sourceModelSha256 === request.sourceModelSha256);
assert.equal(old.geometrySha256, nativeMaterialSourceHash(old));
assert.equal(old.ownershipSha256, nativeMaterialOwnershipHash(cache.nativeModel.elementOwnership));
assert(!old.foreignInstanceEnvelopes && !old.planarComponentEnvelopes, "Use a fresh base; do not merge unreviewed or duplicate prior facts");
assert(Array.isArray(request.planarElementIds) && request.planarElementIds.length <= 1000);
assert(Array.isArray(request.foreignInstances) && request.foreignInstances.length <= 100);
const ids = [...request.planarElementIds, ...request.foreignInstances.flatMap(r => [r.carrierElementId, r.definitionElementId])];
assert(ids.length > 0 && ids.every(id => Number.isSafeInteger(id) && id > 0));
assert.equal(new Set(ids).size, ids.length, "Explicit source locators must be unique");
const wanted = new Set(ids), frames = new Map<number, Uint8Array>();
let pages = 0, retainedBytes = 0, schemaSha256 = "";
const previousTags = activeClassTagTranslation(), previousWidth = activeElementIdBytes();
try {
  const opened = openRevitContainer(rvt, {});
  assert.equal(opened.decoderPlan.revitVersion, 2027);
  assert.equal(activeElementIdBytes(), 8);
  assert(opened.classTagTranslation.identity && !opened.classTagTranslation.movedClasses && opened.nativeSourceSchemaBytes);
  schemaSha256 = sha(opened.nativeSourceSchemaBytes);
  for (const partition of opened.partitions) {
    const stream = createSplitFrameStream({ markers: [2246], minObjectLength: 40, maxFrameBytes: 16 * 1024 * 1024,
      acceptHeader: (view, offset) => wanted.has(view.getUint32(offset, true)) });
    const data = stripRevitPageChecksums(asBytes(partition.entry.content)), offsets = gzipOffsets(data, 10_001);
    assert(offsets.length <= 10_000, "Source page census exceeds bound");
    let window: Uint8Array | null = null;
    for (let i = 0; i < offsets.length; i++) {
      const page = inflateRevitChunk(data, offsets[i]!, offsets[i + 1], window);
      assert(page, "Original source page failed complete inflation");
      window = revitWindowTail(page); pages++;
      for (const frame of stream.push(page)) {
        assert(!frames.has(frame.elementId), "Ambiguous duplicate original source frame");
        const bytes = Uint8Array.from(frame.data); retainedBytes += bytes.length;
        assert(retainedBytes <= 128 * 1024 * 1024, "Requested source retention exceeds bound");
        frames.set(frame.elementId, bytes);
      }
    }
  }
} finally { setActiveClassTagTranslation(previousTags); setActiveElementIdBytes(previousWidth); }
assert.equal(frames.size, wanted.size, "A requested original frame is missing");
const planar = [], refused = [];
for (const id of request.planarElementIds) {
  const fact = originalNativePlanarComponentEnvelope(frames.get(id)!);
  if (fact) planar.push(fact); else refused.push(id);
}
const foreign = request.foreignInstances.map(r => {
  const fact = originalForeignInstanceEnvelope(frames.get(r.carrierElementId)!, frames.get(r.definitionElementId)!);
  assert(fact, "Original foreign-instance constructor refused");
  assert.equal(fact.carrierElementId, r.carrierElementId);
  assert.equal(fact.definitionElementId, r.definitionElementId);
  return fact;
});
const next = { ...old, foreignInstanceEnvelopes: foreign, planarComponentEnvelopes: planar };
next.geometrySha256 = nativeMaterialSourceHash(next);
cache.nativeModel.nativeMaterialSource = next;
const accepted = nativeSourcePlanarComponentEnvelopes(cache.nativeModel, request.sourceModelSha256);
assert.equal(accepted.size, planar.length, "Final source consumer refused a newly issued planar fact");
const wrappers = request.foreignInstances.map(r => {
  const coverage = nativeStairMaterialContainerCoverage(cache.nativeModel, r.wrapperElementId, request.sourceModelSha256);
  assert(coverage?.requiredCarrierBounds.some(b => b.carrierElementId === r.carrierElementId && b.definitionElementId === r.definitionElementId), "Complete source wrapper coverage refused");
  return { wrapperElementId: r.wrapperElementId, ...coverage };
});
// Replace precisely one top-level model field. Preserve every unrelated byte,
// including meshes, floors, ownership, source schema and converter diagnostics.
const marker = Buffer.from('"nativeMaterialSource":'), at = base.indexOf(marker);
assert(at >= 0 && base.indexOf(marker, at + marker.length) === -1, "Ambiguous source field");
const start = at + marker.length;
assert.equal(base[start], 123);
let depth = 0, quoted = false, escaped = false, end = -1;
for (let i = start; i < base.length; i++) {
  const c = base[i];
  if (quoted) { if (escaped) escaped = false; else if (c === 92) escaped = true; else if (c === 34) quoted = false; }
  else if (c === 34) quoted = true;
  else if (c === 123 || c === 91) depth++;
  else if ((c === 125 || c === 93) && --depth === 0) { end = i + 1; break; }
}
assert(end > start);
assert.deepEqual(JSON.parse(base.subarray(start, end).toString("utf8")), old);
const payload = Buffer.from(JSON.stringify(next));
const result = Buffer.concat([base.subarray(0, start), payload, base.subarray(end)]);
assert(result.subarray(0, start).equals(base.subarray(0, start)));
assert(result.subarray(start + payload.length).equals(base.subarray(end)));
assert.equal(nativeMaterialSourceHash(JSON.parse(payload.toString())), next.geometrySha256);
const output = resolve(destination);
await mkdir(output, { recursive: false });
const facts = { sourceModelSha256: request.sourceModelSha256, schemaSha256, completeSourcePages: pages,
  foreignInstanceEnvelopes: foreign, planarComponentEnvelopes: planar };
await writeFile(join(output, "source-material-facts.json"), JSON.stringify(facts), { flag: "wx" });
await writeFile(join(output, "nativeMaterialSource.json"), payload, { flag: "wx" });
await writeFile(join(output, "UNBC.regenerated-materials.native-cache.json"), result, { flag: "wx" });
await writeFile(join(output, "requests.json"), requestBytes, { flag: "wx" });
const receipt = { format: "original-rvt-material-source-regeneration-v1", createdAt: new Date().toISOString(),
  sourceModelSha256: request.sourceModelSha256, schemaSha256, completeSourcePages: pages,
  sourceFrames: frames.size, sourceBytes: retainedBytes, planarRequested: request.planarElementIds.length,
  planarAccepted: planar.length, planarRefused: refused,
  planarComponents: planar.reduce((sum, f) => sum + f.components.length, 0), foreignInstances: foreign.length, wrappers,
  sourceFrameIdentities: [...frames].map(([nativeElementId, bytes]) => ({ nativeElementId, bytes: bytes.length, sha256: sha(bytes) })),
  base: { bytes: base.length, sha256: sha(base) }, result: { bytes: result.length, sha256: sha(result) },
  onlyChangedField: "nativeModel.nativeMaterialSource", payload: { bytes: payload.length, sha256: sha(payload), start, oldEnd: end },
  prefix: { bytes: start, sha256: sha(base.subarray(0, start)), exactlyPreserved: true },
  suffix: { bytes: base.length - end, sha256: sha(base.subarray(end)), exactlyPreserved: true },
  sourcePayloadGeometrySha256: next.geometrySha256, originalOwnershipSha256: next.ownershipSha256,
  scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), node: process.version,
  historicalCacheRestored: false, bodyClearanceApproved: false, routeApproved: false };
await writeFile(join(output, "material-regeneration-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ planarAccepted: planar.length, components: receipt.planarComponents, foreignInstances: foreign.length, result: receipt.result }));
