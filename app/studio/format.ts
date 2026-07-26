/** Display formatting helpers for the studio shell. */

import type { CanvasMenuRequest } from "./types.ts";

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
