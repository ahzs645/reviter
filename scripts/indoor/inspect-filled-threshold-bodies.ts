/** Extracted-frame diagnostics only. This tool never emits prepared navigation
 * data, edits geometry, or grants original-RVT membership/clearance authority. */
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  inspectFilledThresholdFrames,
  type ThresholdFrameInput,
} from "../../lib/reviter/native-filled-threshold-body.ts";

const [requestPath, outputPath, ...extra] = process.argv.slice(2);
if (!requestPath || !outputPath || extra.length)
  throw Error(
    "Usage: inspect-filled-threshold-bodies.ts REQUEST.json NEW-REPORT.json",
  );
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const validSha = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
async function boundedFile(path: string, limit: number) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > limit)
    throw Error(`Input outside bounded file size: ${path}`);
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw Error("Input changed during read");
  return bytes;
}
type FrameRequest = { path: string; nativeElementId: number; sha256: string };
type Request = {
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  pairs: { placed: FrameRequest; definition: FrameRequest }[];
};
const requestFile = resolve(requestPath),
  outputFile = resolve(outputPath),
  raw = await boundedFile(requestFile, 1024 * 1024);
const request = JSON.parse(raw.toString()) as Request;
if (
  !validSha(request.sourceModelSha256) ||
  !validSha(request.sourceSchemaSha256) ||
  !Array.isArray(request.pairs) ||
  !request.pairs.length ||
  request.pairs.length > 16 ||
  new Set(request.pairs.map((p) => p.placed?.nativeElementId)).size !==
    request.pairs.length
)
  throw Error(
    "Bounded unique placements and declared source/schema hashes are required",
  );
const originals = new Map<string, string>([[requestFile, digest(raw)]]);
async function frame(r: FrameRequest): Promise<ThresholdFrameInput> {
  if (
    !r ||
    typeof r.path !== "string" ||
    !r.path ||
    !validSha(r.sha256) ||
    !Number.isSafeInteger(r.nativeElementId) ||
    r.nativeElementId <= 0
  )
    throw Error("Invalid original frame request");
  const path = resolve(dirname(requestFile), r.path);
  if (path === outputFile || requestFile === outputFile)
    throw Error("Output cannot overwrite an input");
  const bytes = await boundedFile(path, 1024 * 1024);
  if (digest(bytes) !== r.sha256)
    throw Error(`Original frame checksum mismatch: ${path}`);
  originals.set(path, r.sha256);
  return { bytes, sha256: r.sha256, nativeElementId: r.nativeElementId };
}
const results = [];
for (const pair of request.pairs)
  results.push(
    inspectFilledThresholdFrames(
      await frame(pair.placed),
      await frame(pair.definition),
    ),
  );
for (const [path, sha] of originals)
  if (digest(await boundedFile(path, 1024 * 1024)) !== sha)
    throw Error("Original input changed during diagnostic");
const report = {
  format: "original-filled-threshold-frame-diagnostics-v1",
  requestSha256: digest(raw),
  declaredSourceModelSha256: request.sourceModelSha256,
  declaredSourceSchemaSha256: request.sourceSchemaSha256,
  scope:
    "Complete supplied extracted frame pairs only; original RVT/schema membership and full model context were not independently revalidated",
  sourceMembershipIndependentlyRevalidated: false,
  fullModelContextAvailable: false,
  sourceFilesUnchanged: true,
  geometryEdited: false,
  routeApproved: false,
  clearanceApproved: false,
  pairCount: results.length,
  exactClosedPlacedBoxes: results.filter((r) => r.ok).length,
  results,
};
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    pairCount: report.pairCount,
    exactClosedPlacedBoxes: report.exactClosedPlacedBoxes,
    routeApproved: false,
  }),
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
