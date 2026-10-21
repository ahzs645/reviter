/** Full original-model threshold source producer. Discovery IDs, endpoints,
 * cap tokens and comparison masks are rechecked, never accepted as authority.
 * This producer cannot emit an enabled link or waive material/owner/access. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalSourceConsumerBinding } from "./native-source-consumer-binding.ts";
import { createOriginalNativeForeignEnvelopeCensus } from "../../lib/reviter/native-source-foreign-envelope-census.ts";
import { certifyOriginalCurtainCellBindings } from "../../lib/reviter/native-source-curtain-cell-bindings.ts";
import { certifyOriginalCurtainMaterialContainer } from "../../lib/reviter/native-source-curtain-material-container.ts";
import { inspectOriginalCurrentCurtainDoorMask } from "../../lib/reviter/native-source-curtain-door-mask.ts";
import { certifyOriginalFilledThresholdDemand, auditOriginalFilledThresholdSupportedMaterial } from "../../lib/reviter/native-filled-threshold-step.ts";
import { Rational, rational, type NativeRationalParts } from "../../lib/reviter/native-rational-overlay.ts";
type Request = {
    nativeDoorElementId: number;
    nativeHostElementId: number;
    nativeSillElementId: number;
    nativeSillDefinitionId: number;
    fromFeet: [
        number,
        number,
        number
    ];
    toFeet: [
        number,
        number,
        number
    ];
    unchangedDoorComparisonMaskFeet: [
        number,
        number
    ][];
    originalFloorCapLocators: {
        nativeFloorElementId: number;
        originalCapFaceToken: number;
    }[];
};
type Requests = {
    format: "original-source-door-threshold-requests-v2";
    sourceModelSha256: string;
    requestedProfile: "walking" | "step-free";
    sourceDrawingReviewSha256: string;
    requestedOriginalFrameIds: number[];
    requests: Request[];
};
const [sourcePath, requestPath, reviewPath, outputPath, ...extra] = process.argv.slice(2);
if (!sourcePath || !requestPath || !reviewPath || !outputPath || extra.length)
    throw Error("Usage: audit-native-source-door-thresholds.ts ORIGINAL.rvt DISCOVERY-REQUESTS.json SOURCE-DRAWING-REVIEW.json NEW-REPORT.json");
const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex"), validId = (n: number) => Number.isSafeInteger(n) && n > 0, validSha = (s: string) => /^[a-f0-9]{64}$/.test(s), sourceBytes = readFileSync(sourcePath), requestBytes = readFileSync(requestPath), reviewBytes = readFileSync(reviewPath), request = JSON.parse(requestBytes.toString()) as Requests;
if (request.format !== "original-source-door-threshold-requests-v2" || !["walking", "step-free"].includes(request.requestedProfile) || !validSha(request.sourceModelSha256) || hash(sourceBytes) !== request.sourceModelSha256 || !validSha(request.sourceDrawingReviewSha256) || hash(reviewBytes) !== request.sourceDrawingReviewSha256)
    throw Error("Original source/drawing/request binding mismatch");
if (!Array.isArray(request.requests) || request.requests.length < 1 || request.requests.length > 64 || new Set(request.requests.map(r => r.nativeDoorElementId)).size !== request.requests.length || !Array.isArray(request.requestedOriginalFrameIds) || request.requestedOriginalFrameIds.length > 4096 || request.requestedOriginalFrameIds.some(n => !validId(n)))
    throw Error("Bounded unique original source locators are required");
for (const r of request.requests) {
    if (![r.nativeDoorElementId, r.nativeHostElementId, r.nativeSillElementId, r.nativeSillDefinitionId].every(validId) || ![r.fromFeet, r.toFeet].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) || !Array.isArray(r.unchangedDoorComparisonMaskFeet) || r.unchangedDoorComparisonMaskFeet.length !== 4 || r.unchangedDoorComparisonMaskFeet.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n))) || !Array.isArray(r.originalFloorCapLocators) || !r.originalFloorCapLocators.length || r.originalFloorCapLocators.length > 64 || r.originalFloorCapLocators.some(c => !validId(c.nativeFloorElementId) || !validId(c.originalCapFaceToken)))
        throw Error("Incomplete original threshold discovery request");
}
const output = resolve(outputPath);
if ([sourcePath, requestPath, reviewPath].some(p => resolve(p) === output))
    throw Error("Output must not overwrite an input");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), entry = fileURLToPath(import.meta.url), before = originalSourceConsumerBinding(root, [entry, resolve(root, "scripts/register-test-typescript.mjs"), resolve(root, "package.json")]), started = performance.now(), points = request.requests.flatMap(r => [r.fromFeet, r.toFeet]), scope = { min: { x: Math.min(...points.map(p => p[0])) - 2, y: Math.min(...points.map(p => p[1])) - 2, z: Math.min(...points.map(p => p[2])) - .5 }, max: { x: Math.max(...points.map(p => p[0])) + 2, y: Math.max(...points.map(p => p[1])) + 2, z: Math.max(...points.map(p => p[2])) + 8 } }, ids = [...new Set([...request.requestedOriginalFrameIds, ...request.requests.flatMap(r => [r.nativeDoorElementId, r.nativeHostElementId, r.nativeSillElementId, r.nativeSillDefinitionId, ...r.originalFloorCapLocators.map(c => c.nativeFloorElementId)])])], { certificate, summary } = createOriginalNativeForeignEnvelopeCensus(sourceBytes, request.sourceModelSha256, scope, JSON.parse(reviewBytes.toString()), ids);
const results = request.requests.map(r => {
    const row: Record<string, unknown> = { nativeDoorElementId: r.nativeDoorElementId, nativeSillElementId: r.nativeSillElementId, sourceOwnersQualified: false, allOriginalWalkingOperandsQualified: false, sourceOperationQualified: false, publicAccessApproved: false, sourceLeafMaterialOmitted: false, sourceSillMaterialOmitted: false, routeApproved: false };
    const attempt = (name: string, fn: () => unknown) => { try {
        const result = fn();
        row[name] = { ok: true, result };
        return result;
    }
    catch (e) {
        row[name] = { ok: false, blocked: e instanceof Error ? e.message : String(e) };
        return undefined;
    } };
    const binding = attempt("currentSourceCell", () => certifyOriginalCurtainCellBindings(certificate, r.nativeHostElementId)) as ReturnType<typeof certifyOriginalCurtainCellBindings> | undefined, container = attempt("currentSourceContainer", () => certifyOriginalCurtainMaterialContainer(certificate, r.nativeHostElementId)) as ReturnType<typeof certifyOriginalCurtainMaterialContainer> | undefined, mask: NativeRationalParts = [[r.unchangedDoorComparisonMaskFeet.map(([x, y]) => [rational(x), rational(y)])]];
    if (container)
        attempt("originalDoorMaterialComparison", () => inspectOriginalCurrentCurtainDoorMask(certificate, container, r.nativeDoorElementId, mask));
    const demand = binding ? attempt("originalFilledThresholdDemand", () => certifyOriginalFilledThresholdDemand({ census: certificate, hostBinding: binding, nativeDoorElementId: r.nativeDoorElementId, nativeSillElementId: r.nativeSillElementId, nativeSillDefinitionId: r.nativeSillDefinitionId, fromFeet: r.fromFeet, toFeet: r.toFeet })) as ReturnType<typeof certifyOriginalFilledThresholdDemand> | undefined : undefined;
    if (demand && container)
        attempt("composedOriginalSourceMaterial", () => auditOriginalFilledThresholdSupportedMaterial(certificate, demand, container, r.originalFloorCapLocators, mask, request.requestedProfile));
    console.log(JSON.stringify({ nativeDoorElementId: r.nativeDoorElementId, sourcePredicatesRecorded: true, routeApproved: false }));
    return row;
});
const after = originalSourceConsumerBinding(root, [entry, resolve(root, "scripts/register-test-typescript.mjs"), resolve(root, "package.json")]), sourceCodeUnchanged = before.sha256 === after.sha256, sourceModelUnchanged = hash(sourceBytes) === hash(readFileSync(sourcePath)), requestsUnchanged = hash(requestBytes) === hash(readFileSync(requestPath)), drawingReviewUnchanged = hash(reviewBytes) === hash(readFileSync(reviewPath));
function encode(v: unknown): unknown { return v instanceof Rational ? { numerator: v.n.toString(), denominator: v.d.toString() } : typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(encode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) : v; }
const report = { format: "original-source-door-threshold-producer-v2", executionSourceRoot: root, sourceModelSha256: request.sourceModelSha256, sourceSchemaSha256: certificate.sourceSchemaSha256, requestSha256: hash(requestBytes), sourceDrawingReviewSha256: hash(reviewBytes), sourceConsumerBinding: before, sourceConsumerBindingAfter: after, sourceCodeUnchanged, sourceModelUnchanged, requestsUnchanged, drawingReviewUnchanged, scopeBoundsFeet: scope, originalCensus: summary, results, elapsedSeconds: (performance.now() - started) / 1000, sourceOwnerAuthorityGranted: false, walkingBodyApproved: false, leafOrSillMaterialOmitted: false, routeApproved: false, published: false };
writeFileSync(output, JSON.stringify(encode(report), null, 2) + "\n", { flag: "wx" });
if (!sourceCodeUnchanged || !sourceModelUnchanged || !requestsUnchanged || !drawingReviewUnchanged)
    throw Error("Source producer/input changed during replay; current-source binding refused");
