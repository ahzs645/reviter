/**
 * Testable decoder admission contracts. An admitted decoder still has to prove
 * each record's framing and ownership; admission is not model-wide support.
 * Paired corpus measurements are deliberately separate from synthetic tests.
 */
import type { ElementIdBytes } from "./element-id-width.ts";

export type CapabilityId =
  | "element-records"
  | "native-identities"
  | "ifc-export-overrides"
  | "room-identities"
  | "stored-room-outlines"
  | "mep-systems"
  | "mep-connectors"
  | "mep-model-ports-and-joins"
  | "mep-source-dimensions"
  | "primary-design-options";

export type CapabilityContract = {
  id: CapabilityId;
  /** Exact releases admitted by this decoder, not a min/max interpolation. */
  admittedReleases: readonly number[];
  /** Releases with the concrete corpus observations described by evidence. */
  measuredReleases: readonly number[];
  requiredEvidence: readonly string[];
  evidence: string;
  limitations: string;
  tests: readonly string[];
};

const NARROW_RELEASES = [2019, 2020, 2021, 2022, 2023] as const;
const WIDE_RELEASES = [2024, 2025, 2026, 2027] as const;
const RECORD_RELEASES = [...NARROW_RELEASES, ...WIDE_RELEASES];

export const REVITER_CAPABILITY_CONTRACTS: readonly CapabilityContract[] = [
  {
    id: "element-records",
    admittedReleases: RECORD_RELEASES,
    measuredReleases: [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2027],
    requiredEvidence: ["record-framing"],
    evidence: "revit-class-tags.ts documents RAC 2019–2023 comparisons; element-headers.ts documents Snowdon 2024, RAC/technical school 2025 and UNBC 2027 category joins.",
    limitations: "Selected narrow-ID decoders only. Category/record recovery does not certify surfaces, completeness, or geometry accuracy. 2026 admission is not a paired geometry measurement.",
    tests: ["tests/element-headers.test.ts", "tests/convert-rvt-bytes-rich.test.ts"],
  },
  {
    id: "native-identities",
    admittedReleases: RECORD_RELEASES,
    measuredReleases: [2023, 2024, 2025, 2026, 2027],
    requiredEvidence: ["complete-history", "complete-element-history"],
    evidence: "native-identity.ts documents Autodesk UniqueId joins for 2023–2025, RAC 2026/2025 identity agreement, and the original 2027 layout.",
    limitations: "Requires recognized History format, complete stream shapes and creation-history invariants. Earlier admitted releases have schema/layout evidence, not separate paired UniqueId measurements here.",
    tests: ["tests/native-identity.test.ts", "tests/capabilities.test.ts"],
  },
  {
    id: "ifc-export-overrides",
    admittedReleases: [2024, 2025, 2026],
    measuredReleases: [2024, 2025],
    requiredEvidence: ["ifc-parameter-header", "declared-parameter-owner", "bounded-ifc-override"],
    evidence: "rvt-rs RE-45 documents measured 2024/2025 scanning; the 2026 header is supplied upstream and tested synthetically. This contract does not claim positive override counts on paired full models.",
    limitations: "The native byte scanner recovers class/predefined-type strings; numeric Export to IFC flags come from owned generic parameter tables, with conflicting witnesses preserved before parameter merging. Declared-ID ownership, bounded owner window and allowlisted values are required. Two conflicting values are retained as ambiguity evidence and cannot authorize an override; unknown entities/predefined types are not emitted.",
    tests: ["tests/ifc-export-semantics.test.ts"],
  },
  {
    id: "room-identities",
    admittedReleases: RECORD_RELEASES,
    measuredReleases: [],
    requiredEvidence: ["room-category", "placed-model-owner"],
    evidence: "Source rooms use the already admitted ElementHeader category and ownership evidence; no separate paired full-model room validation is claimed by this contract.",
    limitations: "Identity can survive missing bounds. It does not imply an outline, enclosed room, routing access, or certification.",
    tests: ["tests/native-source-rooms.test.ts"],
  },
  {
    id: "stored-room-outlines",
    admittedReleases: [2023, 2024, 2025],
    measuredReleases: [2023, 2024, 2025],
    requiredEvidence: ["room-category", "placed-model-owner", "owner-confirmed-solid", "valid-room-topology"],
    evidence: "rvt-rs 1c3d337 stored room-solid layouts measured in releases 2023–2025; Reviter's port has synthetic regression checks, with paired project validation tracked separately.",
    limitations: "Stored outlines are source evidence, never certified routing boundaries. Conflicting solids, open/crossing/touching loops and unsupported layouts yield no outline.",
    tests: ["tests/native-source-rooms.test.ts"],
  },
  {
    id: "mep-systems",
    admittedReleases: WIDE_RELEASES,
    measuredReleases: [2025],
    requiredEvidence: ["mep-system-schema", "owner-confirmed-system"],
    evidence: "rvt-rs RE-162 system record evidence was measured in RE1 2025. Schema-based 2024–2027 admission does not establish paired full-model membership coverage.",
    limitations: "References have payload evidence rather than a fully decoded membership field. Adler32 and frame echoes must agree; page-spanning records fail closed. A system reference does not prove a physical connector.",
    tests: ["tests/native-mep.test.ts"],
  },
  {
    id: "mep-connectors",
    admittedReleases: [2025],
    measuredReleases: [2025],
    requiredEvidence: ["owner-confirmed-connector", "validated-connector-layout"],
    evidence: "rvt-rs 1c3d337 native connector byte-layout evidence is measured in 2025; cross-release connector layout support is not inferred.",
    limitations: "This is the direct byte-list reader, admitted only for measured 2025 joins. RE-171 graph and family-symbol ports use a separate pinned-model projection contract; no general native graph is decoded by this TS reader. Geometry proximity does not create connectivity.",
    tests: ["tests/native-mep.test.ts"],
  },
  {
    id: "mep-model-ports-and-joins",
    admittedReleases: [2024, 2025, 2026],
    measuredReleases: [2025],
    requiredEvidence: ["pinned-reader-commit", "same-source-model", "declared-entity-owner", "unambiguous-connector-endpoints"],
    evidence: "Pinned rvt-rs model production uses RE-169/171 with counted-list fallback. Mechanical/Plumbing/Electrical 2025 fixtures provide positive port/join witnesses; 2024/2026 admission is not a paired positive claim here.",
    limitations: "Model indices map to exact declared BuildingElement IDs; binary byte spans and the individual producer decoder path are not exposed. Flow direction, placement and general raw native graph coverage remain unresolved.",
    tests: ["tests/native-mep-model.test.ts"],
  },
  {
    id: "mep-source-dimensions",
    admittedReleases: [2025],
    measuredReleases: [2025],
    requiredEvidence: ["measured-dimension-layout", "declared-dimension-owner", "dimension-extent-agreement"],
    evidence: "Native source curve/fitting dimension readers RE-134/157/165 and RE-131 pipe-axis proof are measured in 2025, with positive Mechanical/Plumbing reference witnesses.",
    limitations: "Nominal dimensions are separate from body radius/width. Conflicting ownership/extent evidence is omitted, and source dimension metadata does not replace the geometry pipeline.",
    tests: ["tests/native-mep-dimensions.test.ts"],
  },
  {
    id: "primary-design-options",
    admittedReleases: [2024, 2025],
    measuredReleases: [2024],
    requiredEvidence: ["design-option-set", "explicit-primary-option"],
    evidence: "Upstream's positive primary-option record evidence is 2024. A 2025 layout gate does not establish positive paired selection coverage.",
    limitations: "Requires an explicit primary flag and an unambiguous option-set join. Unresolved options must not be guessed or silently hidden.",
    tests: ["tests/design-options.test.ts"],
  },
];

