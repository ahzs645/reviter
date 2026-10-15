/** Census of conservative native-envelope vetoes against prior/type-reference IFCs. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isIfcGlobalId } from "../lib/reviter/ifc-global-id.ts";
import type { NativeIfcTypeIdentityEvidence } from "../lib/reviter/native-ifc-type-identity.ts";
import { stepArguments, stepRecords } from "./lib/ifc-comparison-stats.ts";
import { declareUsage, requirePath, optionValue, writeJsonReport } from "./lib/rvt-harness.ts";

declareUsage("summarize-native-type-envelopes.ts --current artifacts --prior artifacts --reference-unbc reference.ifc --json report.json");
const currentDirectory = requirePath("--current"), priorDirectory = requirePath("--prior");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type TypeLink = { productEntity: string; typeGlobalId: string; typeEntity: string };
function links(source: string): Map<string, TypeLink[]> {
  const records = new Map<number, { entity: string; args: string[] }>(), relations: string[][] = [];
  for (const record of stepRecords(source)) {
    if (record.entity === "IFCRELDEFINESBYTYPE") relations.push(stepArguments(record.body));
    else if (/^\s*'/.test(record.body)) {
      const args = stepArguments(record.body);
      if (isIfcGlobalId(args[0]?.slice(1, -1))) records.set(record.id, { entity: record.entity, args });
    }
  }
  const result = new Map<string, TypeLink[]>();
  for (const relation of relations) {
    const type = records.get(Number(/^#(\d+)$/.exec(relation[5] ?? "")?.[1]));
    if (!type || !/(?:TYPE|STYLE)$|^IFCTYPE(?:PRODUCT|OBJECT)$/.test(type.entity)) continue;
    for (const match of (relation[4] ?? "").matchAll(/#(\d+)/g)) {
      const product = records.get(Number(match[1]));
      const tag = product && /^'([0-9]+)'$/.exec(product.args[7] ?? "")?.[1];
      if (!tag || /^IFC(?:SPACE$|BUILDING$|BUILDINGSTOREY|SITE|PROJECT|REL|PROPERTY|ELEMENTQUANTITY)/.test(product!.entity)) continue;
      result.set(tag, [...(result.get(tag) ?? []), { productEntity: product!.entity, typeGlobalId: type.args[0]!.slice(1, -1), typeEntity: type.entity }]);
    }
  }
  return result;
}
const referencePath = optionValue("--reference-unbc");
const referenceBytes = referencePath ? readFileSync(referencePath) : null;
const reference = referenceBytes ? links(referenceBytes.toString()) : null;
const models = [];
for (const [index, name] of ["rac.rvt", "school.rvt", "snowdon.rvt", "unbc.rvt"].entries()) {
  const current = join(currentDirectory, `${index}-${name}`), prior = join(priorDirectory, `${index}-${name}`);
  const currentMeta = JSON.parse(readFileSync(join(current, "reviter.json"), "utf8"));
  const priorMeta = JSON.parse(readFileSync(join(prior, "reviter.json"), "utf8"));
  if (currentMeta.input.sha256 !== priorMeta.input.sha256) throw new Error(`${name}: source SHA differs from prior campaign`);
  if (JSON.stringify(currentMeta.settings) !== JSON.stringify(priorMeta.settings)) throw new Error(`${name}: converter/export settings differ from prior campaign`);
  const currentBytes = readFileSync(join(current, "reviter.ifc")), priorBytes = readFileSync(join(prior, "reviter.ifc"));
  if (currentMeta.outputIfc !== join(current, "reviter.ifc") || priorMeta.outputIfc !== join(prior, "reviter.ifc")) throw new Error(`${name}: IFC path does not match worker metadata`);
  const currentLinks = links(currentBytes.toString()), priorLinks = links(priorBytes.toString());
  const upstreamBytes = readFileSync(join(current, "upstream.ifc")), priorUpstreamBytes = readFileSync(join(prior, "upstream.ifc"));
  if (sha256(upstreamBytes) !== sha256(priorUpstreamBytes)) throw new Error(`${name}: upstream IFC changed from prior campaign`);
  const upstreamLinks = links(upstreamBytes.toString());
  const evidencePath = join(current, "reviter-native-type-evidence.json");
  const evidenceBytes = existsSync(evidencePath) ? readFileSync(evidencePath) : null;
  const evidence = evidenceBytes ? JSON.parse(evidenceBytes.toString()) as NativeIfcTypeIdentityEvidence[] : null;
  const currentReference = name === "unbc.rvt" ? reference : null;
  const unique = (rows: TypeLink[] | undefined) => rows?.length === 1 ? rows[0]! : null;
  const cases = (evidence ?? []).filter(entry => entry.flipEnvelopeComparison?.status === "conflict").map(entry => {
    const tag = String(entry.elementId), own = unique(currentLinks.get(tag)), before = unique(priorLinks.get(tag)), truth = unique(currentReference?.get(tag));
    return {
      elementId: entry.elementId, originalSymbolId: entry.originalSymbolId,
      sourceComparison: entry.flipEnvelopeComparison, originalSymbolEnvelope: entry.originalSymbolEnvelope,
      sourceReference: { source: entry.source, stream: entry.stream, chunkIndex: entry.chunkIndex, rawOffset: entry.rawOffset, objectOffset: entry.objectOffset },
      prior: before, current: own, reference: truth,
      typeGuidChanged: before && own ? before.typeGlobalId !== own.typeGlobalId : null,
      previouslyMatchedReference: before && truth ? before.typeGlobalId === truth.typeGlobalId : null,
      currentlyMatchesReference: own && truth ? own.typeGlobalId === truth.typeGlobalId : null,
    };
  });
  const comparison = (output: Map<string, TypeLink[]>) => {
    let compared = 0, matched = 0, mismatched = 0;
    for (const [tag, rows] of output) {
      const own = unique(rows), truth = unique(upstreamLinks.get(tag));
      if (!own || !truth) continue;
      compared++;
      if (own.typeGlobalId === truth.typeGlobalId) matched++; else mismatched++;
    }
    return { compared, matched, mismatched };
  };
  const upstreamPopulationChanges = [...upstreamLinks].filter(([, rows]) => rows.length === 1).flatMap(([tag, rows]) => {
    const own = unique(currentLinks.get(tag)), before = unique(priorLinks.get(tag)), truth = rows[0]!;
    const beforeMatch = before ? before.typeGlobalId === truth.typeGlobalId : null;
    const currentMatch = own ? own.typeGlobalId === truth.typeGlobalId : null;
    return beforeMatch !== currentMatch ? [{ elementId: tag, priorMatch: beforeMatch, currentMatch, prior: before, current: own, upstream: truth }] : [];
  });
  const beforeAfter = [...currentLinks].filter(([tag, values]) => values.length === 1 && priorLinks.get(tag)?.length === 1);
  models.push({
    model: name, sourceSha256: currentMeta.input.sha256, matchingConversionAndExportSettings: true,
    priorIfcSha256: sha256(priorBytes), currentIfcSha256: sha256(currentBytes), nativeEvidenceSha256: evidenceBytes ? sha256(evidenceBytes) : null,
    nativeEvidenceReferences: evidence?.length ?? null, originalEnvelopeReferences: evidence?.filter(e => e.originalSymbolEnvelope).length ?? null,
    counters: currentMeta.conversion?.stats?.nativeOriginalSymbolDiagnostics ?? null,
    censusState: evidence ? "complete-for-retained-evidence" : "private-evidence-not-saved-by-earlier-worker",
    allTypedRelationships: { comparedToPrior: beforeAfter.length, sameTypeGlobalId: beforeAfter.filter(([tag, values]) => values[0]!.typeGlobalId === priorLinks.get(tag)![0]!.typeGlobalId).length },
    envelopeCandidates: { agree: evidence?.filter(e => e.flipEnvelopeComparison?.status === "agree").length ?? null, conflicts: evidence ? cases.length : null },
    upstreamComparison: { upstreamIfcSha256: sha256(upstreamBytes), prior: comparison(priorLinks), current: comparison(currentLinks),
      previousMatchesLost: upstreamPopulationChanges.filter(row => row.priorMatch === true && row.currentMatch !== true).length,
      mismatchesNowMatching: upstreamPopulationChanges.filter(row => row.priorMatch === false && row.currentMatch === true).length,
      newlyComparedMatches: upstreamPopulationChanges.filter(row => row.priorMatch == null && row.currentMatch === true).length,
      populationChanges: upstreamPopulationChanges },
    vetoImpact: { previouslyMatchingReference: cases.filter(c => c.previouslyMatchedReference === true).length,
      previouslyMismatchingReference: cases.filter(c => c.previouslyMatchedReference === false).length,
      currentReferenceMatches: cases.filter(c => c.currentlyMatchesReference === true).length,
      referenceComparisonUnavailable: cases.filter(c => c.previouslyMatchedReference == null).length,
      typeGuidChangedFromPrior: cases.filter(c => c.typeGuidChanged === true).length },
    cases,
  });
}
writeJsonReport(requirePath("--json"), { schemaVersion: 1, generatedBy: "scripts/summarize-native-type-envelopes.ts", priorCampaignCommit: "2d42a9c",
  reference: referenceBytes ? { sha256: sha256(referenceBytes), scope: "UNBC paired IFC only; exact product decimal Tags through RelDefinesByType, duplicate joins excluded." } : null,
  models, limitations: ["Veto counts refer to source owners and product-to-type relationships, not distinct type objects or unique type GUIDs.", "A stored-envelope contradiction is a conservative confidence veto, not proof of an incorrect previous IFC identity or improved reference accuracy.",
    "Stored graphics envelopes are not proven API GetOriginalGeometry equivalents under IFC geometry options.", "A capped historical-envelope scan has partial coverage; the census includes every retained conflict, not every possible original-geometry conflict.",
    ...(models.some(model => model.censusState === "private-evidence-not-saved-by-earlier-worker") ? ["An earlier worker did not save private source evidence; the separate source-only RAC validation proves the later historical-envelope capture had no eligible RAC references."] : [])] });
