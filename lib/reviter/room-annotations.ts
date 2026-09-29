/**
 * Durable room annotations, and their round trip through a Pascal scene.
 *
 * A room here is a *number*, an optional *name*, and a boundary polygon on one
 * Revit level. Each of the three can come from a different place: the number
 * and name from a text label in a registered survey DWG, the polygon from the
 * walls around it, and any of them from a person editing the model. This module
 * is the record that keeps those sources apart so that re-running an automated
 * step (a fresh conversion, a re-registered DWG, a re-derived boundary) never
 * overwrites something a person changed.
 *
 * ## Identity
 *
 * Every annotation carries a `key` that is minted once and never recomputed.
 * It becomes the Pascal zone id (`zone_<key>`), the IFC space id, and the join
 * key for every merge. Room numbers are *not* identity: a person may renumber a
 * room, and two drawings may disagree about one.
 *
 * ## Coordinates
 *
 * Annotations are stored in Revit internal feet, in the model's own plan frame
 * (the frame `ConvertResult.elementBounds`, `derived-rooms.ts` and a registered
 * DWG all share). Pascal metres are a *view* of that, computed through a
 * {@link PascalFrame}. The Pascal frame subtracts the conversion's centring
 * origin, and that origin is the middle of the drawn model's bounds, so it moves
 * whenever the RVT gains or loses an element on its outskirts. Storing rooms in
 * Pascal metres would therefore tie them to one export; storing them in model
 * feet does not. The frame an export used is stamped into the scene's site node
 * so an edited scene can always be read back into feet exactly.
 *
 * ## The round trip
 *
 * 1. {@link appendRoomZones} writes annotations into an exported scene as
 *    Pascal `zone` nodes (`spaceRole: "room"`, `roomNumber`) under their level,
 *    each carrying `metadata.reviter` — its key, per-field sources, DWG
 *    provenance, and the exact values Reviter wrote (`exported`).
 * 2. The scene is edited in Pascal. Pascal keeps `metadata` verbatim through
 *    load, edit and save (it is a declared `z.record` on `BaseNode`), and keeps
 *    node ids verbatim on load.
 * 3. {@link readPascalRoomEdits} compares every zone with what Reviter wrote
 *    into it, so a changed field is known to be a person's edit without any
 *    external baseline. Zones a person drew are new manual rooms; zones a
 *    person deleted become tombstones so automation cannot resurrect them.
 * 4. {@link applyPascalRoomEdits} folds that into the annotation set, and
 *    {@link mergeRoomAnnotations} folds in fresh automated proposals under a
 *    "manual wins, automation updates only what it owns" rule.
 *
 * Wall edits travel the same way, but walls carry no baseline of their own, so
 * {@link diffPascalWalls} compares an edited scene against the scene that was
 * exported, and {@link rebaseWallEdits} re-applies those edits to a fresh export
 * three-way: an edit is replayed only where the fresh export still agrees with
 * the geometry the edit started from.
 */
import type { PascalNode } from "./export-pascal.ts";
import type { DerivedRoom } from "./derived-rooms.ts";
import type { ReviewedRoom } from "./room-review.ts";

export const ROOM_ANNOTATION_VERSION = 1 as const;

/** The `metadata.reviter.schema` tag on a zone Reviter wrote. */
export const ROOM_ZONE_SCHEMA = "reviter-room-annotation/1" as const;

const METRES_PER_FOOT = 0.3048;

/** Pascal's `ZoneNode.roomNumber` is `z.string().trim().max(32)`. */
const PASCAL_ROOM_NUMBER_MAX = 32;

/** Pascal's schema default, written explicitly because Load Build does not parse. */
const PASCAL_DEFAULT_CEILING_HEIGHT = 2.7;

/** Plan-coordinate agreement below which two points are the same, in metres. */
const SAME_POINT_METRES = 1e-4;

export type Point2 = [number, number];

/**
 * Who set a field's current value.
 *
 * - `dwg`: read off a text label in a registered survey drawing.
 * - `derived`: computed from the model — a boundary traced from walls.
 * - `revit`: stated by the RVT itself (a native Room, if a model has one).
 * - `manual`: a person set it. Automation never overwrites a manual field.
 */
export type RoomFieldSource = "dwg" | "derived" | "revit" | "manual";

export type RoomField = "number" | "name" | "polygon";

/** Where a room's DWG label came from, precisely enough to find it again. */
export type DwgLabelProvenance = {
  fileName?: string;
  /** SHA-256 of the DWG bytes, hex. */
  sha256: string;
  /** The drawing section (`DwgSection.id`, or a stable label for it). */
  sectionId?: string;
  /**
   * The label's entity handle — for an attribute, the handle of the block
   * reference that owns it (`DwgEntity.insert`). Handles persist across saves
   * of one drawing, which is what makes them a better match key than text.
   */
  entityHandle?: string;
  /** The attribute tag (`ROOMNUM`, `ROOMNAME`) when the label is an attribute. */
  tag?: string;
  layer?: string;
  /** The label text exactly as read, before any cleaning. */
  rawText: string;
  /** The label's anchor in DWG drawing units, before registration. */
  anchorDwg?: Point2;
  /** Hash or id of the DWG→level registration that placed it, if recorded. */
  registrationId?: string;
};

/** An automated proposal that disagreed with a manual value and did not win. */
export type RoomAnnotationConflict = {
  field: RoomField;
  kept: unknown;
  proposed: unknown;
  proposedSource: RoomFieldSource;
  at: string;
};

