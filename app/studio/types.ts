/** View-model types shared by the studio shell and its panels. */
import type { CameraPreset } from "../../lib/reviter";

export type Phase = "idle" | "reading" | "converting" | "ready" | "error";
export type ReferencePhase = "idle" | "reading" | "ready" | "error";
export type GeometrySource =
  | "reference-model"
  | "reference"
  | "recovered"
  | "reference-assisted"
  | "overlay";
export type CameraRequest = { preset: CameraPreset; sequence: number; fit?: boolean };
/**
 * A right-click on the canvas: what was under it, where it happened in the
 * canvas's own pixels, and how big the canvas was — the size is what lets the
 * menu be clamped inside the viewport instead of hanging off its edge.
 */
export type CanvasMenuRequest = {
  elementId: number | null;
  /** Scene-space surface under the menu, used by “Walk from here”. */
  walkPoint?: [number, number, number];
  walkNormal?: [number, number, number];
  x: number;
  y: number;
  width: number;
  height: number;
};
export type WalkStartRequest = {
  point: [number, number, number] | null;
  normal: [number, number, number] | null;
  sequence: number;
};
export type ReferenceLoadState = "idle" | "loading" | "ready" | "error";
export type ReviterGlobal = typeof globalThis & {
  __REVITER_STATIC_WORKERS__?: {
    rvt?: string;
    ifc?: string;
    dwg?: string;
    plan?: string;
    regions?: string;
  };
};

/** Dark is the default; the choice is written to <html data-theme> and stored. */
export type Theme = "dark" | "light";

/**
 * The left dock's three views. They replace the old mutually exclusive
 * `viewerPanel` overlays: the docks are independent now, so what varies here is
 * only which list the Browser is showing.
 */
export type BrowserTab = "objects" | "categories" | "comments";

/**
 * The report dock's tabs. `toolkit` is not one of the four report views — it
 * holds the local-file utilities (family library, DWG preview, OmniClass,
 * shared parameters, legacy API) that used to live in the removed left rail and
 * are about files on disk rather than about the open model.
 */
export type ReportTab = "summary" | "coverage" | "streams" | "exports" | "toolkit";

/** Primary desktop surfaces selected from the persistent bottom switcher. */
export type StudioWorkspace = "model" | "floors";

export type CommentFilter = "open" | "resolved" | "all";

/** Mobile only: which panel is raised over the viewport. */
export type MobileSheet = "model" | "comments" | "properties" | "map" | "report";

export type PropertyRow = { key: string; label: string; value: string };
export type CategoryRow = { name: string; count: number };
