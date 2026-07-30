/** View-model types shared by the studio shell and its panels. */
import type { CameraPreset } from "../../lib/reviter";

export type Phase = "idle" | "reading" | "converting" | "ready" | "error";
export type ReferencePhase = "idle" | "reading" | "ready" | "error";
export type GeometrySource = "reference-model" | "reference" | "recovered" | "overlay";
export type ViewerPanel = "none" | "model" | "properties" | "categories";
export type CameraRequest = { preset: CameraPreset; sequence: number; fit?: boolean };
/**
 * A right-click on the canvas: what was under it, where it happened in the
 * canvas's own pixels, and how big the canvas was — the size is what lets the
 * menu be clamped inside the viewport instead of hanging off its edge.
 */
export type CanvasMenuRequest = {
  elementId: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ReferenceLoadState = "idle" | "loading" | "ready" | "error";
export type ReviterGlobal = typeof globalThis & {
  __REVITER_STATIC_WORKERS__?: { rvt?: string; ifc?: string };
};
