/** Display formatting helpers for the studio shell. */

import { presentedParameters } from "../../lib/reviter/parameter-specs.ts";
import type { ConvertResult, ElementBoundsRecord, Vec3 } from "../../lib/reviter/types.ts";
import type { CanvasMenuRequest, PropertyProvenance, PropertyRow } from "./types.ts";

export type PropertyTextRow = {
  label: string;
  value: string;
  /**
   * Optional so a caller with nothing to say about provenance still type-checks.
   * The studio's palette always sets it, and a paste that dropped the marker
   * would put an inferred category into an issue tracker looking like a read
   * one — which is the whole distinction, lost at exactly the moment the value
   * leaves the application.
   */
  provenance?: PropertyProvenance;
};

/** Describe the geometry that is actually active in the viewport. */
export function propertyGeometryLabel(record: ElementBoundsRecord): string {
  if (record.renderGeometryProvenance === "reference-assisted") return "Paired IFC geometry";
  if (record.renderGeometryProvenance === "native") return "Native RVT face mesh";
  if (record.renderGeometryProvenance === "reconstructed") {
    return record.stairTreads?.length
      ? "Reconstructed stair-run geometry"
      : "Reconstructed RVT geometry";
  }
  if (record.renderGeometryProvenance === "boundary-clipped-proxy") return "Mullion-clipped panel proxy";
  if (record.renderGeometryProvenance === "bounds-fallback") return "Bounds fallback";
  if (record.renderGeometryProvenance === "not-rendered-helper") return "Drawing aid—not rendered";
  return "Not classified";
}

/** State the strongest evidence behind the geometry currently being shown. */
export function propertyEvidenceLabel(record: ElementBoundsRecord): string {
  if (record.renderGeometryProvenance === "reference-assisted") return "Tagged paired IFC body";
  if (record.stairTreads?.length) {
    return record.categorySource === "native-object"
      ? "Native StairsRun sketch and aggregate"
      : "Recovered stair tread sketch";
  }
  if (record.railPath) return "Native railing path";
  if (record.loops?.length) return "Sketch boundary";
  if (record.recordOffset >= 0) return "Duplicated bounds record";
  if (record.orientedBox) return "Placed family instance";
  if (record.solids?.length || record.solid) return "Rebuilt from native surfaces";
  return "Native faces";
}

/**
 * A plain-text version of the properties palette for pasting into an issue,
 * spreadsheet, email, or chat without carrying any of the palette's markup.
 */
export function propertyClipboardText(
  title: string,
  subtitle: string,
  rows: readonly PropertyTextRow[],
): string {
  return [
    title,
    subtitle,
    "",
    ...rows.map(({ label, value, provenance }) =>
      `${label}\t${value}${provenance && provenance !== "decoded" ? `\t(${provenance})` : ""}`),
  ].join("\n");
}

/**
 * The one filter test every list in the studio runs.
 *
 * A trimmed, case-insensitive substring against any field offered, because the
 * thing someone types is as likely to be a category as an id and asking which
 * one they meant is work the interface can do itself. An empty query matches, so
 * an untouched filter is the whole list rather than none of it.
 */
export function matchesFilter(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field != null && String(field).toLowerCase().includes(needle));
}

/** Must match `.canvas-menu` in globals.css: its width, and one item's height. */
export const CANVAS_MENU_WIDTH = 186;
export const CANVAS_MENU_ITEM_HEIGHT = 27;
/**
 * Everything in `.canvas-menu`'s height that is not an item: 4px of padding and
 * a 1px border, twice over. Leaving the border out put a two-item menu opened in
 * the bottom right corner 2px past the viewport's edge.
 */
const CANVAS_MENU_CHROME = 10;

/**
 * Where a right-click menu goes, in the canvas's own pixels.
 *
 * A menu opened near the bottom right corner of the viewport would otherwise
 * hang outside it — the viewport clips its overflow, so the entries nearest the
 * cursor would be the ones that disappeared. The menu is pushed back inside
 * instead, which is what every native context menu does.
 */
