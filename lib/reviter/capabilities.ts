/** Executable support ceilings, not a per-file recovery or completeness report. */
import { standardsReaderSupports, STANDARDS_READER_RANGE_LABEL } from "./reader-support.ts";
import {
  NARROW_ID_RECORD_LAYOUT_FIRST_RELEASE,
  REVIT_2027_RECORD_LAYOUT_FIRST_RELEASE,
  usesRevit2027RecordLayout,
} from "./revit-class-tags.ts";

export type CapabilityStatus = "partial" | "experimental" | "unsupported";
export type CapabilityContract = {
  id: string;
  area: "metadata" | "semantics" | "geometry" | "safety";
  implementation: "reviter" | "vendored-rvt-rs";
  status: CapabilityStatus;
  eligible: boolean;
  scope: string;
  limitations: string[];
  evidence: string[];
};
export type CapabilityManifest = {
  schemaVersion: 1;
  release: number | null;
  narrowElementIds: boolean;
  capabilities: CapabilityContract[];
  caveats: string[];
};

/**
 * The narrow-id flag must come from this file's parsed schema, never its year.
 * Eligibility permits a decoder attempt; status is its maximum product claim.
 * No open/metadata result can promote semantic or geometry recovery.
 */
export function capabilityManifest(
  release?: number | null,
  schemaDeclaresNarrowIds = false,
): CapabilityManifest {
  const version = Number.isInteger(release) && release! > 0 ? release! : null;
  const wide = usesRevit2027RecordLayout(version);
  const narrow = version != null && version >= NARROW_ID_RECORD_LAYOUT_FIRST_RELEASE &&
    version < REVIT_2027_RECORD_LAYOUT_FIRST_RELEASE && schemaDeclaresNarrowIds;
  const records = wide || narrow;
  const row = (value: CapabilityContract): CapabilityContract => value;
  return {
    schemaVersion: 1,
    release: version,
    narrowElementIds: schemaDeclaresNarrowIds,
    capabilities: [
      row({ id: "reviter.container-schema", area: "metadata", implementation: "reviter", status: "partial", eligible: true,
        scope: "CFB inventory, metadata and Formats/Latest schema inspection are attempted independently of native geometry.",
        limitations: ["Opening a container or reading a schema does not prove recoverable elements.", "Malformed or unknown encodings can fail; eligibility is not a universal release guarantee."],
        evidence: ["tests/schema-reader.test.ts", "tests/convert-rvt-bytes.test.ts"] }),
      row({ id: "reviter.native-element-records", area: "semantics", implementation: "reviter", status: records ? "partial" : "unsupported", eligible: records,
        scope: narrow ? "Selected 2019–2023 record decoders with schema-confirmed 32-bit element ids." : "2024–2027 translated class tags and native element record decoders.",
        limitations: ["2019–2023 enable only decoders with explicit narrow-id variants.", "A matching release does not prove every element, parameter or relation was recovered."],
        evidence: ["lib/reviter/revit-class-tags.ts", "docs/older-release-decoding-2026-09-25.md"] }),
      row({ id: "reviter.native-geometry", area: "geometry", implementation: "reviter", status: records ? "partial" : "unsupported", eligible: records,
        scope: "Native surface, drawable and geometry recovery on individually admitted record layouts.",
        limitations: ["Record eligibility is not full geometric fidelity; individual paths have narrower gates.", "Bounds, diagnostic coordinates and proxy meshes are not verified native solids.", "Unresolved geometry must remain visible in per-file coverage and provenance."],
        evidence: ["lib/reviter/native-decoder.ts", "tests/coverage-split.test.ts", "tests/native-supported-pull.test.ts"] }),
      row({ id: "vendored.schema-metadata", area: "metadata", implementation: "vendored-rvt-rs", status: "partial", eligible: true,
        scope: "Optional quickSummary container/schema metadata attempt.",
        limitations: ["May succeed beyond the vendored element reader's release gate.", "WASM traps are caught; metadata success does not enable material or element recovery."],
        evidence: ["lib/reviter/worker.ts", "lib/reviter/reader-support.ts"] }),
      row({ id: "vendored.element-materials", area: "semantics", implementation: "vendored-rvt-rs", status: version != null && standardsReaderSupports(version) ? "experimental" : "unsupported", eligible: version != null && standardsReaderSupports(version),
        scope: `Vendored 0.1.2 optional diagnostics/material reader gated to ${STANDARDS_READER_RANGE_LABEL}.`,
        limitations: ["This is the shipped binary's gate, not Helen's current source capability range.", "The worker uses materials and diagnostics, not the reader's geometry to replace Reviter meshes.", "Materials without a native assignment are definitions, not proof of element assignments."],
        evidence: ["lib/rvt-wasm/package.json", "lib/reviter/worker.ts", "lib/reviter/reader-support.ts"] }),
      row({ id: "reviter.bounded-parser-regressions", area: "safety", implementation: "reviter", status: "partial", eligible: true,
        scope: "Deterministic seeded mutation, truncation and independent zlib compression oracles in ordinary tests.",
        limitations: ["Bounded regression campaigns are not coverage-guided fuzzing or a security proof.", "Parser limits and independent budgets must still be enforced on production input."],
        evidence: ["tests/parser-fuzz-regressions.test.ts", "tests/revit-inflation-bounds.test.ts"] }),
    ],
    caveats: [
      "This manifest describes code eligibility and claim ceilings, not observed recovery for a particular file.",
      "Metadata, semantic and geometry capabilities are independent; no release has a blanket converter-grade claim.",
      "Use conversion coverage and paired authoritative exports to measure actual model fidelity.",
    ],
  };
}
