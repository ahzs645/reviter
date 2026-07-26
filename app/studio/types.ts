/** View-model types shared by the studio shell and its panels. */
import type { CameraPreset } from "../../lib/reviter";

export type Phase = "idle" | "reading" | "converting" | "ready" | "error";
export type ReferencePhase = "idle" | "reading" | "ready" | "error";
export type GeometrySource = "autodesk" | "reference" | "recovered" | "overlay";
export type ViewerPanel = "none" | "model" | "properties" | "categories";
export type CameraRequest = { preset: CameraPreset; sequence: number };
export type ReferenceLoadState = "idle" | "loading" | "ready" | "error";
export type ReviterGlobal = typeof globalThis & {
  __REVITER_STATIC_WORKERS__?: { rvt?: string; ifc?: string };
};
