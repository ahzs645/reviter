/** Executable support ceilings, not a per-file recovery or completeness report. */
import { DesignOptionsCollector } from "./design-options.ts";
import { revitIfcGlobalIdFromUniqueId, IfcExportParameterCollector } from "./revit-ifc-semantics.ts";
import { standardIfcPropertySets } from "./ifc-standard-properties.ts";
import { nativePhaseLayout } from "./native-phases.ts";
import { NATIVE_ROOM_CATEGORY, ROOM_OUTLINE_RELEASES } from "./native-rooms.ts";
import type { SchemaSummary } from "./schema.ts";
import type { SchemaStreamClass } from "./schema-reader.ts";
import type { ElementHeader } from "./element-headers.ts";
import type { ElementParameter } from "./element-parameters.ts";
import type { NativeMepElementKind } from "./native-mep.ts";
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

/** Actual source inputs, not booleans inferred from a successful container open. */
export type CapabilitySourceEvidence = {
  schema?: SchemaSummary;
  schemaClasses?: readonly SchemaStreamClass[];
  /** UniqueIds already joined to native creation episode and original id. */
  nativeUniqueIds?: readonly string[];
  /** Parameters recovered from an independently owned element table. */
  ownedParameters?: readonly ElementParameter[];
  nativeTypeName?: string;
  ifcEntity?: string;
  nativePhaseNames?: ReadonlyMap<number, string>;
  roomHeaders?: readonly ElementHeader[];
  /** Matching source Room record bounds, never proxy or diagnostic envelopes. */
  roomBoundsElementIds?: ReadonlySet<number>;
  /** Categories independently established by native source evidence. */
  mepElementKinds?: ReadonlyMap<number, NativeMepElementKind>;
};

/**
 * The narrow-id flag must come from this file's parsed schema, never its year.
 * Eligibility permits a decoder attempt; status is its maximum product claim.
 * No open/metadata result can promote semantic or geometry recovery.
 */
