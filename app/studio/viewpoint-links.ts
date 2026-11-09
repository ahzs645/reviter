/**
 * Local fragment viewer links, inspired by rvt-rs ifc/share.rs (1c3d337,
 * Apache-2.0; docs/third-party/rvt-rs). Uses Reviter's comment camera frame.
 * Unlike upstream optional identity, matching source-byte SHA256 is required.
 * No filename, local path, source bytes or asset URL is encoded. Review markup is explicit opt-in.
 * V2 adds bounded category visibility and existing model-bounds section controls.
 */
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { roomModelFingerprint } from "./review-exchange.ts";
import { modelFeetToScenePoint, scenePointToModelFeet, type ModelViewpoint, type Point3Tuple, type MarkupStroke } from "./viewer-tools.ts";

export const VIEWPOINT_FRAGMENT_PREFIX = "#reviter-view=";
export const VIEWPOINT_FRAGMENT_MAX_CHARS = 4096;
const MAX_WORLD_FEET = 100_000_000;
const HASH = /^sha256-[0-9a-f]{64}$/;
const REVIEW_HASH = /^fnv1a32-[0-9a-f]{8}$/;
export type ViewpointModelIdentity = { fingerprint: string; reviewFingerprint: string; originFeet: Point3Tuple; elementIds?: ReadonlySet<number> };
export type PortableSectionState = { enabled: boolean; mode: "x" | "y" | "z" | "box"; offset: number; reverse: boolean };
export type PortableReviewMarkup = { id: string; tool: MarkupStroke["tool"]; pointsFeet: Point3Tuple[]; color: string; weightFeet: number; text?: string };
export type PortableViewerState = { hiddenCategories: string[]; section: PortableSectionState; selectedElementId?: number | null; renderMode?: "technical" | "xray"; annotations?: PortableReviewMarkup[] };
export const VIEWPOINT_MAX_ANNOTATIONS = 16;
export const VIEWPOINT_MAX_MARKUP_POINTS = 128;
export const VIEWPOINT_MAX_MARKUP_TEXT = 256;
export const VIEWPOINT_MAX_HIDDEN_CATEGORIES = 64;
export const VIEWPOINT_MAX_CATEGORY_CHARS = 96;
export type PortableViewpoint = {
  format: "reviter-viewpoint";
  version: 1 | 2 | 3;
  sourceFingerprint: string;
  reviewFingerprint: string;
  coordinateSystem: "revit-model-feet";
  sourceOriginFeet: Point3Tuple;
  camera: { positionFeet: Point3Tuple; targetFeet: Point3Tuple; up: Point3Tuple; fov: number };
  /** Present in v2 and v3; v1 remains camera-only. */
  viewer?: PortableViewerState;
};
export type ViewpointImport =
  | { status: "empty"; message: string }
  | { status: "invalid"; message: string }
  | { status: "pending-model"; message: string; viewpoint: PortableViewpoint }
  | { status: "wrong-model"; message: string }
  | { status: "ready"; message: string; viewpoint: PortableViewpoint; camera: ModelViewpoint };

