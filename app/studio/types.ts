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

/**
 * How a displayed property value came to be known.
 *
 * Reviter recovers a proprietary format by measurement, so a value in the
 * palette is not one kind of fact. `decoded` was read out of the file — the
 * element's own category token, its persisted parameter table, the type record
 * its type reference points at. `inferred` was derived when the file did not
 * say: a category taken from a record-code consensus, a body rebuilt or fallen
 * back to an axis-aligned envelope. On the supplied project on 2026-08-19 the
 * split was not marginal — 60.1% of categorised products carried a consensus
 * category rather than their own token, and 7.2% of bodies were a bounds
 * fallback — so a palette that renders both in the same grey text is telling
 * the reader that the decoder is more certain than it is.
 *
 * `edited` is reserved for a value a person asserted over the recovery. Nothing
 * produces it yet; it exists so that the rendering and the clipboard format are
 * settled before the override overlay lands, rather than being retrofitted
 * around whatever the first editor happens to need.
 */
export type PropertyProvenance = "decoded" | "inferred" | "edited";

export type PropertyRow = {
  key: string;
  label: string;
  value: string;
  provenance: PropertyProvenance;
};
export type CategoryRow = { name: string; count: number };
