import type { GeometrySource } from "./types.ts";
import type { ModelViewpoint, Point3Tuple, SectionMode } from "./viewer-tools.ts";
import type { RenderMode } from "../../lib/reviter/viewer.ts";

export type SectionState = { enabled: boolean; mode: SectionMode; offset: number; reverse: boolean };
export type CapturedView = { camera: ModelViewpoint; section: SectionState };
export type SavedReviewView = CapturedView & {
  id: string; name: string; hiddenCategories: string[]; hiddenIds: number[];
  levelId: number | null; isolateLevel: boolean; renderMode: RenderMode;
  referenceHash?: string | null;
};
export type DimensionMode = "distance" | "angle" | "area" | "perimeter" | "coordinates" | "laser";
export type ReviewDimension = {
  id: string; mode: DimensionMode; points: Point3Tuple[];
  space: "model-feet" | "source-scene" | "drawing-units";
  source: GeometrySource | "drawing";
  unit: "feet" | "metres" | "drawing";
  feetPerUnit: number | null; calibration: number;
  provenance: string; createdAt: string;
  referenceHash?: string | null;
};
export type ReviewSession = { format: "reviter-workspace-review"; version: 1; modelHash: string; views: SavedReviewView[]; dimensions: ReviewDimension[] };
export function emptyReview(modelHash: string): ReviewSession {
  return { format: "reviter-workspace-review", version: 1, modelHash, views: [], dimensions: [] };
}
export async function sourceHash(file: Blob): Promise<string> {
  return sourceBytesHash(await file.arrayBuffer());
}
export async function sourceBytesHash(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
const point = (value: unknown): value is Point3Tuple => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const sources: readonly string[] = ["recovered", "reference", "reference-assisted", "reference-model", "overlay"];
export function parseWorkspaceReview(text: string, modelHash: string): ReviewSession {
  if (text.length > 8 * 1024 * 1024) throw new Error("Review exceeds the 8 MB limit.");
  const data = JSON.parse(text) as ReviewSession;
  if (!data || data.format !== "reviter-workspace-review" || data.version !== 1) throw new Error("Unsupported workspace review format.");
  if (!/^sha256-[a-f0-9]{64}$/.test(modelHash) || data.modelHash !== modelHash) throw new Error("This review belongs to a different source file or revision.");
  if (!Array.isArray(data.views) || data.views.length > 100 || !Array.isArray(data.dimensions) || data.dimensions.length > 2000) throw new Error("Invalid review collections.");
  const ids = new Set<string>();
  for (const entry of [...data.views, ...data.dimensions]) {
    if (!entry || typeof entry.id !== "string" || entry.id.length > 100 || ids.has(entry.id)) throw new Error("Invalid or duplicate review identity.");
    ids.add(entry.id);
  }
  for (const view of data.views) {
    if (typeof view.name !== "string" || !view.name.trim() || view.name.length > 120 || !view.camera || !sources.includes(view.camera.source)
      || !point(view.camera.position) || !point(view.camera.target) || !point(view.camera.up)
      || Math.hypot(...view.camera.up) < 1e-8 || !Number.isFinite(view.camera.fov) || view.camera.fov <= 0 || view.camera.fov >= 180
      || !view.section || !["x", "y", "z", "box"].includes(view.section.mode) || typeof view.section.enabled !== "boolean"
      || typeof view.section.reverse !== "boolean" || !Number.isFinite(view.section.offset) || view.section.offset < 0 || view.section.offset > 1
      || !Array.isArray(view.hiddenCategories) || view.hiddenCategories.length > 10000 || !view.hiddenCategories.every(x => typeof x === "string")
      || !Array.isArray(view.hiddenIds) || view.hiddenIds.length > 1000000 || !view.hiddenIds.every(Number.isSafeInteger)
      || (view.levelId !== null && !Number.isSafeInteger(view.levelId)) || typeof view.isolateLevel !== "boolean"
      || (view.referenceHash != null && !/^sha256-[a-f0-9]{64}$/.test(view.referenceHash))
      || !["technical", "xray"].includes(view.renderMode)) throw new Error("Invalid saved view.");
  }
  for (const d of data.dimensions) {
    const count = d?.mode === "angle" ? 3 : d?.mode === "coordinates" ? 1 : d?.mode === "area" || d?.mode === "perimeter" ? null : 2;
    if (!d || !["distance", "angle", "area", "perimeter", "coordinates", "laser"].includes(d.mode)
      || !Array.isArray(d.points) || d.points.length > 1000 || (count ? d.points.length !== count : d.points.length < 3) || !d.points.every(point)
      || !["model-feet", "source-scene", "drawing-units"].includes(d.space) || ![...sources, "drawing"].includes(d.source)
      || (d.space === "drawing-units") !== (d.source === "drawing") || !["feet", "metres", "drawing"].includes(d.unit)
      || (d.source === "reference-model") !== (d.space === "source-scene")
      || (d.referenceHash != null && !/^sha256-[a-f0-9]{64}$/.test(d.referenceHash))
      || !(d.feetPerUnit === null || (Number.isFinite(d.feetPerUnit) && d.feetPerUnit > 0))
      || !Number.isFinite(d.calibration) || d.calibration <= 0 || typeof d.provenance !== "string" || d.provenance.length > 300
      || typeof d.createdAt !== "string" || !Number.isFinite(Date.parse(d.createdAt))) throw new Error("Invalid dimension.");
  }
  return data;
}
export function dimensionValue(d: ReviewDimension): number {
  const [a, b, c] = d.points;
  if (!a) return 0;
  if (d.mode === "coordinates") return 0;
  if (d.mode === "angle") {
    const first = a.map((n, i) => n - b![i]!), second = c!.map((n, i) => n - b![i]!);
    const divisor = Math.hypot(...first) * Math.hypot(...second);
    return divisor ? Math.acos(Math.max(-1, Math.min(1, first.reduce((sum, n, i) => sum + n * second[i]!, 0) / divisor))) * 180 / Math.PI : 0;
  }
  const scale = (d.space === "drawing-units" ? d.feetPerUnit ?? 1 : d.space === "source-scene" ? d.feetPerUnit ?? 1 : 1) * d.calibration;
  if (d.mode === "area") {
    // Drawing areas are in their declared XY plane.
    return Math.abs(d.points.reduce((sum, p, i) => { const next = d.points[(i + 1) % d.points.length]!; return sum + p[0] * next[1] - next[0] * p[1]; }, 0)) / 2 * scale * scale;
  }
  const distance = (p: Point3Tuple, q: Point3Tuple) => Math.hypot(...p.map((n, i) => n - q[i]!));
  if (d.mode === "perimeter") return d.points.reduce((sum, p, i) => sum + distance(p, d.points[(i + 1) % d.points.length]!), 0) * scale;
  return distance(a, b!) * scale;
}
export function dimensionLabel(d: ReviewDimension): string {
  if (d.mode === "angle") return `${dimensionValue(d).toFixed(2)}°`;
  const unknown = (d.space === "drawing-units" || d.space === "source-scene") && d.feetPerUnit === null;
  const unit = unknown ? "units" : d.unit === "metres" ? "m" : "ft";
  const scale = unknown || d.unit !== "metres" ? 1 : 0.3048;
  if (d.mode === "coordinates") {
    const coordinateScale = (d.space === "model-feet" ? 1 : d.feetPerUnit ?? 1) * scale;
    return `${d.points[0]!.map(n => (n * coordinateScale).toFixed(3)).join(", ")} ${unit}`;
  }
  return `${(dimensionValue(d) * (d.mode === "area" ? scale * scale : scale)).toFixed(3)} ${unit}${d.mode === "area" ? "²" : ""}`;
}