export function canvasMenuPosition(request: CanvasMenuRequest, itemCount: number) {
  const height = itemCount * CANVAS_MENU_ITEM_HEIGHT + CANVAS_MENU_CHROME;
  return {
    left: Math.max(0, Math.min(request.x, request.width - CANVAS_MENU_WIDTH)),
    top: Math.max(0, Math.min(request.y, request.height - height)),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1_024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

export function savedFileName(path: string | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null;
}

/**
 * The Revit names of the levels a plan covers, joined; empty when none of them
 * decoded a name. "Floor 1", or "Floor 1 / Floor 1.25" for a split level.
 */
export function levelNames(levels: readonly { name?: string }[]): string {
  return [...new Set(levels.flatMap((level) => (level.name ? [level.name] : [])))].join(" / ");
}

/**
 * The properties palette for one selected element.
 *
 * Category, type and id lead, because that is what a CAD palette answers
 * first; the recovery's own evidence follows, because in this viewer it is a
 * property of the object rather than a footnote about the file.
 *
 * Extracted from the studio's `useMemo` so the provenance rules are testable.
 * Which rows are a read and which are a derivation is the claim this palette
 * makes about the decoder's certainty, and a claim that only exists inside a
 * React hook is a claim nothing checks.
 */
export function propertyRowsFor(
  record: ElementBoundsRecord | null,
  dimensions: Vec3 | null,
  result?: ConvertResult | null,
): PropertyRow[] {
  if (!record || !dimensions) return [];

  // A category read from the element's own token is a fact; one taken from a
  // record-code consensus is this decoder's best guess about which cluster
  // the element belongs to. They are shown together and must not read alike.
  const categoryProvenance: PropertyProvenance =
    record.categorySource === "element-header" ||
    record.categorySource === "native-token" ||
    record.categorySource === "native-object"
      ? "decoded"
      : "inferred";

  // The geometry and evidence rows describe the body in the viewport, so they
  // take the body's provenance: a native face mesh or a tagged paired body is
  // read, everything else — rebuilt, clipped, or an axis-aligned envelope — is
  // derived.
  const geometryProvenance: PropertyProvenance =
    record.renderGeometryProvenance === "native" ||
    record.renderGeometryProvenance === "reference-assisted"
      ? "decoded"
      : "inferred";

  return [
    {
      key: "category",
      label: "Category",
      value: record.categoryName ?? "Uncategorised",
      provenance: categoryProvenance,
    },
    ...(record.familyName
      ? [{
        key: "family",
        label: "Family",
        value: record.familyName,
        provenance: "decoded" as const,
      }]
      : []),
    ...(record.typeName
      ? [{
        key: "type",
        label: "Type",
        value: record.typeName,
        provenance: "decoded" as const,
      }]
      : []),
    {
      key: "element-id",
      label: "Element id",
      value: String(record.elementId),
      provenance: "decoded" as const,
    },
    ...(record.typeId != null
      ? [{
        key: "type-element",
        label: "Type element",
        value: String(record.typeId),
        provenance: "decoded" as const,
      }]
      : []),
    {
      key: "geometry",
      label: "Geometry",
      value: propertyGeometryLabel(record),
      provenance: geometryProvenance,
    },
    {
      key: "evidence",
      label: "Evidence",
      value: propertyEvidenceLabel(record),
      provenance: geometryProvenance,
    },
    ...(record.categoryId != null
      ? [{
        key: "category-id",
        label: "Category ID",
        value: `${record.categoryId}${
          record.categorySource === "record-code-consensus"
            ? " (record-code consensus)"
            : record.categorySource === "element-header"
              ? " (element header)"
              : record.categorySource === "native-object"
                ? " (native object)"
                : " (native token)"
        }`,
        provenance: categoryProvenance,
      }]
      : []),
    ...(record.solid
      ? [{
        key: "native-geometry",
        label: "Native geometry",
        value: `${Math.hypot(
          record.solid.end.x - record.solid.start.x,
          record.solid.end.y - record.solid.start.y,
        ).toFixed(3)} ft long · ${(record.solid.thickness * 304.8).toFixed(0)} mm thick`,
        provenance: "decoded" as const,
      }]
      : []),
    // The parameter table is persisted and its framing is verified: the value
    // under -1001101 reproduced the paired export's swept depth on 6,272 of
    // 6,278 walls. These are read, not derived. Each is shown in the unit its
    // parameter declares; parameters Revit never shows, and values that cannot
    // be what their parameter declares, are left out rather than printed as feet.
    ...parameterRows(record.parameters ?? [], "parameter", ""),
    ...parameterRows(record.typeParameters ?? [], "type-parameter", "Type · "),
    ...sourceElementRows(record, result),
    // Both of these restate the element's own bounds record.
    {
      key: "bounding-size",
      label: "Bounding size",
      value: `${dimensions.x.toFixed(2)} × ${dimensions.y.toFixed(2)} × ${dimensions.z.toFixed(2)} ft`,
      provenance: "decoded" as const,
    },
    {
      key: "minimum-z",
      label: "Minimum Z",
      value: `${record.boundsFeet.min.z.toFixed(3)} ft`,
      provenance: "decoded" as const,
    },
    {
      key: "stream",
      label: "Source stream",
      value: record.stream,
      provenance: "decoded" as const,
    },
    ...(record.chunkIndex >= 0
      ? [{
        key: "chunk",
        label: "Chunk",
        value: record.chunkIndex.toLocaleString(),
        provenance: "decoded" as const,
      }]
      : []),
    ...(record.recordOffset >= 0
      ? [{
        key: "record-offset",
        label: "Record offset",
        value: `0x${record.recordOffset.toString(16)}`,
        provenance: "decoded" as const,
      }]
      : []),
  ];
}


function parameterRows(parameters: NonNullable<ElementBoundsRecord["parameters"]>, prefix: string, labelPrefix: string): PropertyRow[] {
  const grouped = new Map<number, { label: string; values: Set<string> }>();
  for (const parameter of presentedParameters(parameters)) {
    const entry = grouped.get(parameter.parameterId) ?? { label: parameter.label, values: new Set<string>() };
    entry.values.add(parameter.value); grouped.set(parameter.parameterId, entry);
  }
  return [...grouped].map(([id, entry]) => ({ key: `${prefix}-${id}`, label: `${labelPrefix}${entry.label}`, value: `${[...entry.values].join(" / ")}${entry.values.size > 1 ? " (source conflict)" : ""}`, provenance: "decoded" }));
}

/** Selected-element source facts: memberships and stored rooms never grant
 * navigation access, served stops or an indoor enclosure certificate. */
export function sourceElementRows(record: ElementBoundsRecord, result?: ConvertResult | null): PropertyRow[] {
  if (!result) return [];
  const rows: PropertyRow[] = [];
  const add = (key: string, label: string, value: string) => rows.push({ key, label, value, provenance: "decoded" });
  const levelName = (id: number) => result.levels.find(level => level.levelId === id)?.name ?? `Level ${id}`;
  const sem = result.nativeIfcSemanticEvidence?.elements.find(element => element.elementId === record.elementId);
  if (sem) {
    add("source-ifc-class", "IFC source class", sem.ifcClass.entity);
    if (!record.typeName && sem.typeName) add("source-type-name", "Recovered type name", sem.typeName);
    const helpful = new Set(["Shape", "Length", "NominalDiameter", "FireRating", "IsExternal", "LoadBearing", "NumberOfRiser", "RiserHeight", "TreadLength", "Finish", "SerialNumber"]);
    const seen = new Set<string>();
    for (const set of sem.propertySets) for (const property of set.properties) {
      if (!helpful.has(property.name)) continue;
      const identity = `${property.name}:${JSON.stringify(property.value)}:${property.type}`;
      if (seen.has(identity)) continue; seen.add(identity);
      const label = property.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace("Number Of Riser", "Risers");
      const format = (value: string | number | boolean) => typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number"
        ? property.type === "IFCPOSITIVELENGTHMEASURE" || property.type === "IFCLENGTHMEASURE" ? `${formatNumber(value)} m` : String(value)
        : value;
      const values = Array.isArray(property.value) ? property.value.map(format).join(" / ") : format(property.value as string | number | boolean);
      add(`source-property-${set.name}-${property.name}`, `IFC · ${label}`, values);
    }
  }
  const phase = result.nativePhaseEvidence?.elementPhases.find(element => element.elementId === record.elementId);
  if (phase) {
    const name = (id: number | null) => id == null ? "None recorded" : result.nativePhaseEvidence?.phases.find(phase => phase.phaseId === id)?.name ?? `Phase ${id} (name unavailable)`;
    add("created-phase", "Creation phase", name(phase.createdPhaseId));
    add("demolished-phase", "Demolition phase", phase.demolitionKnown ? name(phase.demolishedPhaseId) : "Not recovered");
    add("phase-lifecycle", "Lifecycle", "Phase order and selected export phase required");
  }
  const level = result.nativeAssociatedLevelRelations?.find(relation => relation.elementId === record.elementId);
  if (level) add("source-level", "Source level", levelName(level.levelId));
  const room = result.nativeSourceRooms?.find(room => room.elementId === record.elementId);
  if (room) {
    if (room.number) add("source-room-number", "Room number", room.number);
    if (room.name) add("source-room-name", "Room name", room.name);
    if (room.floorFinish) add("source-room-floor-finish", "Floor finish", room.floorFinish);
    add("source-room-outline", "Stored room outline", room.outlineStatus === "recovered" ? "Recovered · routing needs indoor review" : "Not recovered");
  }
  const systems = result.nativeMepEvidence?.systems.filter(system => system.members.includes(record.elementId)) ?? [];
  if (systems.length) add("source-mep-systems", "System references", systems.map(system => system.name || `Unnamed system ${system.elementId}`).join("; "));
  const ports = result.nativeMepEvidence?.ports?.filter(port => port.elementId === record.elementId) ?? [];
  if (ports.length) add("source-mep-ports", "Recovered ports", String(ports.length));
  const connections = result.nativeMepEvidence?.connections.filter(connection => connection.elementId === record.elementId || connection.otherElementId === record.elementId) ?? [];
  if (connections.length) add("source-mep-connections", "Connector joins", `${connections.length} · direction and port positions unavailable`);
  const dims = result.nativeMepEvidence?.dimensions?.find(dimensions => dimensions.elementId === record.elementId);
  if (dims) for (const [key, label, value, unit] of [
    ["mep-width", "Section width/diameter", dims.widthFeet, "mm"], ["mep-height", "Section height", dims.heightFeet, "mm"],
    ["mep-length", "Source length", dims.lengthFeet, "ft"], ["mep-inner-diameter", "Inside diameter", dims.pipeInnerDiameterFeet, "mm"],
    ["mep-outer-diameter", "Outside diameter", dims.pipeOuterDiameterFeet, "mm"], ["mep-nominal-diameter", "Nominal diameter", dims.nominalDiameterFeet, "mm"],
  ] as const) if (value != null && Number.isFinite(value) && value > 0) add(key, label, `${formatNumber(unit === "mm" ? value * 304.8 : value)} ${unit}`);
  const membership = result.nativeDesignOptionMembership?.find(entry => entry.elementId === record.elementId);
  if (membership) {
    const set = result.nativeDesignOptions?.sets.find(set => set.optionIds.includes(membership.designOptionId));
    add("source-design-option", "Design option", `${set?.name ?? "Option set not recovered"} · option ${membership.designOptionId}${set?.primaryOptionId === membership.designOptionId ? " (primary)" : ""}`);
  }
  return rows;
}

export function sourceSemanticReport(result: ConvertResult): { rows: { label: string; value: string }[]; notes: string[] } {
  const rows: { label: string; value: string }[] = [], notes: string[] = [];
  if (result.fullElementInventory?.status === "decoded") rows.push({ label: "Source table records",
    value: `${result.fullElementInventory.parsedRecordCount.toLocaleString()} rows · ${result.fullElementInventory.declaredElementIds.length.toLocaleString()} declared IDs` });
  const own = result.elementBounds.filter(element => element.parameters?.length), type = result.elementBounds.filter(element => element.typeParameters?.length);
  if (own.length) rows.push({ label: "Instance parameters", value: `${own.reduce((count, element) => count + element.parameters!.length, 0).toLocaleString()} values · ${own.length.toLocaleString()} elements` });
  if (type.length) rows.push({ label: "Type parameters", value: `${type.length.toLocaleString()} elements with recovered type values` });
  if (result.nativeIfcSemanticEvidence?.elements.length) rows.push({ label: "IFC source properties", value: `${result.nativeIfcSemanticEvidence.elements.length.toLocaleString()} element identities` });
  if (result.nativeSourceRooms?.length) {
    rows.push({ label: "Native rooms", value: `${result.nativeSourceRooms.length.toLocaleString()} identities · ${result.nativeSourceRooms.filter(room => room.outline).length.toLocaleString()} stored outlines` });
    notes.push("Room routing requires indoor review.");
  }
  if (result.nativePhaseEvidence?.elementPhases.length) {
    rows.push({ label: "Phase records", value: `${result.nativePhaseEvidence.phases.length.toLocaleString()} named phases · ${result.nativePhaseEvidence.elementPhases.length.toLocaleString()} elements` });
    notes.push("Lifecycle requires proven phase order and a selected export phase.");
  }
  if (result.nativeMepEvidence) {
    rows.push({ label: "Building systems", value: `${result.nativeMepEvidence.systems.length.toLocaleString()} system records · ${result.nativeMepEvidence.connections.length.toLocaleString()} connector joins` });
    notes.push("System membership uses source references; some may include nonphysical records. Flow direction and port positions are unavailable.");
  }
  if (result.nativeDesignOptions?.sets.length) rows.push({ label: "Design alternatives", value: `${result.nativeDesignOptions.sets.length} option sets · ${result.nativeDesignOptions.unresolvedSets.length} unresolved` });
  const metadata = result.documentMetadata;
  if (metadata?.title) rows.push({ label: "Document title", value: metadata.title });
  if (metadata?.workshared != null) rows.push({ label: "Worksharing", value: metadata.workshared ? "Workshared" : "Single document" });
  if (metadata?.projectParameters.length) rows.push({ label: "Project properties", value: `${metadata.projectParameters.length} source values` });
  if (result.nativeIfcSemanticEvidence?.limitations.some(note => /disagreed|conflict|omitted|outside/.test(note))) notes.push("Some IFC property values could not be established or had conflicting source evidence.");
  return { rows, notes };
}
