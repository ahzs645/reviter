/** Source-only MEP audit; geometry conversion is not required.
 * node --experimental-strip-types --import ./scripts/register-test-typescript.mjs
 *   scripts/audit-native-mep.ts model.rvt [reference.ifc] [--out evidence.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { openRevitContainer } from "../lib/reviter/convert-container.ts";
import { asBytes, stripRevitPageChecksums, gzipOffsets, inflateRevitChunk, revitWindowTail } from "../lib/reviter/revit-container.ts";
import { scanElementHeaders } from "../lib/reviter/element-headers.ts";
import { detectDuplicatedBoundsRecords } from "../lib/reviter/bounds-records.ts";
import { createNativeMepCollector } from "../lib/reviter/native-mep.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex < 0 ? undefined : args.splice(outIndex, 2)[1];
const [path, referencePath] = args;
if (!path || args.length > 2) throw new Error("Usage: audit-native-mep.ts model.rvt [reference.ifc] [--out evidence.json]");
const start = performance.now();
const bytes = new Uint8Array(readFileSync(path));
const container = openRevitContainer(bytes, {});
const revitVersion = container.decoderPlan.revitVersion ?? 0;
const elementIds = new Set(container.elementIndex?.uniqueElementIds ?? container.nativeIdentity?.identities.map((i) => i.elementId) ?? []);
const collector = createNativeMepCollector({ revitVersion, classes: container.schema?.taggedClasses ?? [], elementIds });
let pages = 0;
for (const partition of container.partitions) {
  const data = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let index = 0; index < offsets.length; index++) {
    const page = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
    if (!page) continue;
    window = revitWindowTail(page);
    collector.observeElementHeaders(scanElementHeaders(page));
    collector.observeElementBounds(detectDuplicatedBoundsRecords(page).filter((r) => r.duplicated).map((r) => ({ ...r, stream: partition.path })));
    collector.pushPage(page, { stream: partition.path, chunkIndex: index, complete: true });
    pages++;
  }
}
const evidence = collector.finish();
const canonical = (a: string, b: string) => [a, b].sort().join("/");
let comparison: { referenceSha256: string; referenceConnections: number; recoveredConnections: number; matching: number; unexpected: string[]; missing: string[] } | undefined;
if (referencePath) {
  const text = readFileSync(referencePath, "utf8");
  const ports = new Map<string, string>();
  for (const match of text.matchAll(/#(\d+)\s*=\s*IFCDISTRIBUTIONPORT\('[^']*',(?:#[^,]*|\$),'(?:In|Out)?Port_(\d+)_(\d+)'/g)) ports.set(match[1]!, `${match[2]}:${match[3]}`);
  const reference = new Set<string>();
  for (const match of text.matchAll(/IFCRELCONNECTSPORTS\([^;]*?,#(\d+),#(\d+),[^;]*?\);/g)) {
    const a = ports.get(match[1]!), b = ports.get(match[2]!);
    if (a && b) reference.add(canonical(a, b));
  }
  const actual = new Set(evidence.connections.map((c) => canonical(`${c.elementId}:${c.connectorIndex}`, `${c.otherElementId}:${c.otherConnectorIndex}`)));
  comparison = { referenceSha256: createHash("sha256").update(text).digest("hex"), referenceConnections: reference.size, recoveredConnections: actual.size, matching: [...actual].filter((c) => reference.has(c)).length, unexpected: [...actual].filter((c) => !reference.has(c)).sort(), missing: [...reference].filter((c) => !actual.has(c)).sort() };
}
const report = { file: path, sha256: createHash("sha256").update(bytes).digest("hex"), pages, milliseconds: Math.round(performance.now() - start), systemCount: evidence.systems.length, membershipCount: evidence.systems.reduce((n, s) => n + s.members.length, 0), connectionCount: evidence.connections.length, dimensionalElementCount: evidence.dimensions?.length ?? 0, comparison, evidence };
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, evidence: { limitations: evidence.limitations } }, null, 2));
