/**
 * Local fragment viewer links, inspired by rvt-rs ifc/share.rs (1c3d337,
 * Apache-2.0; docs/third-party/rvt-rs). Uses Reviter's comment camera frame.
 * Unlike upstream optional identity, matching source-byte SHA256 is required.
 * No filename, local path, source bytes, comment text or asset URL is encoded.
 * V2 adds bounded category visibility and existing model-bounds section controls.
 */
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { roomModelFingerprint } from "./review-exchange.ts";
import { modelFeetToScenePoint, scenePointToModelFeet, type ModelViewpoint, type Point3Tuple } from "./viewer-tools.ts";

export const VIEWPOINT_FRAGMENT_PREFIX = "#reviter-view=";
export const VIEWPOINT_FRAGMENT_MAX_CHARS = 4096;
const MAX_WORLD_FEET = 100_000_000;
const HASH = /^sha256-[0-9a-f]{64}$/;
const REVIEW_HASH = /^fnv1a32-[0-9a-f]{8}$/;
export type ViewpointModelIdentity = { fingerprint: string; reviewFingerprint: string; originFeet: Point3Tuple };
export type PortableSectionState = { enabled: boolean; mode: "x" | "y" | "z" | "box"; offset: number; reverse: boolean };
export type PortableViewerState = { hiddenCategories: string[]; section: PortableSectionState };
export const VIEWPOINT_MAX_HIDDEN_CATEGORIES = 64;
export const VIEWPOINT_MAX_CATEGORY_CHARS = 96;
export type PortableViewpoint = {
  format: "reviter-viewpoint";
  version: 1 | 2;
  sourceFingerprint: string;
  reviewFingerprint: string;
  coordinateSystem: "revit-model-feet";
  sourceOriginFeet: Point3Tuple;
  camera: { positionFeet: Point3Tuple; targetFeet: Point3Tuple; up: Point3Tuple; fov: number };
  /** Present only in v2; v1 remains camera-only. */
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
  return { fingerprint, reviewFingerprint: roomModelFingerprint(result), originFeet };
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
function normalizeViewer(value: unknown): PortableViewerState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PortableViewerState>;
  if (!Array.isArray(row.hiddenCategories) || row.hiddenCategories.length > VIEWPOINT_MAX_HIDDEN_CATEGORIES ||
      row.hiddenCategories.some(category => typeof category !== "string" || category.length === 0 || category.length > VIEWPOINT_MAX_CATEGORY_CHARS || /[\u0000-\u001f\u007f]/u.test(category))) return undefined;
  const section = row.section;
  if (!section || typeof section !== "object" || typeof section.enabled !== "boolean" || typeof section.reverse !== "boolean" ||
      !["x", "y", "z", "box"].includes(section.mode) || typeof section.offset !== "number" || !Number.isFinite(section.offset) || section.offset < 0 || section.offset > 1) return undefined;
  return { hiddenCategories: [...new Set(row.hiddenCategories)].sort(),
    section: { enabled: section.enabled, mode: section.mode, offset: section.offset, reverse: section.reverse } };
}
function normalizeViewpoint(value: unknown): PortableViewpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PortableViewpoint>;
  if (row.format !== "reviter-viewpoint" || (row.version !== 1 && row.version !== 2) || row.coordinateSystem !== "revit-model-feet" ||
      typeof row.sourceFingerprint !== "string" || !HASH.test(row.sourceFingerprint) ||
      typeof row.reviewFingerprint !== "string" || !REVIEW_HASH.test(row.reviewFingerprint) || !point(row.sourceOriginFeet)) return undefined;
  const camera = normalizeCamera(row.camera);
  if (!camera) return undefined;
  const viewer = row.version === 2 ? normalizeViewer(row.viewer) : undefined;
  if (row.version === 2 && !viewer) return undefined;
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
  return { format: "reviter-viewpoint", version: viewer ? 2 : 1, sourceFingerprint: identity.fingerprint,
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
  if (viewpoint.version === 2 && viewpoint.reviewFingerprint !== identity.reviewFingerprint) return { status: "invalid", message: "This saved view uses a different recovered model layout. Copy a new link from the current model." };
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