export type RoomAnnotation = {
  /** Stable identity, minted once; see the module comment. `[A-Za-z0-9._-]`. */
  key: string;
  /** The Revit level element id the room sits on. */
  levelId: number;
  /** The room number, untruncated. Empty when no label has been found. */
  number: string;
  name?: string;
  /** Outer boundary, Revit model feet, counter-clockwise, no closing repeat. */
  polygonFeet: Point2[];
  /** Holes, Revit model feet. Pascal zones have none, so these ride in metadata. */
  holesFeet?: Point2[][];
  /** Where the label goes — for a DWG label, its registered anchor. */
  labelPointFeet: Point2;
  /** Per-field provenance of the *current* value. */
  source: Record<RoomField, RoomFieldSource>;
  dwg?: DwgLabelProvenance;
  /** 0–1: how sure the automation was that label and boundary belong together. */
  confidence: number;
  /** `DerivedRoom.key` of the boundary candidate it was built from. */
  derivedRoomKey?: string;
  /** Ceiling height in feet, when known. */
  heightFeet?: number;
  /**
   * `active`, or `deleted` — a tombstone left when a person deletes a room, so
   * the next automated pass does not bring it back.
   */
  status: "active" | "deleted";
  /** The last values automation proposed, so a changed proposal is noticed. */
  auto?: { number?: string; name?: string; polygonFeet?: Point2[] };
  conflicts?: RoomAnnotationConflict[];
  /** Keys this annotation absorbed or was copied from (a duplicated zone). */
  lineage?: { op: "duplicate" | "merge"; fromKeys: string[] };
  updatedAt?: string;
};

/** The sidecar: the durable record, independent of any one export. */
export type RoomAnnotationSet = {
  format: "reviter-room-annotations";
  version: typeof ROOM_ANNOTATION_VERSION;
  coordinateSystem: "revit-model-feet";
  model: { fileName: string; uniqueDocumentGuid?: string };
  annotations: RoomAnnotation[];
};

export function makeRoomAnnotationSet(
  fileName: string,
  annotations: RoomAnnotation[],
  uniqueDocumentGuid?: string,
): RoomAnnotationSet {
  return {
    format: "reviter-room-annotations",
    version: ROOM_ANNOTATION_VERSION,
    coordinateSystem: "revit-model-feet",
    model: uniqueDocumentGuid ? { fileName, uniqueDocumentGuid } : { fileName },
    annotations,
  };
}

// ─── Keys ────────────────────────────────────────────────────────────────────

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffff_ffff_ffff_ffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Mint a key from the first evidence a room was found by.
 *
 * Deterministic, so regenerating annotations from scratch reproduces the same
 * keys; but it is only ever called for a room with no key yet, so later
 * changes to that evidence (a renumbering, a re-traced boundary) never move it.
 * The DWG file hash is deliberately left out: a revised drawing keeps its
 * handles, and a room should keep its key across drawing revisions.
 */
export function mintRoomKey(
  levelId: number,
  evidence: { dwgHandle?: string; derivedRoomKey?: string; number?: string; labelPointFeet?: Point2 },
): string {
  const basis = evidence.dwgHandle
    ? `dwg:${evidence.dwgHandle}`
    : evidence.derivedRoomKey
      ? `derived:${evidence.derivedRoomKey}`
      : evidence.number
        ? `number:${normaliseNumber(evidence.number)}`
        : `point:${evidence.labelPointFeet?.map((value) => value.toFixed(2)).join(",") ?? "none"}`;
  return `rm-${levelId}-${fnv1a64Hex(basis).slice(0, 12)}`;
}

function normaliseNumber(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, (character) => `-${character.codePointAt(0)!.toString(16)}-`);
}

/** The Pascal zone id for an annotation key. */
export function zoneIdForKey(key: string): string {
  return `zone_${safeKey(key)}`;
}

// ─── The Pascal frame ────────────────────────────────────────────────────────

/**
 * The exact map from Revit model feet to a Pascal export's metres:
 *
 *     pascal.x = (revit.x - originFeet.x) * 0.3048
 *     pascal.y = (revit.z - originFeet.z) * 0.3048          // up
 *     pascal.z = planSign * (revit.y - originFeet.y) * 0.3048
 *
 * with `planSign = -1` (the default export) or `+1` (`--mirror-plan`). A plan
 * point is Pascal's `[x, z]`. This restates `makePascalScene` so a scene can be
 * read back without the conversion that wrote it.
 */
export type PascalFrame = {
  kind: "reviter-pascal-frame";
  version: 1;
  metresPerFoot: typeof METRES_PER_FOOT;
  originFeet: { x: number; y: number; z: number };
  planSign: 1 | -1;
  revitFileName?: string;
};

/** The frame `makePascalScene(result, { mirrorPlan })` writes in. */
export function pascalFrameFor(
  result: { origin: { x: number; y: number; z: number }; fileName?: string },
  options: { mirrorPlan?: boolean } = {},
): PascalFrame {
  return {
    kind: "reviter-pascal-frame",
    version: 1,
    metresPerFoot: METRES_PER_FOOT,
    originFeet: { x: result.origin.x, y: result.origin.y, z: result.origin.z },
    planSign: options.mirrorPlan === true ? 1 : -1,
    ...(result.fileName ? { revitFileName: result.fileName } : {}),
  };
}

export function feetToPascalPlan(frame: PascalFrame, point: readonly [number, number]): Point2 {
  return [
    (point[0] - frame.originFeet.x) * frame.metresPerFoot,
    frame.planSign * (point[1] - frame.originFeet.y) * frame.metresPerFoot,
  ];
}

export function pascalPlanToFeet(frame: PascalFrame, point: readonly [number, number]): Point2 {
  return [
    point[0] / frame.metresPerFoot + frame.originFeet.x,
    (frame.planSign * point[1]) / frame.metresPerFoot + frame.originFeet.y,
  ];
}

/** Absolute height above the export datum, in metres, for a Revit elevation. */
export function feetToPascalUp(frame: PascalFrame, zFeet: number): number {
  return (zFeet - frame.originFeet.z) * frame.metresPerFoot;
}

/** The build JSON shape; `makePascalScene`'s result fits it too. */
export type PascalBuild = {
  nodes: Record<string, PascalNode>;
  rootNodeIds: string[];
};

function siteNode(scene: PascalBuild): PascalNode | undefined {
  for (const id of scene.rootNodeIds) {
    const node = scene.nodes[id];
    if (node?.type === "site") return node;
  }
  return Object.values(scene.nodes).find((node) => node.type === "site");
}

