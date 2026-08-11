/**
 * The named plans a DWG already knows about.
 *
 * A survey drawing lays every floor of every building side by side in one model
 * space, and splitting that back up by looking for empty margins is guesswork —
 * scattered annotation bridges the gaps, and nothing in the result has a name.
 * The drawing already carries the answer: each paper-space layout is a sheet
 * with a title ("03 CJMH LVL 1"), and the viewport on that sheet records which
 * rectangle of model space it looks at. Reading those gives both the crop and
 * the name, with no heuristics at all.
 *
 * The viewport stores its centre in display coordinates, as an offset from the
 * view target — `displayCenter` alone lands 38 of this drawing's 54 sheets on
 * empty space, and `targetPoint` alone puts every sheet in the same place. Their
 * sum is the model-space centre.
 *
 * Pure, and takes plain records, so it is testable without a WASM decoder.
 */

import type { DwgBounds } from "./dwg-plan.ts";

export type DwgLayoutRecord = {
  layoutName?: unknown;
  tabOrder?: unknown;
  /** Handle of the paper-space block record that owns this sheet's entities. */
  paperSpaceTableId?: unknown;
};

export type DwgViewportRecord = {
  type?: unknown;
  ownerBlockRecordSoftId?: unknown;
  /** Height of the model-space window, in drawing units. */
  viewHeight?: unknown;
  /** Size of the viewport on the paper sheet; only its ratio is used. */
  width?: unknown;
  height?: unknown;
  displayCenter?: { x?: unknown; y?: unknown } | null;
  targetPoint?: { x?: unknown; y?: unknown } | null;
  viewTwistAngle?: unknown;
};

export type DwgLayoutSheet = {
  /** Position in the returned list; stable for a given drawing. */
  id: number;
  name: string;
  tabOrder: number;
  bounds: DwgBounds;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(value: { x?: unknown; y?: unknown } | null | undefined) {
  if (!value) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  return x == null || y == null ? null : { x, y };
}

/**
 * The model-space rectangle a viewport looks at, or null if it does not say.
 *
 * A twisted viewport looks at a rotated rectangle, which cannot be expressed as
 * bounds. The enclosing axis-aligned box is returned instead: that is a superset,
 * so the sheet may carry a little of its neighbour rather than losing its own
 * edges, which is the safer way to be wrong.
 */
export function dwgViewportWindow(viewport: DwgViewportRecord): DwgBounds | null {
  const viewHeight = finite(viewport.viewHeight);
  const paperWidth = finite(viewport.width);
  const paperHeight = finite(viewport.height);
  const display = point(viewport.displayCenter);
  if (!viewHeight || viewHeight <= 0 || !paperWidth || !paperHeight || paperHeight <= 0) return null;
  if (!display) return null;

  const target = point(viewport.targetPoint) ?? { x: 0, y: 0 };
  const centreX = target.x + display.x;
  const centreY = target.y + display.y;
  let width = viewHeight * (paperWidth / paperHeight);
  let height = viewHeight;
  if (!Number.isFinite(width) || width <= 0) return null;

  const twist = finite(viewport.viewTwistAngle) ?? 0;
  if (Math.abs(twist) > 1e-6) {
    const cos = Math.abs(Math.cos(twist));
    const sin = Math.abs(Math.sin(twist));
    const spanX = width * cos + height * sin;
    const spanY = width * sin + height * cos;
    width = spanX;
    height = spanY;
  }
  return {
    minX: centreX - width / 2,
    minY: centreY - height / 2,
    maxX: centreX + width / 2,
    maxY: centreY + height / 2,
  };
}

/**
 * One sheet per named layout, in tab order.
 *
 * A sheet often holds several viewports — the paper sheet itself, plus detail
 * insets. The largest model window is the plan, which is the one wanted here.
 * The "Model" tab is not a sheet; it is the shared space all of these look at.
 */
export function dwgLayoutSheets(
  layouts: readonly DwgLayoutRecord[],
  viewports: readonly DwgViewportRecord[],
): DwgLayoutSheet[] {
  const byOwner = new Map<string, DwgViewportRecord[]>();
  for (const viewport of viewports) {
    const owner = viewport.ownerBlockRecordSoftId;
    if (typeof owner !== "string") continue;
    const list = byOwner.get(owner);
    if (list) list.push(viewport); else byOwner.set(owner, [viewport]);
  }

  const sheets: Omit<DwgLayoutSheet, "id">[] = [];
  for (const layout of layouts) {
    const name = typeof layout.layoutName === "string" ? layout.layoutName.trim() : "";
    if (!name || name.toLowerCase() === "model") continue;
    const owner = layout.paperSpaceTableId;
    if (typeof owner !== "string") continue;

    let best: DwgBounds | null = null;
    let bestHeight = 0;
    for (const viewport of byOwner.get(owner) ?? []) {
      const height = finite(viewport.viewHeight) ?? 0;
      if (height <= bestHeight) continue;
      const window = dwgViewportWindow(viewport);
      if (!window) continue;
      best = window;
      bestHeight = height;
    }
    if (!best) continue;
    sheets.push({ name, tabOrder: finite(layout.tabOrder) ?? sheets.length, bounds: best });
  }

  return sheets
    .sort((a, b) => a.tabOrder - b.tabOrder || a.name.localeCompare(b.name))
    .map((sheet, id) => ({ ...sheet, id }));
}