/** Hash locally; callers may reuse an existing verified source-byte hash. */
export async function viewpointSourceFingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return `sha256-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function makeViewpointModelIdentity(result: ConvertResult, sourceFingerprint: string): ViewpointModelIdentity {
  const fingerprint = sourceFingerprint.startsWith("sha256-") ? sourceFingerprint : `sha256-${sourceFingerprint}`;
  if (!HASH.test(fingerprint)) throw new Error("Viewpoint links need a SHA-256 fingerprint of the source model bytes.");
  const originFeet: Point3Tuple = [result.origin.x, result.origin.y, result.origin.z];
  if (!point(originFeet)) throw new Error("The open model has an invalid source origin.");
  return { fingerprint, reviewFingerprint: roomModelFingerprint(result), originFeet, elementIds: new Set([...result.elementBounds.map(record => record.elementId), ...(result.meshes ?? []).flatMap(mesh => Array.from(mesh.elementIds ?? []))]) };
}
function point(value: unknown): value is Point3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate) && Math.abs(coordinate) <= MAX_WORLD_FEET);
}
function normalizeCamera(camera: unknown): PortableViewpoint["camera"] | undefined {
  if (!camera || typeof camera !== "object") return undefined;
  const row = camera as Partial<PortableViewpoint["camera"]>;
  if (!point(row.positionFeet) || !point(row.targetFeet) || !point(row.up) || typeof row.fov !== "number" || !Number.isFinite(row.fov) || row.fov <= 0) return undefined;
  const upLength = Math.hypot(...row.up);
  const direction = row.targetFeet.map((value, axis) => value - row.positionFeet![axis]!) as Point3Tuple;
  const distance = Math.hypot(...direction);
  if (upLength < 1e-12 || distance < 1e-6) return undefined;
  const up = row.up.map(value => value / upLength) as Point3Tuple;
  const alignment = Math.abs(up.reduce((sum, value, axis) => sum + value * direction[axis]! / distance, 0));
  if (alignment > 1 - 1e-8) return undefined;
  return { positionFeet: [...row.positionFeet], targetFeet: [...row.targetFeet], up, fov: Math.min(120, Math.max(5, row.fov)) };
}
function normalizeAnnotation(value: unknown): PortableReviewMarkup | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PortableReviewMarkup>;
  if (typeof row.id !== "string" || !/^[A-Za-z0-9:_-]{1,96}$/u.test(row.id) ||
      !["pencil", "arrow", "cloud", "text"].includes(row.tool ?? "") || !Array.isArray(row.pointsFeet) ||
      !row.pointsFeet.length || row.pointsFeet.length > VIEWPOINT_MAX_MARKUP_POINTS || !row.pointsFeet.every(point) ||
      typeof row.color !== "string" || !/^#[a-fA-F0-9]{6}$/u.test(row.color) ||
      typeof row.weightFeet !== "number" || !Number.isFinite(row.weightFeet) || row.weightFeet <= 0 || row.weightFeet > 1000 ||
      (row.text !== undefined && (typeof row.text !== "string" || row.text.length > VIEWPOINT_MAX_MARKUP_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(row.text)))) return undefined;
  return { id: row.id, tool: row.tool!, pointsFeet: row.pointsFeet.map(p => [...p]), color: row.color.toLowerCase(), weightFeet: row.weightFeet, ...(row.text === undefined ? {} : { text: row.text }) };
}
function normalizeViewer(value: unknown): PortableViewerState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PortableViewerState>;
  if (!Array.isArray(row.hiddenCategories) || row.hiddenCategories.length > VIEWPOINT_MAX_HIDDEN_CATEGORIES ||
      row.hiddenCategories.some(category => typeof category !== "string" || category.length === 0 || category.length > VIEWPOINT_MAX_CATEGORY_CHARS || /[\u0000-\u001f\u007f]/u.test(category))) return undefined;
  const section = row.section;
  if (!section || typeof section !== "object" || typeof section.enabled !== "boolean" || typeof section.reverse !== "boolean" ||
      !["x", "y", "z", "box"].includes(section.mode) || typeof section.offset !== "number" || !Number.isFinite(section.offset) || section.offset < 0 || section.offset > 1) return undefined;
  if (row.selectedElementId !== undefined && row.selectedElementId !== null && (!Number.isSafeInteger(row.selectedElementId) || row.selectedElementId <= 0)) return undefined;
  if (row.renderMode !== undefined && row.renderMode !== "technical" && row.renderMode !== "xray") return undefined;
  let annotations: PortableReviewMarkup[] | undefined;
  if (row.annotations !== undefined) {
    if (!Array.isArray(row.annotations) || row.annotations.length > VIEWPOINT_MAX_ANNOTATIONS) return undefined;
    const normalized = row.annotations.map(normalizeAnnotation);
    if (normalized.some(annotation => !annotation)) return undefined;
    annotations = normalized as PortableReviewMarkup[];
    if (new Set(annotations.map(annotation => annotation.id)).size !== annotations.length || annotations.reduce((count, annotation) => count + annotation.pointsFeet.length, 0) > VIEWPOINT_MAX_MARKUP_POINTS) return undefined;
  }
  return { hiddenCategories: [...new Set(row.hiddenCategories)].sort(),
    ...(row.selectedElementId === undefined ? {} : { selectedElementId: row.selectedElementId }),
    ...(row.renderMode === undefined ? {} : { renderMode: row.renderMode }), ...(annotations === undefined ? {} : { annotations }),
    section: { enabled: section.enabled, mode: section.mode, offset: section.offset, reverse: section.reverse } };
}
function normalizeViewpoint(value: unknown): PortableViewpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PortableViewpoint>;
  if (row.format !== "reviter-viewpoint" || (row.version !== 1 && row.version !== 2 && row.version !== 3) || row.coordinateSystem !== "revit-model-feet" ||
      typeof row.sourceFingerprint !== "string" || !HASH.test(row.sourceFingerprint) ||
      typeof row.reviewFingerprint !== "string" || !REVIEW_HASH.test(row.reviewFingerprint) || !point(row.sourceOriginFeet)) return undefined;
  const camera = normalizeCamera(row.camera);
  if (!camera) return undefined;
  const viewer = row.version >= 2 ? normalizeViewer(row.viewer) : undefined;
  if (row.version >= 2 && !viewer) return undefined;
  if (row.version === 2 && viewer && (viewer.selectedElementId !== undefined || viewer.renderMode !== undefined || viewer.annotations !== undefined)) return undefined;
  // Return a new whitelist projection; unknown keys never enter application state.
  return { format: "reviter-viewpoint", version: row.version, sourceFingerprint: row.sourceFingerprint,
    reviewFingerprint: row.reviewFingerprint, coordinateSystem: "revit-model-feet", sourceOriginFeet: [...row.sourceOriginFeet], camera, ...(viewer ? { viewer } : {}) };
}

/** Reuse the same scene/model conversion used by comment viewpoints. */
export function portableViewpoint(identity: ViewpointModelIdentity, camera: ModelViewpoint, viewerState?: PortableViewerState): PortableViewpoint {
  if (!HASH.test(identity.fingerprint) || !REVIEW_HASH.test(identity.reviewFingerprint) || !point(identity.originFeet)) throw new Error("Invalid source model identity.");
  if (!["recovered", "reference-assisted", "overlay", "reference"].includes(camera.source)) throw new Error("This reference model has no registered Revit camera frame. Switch to the RVT view to copy a viewpoint link.");
  if (viewerState !== undefined && camera.source !== "recovered") throw new Error("Switch to the RVT view before copying category and section state.");
  if (!point(camera.position) || !point(camera.target)) throw new Error("The current camera cannot be shared.");
  const positionFeet = scenePointToModelFeet(camera.position, camera.source, identity.originFeet);
  const targetFeet = scenePointToModelFeet(camera.target, camera.source, identity.originFeet);
  const normalized = normalizeCamera({ positionFeet, targetFeet, up: camera.up, fov: camera.fov });
  if (!normalized) throw new Error("The current camera cannot be shared.");
  const viewer = viewerState === undefined ? undefined : normalizeViewer(viewerState);
  if (viewerState !== undefined && !viewer) throw new Error("The current category or section state cannot be shared.");
  if (viewer?.selectedElementId != null && !identity.elementIds?.has(viewer.selectedElementId)) throw new Error("The selected element is not present in this source model.");
  return { format: "reviter-viewpoint", version: viewer ? (viewer.selectedElementId !== undefined || viewer.renderMode !== undefined || viewer.annotations !== undefined ? 3 : 2) : 1, sourceFingerprint: identity.fingerprint,
    reviewFingerprint: identity.reviewFingerprint, coordinateSystem: "revit-model-feet", sourceOriginFeet: [...identity.originFeet], camera: normalized, ...(viewer ? { viewer } : {}) };
}

export function encodeViewpointFragment(viewpoint: PortableViewpoint): string {
  const normalized = normalizeViewpoint(viewpoint);
  if (!normalized) throw new Error("Invalid viewpoint.");
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const fragment = `${VIEWPOINT_FRAGMENT_PREFIX}${encoded}`;
  if (fragment.length > VIEWPOINT_FRAGMENT_MAX_CHARS) throw new Error("Viewpoint link exceeds its size limit.");
  return fragment;
}

/** Accept a fragment or pasted URL; never fetch the URL or open model assets. */
export function decodeViewpointFragment(fragmentOrUrl: string): PortableViewpoint | undefined {
  const hashAt = fragmentOrUrl.indexOf("#");
  const fragment = hashAt >= 0 ? fragmentOrUrl.slice(hashAt) : fragmentOrUrl;
  if (!fragment.startsWith(VIEWPOINT_FRAGMENT_PREFIX) || fragment.length > VIEWPOINT_FRAGMENT_MAX_CHARS) return undefined;
  const encoded = fragment.slice(VIEWPOINT_FRAGMENT_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) return undefined;
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") !== encoded) return undefined;
    return normalizeViewpoint(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return undefined; }
}

/** No model -> defer; foreign bytes -> refuse; matching model -> local camera. */
export function resolveViewpointImport(fragmentOrUrl: string, identity?: ViewpointModelIdentity | null): ViewpointImport {
  if (!fragmentOrUrl || fragmentOrUrl === "#") return { status: "empty", message: "No viewpoint link is present." };
  const viewpoint = decodeViewpointFragment(fragmentOrUrl);
  if (!viewpoint) return { status: "invalid", message: "This viewpoint link is invalid or uses an unsupported version." };
  if (!identity) return { status: "pending-model", message: "Open the source RVT model to restore this viewpoint. The link contains a saved view, without model files.", viewpoint };
  if (!HASH.test(identity.fingerprint) || viewpoint.sourceFingerprint !== identity.fingerprint) return { status: "wrong-model", message: "This viewpoint belongs to different model bytes. Open the source RVT model to restore it." };
  if (viewpoint.version >= 2 && viewpoint.reviewFingerprint !== identity.reviewFingerprint) return { status: "invalid", message: "This saved view uses a different recovered model layout. Copy a new link from the current model." };
  if (viewpoint.viewer?.selectedElementId != null && !identity.elementIds?.has(viewpoint.viewer.selectedElementId)) return { status: "invalid", message: "The selected element is not present in this source model." };
  if (!point(identity.originFeet)) return { status: "invalid", message: "The open model has an invalid source origin." };
  const position = modelFeetToScenePoint(viewpoint.camera.positionFeet, "recovered", identity.originFeet)!;
  const target = modelFeetToScenePoint(viewpoint.camera.targetFeet, "recovered", identity.originFeet)!;
  if (!point(position) || !point(target)) return { status: "invalid", message: "This viewpoint lies outside the supported camera coordinate range." };
  return { status: "ready", message: "Viewpoint restored on the matching RVT model.", viewpoint,
    camera: { source: "recovered", position, target, up: viewpoint.camera.up, fov: viewpoint.camera.fov } };
}

/** Clipboard access stays in the app's explicit user-click handler. */
export function viewpointLinkUrl(pageUrl: string, viewpoint: PortableViewpoint): string {
  const url = new URL(pageUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Viewpoint links need an HTTP or HTTPS page URL.");
  // Query parameters can contain private navigation/test poses or asset paths.
  url.search = ""; url.username = ""; url.password = "";
  url.hash = encodeViewpointFragment(viewpoint);
  return url.toString();
}

/** Opt-in user review markup, registered into the same canonical frame as camera links. */
export function captureViewpointMarkup(strokes: readonly MarkupStroke[], identity: ViewpointModelIdentity): PortableReviewMarkup[] {
  const annotations = strokes.map(stroke => {
    if (!["recovered", "reference"].includes(stroke.source)) throw new Error("Some review markup has no registered source frame. Use the markup sidecar for it.");
    const pointsFeet = stroke.pointsFeet ?? stroke.points.map(p => scenePointToModelFeet(p, stroke.source, identity.originFeet));
    if (pointsFeet.some(p => !p) || stroke.source === "reference-model") throw new Error("Some review markup has no registered source frame. Use the markup sidecar for it.");
    const converted = normalizeAnnotation({ id: stroke.id, tool: stroke.tool, pointsFeet, color: stroke.color,
      weightFeet: stroke.worldWeight * (stroke.source === "reference" ? 1 / 0.3048 : 1), ...(stroke.text === undefined ? {} : { text: stroke.text }) });
    if (!converted) throw new Error("Review markup exceeds the viewpoint limits. Export its markup sidecar instead.");
    return converted;
  });
  const viewer = normalizeViewer({ hiddenCategories: [], section: { enabled: false, mode: "z", offset: 0.5, reverse: false }, annotations });
  if (!viewer) throw new Error("Review markup exceeds the viewpoint limits. Export its markup sidecar instead.");
  return viewer.annotations!;
}
export function mergeViewpointMarkup(current: readonly MarkupStroke[], annotations: readonly PortableReviewMarkup[], identity: ViewpointModelIdentity, createdAt: string): MarkupStroke[] {
  const viewer = normalizeViewer({ hiddenCategories: [], section: { enabled: false, mode: "z", offset: 0.5, reverse: false }, annotations });
  if (!viewer) throw new Error("Invalid viewpoint markup.");
  const result = [...current];
  for (const annotation of viewer.annotations!) {
    const normalized = normalizeAnnotation(annotation);
    if (!normalized) throw new Error("Invalid viewpoint markup.");
    const points = normalized.pointsFeet.map(p => modelFeetToScenePoint(p, "recovered", identity.originFeet)!);
    const same = (stroke: MarkupStroke) => stroke.source === "recovered" && stroke.tool === normalized.tool && stroke.color === normalized.color && stroke.worldWeight === normalized.weightFeet && stroke.text === normalized.text && JSON.stringify(stroke.pointsFeet ?? stroke.points.map(p => scenePointToModelFeet(p, stroke.source, identity.originFeet))) === JSON.stringify(normalized.pointsFeet);
    if (result.some(same)) continue;
    let id = normalized.id, suffix = 0;
    while (result.some(stroke => stroke.id === id)) id = `shared:${normalized.id.slice(0, 64)}:${++suffix}`;
    result.push({ id, source: "recovered", tool: normalized.tool, points, pointsFeet: normalized.pointsFeet,
      color: normalized.color, worldWeight: normalized.weightFeet, ...(normalized.text === undefined ? {} : { text: normalized.text }), createdAt });
  }
  return result;
}