/** Record the frame on the site node, so the scene can be read back into feet. */
export function stampPascalFrame(scene: PascalBuild, frame: PascalFrame): void {
  const site = siteNode(scene);
  if (!site) throw new Error("The scene has no site node to carry its frame.");
  site.metadata = { ...(site.metadata ?? {}), reviterFrame: frame };
}

export function readPascalFrame(scene: PascalBuild): PascalFrame | null {
  const frame = siteNode(scene)?.metadata?.reviterFrame as Partial<PascalFrame> | undefined;
  if (
    frame?.kind !== "reviter-pascal-frame" ||
    frame.version !== 1 ||
    !frame.originFeet ||
    ![frame.originFeet.x, frame.originFeet.y, frame.originFeet.z].every(Number.isFinite) ||
    (frame.planSign !== 1 && frame.planSign !== -1)
  ) {
    return null;
  }
  return { ...frame, metresPerFoot: METRES_PER_FOOT } as PascalFrame;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function signedArea(points: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** Drop a closing repeat and wind counter-clockwise (positive signed area). */
function counterClockwise(points: readonly Point2[]): Point2[] {
  const ring = points.map((point) => [point[0], point[1]] as Point2);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 3 && first && last && first[0] === last[0] && first[1] === last[1]) ring.pop();
  if (ring.length >= 3 && signedArea(ring) < 0) ring.reverse();
  return ring;
}

function pointInRing(point: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!;
    const b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** A 1 mm-quantised fingerprint of a plan ring, for "did anyone move this". */
function ringFingerprint(ring: readonly Point2[]): string {
  return fnv1a64Hex(ring.map(([x, z]) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`).join(";"));
}

function samePolygonFeet(a: readonly Point2[] | undefined, b: readonly Point2[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return a === b;
  const tolerance = SAME_POINT_METRES / METRES_PER_FOOT;
  return a.every((point, index) =>
    Math.abs(point[0] - b[index]![0]) <= tolerance && Math.abs(point[1] - b[index]![1]) <= tolerance);
}

function sameValue(field: RoomField, a: unknown, b: unknown): boolean {
  if (field === "polygon") return samePolygonFeet(a as Point2[] | undefined, b as Point2[] | undefined);
  return (a ?? "") === (b ?? "");
}

// ─── Annotations → Pascal zones ──────────────────────────────────────────────

/** What `metadata.reviter` holds on a zone Reviter wrote. */
export type RoomZoneMetadata = {
  schema: typeof ROOM_ZONE_SCHEMA;
  key: string;
  levelId: number;
  /** The full number, in case `roomNumber` had to be cut to Pascal's 32. */
  number: string;
  name?: string;
  source: Record<RoomField, RoomFieldSource>;
  confidence: number;
  labelPointFeet: Point2;
  holesFeet?: Point2[][];
  derivedRoomKey?: string;
  dwg?: DwgLabelProvenance;
  /**
   * Exactly what Reviter wrote into this zone's Pascal fields. Reading the
   * scene back, any field that no longer matches was edited by a person.
   */
  exported: { roomNumber: string; name: string; polygonFingerprint: string };
};

export type AppendRoomZonesOptions = {
  /**
   * Also write Pascal's typed `provenance` field. It survives an edit only in
   * a Pascal built from the repository; the npm `@pascal-app/core` 1.0.3 store
   * drops it on the first edit of a node. `metadata.reviter` is the carrier
   * that survives both, so this is a courtesy for tools that read provenance.
   */
  provenance?: boolean;
  /** Colours by review state; overridable. */
  colors?: Partial<Record<"dwg" | "manual" | "unnumbered" | "lowConfidence", string>>;
  /** Below this confidence a zone is drawn in the low-confidence colour. */
  lowConfidence?: number;
};

export type AppendRoomZonesReport = {
  written: number;
  replaced: number;
  skipped: { key: string; reason: string }[];
  /** Keys whose number exceeded Pascal's 32 characters and was cut in `roomNumber`. */
  truncatedNumbers: string[];
};

const DEFAULT_COLORS = {
  dwg: "#22c55e",
  manual: "#3b82f6",
  unnumbered: "#9ca3af",
  lowConfidence: "#f59e0b",
};

function levelNodeFor(scene: PascalBuild, levelId: number): PascalNode | undefined {
  const direct = scene.nodes[`level_r${levelId}`];
  if (direct?.type === "level") return direct;
  return Object.values(scene.nodes).find((node) =>
    node.type === "level" && node.metadata?.revitLevelId === levelId);
}

function asciiRef(value: string, max: number): string {
  return value.replace(/[^\x20-\x7e]/g, (character) =>
    encodeURIComponent(character)).slice(0, max);
}

/** One annotation as a Pascal zone node, matching `ZoneNode` field for field. */
export function roomZoneNode(
  annotation: RoomAnnotation,
  levelNodeId: string,
  frame: PascalFrame,
  options: AppendRoomZonesOptions = {},
): PascalNode {
  const polygon = counterClockwise(annotation.polygonFeet.map((point) => feetToPascalPlan(frame, point)));
  const roomNumber = annotation.number.trim().slice(0, PASCAL_ROOM_NUMBER_MAX);
  const name = annotation.name?.trim() || "";
  const colors = { ...DEFAULT_COLORS, ...options.colors };
  const color = annotation.source.number === "manual" || annotation.source.name === "manual"
    ? colors.manual
    : !annotation.number
      ? colors.unnumbered
      : annotation.confidence < (options.lowConfidence ?? 0.5)
        ? colors.lowConfidence
        : colors.dwg;
  const metadata: RoomZoneMetadata = {
    schema: ROOM_ZONE_SCHEMA,
    key: annotation.key,
    levelId: annotation.levelId,
    number: annotation.number,
    ...(annotation.name ? { name: annotation.name } : {}),
    source: { ...annotation.source },
    confidence: annotation.confidence,
    labelPointFeet: annotation.labelPointFeet,
    ...(annotation.holesFeet?.length ? { holesFeet: annotation.holesFeet } : {}),
    ...(annotation.derivedRoomKey ? { derivedRoomKey: annotation.derivedRoomKey } : {}),
    ...(annotation.dwg ? { dwg: annotation.dwg } : {}),
    exported: { roomNumber, name, polygonFingerprint: ringFingerprint(polygon) },
  };
  const node: PascalNode = {
    object: "node",
    id: zoneIdForKey(annotation.key),
    type: "zone",
    name,
    parentId: levelNodeId,
    visible: true,
    polygon,
    // Every schema default is written out: Load Build hands nodes to the store
    // without parsing them, so a default left to zod never materialises.
    autoFromWalls: false,
    boundaryWallIds: [],
    spaceRole: "room",
    roomNumber,
    enclosureStatus: "auto",
    floorFinish: "",
    wallFinish: "",
    ceilingFinish: "",
    ceilingHeight: annotation.heightFeet != null && annotation.heightFeet * METRES_PER_FOOT >= 0.1
      ? annotation.heightFeet * METRES_PER_FOOT
      : PASCAL_DEFAULT_CEILING_HEIGHT,
    occupancy: "",
    clearDimensionPolicy: "none",
    color,
    metadata: { reviter: metadata },
  };
  if (options.provenance) {
    const refs: { ns?: string; id: string; role?: string }[] = [
      { ns: "reviter:room", id: asciiRef(annotation.key, 160) },
    ];
    if (annotation.dwg?.entityHandle) {
      refs.push({
        ns: `dwg:${asciiRef(annotation.dwg.sha256, 16)}`,
        id: asciiRef(annotation.dwg.entityHandle, 160),
        role: "absorbed",
      });
    }
    node.provenance = { refs };
  }
  return node;
}

/**
 * Write active annotations into a scene as room zones under their levels.
 *
 * Idempotent: a zone already carrying an annotation's key is replaced in place,
 * so running this twice, or after a merge, never duplicates a room. Stamps the
 * frame on the site node. Mutates `scene`.
 */
export function appendRoomZones(
  scene: PascalBuild,
  annotations: readonly RoomAnnotation[],
  frame: PascalFrame,
  options: AppendRoomZonesOptions = {},
): AppendRoomZonesReport {
  const report: AppendRoomZonesReport = { written: 0, replaced: 0, skipped: [], truncatedNumbers: [] };
  stampPascalFrame(scene, frame);

  const existingByKey = new Map<string, PascalNode>();
  for (const node of Object.values(scene.nodes)) {
    const key = zoneMetadata(node)?.key;
    if (node.type === "zone" && key) existingByKey.set(key, node);
  }

  for (const annotation of annotations) {
    if (annotation.status === "deleted") continue;
    if (annotation.polygonFeet.length < 3) {
      report.skipped.push({ key: annotation.key, reason: "polygon has fewer than three points" });
      continue;
    }
    const level = levelNodeFor(scene, annotation.levelId);
    if (!level) {
      report.skipped.push({ key: annotation.key, reason: `no level node for Revit level ${annotation.levelId}` });
      continue;
    }
    const previous = existingByKey.get(annotation.key);
    if (previous) {
      detach(scene, previous);
      report.replaced += 1;
    }
    const node = roomZoneNode(annotation, level.id, frame, options);
    if (annotation.number.trim().length > PASCAL_ROOM_NUMBER_MAX) report.truncatedNumbers.push(annotation.key);
    scene.nodes[node.id] = node;
    level.children = [...(level.children ?? []).filter((id) => id !== node.id), node.id];
    report.written += 1;
  }
  return report;
}

function detach(scene: PascalBuild, node: PascalNode): void {
  const parent = node.parentId ? scene.nodes[node.parentId] : undefined;
  if (parent?.children) parent.children = parent.children.filter((id) => id !== node.id);
  delete scene.nodes[node.id];
}

function zoneMetadata(node: PascalNode | undefined): RoomZoneMetadata | null {
  const value = node?.metadata?.reviter as Partial<RoomZoneMetadata> | undefined;
  if (value?.schema !== ROOM_ZONE_SCHEMA || typeof value.key !== "string" || !value.exported) return null;
  return value as RoomZoneMetadata;
}

// ─── Pascal zones → annotation edits ─────────────────────────────────────────

export type PascalRoomEdit =
  /** A zone Reviter wrote, with the fields a person changed (possibly none). */
  | {
      kind: "edited";
      key: string;
      nodeId: string;
      levelId: number;
      changed: Partial<{ number: string; name: string; polygonFeet: Point2[]; levelId: number }>;
    }
  /** A zone a person drew, or a copy of one of Reviter's (see `copiedFromKey`). */
  | { kind: "added"; annotation: RoomAnnotation; nodeId: string; copiedFromKey?: string }
  /** A key Reviter wrote whose zone is no longer in the scene. */
  | { kind: "deleted"; key: string };

export type ReadPascalRoomEditsOptions = {
  /** Keys that were written into this scene, so their absence reads as deletion. */
  exportedKeys?: Iterable<string>;
  /** Frame to read in, when the scene carries none. */
  frame?: PascalFrame;
  now?: string;
};

function levelIdOf(scene: PascalBuild, node: PascalNode): number | null {
  const parent = node.parentId ? scene.nodes[node.parentId] : undefined;
  const levelId = parent?.metadata?.revitLevelId;
  return typeof levelId === "number" ? levelId : null;
}

function polygonOf(node: PascalNode): Point2[] {
  const polygon = node.polygon;
  if (!Array.isArray(polygon)) return [];
  return polygon.filter((point): point is Point2 =>
    Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(value)));
}

function centroidOf(ring: readonly Point2[]): Point2 {
  const area = signedArea(ring);
  if (Math.abs(area) < 1e-12) {
    const sum = ring.reduce((total, point) => [total[0] + point[0], total[1] + point[1]] as Point2, [0, 0] as Point2);
    return [sum[0] / Math.max(ring.length, 1), sum[1] / Math.max(ring.length, 1)];
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}

/**
 * Read an (edited) Pascal scene's zones back as edits against what Reviter
 * wrote into it. Needs no baseline file: each Reviter zone carries its own.
 */
export function readPascalRoomEdits(
  scene: PascalBuild,
  options: ReadPascalRoomEditsOptions = {},
): { edits: PascalRoomEdit[]; unreadable: string[] } {
  const frame = readPascalFrame(scene) ?? options.frame;
  if (!frame) throw new Error("The scene carries no Reviter frame; pass options.frame.");
  const now = options.now ?? new Date().toISOString();
  const edits: PascalRoomEdit[] = [];
  const unreadable: string[] = [];
  const seenKeys = new Set<string>();

  const zones = Object.values(scene.nodes).filter((node) => node.type === "zone");
  // A zone whose id is still the one its key minted is the original; any other
  // zone carrying the same key is a copy (Pascal copies metadata verbatim).
  zones.sort((a, b) => {
    const original = (node: PascalNode) => {
      const meta = zoneMetadata(node);
      return meta && node.id === zoneIdForKey(meta.key) ? 0 : 1;
    };
    return original(a) - original(b) || a.id.localeCompare(b.id);
  });

  for (const node of zones) {
    const meta = zoneMetadata(node);
    const polygonMetres = polygonOf(node);
    const levelId = levelIdOf(scene, node) ?? meta?.levelId ?? null;
    if (polygonMetres.length < 3 || levelId == null) {
      unreadable.push(node.id);
      continue;
    }
    const polygonFeet = counterClockwise(polygonMetres.map((point) => pascalPlanToFeet(frame, point)));
    const roomNumber = typeof node.roomNumber === "string" ? node.roomNumber.trim() : "";
    const name = typeof node.name === "string" ? node.name.trim() : "";

    if (meta && !seenKeys.has(meta.key)) {
      seenKeys.add(meta.key);
      const changed: Extract<PascalRoomEdit, { kind: "edited" }>["changed"] = {};
      // A cut-down roomNumber that still matches what was written keeps the full one.
      if (roomNumber !== meta.exported.roomNumber) changed.number = roomNumber;
      if (name !== meta.exported.name) changed.name = name;
      if (ringFingerprint(counterClockwise(polygonMetres)) !== meta.exported.polygonFingerprint) {
        changed.polygonFeet = polygonFeet;
      }
      if (levelId !== meta.levelId) changed.levelId = levelId;
      edits.push({ kind: "edited", key: meta.key, nodeId: node.id, levelId, changed });
      continue;
    }

    const copiedFromKey = meta?.key;
    const key = safeKey(`pascal-${node.id}`);
    const annotation: RoomAnnotation = {
      key,
      levelId,
      number: roomNumber,
      ...(name ? { name } : {}),
      polygonFeet,
      labelPointFeet: centroidOf(polygonFeet),
      source: { number: "manual", name: "manual", polygon: "manual" },
      confidence: 1,
      status: "active",
      ...(copiedFromKey ? { lineage: { op: "duplicate" as const, fromKeys: [copiedFromKey] } } : {}),
      updatedAt: now,
    };
    edits.push({ kind: "added", annotation, nodeId: node.id, ...(copiedFromKey ? { copiedFromKey } : {}) });
  }

  for (const key of options.exportedKeys ?? []) {
    if (!seenKeys.has(key)) edits.push({ kind: "deleted", key });
  }
  return { edits, unreadable };
}

/**
 * Fold edits read from Pascal into the annotation set. Every changed field
 * becomes `manual`; a deleted zone becomes a tombstone.
 */
export function applyPascalRoomEdits(
  current: readonly RoomAnnotation[],
  edits: readonly PascalRoomEdit[],
  now = new Date().toISOString(),
): RoomAnnotation[] {
  const byKey = new Map(current.map((annotation) => [annotation.key, { ...annotation }]));
  for (const edit of edits) {
    if (edit.kind === "added") {
      if (!byKey.has(edit.annotation.key)) byKey.set(edit.annotation.key, edit.annotation);
      continue;
    }
    const annotation = byKey.get(edit.key);
    if (!annotation) continue;
    if (edit.kind === "deleted") {
      annotation.status = "deleted";
      annotation.updatedAt = now;
      continue;
    }
    const { changed } = edit;
    if (Object.keys(changed).length === 0) continue;
    const source = { ...annotation.source };
    if (changed.number != null) {
      annotation.number = changed.number;
      source.number = "manual";
    }
    if (changed.name != null) {
      if (changed.name) annotation.name = changed.name;
      else delete annotation.name;
      source.name = "manual";
    }
    if (changed.polygonFeet) {
      annotation.polygonFeet = changed.polygonFeet;
      // A redrawn outline no longer bounds the old holes or label point reliably.
      if (!pointInRing(annotation.labelPointFeet, changed.polygonFeet)) {
        annotation.labelPointFeet = centroidOf(changed.polygonFeet);
      }
      source.polygon = "manual";
    }
    if (changed.levelId != null) annotation.levelId = changed.levelId;
    annotation.source = source;
    annotation.updatedAt = now;
  }
  return [...byKey.values()];
}

// ─── Automated proposals → annotations ───────────────────────────────────────

export type MergeRoomAnnotationsReport = {
  matched: number;
  added: number;
  /** Automated annotations the new pass no longer proposes; kept, flagged. */
  stale: string[];
  conflicts: { key: string; conflict: RoomAnnotationConflict }[];
};

function fieldValue(annotation: RoomAnnotation, field: RoomField): unknown {
  return field === "number" ? annotation.number : field === "name" ? annotation.name : annotation.polygonFeet;
}

function autoValue(annotation: RoomAnnotation, field: RoomField): unknown {
  const auto = annotation.auto;
  if (!auto) return undefined;
  return field === "number" ? auto.number : field === "name" ? auto.name : auto.polygonFeet;
}

function setField(annotation: RoomAnnotation, field: RoomField, value: unknown): void {
  if (field === "number") annotation.number = (value as string | undefined) ?? "";
  else if (field === "polygon") annotation.polygonFeet = value as Point2[];
  else if (value) annotation.name = value as string;
  else delete annotation.name;
}

/**
 * Merge a fresh automated pass (DWG labels re-applied, boundaries re-derived,
 * a new conversion) into the durable set. The rule, per field:
 *
 * - a `manual` field is never overwritten; if automation now proposes
 *   something new for it, that proposal is recorded as a conflict for review;
 * - any other field takes the new proposal, with the proposal's source.
 *
 * Matching, in order: key; DWG entity handle on the same level; derived-room
 * key on the same level; room number on the same level; the proposal's label
 * point inside an existing boundary on the same level. Tombstones match too,
 * and stay deleted. An automated room the new pass does not propose is kept
 * and reported stale rather than silently dropped.
 */
export function mergeRoomAnnotations(
  current: readonly RoomAnnotation[],
  proposals: readonly RoomAnnotation[],
  now = new Date().toISOString(),
): { annotations: RoomAnnotation[]; report: MergeRoomAnnotationsReport } {
  const report: MergeRoomAnnotationsReport = { matched: 0, added: 0, stale: [], conflicts: [] };
  const result = current.map((annotation) => ({ ...annotation }));
  const claimed = new Set<number>();
  const matchers: ((candidate: RoomAnnotation, proposal: RoomAnnotation) => boolean)[] = [
    (candidate, proposal) => candidate.key === proposal.key,
    (candidate, proposal) => candidate.levelId === proposal.levelId &&
      Boolean(proposal.dwg?.entityHandle) && candidate.dwg?.entityHandle === proposal.dwg?.entityHandle,
    (candidate, proposal) => candidate.levelId === proposal.levelId &&
      Boolean(proposal.derivedRoomKey) && candidate.derivedRoomKey === proposal.derivedRoomKey,
    (candidate, proposal) => candidate.levelId === proposal.levelId && Boolean(proposal.number.trim()) &&
      normaliseNumber(candidate.number) === normaliseNumber(proposal.number),
    (candidate, proposal) => candidate.levelId === proposal.levelId &&
      pointInRing(proposal.labelPointFeet, candidate.polygonFeet),
  ];

  for (const proposal of proposals) {
    let index = -1;
    for (const matches of matchers) {
      index = result.findIndex((candidate, at) => !claimed.has(at) && matches(candidate, proposal));
      if (index >= 0) break;
    }
    if (index < 0) {
      const key = proposal.key || mintRoomKey(proposal.levelId, {
        dwgHandle: proposal.dwg?.entityHandle,
        derivedRoomKey: proposal.derivedRoomKey,
        number: proposal.number,
        labelPointFeet: proposal.labelPointFeet,
      });
      result.push({
        ...proposal,
        key,
        status: "active",
        auto: { number: proposal.number, name: proposal.name, polygonFeet: proposal.polygonFeet },
        updatedAt: now,
      });
      claimed.add(result.length - 1);
      report.added += 1;
      continue;
    }
    claimed.add(index);
    report.matched += 1;
    const annotation = result[index]!;
    const source = { ...annotation.source };
    for (const field of ["number", "name", "polygon"] as const) {
      const proposed = fieldValue(proposal, field);
      if (source[field] === "manual") {
        const previouslyProposed = autoValue(annotation, field);
        if (!sameValue(field, proposed, previouslyProposed) && !sameValue(field, proposed, fieldValue(annotation, field))) {
          const conflict: RoomAnnotationConflict = {
            field,
            kept: fieldValue(annotation, field),
            proposed,
            proposedSource: proposal.source[field],
            at: now,
          };
          annotation.conflicts = [...(annotation.conflicts ?? []), conflict];
          report.conflicts.push({ key: annotation.key, conflict });
        }
        continue;
      }
      // "No proposal" for a name is not a proposal to erase a DWG-read one.
      if (field === "name" && !proposed && annotation.name) continue;
      setField(annotation, field, proposed);
      source[field] = proposal.source[field];
    }
    annotation.source = source;
    if (source.polygon !== "manual") {
      if (proposal.holesFeet) annotation.holesFeet = proposal.holesFeet;
      else delete annotation.holesFeet;
      annotation.labelPointFeet = proposal.labelPointFeet;
    }
    if (proposal.dwg) annotation.dwg = proposal.dwg;
    if (proposal.derivedRoomKey) annotation.derivedRoomKey = proposal.derivedRoomKey;
    if (proposal.heightFeet != null) annotation.heightFeet = proposal.heightFeet;
    annotation.confidence = proposal.confidence;
    annotation.auto = { number: proposal.number, name: proposal.name, polygonFeet: proposal.polygonFeet };
    annotation.updatedAt = now;
  }

  result.forEach((annotation, index) => {
    if (claimed.has(index) || annotation.status === "deleted") return;
    const automated = (["number", "name", "polygon"] as const).every((field) => annotation.source[field] !== "manual");
    if (automated) report.stale.push(annotation.key);
  });
  return { annotations: result, report };
}

/**
 * A boundary-only proposal from a derived room: no number yet, polygon
 * `derived`. A DWG pass fills in the number and name.
 */
export function proposalFromDerivedRoom(room: DerivedRoom): RoomAnnotation {
  const [outer, ...holes] = [...room.loops].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return {
    key: mintRoomKey(room.levelId, { derivedRoomKey: room.key }),
    levelId: room.levelId,
    number: "",
    polygonFeet: counterClockwise(outer ?? []),
    ...(holes.length ? { holesFeet: holes.map((hole) => counterClockwise(hole).reverse()) } : {}),
    labelPointFeet: room.centroid,
    source: { number: "derived", name: "derived", polygon: "derived" },
    confidence: room.closure === "closed" ? 0.6 : 0.4,
    derivedRoomKey: room.key,
    status: "active",
  };
}

// ─── IFC ─────────────────────────────────────────────────────────────────────

/**
 * Active annotations as accepted `ReviewedRoom`s, so `makeIfc`/
 * `makeIfcCenterlines` emit them as `IfcSpace` without any change there.
 *
 * `details.number` is set and `details.name` left empty on purpose: the IFC
 * exporter then writes the number alone as `IfcSpace.Name` and the room name as
 * `LongName`, which is the convention Revit's own IFC exporter follows and the
 * one Pascal's IFC importer reads (`roomNumber` from `Name` when it differs
 * from `LongName`). The space's GUID derives from `roomId`, which is derived
 * from the stable key.
 */
export function annotationsToReviewedRooms(
  annotations: readonly RoomAnnotation[],
  now = new Date().toISOString(),
): ReviewedRoom[] {
  return annotations.filter((annotation) => annotation.status === "active" && annotation.polygonFeet.length >= 3)
    .map((annotation) => {
      const loops = [annotation.polygonFeet, ...(annotation.holesFeet ?? [])];
      const area = Math.abs(signedArea(annotation.polygonFeet)) -
        (annotation.holesFeet ?? []).reduce((total, hole) => total + Math.abs(signedArea(hole)), 0);
      const provenance = [
        `key=${annotation.key}`,
        `number:${annotation.source.number}`,
        `name:${annotation.source.name}`,
        `polygon:${annotation.source.polygon}`,
        ...(annotation.dwg
          ? [`dwg=${annotation.dwg.sha256.slice(0, 16)}`, `handle=${annotation.dwg.entityHandle ?? ""}`,
              `layer=${annotation.dwg.layer ?? ""}`, `text=${annotation.dwg.rawText}`]
          : []),
      ].join("; ");
      return {
        roomId: `ann-${annotation.key}`,
        candidateKey: annotation.derivedRoomKey ?? annotation.key,
        levelId: annotation.levelId,
        closure: "closed",
        disposition: "accepted",
        geometry: {
          areaSquareFeet: Math.max(area, 0),
          centroidFeet: annotation.labelPointFeet,
          loopsFeet: loops,
        },
        gapIds: [],
        details: {
          number: annotation.number,
          name: annotation.number ? "" : annotation.name ?? "",
          longName: annotation.name ?? "",
          description: "Room annotation maintained in Reviter",
          department: "",
          occupancyType: "",
          accessibility: "",
          notes: provenance,
          heightFeet: annotation.heightFeet ?? null,
        },
        ifc: { export: true, predefinedType: "INTERNAL" },
        createdAt: annotation.updatedAt ?? now,
        updatedAt: annotation.updatedAt ?? now,
      } satisfies ReviewedRoom;
    });
}

// ─── Walls: diff an edited scene, and replay the edits on a fresh export ─────

type WallGeometry = {
  nodeId: string;
  levelNodeId: string | null;
  startFeet: Point2;
  endFeet: Point2;
  thickness: number;
  height: number | null;
  curveOffset: number;
};

export type PascalWallEdit =
  | { kind: "modified"; nodeId: string; revitElementId: number | null; before: WallGeometry; after: WallGeometry }
  | { kind: "deleted"; nodeId: string; revitElementId: number | null; before: WallGeometry }
  /**
   * New nodes carrying a Revit wall's id: a split or insertion (`removed` lists
   * the originals it replaced), or a division or copy (`removed` is empty and
   * the original, if shortened, is reported `modified` on its own).
   */
  | {
      kind: "split";
      revitElementId: number;
      removed: WallGeometry[];
      pieces: { geometry: WallGeometry; node: PascalNode }[];
    }
  | { kind: "added"; nodeId: string; revitElementId: number | null; after: WallGeometry; node: PascalNode };

function wallGeometry(node: PascalNode, frame: PascalFrame): WallGeometry | null {
  const start = node.start as Point2 | undefined;
  const end = node.end as Point2 | undefined;
  if (!Array.isArray(start) || !Array.isArray(end)) return null;
  return {
    nodeId: node.id,
    levelNodeId: node.parentId,
    startFeet: pascalPlanToFeet(frame, start),
    endFeet: pascalPlanToFeet(frame, end),
    thickness: typeof node.thickness === "number" ? node.thickness : 0.2,
    height: typeof node.height === "number" ? node.height : null,
    curveOffset: typeof node.curveOffset === "number" ? node.curveOffset : 0,
  };
}

function sameWall(a: WallGeometry, b: WallGeometry): boolean {
  const feet = SAME_POINT_METRES / METRES_PER_FOOT;
  const close = (p: Point2, q: Point2) => Math.abs(p[0] - q[0]) <= feet && Math.abs(p[1] - q[1]) <= feet;
  return close(a.startFeet, b.startFeet) && close(a.endFeet, b.endFeet) &&
    Math.abs(a.thickness - b.thickness) <= SAME_POINT_METRES &&
    Math.abs((a.height ?? -1) - (b.height ?? -1)) <= SAME_POINT_METRES &&
    Math.abs(a.curveOffset - b.curveOffset) <= SAME_POINT_METRES &&
    a.levelNodeId === b.levelNodeId;
}

function revitElementIdOf(node: PascalNode): number | null {
  const id = node.metadata?.revitElementId;
  return typeof id === "number" ? id : null;
}

/**
 * Wall edits between the scene Reviter exported and the scene a person saved.
 * Geometry is reported in Revit feet (each scene read in its own frame), so the
 * edits outlive the export they were made in.
 */
export function diffPascalWalls(
  baseline: PascalBuild,
  edited: PascalBuild,
  frames: { baseline?: PascalFrame; edited?: PascalFrame } = {},
): PascalWallEdit[] {
  const baselineFrame = readPascalFrame(baseline) ?? frames.baseline;
  const editedFrame = readPascalFrame(edited) ?? frames.edited ?? baselineFrame;
  if (!baselineFrame || !editedFrame) throw new Error("Both scenes need a Reviter frame to diff walls.");
  const walls = (scene: PascalBuild) => Object.values(scene.nodes).filter((node) => node.type === "wall");
  const before = new Map(walls(baseline).map((node) => [node.id, node]));
  const after = new Map(walls(edited).map((node) => [node.id, node]));
  const edits: PascalWallEdit[] = [];

  const newByElement = new Map<number, PascalNode[]>();
  for (const node of after.values()) {
    if (before.has(node.id)) continue;
    const elementId = revitElementIdOf(node);
    if (elementId == null) {
      const geometry = wallGeometry(node, editedFrame);
      if (geometry) edits.push({ kind: "added", nodeId: node.id, revitElementId: null, after: geometry, node });
      continue;
    }
    newByElement.set(elementId, [...(newByElement.get(elementId) ?? []), node]);
  }

  const removedByElement = new Map<number, WallGeometry[]>();
  for (const node of before.values()) {
    const was = wallGeometry(node, baselineFrame);
    if (!was) continue;
    const now = after.get(node.id);
    const elementId = revitElementIdOf(node);
    if (now) {
      const is = wallGeometry(now, editedFrame);
      if (is && !sameWall(was, is)) {
        edits.push({ kind: "modified", nodeId: node.id, revitElementId: elementId, before: was, after: is });
      }
      continue;
    }
    if (elementId != null && newByElement.has(elementId)) {
      removedByElement.set(elementId, [...(removedByElement.get(elementId) ?? []), was]);
      continue;
    }
    edits.push({ kind: "deleted", nodeId: node.id, revitElementId: elementId, before: was });
  }

  for (const [elementId, nodes] of newByElement) {
    const pieces = nodes.flatMap((node) => {
      const geometry = wallGeometry(node, editedFrame);
      return geometry ? [{ geometry, node }] : [];
    });
    const removed = removedByElement.get(elementId) ?? [];
    // A piece that appears while the original stays is a division (Pascal keeps
    // the first piece's id); one that appears as the original goes is a split.
    edits.push({ kind: "split", revitElementId: elementId, removed, pieces });
  }
  return edits;
}

export type RebaseWallEditsReport = {
  applied: number;
  /** Edits not replayed because the fresh export no longer matches their starting point. */
  conflicts: { edit: PascalWallEdit; reason: string }[];
};

/**
 * Replay wall edits on a fresh export (a re-conversion of an updated RVT) with
 * a three-way rule: an edit is replayed only if the fresh wall still equals the
 * geometry the edit started from. Where the RVT itself moved the wall, the
 * edit is reported as a conflict instead of guessed at. Mutates `fresh`.
 *
 * Replayed walls are written through the fresh scene's own frame, so an origin
 * that moved between exports is absorbed.
 */
export function rebaseWallEdits(
  fresh: PascalBuild,
  edits: readonly PascalWallEdit[],
  frame?: PascalFrame,
): RebaseWallEditsReport {
  const freshFrame = readPascalFrame(fresh) ?? frame;
  if (!freshFrame) throw new Error("The fresh scene needs a Reviter frame.");
  const report: RebaseWallEditsReport = { applied: 0, conflicts: [] };
  const current = (nodeId: string) => {
    const node = fresh.nodes[nodeId];
    return node?.type === "wall" ? { node, geometry: wallGeometry(node, freshFrame) } : null;
  };
  const place = (node: PascalNode, geometry: WallGeometry) => {
    node.start = feetToPascalPlan(freshFrame, geometry.startFeet);
    node.end = feetToPascalPlan(freshFrame, geometry.endFeet);
    node.thickness = geometry.thickness;
    if (geometry.height == null) delete node.height;
    else node.height = geometry.height;
    if (geometry.curveOffset) node.curveOffset = geometry.curveOffset;
    else delete node.curveOffset;
  };
  const attach = (node: PascalNode) => {
    const parent = node.parentId ? fresh.nodes[node.parentId] : undefined;
    if (!parent) return false;
    fresh.nodes[node.id] = node;
    parent.children = [...(parent.children ?? []).filter((id) => id !== node.id), node.id];
    return true;
  };

  for (const edit of edits) {
    if (edit.kind === "modified" || edit.kind === "deleted") {
      const found = current(edit.nodeId);
      if (!found?.geometry) {
        report.conflicts.push({ edit, reason: "wall is no longer in the fresh export" });
        continue;
      }
      if (!sameWall(found.geometry, edit.before)) {
        report.conflicts.push({ edit, reason: "the fresh export moved this wall too" });
        continue;
      }
      if (edit.kind === "modified") {
        place(found.node, edit.after);
        if (edit.after.levelNodeId && edit.after.levelNodeId !== found.node.parentId) {
          detach(fresh, found.node);
          found.node.parentId = edit.after.levelNodeId;
          if (!attach(found.node)) {
            report.conflicts.push({ edit, reason: "target level is missing" });
            continue;
          }
        }
      } else {
        if (found.node.children?.length) {
          report.conflicts.push({ edit, reason: "wall hosts doors or windows" });
          continue;
        }
        detach(fresh, found.node);
      }
      report.applied += 1;
      continue;
    }
    if (edit.kind === "added") {
      if (fresh.nodes[edit.nodeId]) {
        report.applied += 1;
        continue;
      }
      const node = { ...edit.node, children: [] };
      place(node, edit.after);
      if (attach(node)) report.applied += 1;
      else report.conflicts.push({ edit, reason: "target level is missing" });
      continue;
    }
    // split
    const originals = edit.removed.map((geometry) => ({ geometry, found: current(geometry.nodeId) }));
    if (originals.some(({ geometry, found }) => !found?.geometry || !sameWall(found.geometry, geometry))) {
      report.conflicts.push({ edit, reason: "the fresh export changed the wall that was split" });
      continue;
    }
    if (
      originals.some(({ found }) => found?.node.children?.length) ||
      edit.pieces.some(({ node }) => node.children?.length)
    ) {
      report.conflicts.push({ edit, reason: "split wall hosts doors or windows; re-host by hand" });
      continue;
    }
    for (const { found } of originals) detach(fresh, found!.node);
    for (const piece of edit.pieces) {
      const node = { ...piece.node, children: [] };
      place(node, piece.geometry);
      attach(node);
    }
    report.applied += 1;
  }
  return report;
}