export type CapabilityContext = {
  revitVersion: number | null;
  /** Null means the schema did not declare an Identifier width. */
  schemaElementIdBytes: ElementIdBytes | null;
  evidence: ReadonlySet<string>;
};

export type CapabilityAdmission = {
  id: CapabilityId;
  admitted: boolean;
  missing: string[];
  corpusMeasuredRelease: boolean;
};

/** Pure admission check: does not modify the converter's module-level gates. */
export function evaluateCapability(
  id: CapabilityId,
  context: CapabilityContext,
): CapabilityAdmission {
  const contract = REVITER_CAPABILITY_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown capability: ${id}`);
  const version = context.revitVersion;
  const releaseAdmitted = version != null && Number.isInteger(version) &&
    contract.admittedReleases.includes(version);
  const missing = releaseAdmitted ? [] : ["admitted-release"];
  // Every narrow record decoder requires the actual file's int32 schema.
  // Wide decoders retain their existing default when Identifier is absent,
  // but an explicitly conflicting schema is never admitted by this contract.
  if (releaseAdmitted && (
    (version! < 2024 && context.schemaElementIdBytes !== 4) ||
    (version! >= 2024 && context.schemaElementIdBytes === 4)
  )) missing.push("schema-element-id-width");
  for (const requirement of contract.requiredEvidence) {
    if (!context.evidence.has(requirement)) missing.push(requirement);
  }
  return {
    id,
    admitted: missing.length === 0,
    missing,
    corpusMeasuredRelease: version != null && contract.measuredReleases.includes(version),
  };
}

/** A serializable per-file snapshot; callers supply their proven evidence. */
export function capabilitySnapshot(context: CapabilityContext): {
  contractVersion: 1;
  revitVersion: number | null;
  schemaElementIdBytes: ElementIdBytes | null;
  capabilities: CapabilityAdmission[];
} {
  return {
    contractVersion: 1,
    revitVersion: context.revitVersion,
    schemaElementIdBytes: context.schemaElementIdBytes,
    capabilities: REVITER_CAPABILITY_CONTRACTS.map((contract) => evaluateCapability(contract.id, context)),
  };
}
