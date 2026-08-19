/** Display formatting helpers for the studio shell. */

import type { ElementBoundsRecord, Vec3 } from "../../lib/reviter/types.ts";
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
): PropertyRow[] {
  if (!record || !dimensions) return [];

  // A category read from the element's own token is a fact; one taken from a
  // record-code consensus is this decoder's best guess about which cluster
  // the element belongs to. They are shown together and must not read alike.
  const categoryProvenance: PropertyProvenance =
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
    // 6,278 walls. These are read, not derived.
    ...(record.parameters?.map((parameter) => ({
      key: `parameter-${parameter.parameterId}`,
      label: parameter.name,
      value: typeof parameter.value === "string"
        ? parameter.value
        : `${parameter.value.toFixed(4)} ft`,
      provenance: "decoded" as const,
    })) ?? []),
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