export function capabilityManifest(
  release?: number | null,
  schemaDeclaresNarrowIds = false,
  source: CapabilitySourceEvidence = {},
): CapabilityManifest {
  const version = Number.isInteger(release) && release! > 0 ? release! : null;
  const wide = usesRevit2027RecordLayout(version);
  const narrow = version != null && version >= NARROW_ID_RECORD_LAYOUT_FIRST_RELEASE &&
    version < REVIT_2027_RECORD_LAYOUT_FIRST_RELEASE && schemaDeclaresNarrowIds;
  const records = wide || narrow;
  const designOptions = new DesignOptionsCollector({ revitVersion: version, schema: source.schema }).finish().status === "supported";
  const identity = source.nativeUniqueIds?.some((id) => revitIfcGlobalIdFromUniqueId(id) != null) ?? false;
  const overrides = new IfcExportParameterCollector();
  overrides.add(1, source.ownedParameters ?? []);
  const hasOverrides = overrides.entries().length > 0;
  const properties = source.ifcEntity != null && standardIfcPropertySets(source.ifcEntity,
    { parameters: source.ownedParameters, typeName: source.nativeTypeName }, source.nativePhaseNames).length > 0;
  const phases = version != null && nativePhaseLayout(version, source.schemaClasses ?? []) != null;
  const rooms = records && (source.roomHeaders?.some((header) => header.categoryId === NATIVE_ROOM_CATEGORY &&
    header.familyId == null && header.ownerViewId == null && header.unplacedOwnerId == null) ?? false);
  const outlines = rooms && (ROOM_OUTLINE_RELEASES as readonly number[]).includes(version ?? 0) &&
    (source.roomHeaders?.some((header) => header.categoryId === NATIVE_ROOM_CATEGORY &&
      header.familyId == null && header.ownerViewId == null && header.unplacedOwnerId == null &&
      source.roomBoundsElementIds?.has(header.elementId)) ?? false);
  const classNames = new Set(source.schema?.taggedClasses.map((entry) => entry.name));
  const categorizedMep = (source.mepElementKinds?.size ?? 0) > 0;
  const mepSystems = wide && categorizedMep && ["RbsHvacSystem", "RbsPipingSystem", "RbsElectricalSystem"].some((name) => classNames.has(name));
  const mepConnectors = version === 2025 && categorizedMep && classNames.has("RbsCurveConnectorManager");
  const row = (value: CapabilityContract): CapabilityContract => value;
  return {
    schemaVersion: 1,
    release: version,
    narrowElementIds: schemaDeclaresNarrowIds,
    capabilities: [
      row({ id: "reviter.ifc-revit-globalids", area: "semantics", implementation: "reviter", status: identity ? "partial" : "unsupported", eligible: identity,
        scope: "Revit-compatible IFC GlobalIds from validated native creation-episode GUID and original element id.",
        limitations: ["Requires an independently joined native UniqueId; current element id alone is insufficient.", "Invalid or missing source identity uses the existing deterministic fallback; byte opening does not prove identity parity."],
        evidence: ["lib/reviter/revit-ifc-semantics.ts", "tests/revit-ifc-semantics.test.ts"] }),
      row({ id: "reviter.ifc-export-overrides", area: "semantics", implementation: "reviter", status: hasOverrides ? "partial" : "unsupported", eligible: hasOverrides,
        scope: "Owned instance/type IFC export parameters with instance precedence and bounded entity/predefined-type validation.",
        limitations: ["Eligibility requires a recognized value from an owned native parameter table.", "Unsupported entities/enums retain the category default; arbitrary IFC entity emission is not supported.", "Conflicting repeated parameters remain unresolved."],
        evidence: ["lib/reviter/revit-ifc-semantics.ts", "tests/revit-ifc-semantics.test.ts"] }),
      row({ id: "reviter.ifc-standard-properties", area: "semantics", implementation: "reviter", status: properties ? "partial" : "unsupported", eligible: properties,
        scope: "Selected IFC common property sets from explicit owned built-in parameters or a decoded native type-name relationship.",
        limitations: ["Requires an admitted IFC entity and at least one supported explicit source property.", "Missing values are omitted; display labels, geometry and category guesses cannot establish property values.", "No blanket standard-property completeness claim; raw Revit parameters retain their provenance."],
        evidence: ["lib/reviter/ifc-standard-properties.ts", "tests/ifc-standard-properties.test.ts"] }),
      row({ id: "reviter.native-phases", area: "semantics", implementation: "reviter", status: phases ? "partial" : "unsupported", eligible: phases,
        scope: "2024, 2025 and 2027 native phase names and explicit created/demolished references after exact schema admission.",
        limitations: ["Requires the file's full Element, ProjectPhase and CellList field declarations, not class-name presence alone.", "Independent element identity/category joins and record framing are still required.", "Phase order, view phase filters and inferred existing/new/demolished status are not decoded."],
        evidence: ["lib/reviter/native-phases.ts", "tests/native-phases.test.ts"] }),
      row({ id: "reviter.native-design-options", area: "semantics", implementation: "reviter", status: designOptions ? "partial" : "unsupported", eligible: designOptions,
        scope: "2024–2026 primary option sets admitted by the file's measured ElementHeader/Outline/ElementParents schema.",
        limitations: ["Set membership must join the leading partition chain and counted option/name entry.", "Alternatives remain visible by default; explicit primary selection retains unresolved or conflicting evidence.", "2027 and narrow-id releases are not admitted by this decoder."],
        evidence: ["lib/reviter/design-options.ts", "tests/design-options.test.ts"] }),
      row({ id: "reviter.native-room-identities", area: "semantics", implementation: "reviter", status: rooms ? "partial" : "unsupported", eligible: rooms,
        scope: "Source-authored Room identity from native room-category ElementHeaders, separate from reviewed indoor rooms.",
        limitations: ["Requires an admitted native record layout and independently decoded room header without family/view/unplaced ownership.", "Room identity may exist without a box, name or stored outline.", "Source room evidence never certifies enclosure, public access or navigation."],
        evidence: ["lib/reviter/native-rooms.ts", "tests/native-rooms.test.ts"] }),
      row({ id: "reviter.native-room-stored-outlines", area: "geometry", implementation: "reviter", status: outlines ? "experimental" : "unsupported", eligible: outlines,
        scope: "Measured 2023–2025 stored Room solid-face outlines with independently matching room identity and record bounds.",
        limitations: ["Source identity alone cannot enable outlines; matched native record bounds are required.", "Curved/unsupported faces, missing solids and ambiguous ring joins remain unresolved.", "Stored outlines are unreviewed source evidence and do not alter navigation or certify usable room enclosure."],
        evidence: ["lib/reviter/native-rooms.ts", "tests/native-rooms.test.ts"] }),
      row({ id: "reviter.native-mep-membership-candidates", area: "semantics", implementation: "reviter", status: mepSystems ? "experimental" : "unsupported", eligible: mepSystems,
        scope: "2024–2027 native system records and candidate membership from exact object-id references.",
        limitations: ["Requires source system schema classes and independently categorized native MEP elements.", "Checksum-verified object references are membership candidates, not a decoded membership field or proven service assignment.", "Spatial proximity and display categories cannot prove system topology.", "Collection requires ConvertOptions.experimentalMep; IFC export requires includeExperimentalMep, both opt-in."],
        evidence: ["lib/reviter/native-mep.ts", "tests/native-mep.test.ts"] }),
      row({ id: "reviter.native-mep-connector-packets", area: "semantics", implementation: "reviter", status: mepConnectors ? "experimental" : "unsupported", eligible: mepConnectors,
        scope: "Measured 2025 curve/fitting connector packets with independently categorized endpoint elements.",
        limitations: ["Requires RbsCurveConnectorManager in the file's schema and source endpoint categories.", "Other releases are unsupported; this is not a complete family or network graph.", "No connector position, flow or spatially inferred port is invented.", "Collection and IFC export require separate experimental opt-ins."],
        evidence: ["lib/reviter/native-mep.ts", "tests/native-mep.test.ts"] }),
      row({ id: "reviter.native-mep-family-graphs", area: "semantics", implementation: "reviter", status: "unsupported", eligible: false,
        scope: "Family symbol/instance connector graphs are not decoded.",
        limitations: ["Curve/fitting packets and system reference candidates cannot promote family connector graph support."],
        evidence: ["lib/reviter/native-mep.ts", "tests/native-mep.test.ts"] }),
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
