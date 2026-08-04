/**
 * Turning recovered records into renderable batches.
 *
 * Nothing here decodes the file — it decides how already-recovered evidence is
 * shown: which envelopes belong in the default scene, how they are grouped and
 * shaded, and the display materials that stand in for undecoded Revit materials.
 */
import { MIN_SOLID_SPAN_FEET } from "./bounds-records.ts";
import { REVIT_2027_FAMILY_SYMBOL_MARKER } from "./family-material-relations.ts";
import type { WallArc, WallSolid } from "./native-geometry.ts";
import { groupRings, triangulate, type Point2 } from "./polygon.ts";
import {
  CURTAIN_GRID_CELL_RECORD_CODE,
  NO_CLASS_RECORD_CODE,
  STAIR_COMPANION_CODE,
} from "./record-codes.ts";
import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";
import type { Point3 } from "./sketch-curves.ts";

import type {
  Bounds3,
  ElementBoundsRecord,
  LevelBand,
  MaterialData,
  MeshData,
  Segment,
  Vec3,
} from "./types";

const MESH_BATCH_SIZE = 2_000;

/** Fallback depth for a sketch whose element bounds have no vertical extent. */
const MIN_PRISM_THICKNESS_FEET = 0.02;

export function displayMaterials(): MaterialData[] {
  const fallback = (
    name: string,
    color: [number, number, number, number],
    roughness = 0.82,
  ): MaterialData => ({
    name,
    baseColorLinear: color,
    metallic: 0,
    roughness,
    doubleSided: true,
    source: "display-fallback",
    assignedElements: 0,
  });
  // The shaded view draws these flat, so the palette is what tells one category
  // from another on screen. The previous set sat inside a narrow pale band and
  // rendered the whole building as one wash; these are separated in hue and
  // value so walls, floors, glazing, and framing read apart at building scale.
  return [
    fallback("Unclassified display proxy", [0.55, 0.60, 0.66, 1]),
    fallback("Wall display proxy", [0.80, 0.77, 0.71, 1], 0.9),
    fallback("Door display proxy", [0.66, 0.42, 0.24, 1], 0.72),
    fallback("Panel display proxy", [0.40, 0.60, 0.74, 0.85], 0.5),
    fallback("Frame display proxy", [0.20, 0.26, 0.33, 1], 0.5),
    fallback("Structural display proxy", [0.44, 0.48, 0.54, 1], 0.84),
    // Native admission removes the rail-path proxy per railing before batches
    // are built. On the measured model 154 of 156 records carrying rail paths
    // are already native; this slot serves only the two evidence-starved
    // residual ribbons. Keep those visible and opaque instead of globally
    // fading the railing category to compensate for geometry no longer drawn.
    fallback("Railing display proxy", [0.28, 0.34, 0.41, 1], 0.58),
    fallback("Slab and roof display proxy", [0.86, 0.85, 0.82, 1], 0.95),
    fallback("Covering display proxy", [0.70, 0.72, 0.68, 1], 0.9),
    fallback("Glazing display proxy", [0.36, 0.66, 0.82, 0.55], 0.3),
    // Reconstructed stair runs used to share the dark-blue railing slot, then
    // a 0.29 neutral fallback. That second value made vertical risers read as
    // a single charcoal wall even where both IFC and Autodesk contain the same
    // stair body. Autodesk's two meshes covering the supplied curved run use
    // the exact neutral 127/255 palette entry; use that persisted visual
    // reference value for the evidence-only proxy without borrowing geometry.
    // Keep this at the end so every established fallback material index stays
    // stable.
    fallback("Stair display proxy", [127 / 255, 127 / 255, 127 / 255, 1], 0.2),
  ];
}

export type DisplayRole =
  | "wall"
  | "door"
  | "panel"
  | "frame"
  | "structure"
  | "railing"
  | "stair"
  | "slab"
  | "covering"
  | "glazing"
  /** Category decoded natively, but with no dedicated shading role. */
  | "native"
  /**
   * Geometry recovered, category not. The evidence for an element's envelope is
   * independent of the evidence for its label, so a record that carries a
   * validated duplicated-bounds block is drawn even when nothing names it.
   */
  | "unclassified";

/**
 * Display role per native Revit category. Curtain wall panels map to glazing
 * rather than an opaque panel: they are the glass of a facade, and drawing them
 * opaque walls the building off from its own interior.
 *
 * Display role per native Revit category. Every decoded id now resolves to a
 * published Revit category name; this table only decides shading, so a category
 * missing from it still displays under its real name.
 */
const CATEGORY_DISPLAY_ROLE: Record<number, DisplayRole> = {
  [-2000011]: "wall",
  [-2000014]: "glazing",
  [-2000023]: "door",
  [-2000032]: "slab",
  [-2000035]: "slab",
  [-2000038]: "covering",
  [-2000100]: "structure",
  [-2000120]: "structure",
  [-2000126]: "railing",
  [-2000170]: "glazing",
  [-2000171]: "frame",
  [-2000180]: "structure",
  [-2001330]: "structure",
  [-2000045]: "railing",
  [-2000067]: "railing",
  [-2000123]: "railing",
  [-2000127]: "railing",
  // A run and a landing are physical stair bodies. They previously inherited
  // the railing material, which turned the reconstructed tread band blue even
  // though its RVT sketch evidence already describes the individual steps.
  [-2000919]: "stair",
  [-2000920]: "stair",
  [-2000938]: "railing",
  [-2000945]: "railing",
  [-2000946]: "railing",
  [-2000954]: "railing",
};

/**
 * Per-role vertex tint, taken from each role's display material.
 *
 * Vertex colours multiply the material, so emitting one elevation ramp for every
 * element — as this did — flattens all ten materials back to a single wash and
 * throws away the category work. Tinting by role instead lets a facade read as
 * glazing and mullions, a floor as a slab, a door as a door.
 */
const ROLE_TINT: Record<DisplayRole, [number, number, number]> = {
  native: [0.58, 0.68, 0.79],
  unclassified: [0.55, 0.60, 0.66],
  wall: [0.72, 0.78, 0.85],
  door: [0.78, 0.56, 0.32],
  panel: [0.55, 0.74, 0.86],
  frame: [0.30, 0.38, 0.47],
  structure: [0.55, 0.62, 0.70],
  railing: [0.36, 0.43, 0.51],
  stair: [0.58, 0.58, 0.56],
  slab: [0.80, 0.82, 0.85],
  covering: [0.78, 0.79, 0.76],
  glazing: [0.48, 0.74, 0.88],
};

const DISPLAY_MATERIAL_INDEX: Record<DisplayRole, number> = {
  native: 0,
  unclassified: 0,
  wall: 1,
  door: 2,
  panel: 3,
  frame: 4,
  structure: 5,
  railing: 6,
  slab: 7,
  covering: 8,
  glazing: 9,
  stair: 10,
};

/**
 * The record shape a curtain-wall container is written in.
 *
 * This is a record-code fingerprint measured on one building, so on its own it
 * is a guess about a byte pattern, not a statement about the element. It is
 * kept because it is the only container evidence available when no category
 * token decodes — but where a category *is* decoded, `CONTAINER_CATEGORIES`
 * has the final say.
 */
function matchesWrapperRecordShape(record: ElementBoundsRecord): boolean {
  const hasNamedAnalyticSolid =
    !!record.typeName && (!!record.solid || (record.solids?.length ?? 0) > 0);
  const count = record.recordCount;
  return !hasNamedAnalyticSolid && record.recordCode === 30 &&
    count != null && count >= 8 && count <= 10;
}

/**
 * Categories Revit can model as a host holding other elements' geometry.
 *
 * The wrapper fingerprint used to run ahead of the decoded category and win,
 * which meant a byte pattern from one building could hide an element the file
 * had *named*. On the supplied model it claimed 1,840 records — and every one
 * of them carried a decoded category, so the fingerprint was never breaking a
 * tie, it was overruling evidence.
 *
 * Of those 1,840, **1,809 are `Walls`** and a curtain wall is a Wall in Revit,
 * so the rule was right about the overwhelming majority. The other 31 are not
 * containers at all — 14 Curtain Wall Mullions, 9 Curtain Grids Wall, 8 Curtain
 * Wall Panels — they are precisely the *children* a wrapper exists to reveal,
 * and hiding them removed real facade geometry from the scene.
 *
 * Requiring the category to be one that can host keeps all 1,809 and returns
 * those 31 to the scene. A record with no decoded category is unaffected: the
 * fingerprint still stands alone there, because nothing better exists.
 */
const CONTAINER_CATEGORIES = new Set([
  -2000011, // Walls — a curtain wall is a Wall hosting panels and mullions
  -2000035, // Roofs — a curtain-system roof hosts the same way
  -2000090, // Curtain Systems — the non-wall, non-roof host of the same parts
]);

export function displayRole(record: ElementBoundsRecord): DisplayRole | "wrapper" | "unknown" {
  const code = record.recordCode;
  const count = record.recordCount;
  // A curtain-wall container stays a wrapper even once its category is known,
  // so its child panels and mullions are not swallowed by one large envelope.
  // Whether a wrapper is actually held back is decided by `selectDisplayBounds`,
  // which checks that a facade is there to stand in its place.
  // A named wall whose own planes rebuilt a solid is not merely a container.
  // The UNBC IFC corroborates all 11 such records as drawable wall products;
  // treating them as wrappers hid valid solids whenever nearby facade elements
  // happened to stand inside their envelopes.
  const isWrapper = matchesWrapperRecordShape(record) &&
    (record.categoryId == null || CONTAINER_CATEGORIES.has(record.categoryId));
  if (!isWrapper && record.categoryId != null) {
    return CATEGORY_DISPLAY_ROLE[record.categoryId] ?? "native";
  }
  if (code === 30 && count === 5) return "wall";
  if (isWrapper) return "wrapper";
  if (code === 44 && count === 1) return "door";
  if (code === 114 && count === 1) return "panel";
  if ((code === 116 && count === 1) || (code === 179015 && count === 3)) return "frame";
  if (code === 79 && (count === 1 || count === 3)) return "structure";
  if (code === 101 && (count === 2 || count === 3)) return "railing";
  if ((code === 54 || code === 58) && count === 1) return "slab";
  if (code === 62 && count === 1) return "covering";
  if (code === 34 && count === 1) return "glazing";
  if (code === 81 || (code === 107 && count === 4)) return "structure";
  return "unknown";
}

export type DisplaySelection = {
  records: ElementBoundsRecord[];
  /**
   * Curtain-wall/opening containers omitted because their panels and mullions
   * are drawn instead. Their envelopes are also the only recovered evidence of
   * the void Revit cuts through an intersecting host wall.
   */
  openingWrappers: ElementBoundsRecord[];
  omittedContainerCount: number;
  omittedWrapperCount: number;
  /** Records drawn without a decoded category, under the unclassified role. */
  unclassifiedCount: number;
  /** Sheets held back: a sketch drawn twice, or an unnamed storey-sized plate. */
  omittedSheetCount: number;
};

/**
 * Plan area above which an envelope with no category at all is a sheet.
 *
 * Size alone proves nothing — the largest real slab in the supplied model is
 * 371 × 686 ft, far bigger than any of these. Size *with no decoded category*
 * is the discriminator: of the 50 envelopes over 10,000 sq ft that do carry a
 * category, the paired export names **49**; of the 22 that carry none, it names
 * **none**. A 100 × 100 ft plate that no category claims is not a building
 * element, and drawing it puts a sheet across the model.
 */
const UNNAMED_SHEET_AREA_SQ_FEET = 10_000;

/** Plan agreement between a boundary sketch and the element that owns it. */
const OWNER_SKETCH_TOLERANCE_FEET = 0.5;

/**
 * Categories Revit models as part of another element rather than on their own.
 *
 * A railing's top rail is a real handrail, but Revit records its envelope as the
 * whole railing's, and the IFC exporter folds it into the one `IfcRailing`: of
 * the 178 top rails in the supplied model the export names **none**, while 158
 * of them reproduce a drawn railing's plan extent to within half a foot. Drawn
 * on its own it is a second thin plate lying along a railing already in the
 * scene.
 *
 * The other line-like categories are deliberately *not* here. `Stairs Paths`,
 * `Stairs Sketch Boundary Lines` and `Sketch Lines` look like drawing aids by
 * their names, and the export names 18 of 20, 12 of 12 and 1 of 1 of them — as
 * stairs, stair flights and a covering. Those are real elements whose category
 * was inherited wrongly, and dropping them would take the building with them.
 */
const SUB_ELEMENT_CATEGORIES = new Map<number, number>([
  [-2000946, -2000126], // a top rail belongs to a railing
]);

/**
 * Drawing-aid categories that must never be represented by an envelope proxy.
 *
 * Some real stair products inherit one of these category tokens in this file,
 * so they cannot be removed during the initial display selection: a later
 * native or reconstructed mesh for the same element id is still legitimate.
 * The conversion pipeline applies this predicate only to the records left on
 * the proxy path after native admission. That removes the large helper boxes
 * without suppressing a resolved stair flight or railing.
 *
 * `Stairs Railing Baluster` joins the set on the same evidence pattern as the
 * others. A baluster record is not a baluster: it is the per-railing *set* —
 * its envelope is the railing's plan extent times a storey of height, it sits
 * on the all-ones "no class" record code with no geometry evidence of any
 * kind, its persisted owner is the railing's top rail, and it owns the
 * ElemTable rows that are the actual balusters. Drawn as a fallback envelope
 * it is a solid wall standing in a railing's run — 19 such boxes on the
 * supplied model, up to 20.7 x 19.0 x 9.5 ft — while the railing itself is
 * already drawn as its swept ribbon. The export never gives these records
 * geometry, in keeping with the all-ones measurement above. Native baluster
 * meshes, where they exist, are untouched: this predicate only ever sees the
 * proxy path.
 */
const PROXY_ONLY_HELPER_CATEGORY_IDS = new Set([
  -2000120, // Stairs (assembly container; children carry the geometry)
  -2000954, // Railing Rail Path Extension Lines
  -2000938, // Stairs Paths
  -2000067, // Stairs Sketch Boundary Lines
  -2000045, // Sketch Lines
  -2000127, // Stairs Railing Baluster (the per-railing set container)
]);

/** `RampSym` tag 3463 is persisted as marker 3462 in Revit 2027. */
const REVIT_2027_RAMP_SYMBOL_MARKER = 3462;

/** `ContourLabelingElem`, an annotation/drawing-aid class in Formats/Latest. */
const REVIT_2027_CONTOUR_LABELING_ELEMENT_MARKER = 974;

/**
 * An unlabelled type/annotation definition is not a placed scene element.
 *
 * Both identities come from exact framed classes in the file's own schema.
 * Requiring no placement prevents a FamilyInstance from being mistaken for its
 * FamilySymbol, and requiring no category keeps the rule from overruling an
 * element the file itself names.
 */
export function isNonSceneObjectDefinition(
  record: Pick<ElementBoundsRecord, "categoryId" | "categoryName">,
  nativeMarkers: ReadonlySet<number> | undefined,
  hasInstancePlacement: boolean,
): boolean {
  if (record.categoryId != null || record.categoryName || hasInstancePlacement) {
    return false;
  }
  return Boolean(
    nativeMarkers?.has(REVIT_2027_CONTOUR_LABELING_ELEMENT_MARKER) ||
      nativeMarkers?.has(REVIT_2027_FAMILY_SYMBOL_MARKER),
  );
}

/**
 * Native faces that belong to persisted drawing helpers rather than model
 * elements.
 *
 * Stair companion records are the sketch-side box that the owning stair part
 * one id below already adopts.  Categoryless, synthetic horizontal geometry
 * is likewise 2D sketch residue: it has no persisted element envelope, no
 * independently rebuilt body, and no volume to display. Both are excluded
 * from native batches as well as from proxy selection so the exact-mesh path
 * cannot put a helper back into the scene after the display selector removed
 * it.
 */
export function nonSceneNativeMeshHelperIds(
  records: readonly ElementBoundsRecord[],
): Set<number> {
  const ids = new Set(records.map((record) => record.elementId));
  const helpers = new Set<number>();
  for (const record of records) {
    if (
      record.recordCode === STAIR_COMPANION_CODE &&
      record.recordCount === 1 &&
      ids.has(record.elementId - 1)
    ) {
      helpers.add(record.elementId);
      continue;
    }
    if (
      record.categoryId == null &&
      !record.categoryName &&
      record.recordOffset < 0 &&
      !record.loops?.length &&
      !record.stairTreads?.length &&
      !record.railPath &&
      !record.solid &&
      !record.solids?.length &&
      !record.arcs?.length &&
      Math.abs(record.boundsFeet.max.z - record.boundsFeet.min.z) <= 1e-6
    ) {
      helpers.add(record.elementId);
    }
  }
  return helpers;
}

/**
 * Categoryless fallback bodies almost wholly embedded in a recovered wall.
 *
 * These are not openings: no category, hosted relation, face set, or exported
 * product identifies them as one. When their only drawable evidence is an
 * envelope inside an opaque wall, drawing that envelope duplicates the host
 * and any small overhang becomes a conspicuous block.
 *
 * The 95% threshold is deliberately about the anonymous body's volume, not an
 * arbitrary distance. On UNBC it identifies the three-object cluster piercing
 * stair 1460781: two bodies are 100% inside native wall 761182 and the third is
 * 96.1% inside it; Autodesk IFC and GLB contain the wall but neither contains
 * the cluster. A named or categorised insert is never eligible.
 */
export function anonymousWallDuplicateProxyIds(
  records: readonly ElementBoundsRecord[],
  minimumContainedFraction = 0.95,
): Set<number> {
  const walls = records.filter((record) =>
    record.categoryId === -2_000_011 || record.categoryName === "Walls");
  const duplicates = new Set<number>();
  for (const record of records) {
    if (record.categoryId != null || record.categoryName) continue;
    const bounds = record.boundsFeet;
    const volume =
      (bounds.max.x - bounds.min.x) *
      (bounds.max.y - bounds.min.y) *
      (bounds.max.z - bounds.min.z);
    if (!(volume > 0)) continue;
    for (const wall of walls) {
      const other = wall.boundsFeet;
      const overlap =
        Math.max(0, Math.min(bounds.max.x, other.max.x) - Math.max(bounds.min.x, other.min.x)) *
        Math.max(0, Math.min(bounds.max.y, other.max.y) - Math.max(bounds.min.y, other.min.y)) *
        Math.max(0, Math.min(bounds.max.z, other.max.z) - Math.max(bounds.min.z, other.min.z));
      if (overlap / volume >= minimumContainedFraction) {
        duplicates.add(record.elementId);
        break;
      }
    }
  }
  return duplicates;
}

/** Remove selected elements' triangles while preserving batch material data. */
export function excludeMeshElementIds(
  meshes: readonly MeshData[],
  excluded: ReadonlySet<number>,
): MeshData[] {
  if (!excluded.size) return [...meshes];
  const filtered: MeshData[] = [];
  for (const mesh of meshes) {
    const ids = mesh.elementIds;
    if (!ids || ids.length * 3 !== mesh.indices.length) {
      filtered.push(mesh);
      continue;
    }
    let keptTriangles = 0;
    for (const elementId of ids) if (!excluded.has(elementId)) keptTriangles += 1;
    if (keptTriangles === ids.length) {
      filtered.push(mesh);
      continue;
    }
    if (!keptTriangles) continue;
    const indices = new Uint32Array(keptTriangles * 3);
    const elementIds = new Uint32Array(keptTriangles);
    let at = 0;
    for (let triangle = 0; triangle < ids.length; triangle += 1) {
      const elementId = ids[triangle]!;
      if (excluded.has(elementId)) continue;
      indices[at * 3] = mesh.indices[triangle * 3]!;
      indices[at * 3 + 1] = mesh.indices[triangle * 3 + 1]!;
      indices[at * 3 + 2] = mesh.indices[triangle * 3 + 2]!;
      elementIds[at] = elementId;
      at += 1;
    }
    filtered.push({ ...mesh, indices, elementIds });
  }
  return filtered;
}

export function isStairOrRailingHelperProxy(
  record: Pick<
    ElementBoundsRecord,
    | "categoryId"
    | "categoryName"
    | "stairTreads"
    | "railPath"
    | "loops"
    | "solid"
    | "solids"
    | "arcs"
    | "orientedBox"
  > & Partial<Pick<ElementBoundsRecord, "boundsFeet">>,
  nativeObjectMarker?: number,
): boolean {
  if (
    record.stairTreads?.length ||
    record.railPath ||
    record.loops?.length ||
    record.solid ||
    record.solids?.length ||
    record.arcs?.length ||
    record.orientedBox
  ) {
    return false;
  }
  // `BaseRailingSym` is the native per-railing baluster-set definition. Its
  // bounds span from the host stair/landing to the top rail and therefore form
  // a storey-high box, not a physical railing solid. Most such records inherit
  // `Stairs Railing Baluster`; a small record-code tail has no category token,
  // so the exact framed class marker is the stronger fallback identity.
  if (nativeObjectMarker === REVIT_2027_BASE_RAILING_SYMBOL_MARKER) {
    return true;
  }
  // TopRailType is a railing-owned geometry definition. Flat definitions are
  // admitted as native meshes before this predicate runs; an unresolved
  // sloped definition must not become a stair-flight-sized envelope box.
  if (nativeObjectMarker === REVIT_2027_TOP_RAIL_TYPE_MARKER) {
    return true;
  }
  // RampSym is the per-ramp symbol/helper record. Its curves describe helper
  // regions, while the Ramp instance is the physical scene element; an
  // unresolved symbol envelope otherwise becomes a 24.6 x 9.6 x 3.8 ft block.
  if (nativeObjectMarker === REVIT_2027_RAMP_SYMBOL_MARKER) {
    return true;
  }
  // Some Stairs Stringer Carriage records are persisted as a near-zero-width
  // vertical aid rather than as the physical stringer. The paired IFC proves
  // the two tagged examples: their fallback records are 0.04 x 0.06 x 9.84 ft
  // and 0.05 x 0.08 x 9.84 ft, while the exported products are ordinary
  // tread-height components. A sub-inch plan section spanning more than five
  // feet cannot be a usable carriage solid, so do not inflate that aid into a
  // visible needle. Native or reconstructed stringers returned above remain.
  if (record.categoryName === "Stairs Stringer Carriage" && record.boundsFeet) {
    const width = record.boundsFeet.max.x - record.boundsFeet.min.x;
    const depth = record.boundsFeet.max.y - record.boundsFeet.min.y;
    const height = record.boundsFeet.max.z - record.boundsFeet.min.z;
    if (Math.max(width, depth) <= 0.1 && height >= 5) return true;
  }
  return (
    (record.categoryId != null &&
      PROXY_ONLY_HELPER_CATEGORY_IDS.has(record.categoryId)) ||
    record.categoryName === "Railing Rail Path Extension Lines" ||
    record.categoryName === "Stairs Paths" ||
    record.categoryName === "Stairs Sketch Boundary Lines" ||
    record.categoryName === "Sketch Lines" ||
    record.categoryName === "Stairs Railing Baluster"
  );
}

type PersistedOwnershipEdge = {
  ownerId: number;
  elementId: number;
};

function hasIndependentRecoveredGeometry(record: ElementBoundsRecord): boolean {
  return Boolean(
    record.stairTreads?.length ||
    record.railPath ||
    record.loops?.length ||
    record.solid ||
    record.solids?.length ||
    record.arcs?.length ||
    record.orientedBox ||
    record.inferredCurtainPanelGeometry,
  );
}

/**
 * Unresolved curtain-assembly records whose bounds are containers, not solids.
 *
 * There are two independently checkable encodings:
 *
 * - code 34702 is a curtain-grid cell. It is omitted only when its persisted
 *   owner is a curtain-wall wrapper that also owns a resolved panel or mullion;
 * - an all-ones/no-class record is an assembly shell when it itself owns a
 *   resolved facade child. Object 2322290 is exactly this form: the shell was
 *   mislabelled as a mullion, while its child carries the actual mullion mesh.
 *
 * The caller supplies the ids that reached the native scene. Consequently a
 * missing or declined child keeps the fallback envelope as the only available
 * trace, and any record with its own reconstructed geometry is retained.
 */
export function curtainAssemblyHelperProxyIds(
  records: readonly ElementBoundsRecord[],
  ownership: readonly PersistedOwnershipEdge[],
  resolvedElementIds: ReadonlySet<number>,
): Set<number> {
  const byId = new Map(records.map((record) => [record.elementId, record]));
  const ownerByElement = new Map<number, number>();
  const resolvedFacadeOwners = new Set<number>();

  for (const relation of ownership) {
    ownerByElement.set(relation.elementId, relation.ownerId);
    const child = byId.get(relation.elementId);
    if (
      child?.categoryId != null &&
      FACADE_CATEGORY_IDS.has(child.categoryId) &&
      resolvedElementIds.has(child.elementId)
    ) {
      resolvedFacadeOwners.add(relation.ownerId);
    }
  }

  const helpers = new Set<number>();
  for (const record of records) {
    if (
      resolvedElementIds.has(record.elementId) ||
      hasIndependentRecoveredGeometry(record)
    ) {
      continue;
    }

    if (
      record.recordCode === NO_CLASS_RECORD_CODE &&
      resolvedFacadeOwners.has(record.elementId)
    ) {
      helpers.add(record.elementId);
      continue;
    }

    if (record.recordCode !== CURTAIN_GRID_CELL_RECORD_CODE) continue;
    const ownerId = ownerByElement.get(record.elementId);
    const owner = ownerId == null ? undefined : byId.get(ownerId);
    if (
      owner &&
      owner.elementId !== record.elementId &&
      displayRole(owner) === "wrapper" &&
      resolvedFacadeOwners.has(owner.elementId)
    ) {
      helpers.add(record.elementId);
    }
  }
  return helpers;
}

function planArea(record: ElementBoundsRecord): number {
  const { min, max } = record.boundsFeet;
  return (max.x - min.x) * (max.y - min.y);
}

function planMatches(a: ElementBoundsRecord, b: ElementBoundsRecord): boolean {
  return (
    Math.abs(a.boundsFeet.min.x - b.boundsFeet.min.x) <= OWNER_SKETCH_TOLERANCE_FEET &&
    Math.abs(a.boundsFeet.min.y - b.boundsFeet.min.y) <= OWNER_SKETCH_TOLERANCE_FEET &&
    Math.abs(a.boundsFeet.max.x - b.boundsFeet.max.x) <= OWNER_SKETCH_TOLERANCE_FEET &&
    Math.abs(a.boundsFeet.max.y - b.boundsFeet.max.y) <= OWNER_SKETCH_TOLERANCE_FEET
  );
}

/**
 * A sheet: geometry that is drawn but is not a building element.
 *
 * Two kinds, both found by overlaying the recovery on the paired export and
 * looking at what stuck out past the building.
 *
 * **A floor's own boundary sketch.** Revit keeps it as an element in its own
 * right, one id below the floor, with the same footprint and no thickness, and
 * the decoder was extruding it into a second slab hovering over the first —
 *
 *     1495202  142 × 156 × 0.66 ft  z 43.3  Floors     (in the export)
 *     1495201  142 × 156 × 0.00 ft  z 44.0  (none)     (not in the export)
 *
 * The check is the pairing itself, not the shape: no category, no thickness, a
 * ring instead of a solid, and an element one id above with the same plan
 * extent. On the supplied model that is 39 records, **none** of which the
 * export names, and the same shape never occurs on a categorised element.
 *
 * **An unnamed storey-sized plate**, per `UNNAMED_SHEET_AREA_SQ_FEET`.
 *
 * **A sub-element lying along its parent**, per `SUB_ELEMENT_CATEGORIES`.
 *
 * **An unnamed record of no class**, per `NO_CLASS_RECORD_CODE`.
 */
/**
 * True when all the element has is a hull over the faces attributed to it.
 *
 * `convert.ts` synthesises a record from that hull so a ring or a placement can
 * attach to the element later, and where one does the element is drawn from it.
 * Where none does, the hull is what would be drawn, and measured against the
 * paired export **37 of the 40** such elements are more than a foot out with a
 * median error of 7.96 ft — one of them a 0.2 × 0.5 × 4.3 ft mullion drawn as a
 * 168 × 366 ft hull over faces that are not its own. Of the three inside a
 * foot, two are undersized fragments that merely fail to overhang.
 *
 * A synthesised record is recognisable by construction: it has no offset into
 * the file, and one synthesised from a solid or a placement carries that solid
 * or that box.
 */
function isFaceHullOnly(record: ElementBoundsRecord): boolean {
  return (
    record.recordOffset < 0 &&
    (record.quads?.length ?? 0) > 0 &&
    !record.loops?.length &&
    !record.stairTreads?.length &&
    !record.orientedBox &&
    !record.railPath &&
    !record.solid &&
    !record.solids?.length
  );
}

/**
 * `convert.ts` hands the companion's box to the run one id below; what is left
 * here is a record the export names in none of its 111 cases, sitting on top of
 * a stair part that is now drawn correctly. It is held back only when that
 * owner exists, so a companion whose stair part was never recovered stays as
 * its only trace.
 *
 * The code itself lives in `record-codes.ts`: it is a byte value observed in
 * one file, and two modules keeping their own copy of it meant a re-measurement
 * could correct one and leave the other reading a stale number.
 */

/**
 * The record code that means "no class", and which no building element uses.
 *
 * `bounds-records.ts` accepts `0xffffffff` as a self-consistent no-code variant:
 * every record carrying it also carries `0xffffffff` in the reserved word the
 * detector otherwise requires to be zero — 1,206 of the 42,333 records in the
 * stream, 861 of which reach `elementBounds` — so this is a deliberate encoding
 * rather than a corrupt code. What it *means* was never established, and it
 * turns out to be decisive.
 *
 * **The RVT says it on its own.** Of the 465 all-ones records whose category
 * does decode, **450 — 96.8% — carry a drawing aid or an assembly container**:
 * 231 `Railing Top Rail`, 67 `Railing Rail Path Extension Lines`, 67
 * `Stairs Railing Baluster`, 28 `Stairs`, 21 `Stairs Paths`, 21 `Sketch Lines`,
 * 15 `Stairs Sketch Boundary Lines`. Over the 31,359 categorised records with an
 * ordinary record code the same categories account for **1.3%** — a 74-fold
 * enrichment, measured without any reference file.
 *
 * **The paired export agrees, unanimously.** Of the 304 all-ones records that
 * reach the scene the export gives mesh geometry to **0**, against a base rate
 * of 97.8% over all 35,720 drawn records — 297 expected at chance. Rotating the
 * truth 12,345 places against the drawn order names 304 of 304.
 *
 * Only the records that also have **no decoded category** are held back, which
 * is 187 of the 304 and 53,866 sq ft of plan. Anonymity is required for the
 * same reason it is required by `UNNAMED_SHEET_AREA_SQ_FEET`: `Stairs Paths`,
 * `Sketch Lines` and `Stairs Sketch Boundary Lines` land on this code too, and
 * the export names 18 of 20, 1 of 1 and 12 of 12 of them as stairs, stair
 * flights and a covering — real elements that inherited a drawing aid's
 * category, and dropping them by name would take the building with them.
 *
 * It also explains the rule above it rather than competing with it. Of the 24
 * uncategorised drawable envelopes over `UNNAMED_SHEET_AREA_SQ_FEET`, **20 carry
 * this code** — so "storey-sized and unnamed" was mostly reading this same
 * encoding through its effect. The remaining 4 keep the size rule alive, and
 * the one element the size rule is known to cost — `1522385`, an `IfcMember`
 * with a 61,572 sq ft footprint, which is to say a misparse — is not one of the
 * 20, so this rule does not cost it.
 *
 * The cost is stated rather than nil. All 187 stand inside volume that stays
 * drawn — 144 of them survive a 10 ft displacement, 68 a 25 ft one, 0 a 100 ft
 * one, so that is a fit to the building rather than to the whole model's
 * extent — and 4 carry an export product: `Assembled Stair:Stair` assemblies
 * with no mesh of their own, each standing over 4 to 24 stair parts that stay in
 * the scene. `IFCSTAIR` drops from 57 to 51 in the coverage table's drawn
 * column, 6 products for those 4 elements because one is a multistorey stair the
 * exporter splits per storey — the same trade `IFCCURTAINWALL` already makes,
 * a container held back because its parts are drawn instead.
 *
 * The value itself is `NO_CLASS_RECORD_CODE` in `record-codes.ts`.
 */

/**
 * Which of the sheet rules claims a record, or `null` when none does.
 *
 * `isSheet` is this predicate's boolean face. The reason is kept separate so a
 * census can group what is held back **by cause** rather than by class — every
 * round of this work so far chased one class at a time, and the buckets a class
 * splits into are what decide whether a gap is reachable.
 */
function sheetReason(
  record: ElementBoundsRecord,
  byId: Map<number, ElementBoundsRecord>,
  all: ElementBoundsRecord[],
): HoldBackReason | null {
  if (isFaceHullOnly(record)) return "face-hull-only";
  if (record.recordCode === STAIR_COMPANION_CODE && record.recordCount === 1) {
    return byId.has(record.elementId - 1) ? "stair-companion" : null;
  }
  const parentCategory = record.categoryId == null
    ? undefined
    : SUB_ELEMENT_CATEGORIES.get(record.categoryId);
  if (parentCategory != null) {
    // The evidence is the duplicate footprint, not the shape: a top rail on a
    // stair carries the railing's whole rise, up to 24.9 ft here, so a
    // thickness test would keep exactly the ones that hide the most. Requiring
    // a parent keeps a top rail whose railing was never recovered, which is
    // then the only trace of that railing in the scene.
    return all.some((other) => other.categoryId === parentCategory && planMatches(record, other))
      ? "sub-element"
      : null;
  }
  if (record.categoryId != null || record.categoryName) return null;
  if (record.recordCode === NO_CLASS_RECORD_CODE) return "no-class-code";
  if (planArea(record) > UNNAMED_SHEET_AREA_SQ_FEET) return "unnamed-plate";
  const { min, max } = record.boundsFeet;
  if (max.z - min.z > MIN_SOLID_SPAN_FEET) return null;
  if (!record.loops?.length) return null;
  const owner = byId.get(record.elementId + 1);
  return owner && planMatches(record, owner) ? "floor-sketch" : null;
}

function isSheet(
  record: ElementBoundsRecord,
  byId: Map<number, ElementBoundsRecord>,
  all: ElementBoundsRecord[],
): boolean {
  return sheetReason(record, byId, all) !== null;
}

/**
 * Curtain panels and mullions — the two categories a facade is made of, and the
 * geometry a held-back container is traded for.
 */
const FACADE_CATEGORY_IDS = new Set([-2_000_170, -2_000_171]);

/** A record counts as standing inside a wrapper when its centre does, within this. */
const WRAPPER_OCCUPANT_SLACK_FEET = 0.5;

/**
 * Records of any kind inside a wrapper, at or above which it is still treated as
 * a container even though no curtain panel or mullion was categorised in it.
 *
 * Measured against the paired export rather than chosen: of the 1,607 records the
 * wrapper rule held back, **27 are ordinary walls the export names** — 18
 * `IfcWallStandardCase` and 9 `IfcWall` — and 6 are curtain walls not one of
 * whose panels was recovered. All 33 were simply missing from the building, hidden
 * by a rule that assumed a facade had taken their place.
 *
 * Category alone does not separate them: 26 of the 27 walls hold no panel or
 * mullion, but so do 21 curtain walls whose panels are drawn with no category
 * decoded, and releasing those would lay a sheet over them. A count alone does not
 * either — a curtain wall holds a median of 14 other records and an ordinary wall
 * 2, but the tails cross, and a count cut that recovers 21 walls also releases 15
 * curtain walls, 11 of them over drawn panels. Requiring **both** — no facade
 * element *and* an uncrowded envelope — recovers 21 walls for 1 curtain wall
 * released over drawn children.
 *
 * The floor is a plateau, not a fit: 3, 4 and 5 all cost exactly that 1, while 6
 * costs 5 and recovers no further wall. Two measures that looked promising are
 * recorded as failures so they are not retried — the share of a wrapper's plan
 * footprint filled by *any* drawn record separates the wrong way (walls read 1.00
 * against curtain walls' 0.45, because a floor slab under a wall covers its whole
 * plan footprint), and so does the share filled by the records inside it (0.79
 * against 0.20).
 */
const WRAPPER_CROWD_FLOOR = 5;

/** Bucket size for the wrapper occupancy index, in feet. */
const OCCUPANCY_GRID_FEET = 25;

/**
 * The wrappers that are genuinely standing in for something.
 *
 * "Its panels and mullions are drawn instead" is a claim, and it is checkable
 * from the RVT alone: the categories are decoded natively, and a container's
 * children sit inside its envelope. Where the claim fails the record is drawn,
 * because an unnamed box in the right place beats a hole in the building.
 */
function heldBackWrappers(records: ElementBoundsRecord[]): Set<ElementBoundsRecord> {
  const held = new Set<ElementBoundsRecord>();
  const wrappers = records.filter((record) => displayRole(record) === "wrapper");
  if (!wrappers.length) return held;

  const buckets = new Map<string, ElementBoundsRecord[]>();
  const centreOf = (record: ElementBoundsRecord) => {
    const { min, max } = record.boundsFeet;
    return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  };
  for (const record of records) {
    const centre = centreOf(record);
    const key = `${Math.floor(centre.x / OCCUPANCY_GRID_FEET)},${Math.floor(centre.y / OCCUPANCY_GRID_FEET)}`;
    const list = buckets.get(key);
    if (list) list.push(record);
    else buckets.set(key, [record]);
  }

  for (const wrapper of wrappers) {
    const { min, max } = wrapper.boundsFeet;
    const slack = WRAPPER_OCCUPANT_SLACK_FEET;
    let occupants = 0;
    let facade = 0;
    for (
      let x = Math.floor((min.x - slack) / OCCUPANCY_GRID_FEET);
      x <= Math.floor((max.x + slack) / OCCUPANCY_GRID_FEET);
      x += 1
    ) {
      for (
        let y = Math.floor((min.y - slack) / OCCUPANCY_GRID_FEET);
        y <= Math.floor((max.y + slack) / OCCUPANCY_GRID_FEET);
        y += 1
      ) {
        for (const other of buckets.get(`${x},${y}`) ?? []) {
          if (other === wrapper) continue;
          const centre = centreOf(other);
          if (centre.x < min.x - slack || centre.x > max.x + slack) continue;
          if (centre.y < min.y - slack || centre.y > max.y + slack) continue;
          if (centre.z < min.z - slack || centre.z > max.z + slack) continue;
          occupants += 1;
          if (other.categoryId != null && FACADE_CATEGORY_IDS.has(other.categoryId)) facade += 1;
        }
      }
    }
    if (facade > 0 || occupants >= WRAPPER_CROWD_FLOOR) held.add(wrapper);
  }
  return held;
}

/**
 * Choose the envelopes that belong in the default scene.
 *
 * Held back: curtain-wall and opening wrappers **whose facade is actually in the
 * scene**, per `heldBackWrappers`; a single building-sized container that would
 * otherwise hide everything behind it; and sheets — a floor's own boundary sketch
 * redrawn as a second slab, and storey-sized plates no category claims.
 *
 * A record whose category did not decode is **not** held back. Its envelope
 * came from the same validated duplicated-bounds signature as every other
 * record's, and dropping it trades a missing label for a missing building
 * element — a hole in the model rather than an unnamed part of it.
 */
/**
 * Every element's display role, keyed by element id.
 *
 * The viewer needs this because a render batch is not a category. Proxy batches
 * are grouped by decoded category and carry a display material that already
 * encodes the role, but native BRep batches are grouped by *native material*,
 * so a batch can hold several categories and its material says nothing about
 * what the elements are. Handing the viewer the per-element roles lets it make
 * a role-aware decision — drawing glazing as glazing, say — from the decoded
 * category rather than from a batch's name or its material's alpha.
 */
export function elementDisplayRoles(
  records: ElementBoundsRecord[],
): Map<number, DisplayRole> {
  const roles = new Map<number, DisplayRole>();
  for (const record of records) {
    const resolved = displayRole(record);
    if (resolved === "unknown" || resolved === "wrapper") continue;
    roles.set(record.elementId, resolved);
  }
  return roles;
}

/**
 * Element ids the file's own categories say are glazing.
 *
 * Named separately from `elementDisplayRoles` because transparency is the one
 * display decision that cannot be carried by a batch's material: Revit's
 * persisted material transparency is not decoded yet, so every native material
 * arrives opaque — including the one this model names `Стекло`, which is
 * *glass*, and which carries 74,968 of the model's 76,314 glazing triangles.
 * Every window in the model rendered as a solid blue plate because of it.
 *
 * The category is decoded evidence, and it is the same evidence the proxy path
 * already uses to pick the translucent glazing display material. This extends
 * it to native geometry rather than introducing a new rule. The limitation is
 * real and worth stating: Revit models a solid spandrel panel as a curtain wall
 * panel too, so a spandrel is drawn translucent here. Until the persisted
 * transparency field is decoded, the choice is between glazing that reads as
 * glass and spandrels that read as opaque; this takes the first.
 */
export function glazingElementIds(records: ElementBoundsRecord[]): Set<number> {
  const ids = new Set<number>();
  for (const [elementId, role] of elementDisplayRoles(records)) {
    if (role === "glazing") ids.add(elementId);
  }
  return ids;
}

export function selectDisplayBounds(records: ElementBoundsRecord[]): DisplaySelection {
  const held = heldBackWrappers(records);
  const openingWrappers = [...held];
  const withoutWrappers = records.filter((record) => !held.has(record));
  const omittedWrapperCount = held.size;
  const byId = new Map(records.map((record) => [record.elementId, record]));
  const classified = withoutWrappers.filter((record) => !isSheet(record, byId, withoutWrappers));
  const omittedSheetCount = withoutWrappers.length - classified.length;
  const unclassifiedCount = classified.filter((record) => displayRole(record) === "unknown").length;
  if (classified.length < 2) {
    return {
      records: classified,
      openingWrappers,
      omittedContainerCount: 0,
      omittedWrapperCount,
      unclassifiedCount,
      omittedSheetCount,
    };
  }
  const byFootprint = classified
    .map((record) => {
      const { min, max } = record.boundsFeet;
      const dx = max.x - min.x;
      const dy = max.y - min.y;
      return { record, footprint: dx * dy, longestSide: Math.max(dx, dy) };
    })
    .sort((a, b) => b.footprint - a.footprint);
  const largest = byFootprint[0]!;
  const runnerUp = byFootprint[1]!;
  const isDominantContainer =
    largest.longestSide > 500 && largest.footprint > runnerUp.footprint * 2.5;
  if (!isDominantContainer) {
    return {
      records: classified,
      openingWrappers,
      omittedContainerCount: 0,
      omittedWrapperCount,
      unclassifiedCount,
      omittedSheetCount,
    };
  }
  return {
    records: classified.filter((record) => record !== largest.record),
    openingWrappers,
    omittedContainerCount: 1,
    omittedWrapperCount,
    unclassifiedCount,
    omittedSheetCount,
  };
}

/** The gate that held a record out of the scene, as named in the sources above. */
export type HoldBackReason =
  | "wrapper"
  | "face-hull-only"
  | "stair-companion"
  | "sub-element"
  | "no-class-code"
  | "unnamed-plate"
  | "floor-sketch"
  | "dominant-container";

/**
 * Why each record `selectDisplayBounds` drops was dropped — diagnosis only.
 *
 * Nothing in the conversion calls this; it exists so a census can ask which
 * *gate* costs an element rather than which class the element belongs to. It
 * walks the same rules in the same order as `selectDisplayBounds`, so its keys
 * are exactly that function's complement over the records handed to it. Pass it
 * the same list the audit passes — the drawable-extent filter runs first there,
 * and running the wrapper rule over a different population changes the occupancy
 * counts it decides on.
 */
export function explainHoldBack(records: ElementBoundsRecord[]): Map<number, HoldBackReason> {
  const reasons = new Map<number, HoldBackReason>();
  const held = heldBackWrappers(records);
  const withoutWrappers: ElementBoundsRecord[] = [];
  for (const record of records) {
    if (held.has(record)) reasons.set(record.elementId, "wrapper");
    else withoutWrappers.push(record);
  }
  const byId = new Map(records.map((record) => [record.elementId, record]));
  const classified: ElementBoundsRecord[] = [];
  for (const record of withoutWrappers) {
    const reason = sheetReason(record, byId, withoutWrappers);
    if (reason) reasons.set(record.elementId, reason);
    else classified.push(record);
  }
  if (classified.length < 2) return reasons;
  const byFootprint = classified
    .map((record) => {
      const { min, max } = record.boundsFeet;
      const dx = max.x - min.x;
      const dy = max.y - min.y;
      return { record, footprint: dx * dy, longestSide: Math.max(dx, dy) };
    })
    .sort((a, b) => b.footprint - a.footprint);
  const largest = byFootprint[0]!;
  const runnerUp = byFootprint[1]!;
  if (largest.longestSide > 500 && largest.footprint > runnerUp.footprint * 2.5) {
    reasons.set(largest.record.elementId, "dominant-container");
  }
  return reasons;
}

const BOX_INDICES = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
];

/**
 * Oriented box for an element whose native surfaces rebuilt a solid. Unlike the
 * axis-aligned envelope this follows the element's real direction, length, and
 * thickness, so a wall at an angle is drawn at that angle.
 */
function solidGeometry(solid: WallSolid, origin: Vec3) {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * solid.thickness * 0.5;
  const ny = (dx / length) * solid.thickness * 0.5;
  const z0 = solid.baseElevation;
  const z1 = solid.topElevation;
  const start = solid.startCorners ?? [
    { x: solid.start.x + nx, y: solid.start.y + ny },
    { x: solid.start.x - nx, y: solid.start.y - ny },
  ];
  const end = solid.endCorners ?? [
    { x: solid.end.x + nx, y: solid.end.y + ny },
    { x: solid.end.x - nx, y: solid.end.y - ny },
  ];
  const points = [
    [start[0].x, start[0].y, z0],
    [start[1].x, start[1].y, z0],
    [end[1].x, end[1].y, z0],
    [end[0].x, end[0].y, z0],
    [start[0].x, start[0].y, z1],
    [start[1].x, start[1].y, z1],
    [end[1].x, end[1].y, z1],
    [end[0].x, end[0].y, z1],
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: BOX_INDICES,
  };
}

type SolidOpening = {
  start: number;
  end: number;
  base: number;
  top: number;
};

/**
 * Project one axis-aligned wrapper envelope into a wall solid's local frame.
 *
 * A wrapper is accepted as an opening only when its envelope crosses both wall
 * faces. Merely touching or sitting beside a wall must not punch a hole in it.
 * The wrapper's z band and longitudinal overlap then describe the rectangular
 * void that Revit's host Boolean would have cut.
 */
function solidOpening(
  solid: WallSolid,
  wrapper: ElementBoundsRecord,
): SolidOpening | null {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_SOLID_SPAN_FEET) return null;

  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const { min, max } = wrapper.boundsFeet;
  const centreX = (min.x + max.x) / 2 - solid.start.x;
  const centreY = (min.y + max.y) / 2 - solid.start.y;
  const halfX = (max.x - min.x) / 2;
  const halfY = (max.y - min.y) / 2;
  const alongCentre = centreX * ux + centreY * uy;
  const alongRadius = Math.abs(ux) * halfX + Math.abs(uy) * halfY;
  const normalCentre = centreX * nx + centreY * ny;
  const normalRadius = Math.abs(nx) * halfX + Math.abs(ny) * halfY;
  const normalMin = normalCentre - normalRadius;
  const normalMax = normalCentre + normalRadius;
  const halfThickness = solid.thickness / 2;
  const epsilon = MIN_SOLID_SPAN_FEET;
  if (
    normalMin > -halfThickness + epsilon ||
    normalMax < halfThickness - epsilon
  ) {
    return null;
  }

  const start = Math.max(0, alongCentre - alongRadius);
  const end = Math.min(length, alongCentre + alongRadius);
  const base = Math.max(solid.baseElevation, min.z);
  const top = Math.min(solid.topElevation, max.z);
  if (
    end - start < MIN_SOLID_SPAN_FEET ||
    top - base < MIN_SOLID_SPAN_FEET
  ) {
    return null;
  }
  return { start, end, base, top };
}

function uniqueStops(values: number[]): number[] {
  return values
    .sort((left, right) => left - right)
    .filter((value, index, sorted) =>
      index === 0 || value - sorted[index - 1]! >= MIN_SOLID_SPAN_FEET);
}

/**
 * Split a straight reconstructed wall around recovered curtain-wall wrappers.
 *
 * The operation is performed in the wall's own length/elevation plane, so it
 * also works for walls rotated in plan. Each retained rectangle becomes a
 * closed wall-solid cell; together they cover the original wall volume minus
 * the wrapper voids.
 */
function cutSolidAroundWrappers(
  solid: WallSolid,
  wrappers: readonly ElementBoundsRecord[],
): WallSolid[] {
  if (!wrappers.length) return [solid];
  const openings = wrappers
    .map((wrapper) => solidOpening(solid, wrapper))
    .filter((opening): opening is SolidOpening => opening != null);
  if (!openings.length) return [solid];

  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const zStops = uniqueStops([
    solid.baseElevation,
    solid.topElevation,
    ...openings.flatMap((opening) => [opening.base, opening.top]),
  ]);
  const cells: WallSolid[] = [];

  for (let zIndex = 0; zIndex + 1 < zStops.length; zIndex += 1) {
    const baseElevation = zStops[zIndex]!;
    const topElevation = zStops[zIndex + 1]!;
    if (topElevation - baseElevation < MIN_SOLID_SPAN_FEET) continue;
    const midpoint = (baseElevation + topElevation) / 2;
    const covered = openings
      .filter((opening) => midpoint > opening.base && midpoint < opening.top)
      .map((opening) => [opening.start, opening.end] as const)
      .sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];
    for (const interval of covered) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1] + MIN_SOLID_SPAN_FEET) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        merged.push([interval[0], interval[1]]);
      }
    }

    let cursor = 0;
    for (const [openingStart, openingEnd] of merged) {
      if (openingStart - cursor >= MIN_SOLID_SPAN_FEET) {
        cells.push({
          ...solid,
          startCorners: cursor < MIN_SOLID_SPAN_FEET ? solid.startCorners : undefined,
          endCorners: Math.abs(length - openingStart) < MIN_SOLID_SPAN_FEET
            ? solid.endCorners
            : undefined,
          start: {
            x: solid.start.x + ux * cursor,
            y: solid.start.y + uy * cursor,
          },
          end: {
            x: solid.start.x + ux * openingStart,
            y: solid.start.y + uy * openingStart,
          },
          baseElevation,
          topElevation,
        });
      }
      cursor = Math.max(cursor, openingEnd);
    }
    if (length - cursor >= MIN_SOLID_SPAN_FEET) {
      cells.push({
        ...solid,
        startCorners: cursor < MIN_SOLID_SPAN_FEET ? solid.startCorners : undefined,
        endCorners: solid.endCorners,
        start: {
          x: solid.start.x + ux * cursor,
          y: solid.start.y + uy * cursor,
        },
        end: { ...solid.end },
        baseElevation,
        topElevation,
      });
    }
  }
  return cells;
}


/** Arcs are tessellated no coarser than this, in radians. */
const ARC_STEP_RADIANS = Math.PI / 32;

/** Segments an arc is given regardless of how short its sweep is. */
const MIN_ARC_SEGMENTS = 2;

/**
 * A curved wall as the annulus sector its cylinder triple describes.
 *
 * The axis-aligned envelope of an arc is the rectangle enclosing the whole
 * bulge, so a quarter-round wall drawn from its envelope covers 4/pi times the
 * plan area it should and squares off the curve. This walks the sweep instead,
 * emitting the inner and outer faces, the two ends, and the top and bottom.
 */
function arcGeometry(arc: WallArc, origin: Vec3) {
  const sweep = arc.endAngle - arc.startAngle;
  const segments = Math.max(MIN_ARC_SEGMENTS, Math.ceil(Math.abs(sweep) / ARC_STEP_RADIANS));
  const inner = arc.radius - arc.thickness / 2;
  const outer = arc.radius + arc.thickness / 2;
  const positions: number[] = [];
  const indices: number[] = [];

  // Four vertices per station: inner and outer, at the base and the top.
  for (let step = 0; step <= segments; step += 1) {
    const angle = arc.startAngle + (sweep * step) / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ux = cos * arc.xDir.x + sin * arc.yDir.x;
    const uy = cos * arc.xDir.y + sin * arc.yDir.y;
    for (const radius of [inner, outer]) {
      for (const z of [arc.baseElevation, arc.topElevation]) {
        positions.push(
          arc.centre.x + radius * ux - origin.x,
          arc.centre.y + radius * uy - origin.y,
          z - origin.z,
        );
      }
    }
  }

  // Station layout: 0 inner-base, 1 inner-top, 2 outer-base, 3 outer-top.
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let step = 0; step < segments; step += 1) {
    const here = step * 4;
    const next = here + 4;
    quad(here + 0, next + 0, next + 1, here + 1); // inner face
    quad(here + 2, here + 3, next + 3, next + 2); // outer face
    quad(here + 1, next + 1, next + 3, here + 3); // top
    quad(here + 0, here + 2, next + 2, next + 0); // bottom
  }
  const last = segments * 4;
  quad(0, 1, 3, 2);
  quad(last + 0, last + 2, last + 3, last + 1);
  return { positions, indices };
}


/** Eight already-placed world corners, in box-index order. */
function cornersGeometry(corners: [number, number, number][], origin: Vec3) {
  return {
    positions: corners.flatMap(([x, y, z]) => [x - origin.x, y - origin.y, z - origin.z]),
    indices: BOX_INDICES,
  };
}

function inferredGeometry(
  geometry: NonNullable<ElementBoundsRecord["inferredCurtainPanelGeometry"]>,
  origin: Vec3,
) {
  const positions = [...geometry.positions];
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! - origin.x;
    positions[index + 1] = positions[index + 1]! - origin.y;
    positions[index + 2] = positions[index + 2]! - origin.z;
  }
  return { positions, indices: geometry.indices };
}

function surfaceQuadGeometry(
  quad: NonNullable<ElementBoundsRecord["curtainPanelSurfaceQuads"]>[number],
  origin: Vec3,
) {
  return {
    positions: quad.corners.flatMap(([x, y, z]) => [
      x - origin.x,
      y - origin.y,
      z - origin.z,
    ]),
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/**
 * A slab, floor or roof as Revit models it: its sketch boundary extruded
 * through the element's own thickness. The outer ring is the body and the
 * remaining rings are its openings, so a stair well stays a hole instead of
 * being paved over.
 */
function prismGeometry(loops: Point3[][], bounds: Bounds3, origin: Vec3) {
  const plan = loops.map((ring): Point2[] => ring.map(([x, y]) => [x, y]));
  const z0 = bounds.min.z;
  const z1 = bounds.max.z > bounds.min.z ? bounds.max.z : bounds.min.z + MIN_PRISM_THICKNESS_FEET;

  const items: { positions: number[]; indices: number[] }[] = [];
  for (const { outer, holes } of groupRings(plan)) {
    const cap = triangulate(outer, holes);
    if (!cap.length) continue;

    const rings = [outer, ...holes];
    const vertices = rings.flat();
    const positions: number[] = [];
    for (const z of [z0, z1]) {
      for (const [x, y] of vertices) positions.push(x - origin.x, y - origin.y, z - origin.z);
    }

    const top = vertices.length;
    const indices: number[] = [];
    // Bottom cap wound the other way so both caps face outwards.
    for (let index = 0; index < cap.length; index += 3) {
      indices.push(cap[index]!, cap[index + 2]!, cap[index + 1]!);
      indices.push(top + cap[index]!, top + cap[index + 1]!, top + cap[index + 2]!);
    }
    // Sides, ring by ring, so the seam bridging an opening into its shell never
    // becomes a wall that does not exist.
    let base = 0;
    for (const ring of rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const a = base + index;
        const b = base + ((index + 1) % ring.length);
        indices.push(a, b, top + b, a, top + b, top + a);
      }
      base += ring.length;
    }
    items.push({ positions, indices });
  }
  return items;
}

function boxGeometry(bounds: Bounds3, origin: Vec3) {
  const { min, max } = bounds;
  const points = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, max.y, min.z], [min.x, max.y, min.z],
    [min.x, min.y, max.z], [max.x, min.y, max.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: BOX_INDICES,
  };
}

/** Plan width given to a swept rail, so it reads as a rail rather than a line. */
const RAIL_WIDTH_FEET = 0.16;

/**
 * A railing swept along its own path.
 *
 * Each segment becomes a thin upright box from the path up by the guard height,
 * so a railing follows a stair's rise and an atrium's edge instead of filling
 * the rectangle its path happens to span. The largest railing here spans
 * 23,877 sq ft in plan; as a box that is a slab across the floor, and the
 * export's bounding box is identical, so no comparison against it registers the
 * problem — only looking at the model does.
 */
function railGeometry(
  railPath: { polylines: Point3[][]; guardHeightFeet: number },
  origin: Vec3,
) {
  const items: { positions: number[]; indices: number[] }[] = [];
  const half = RAIL_WIDTH_FEET / 2;
  for (const polyline of railPath.polylines) {
    for (let index = 0; index + 1 < polyline.length; index += 1) {
      const [x0, y0, z0] = polyline[index]!;
      const [x1, y1, z1] = polyline[index + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const nx = (-dy / length) * half;
      const ny = (dx / length) * half;
      const top0 = z0 + railPath.guardHeightFeet;
      const top1 = z1 + railPath.guardHeightFeet;
      const points = [
        [x0 + nx, y0 + ny, z0], [x1 + nx, y1 + ny, z1], [x1 - nx, y1 - ny, z1], [x0 - nx, y0 - ny, z0],
        [x0 + nx, y0 + ny, top0], [x1 + nx, y1 + ny, top1], [x1 - nx, y1 - ny, top1], [x0 - nx, y0 - ny, top0],
      ];
      items.push({
        positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
        indices: BOX_INDICES,
      });
    }
  }
  return items;
}

/**
 * A straight run's stepped top, reconstructed from its own native tread lines.
 *
 * Each tread becomes the top of a horizontal slab. When the StairsRun
 * aggregate supplies the paired-export tread thickness, adjacent slabs share
 * one exposed riser surface instead of overlapping closed-box faces.
 */
function stairTreadGeometry(
  treads: [Point3, Point3, Point3, Point3][],
  baseZ: number,
  topZ: number,
  origin: Vec3,
  treadThicknessFeet?: number,
  beginWithRiser = false,
  endWithRiser = false,
) {
  const treadThickness =
    treadThicknessFeet != null &&
    Number.isFinite(treadThicknessFeet) &&
    treadThicknessFeet >= MIN_PRISM_THICKNESS_FEET
      ? treadThicknessFeet
      : null;
  const renderedTreads = treads.map((tread) =>
    tread.map((point) => [...point] as Point3) as [Point3, Point3, Point3, Point3]);
  if (treadThickness != null) {
    const elevationKeys = [...new Set(renderedTreads.map((tread) =>
      tread[0][2].toFixed(6)))].sort((left, right) => Number(left) - Number(right));
    const rises = elevationKeys.slice(1).map((key, index) =>
      Number(key) - Number(elevationKeys[index]!));
    const orderedRises = rises.filter((rise) => rise > MIN_PRISM_THICKNESS_FEET)
      .sort((left, right) => left - right);
    const typicalRise = orderedRises[Math.floor(orderedRises.length / 2)] ?? 0;
    const endExtension = Math.min(
      0.35,
      Math.max(0, typicalRise - treadThickness),
    );
    const planEdgeKey = (start: Point3, end: Point3) => {
      const a = `${start[0].toFixed(6)},${start[1].toFixed(6)}`;
      const b = `${end[0].toFixed(6)},${end[1].toFixed(6)}`;
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    for (const elevationKey of elevationKeys) {
      const group = renderedTreads.filter((tread) =>
        tread[0][2].toFixed(6) === elevationKey);
      // Four or more cells at one elevation prove a sampled curved profile.
      // A single straight tread also has two free side edges, but widening it
      // would be an unsupported change to the persisted stair width.
      if (group.length < 4 || endExtension < MIN_PRISM_THICKNESS_FEET) continue;
      const startKeys = new Set(group.map((tread) =>
        planEdgeKey(tread[0], tread[1])));
      const endKeys = new Set(group.map((tread) =>
        planEdgeKey(tread[2], tread[3])));
      const startCells = group.filter((tread) =>
        !endKeys.has(planEdgeKey(tread[0], tread[1])));
      const endCells = group.filter((tread) =>
        !startKeys.has(planEdgeKey(tread[2], tread[3])));
      // A closed circular landing has no terminals. Disconnected cells have
      // more than one pair and stay unchanged rather than being joined by a
      // width assumption.
      if (startCells.length !== 1 || endCells.length !== 1) continue;
      const extendSide = (
        tread: [Point3, Point3, Point3, Point3],
        corners: readonly [number, number],
        direction: number,
      ) => {
        const startMidpoint = [
          (tread[0][0] + tread[1][0]) / 2,
          (tread[0][1] + tread[1][1]) / 2,
        ];
        const endMidpoint = [
          (tread[2][0] + tread[3][0]) / 2,
          (tread[2][1] + tread[3][1]) / 2,
        ];
        const dx = endMidpoint[0]! - startMidpoint[0]!;
        const dy = endMidpoint[1]! - startMidpoint[1]!;
        const length = Math.hypot(dx, dy);
        if (length <= MIN_PRISM_THICKNESS_FEET) return;
        for (const corner of corners) {
          tread[corner]![0] += direction * endExtension * dx / length;
          tread[corner]![1] += direction * endExtension * dy / length;
        }
      };
      extendSide(startCells[0]!, [0, 1], -1);
      extendSide(endCells[0]!, [2, 3], 1);
    }
  }
  const cells: Array<{
    points: number[][];
    tread: [Point3, Point3, Point3, Point3];
    topZ: number;
  }> = [];
  for (const tread of renderedTreads) {
    const topZ = tread[0][2];
    if (topZ - baseZ < MIN_PRISM_THICKNESS_FEET) continue;
    const bottomZ = treadThickness == null
      ? baseZ
      : Math.max(baseZ, topZ - treadThickness);
    cells.push({
      tread,
      topZ,
      points: [
      [tread[0][0], tread[0][1], bottomZ],
      [tread[1][0], tread[1][1], bottomZ],
      [tread[2][0], tread[2][1], bottomZ],
      [tread[3][0], tread[3][1], bottomZ],
      ...tread,
      ],
    });
  }
  if (!cells.length) return [];

  const positions = cells.flatMap(({ points }) =>
    points.flatMap(([x, y, z]) => [
      x! - origin.x,
      y! - origin.y,
      z! - origin.z,
    ]));
  const indices: number[] = [];
  type Side = {
    cellIndex: number;
    elevationGroup: number;
    startCorner: number;
    endCorner: number;
    topZ: number;
  };
  const sidesByEdge = new Map<string, Side[]>();
  const elevationGroupByKey = new Map(
    [...new Set(cells.map(({ topZ }) => topZ.toFixed(6)))]
      .sort((left, right) => Number(left) - Number(right))
      .map((key, index) => [key, index]),
  );
  const pointKey = (point: Point3) =>
    `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
  const edgeKey = (start: Point3, end: Point3) => {
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    return startKey < endKey
      ? `${startKey}|${endKey}`
      : `${endKey}|${startKey}`;
  };
  const minimumTreadZ = Math.min(...cells.map((cell) => cell.topZ));
  const maximumTreadZ = Math.max(...cells.map((cell) => cell.topZ));
  const startCapSides = new Set<string>();
  const endCapSides = new Set<string>();
  const sideId = (cellIndex: number, startCorner: number, endCorner: number) =>
    `${cellIndex}:${startCorner}:${endCorner}`;

  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
    const cell = cells[cellIndex]!;
    const base = cellIndex * 8;
    // Bottom and top faces never overlap between adjacent tread cells.
    indices.push(
      base, base + 2, base + 1,
      base, base + 3, base + 2,
      base + 4, base + 5, base + 6,
      base + 4, base + 6, base + 7,
    );
    for (let startCorner = 0; startCorner < 4; startCorner += 1) {
      const endCorner = (startCorner + 1) % 4;
      const key = edgeKey(cell.tread[startCorner]!, cell.tread[endCorner]!);
      const sides = sidesByEdge.get(key) ?? [];
      sides.push({
        cellIndex,
        elevationGroup: elevationGroupByKey.get(cell.topZ.toFixed(6))!,
        startCorner,
        endCorner,
        topZ: cell.topZ,
      });
      sidesByEdge.set(key, sides);
    }
    // Every tread quad is ordered lower-profile → upper-profile. The 3→0
    // edges therefore form the first exposed profile, while 1→2 form the last.
    // Curved profiles consist of many cells at one elevation; tagging by cell
    // closes the complete arc without mistaking its two side edges for risers.
    if (Math.abs(cell.topZ - minimumTreadZ) < 1e-6) {
      startCapSides.add(sideId(cellIndex, 3, 0));
    }
    if (Math.abs(cell.topZ - maximumTreadZ) < 1e-6) {
      endCapSides.add(sideId(cellIndex, 1, 2));
    }
  }

  const sidePoints = (side: Side) => {
    const cell = cells[side.cellIndex]!;
    return [
      cell.tread[side.startCorner]!,
      cell.tread[side.endCorner]!,
    ] as const;
  };
  const sidesByElevationGroup = new Map<number, Side[]>();
  for (const sides of sidesByEdge.values()) {
    for (const side of sides) {
      const group = sidesByElevationGroup.get(side.elevationGroup) ?? [];
      group.push(side);
      sidesByElevationGroup.set(side.elevationGroup, group);
    }
  }
  const CURVED_RISER_EDGE_TOLERANCE_FEET = 0.35;
  const pointToSideDistance = (point: Point3, side: Side) => {
    const [start, end] = sidePoints(side);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const parameter = lengthSquared <= 1e-12
      ? 0
      : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
          lengthSquared));
    return Math.hypot(
      point[0] - (start[0] + dx * parameter),
      point[1] - (start[1] + dy * parameter),
    );
  };
  const nearSuccessorRearSide = (side: Side): Side | null => {
    // A normal tread quad is ordered rear profile (3 -> 0), side, forward
    // profile (1 -> 2), side. Curved profiles are sampled independently, so
    // the forward edge of one tread and the rear edge of the next can differ
    // by a few hundredths of a foot and miss the exact edge-key join above.
    if (side.startCorner !== 1 || side.endCorner !== 2) return null;
    const [start, end] = sidePoints(side);
    const candidates = (sidesByElevationGroup.get(side.elevationGroup + 1) ?? [])
      .filter((candidate) =>
        candidate.startCorner === 3 && candidate.endCorner === 0);
    if (!candidates.length) return null;
    const midpoint: Point3 = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      side.topZ,
    ];
    // One native arc may be sampled into sixteen cells at one elevation and
    // eighteen at the next. Compare the edge to the union of the complete
    // successor profile instead of requiring both endpoints to land on one
    // successor segment.
    const profileDistance = Math.max(...[start, midpoint, end].map((point) =>
      Math.min(...candidates.map((candidate) =>
        pointToSideDistance(point, candidate)))));
    if (profileDistance > CURVED_RISER_EDGE_TOLERANCE_FEET) return null;
    return [...candidates].sort((left, right) =>
      pointToSideDistance(midpoint, left) - pointToSideDistance(midpoint, right)
    )[0]!;
  };

  const emitSides = (sides: Side[]) => {
    const emitExtendedSide = (side: Side, bottomZ: number, capTopZ: number) => {
      if (capTopZ - bottomZ < MIN_PRISM_THICKNESS_FEET) return;
      const cell = cells[side.cellIndex]!;
      const start = cell.tread[side.startCorner]!;
      const end = cell.tread[side.endCorner]!;
      const base = positions.length / 3;
      positions.push(
        start[0] - origin.x, start[1] - origin.y, bottomZ - origin.z,
        end[0] - origin.x, end[1] - origin.y, bottomZ - origin.z,
        end[0] - origin.x, end[1] - origin.y, capTopZ - origin.z,
        start[0] - origin.x, start[1] - origin.y, capTopZ - origin.z,
      );
      indices.push(
        base, base + 1, base + 2,
        base, base + 2, base + 3,
      );
    };
    const emitIndependentSide = (side: Side) => {
      const base = side.cellIndex * 8;
      const start = base + side.startCorner;
      const end = base + side.endCorner;
      indices.push(
        start, end, end + 4,
        start, end + 4, start + 4,
      );
    };
    if (sides.length === 1) {
      const side = sides[0]!;
      const id = sideId(side.cellIndex, side.startCorner, side.endCorner);
      if (beginWithRiser && startCapSides.has(id)) {
        emitExtendedSide(side, baseZ, side.topZ);
      } else if (endWithRiser && endCapSides.has(id)) {
        const cell = cells[side.cellIndex]!;
        emitExtendedSide(
          side,
          cell.points[side.startCorner]![2]!,
          topZ,
        );
      } else {
        emitIndependentSide(side);
        const successor = nearSuccessorRearSide(side);
        const closedRunSuccessorBottomZ =
          successor == null &&
          beginWithRiser &&
          endWithRiser &&
          side.startCorner === 1 &&
          side.endCorner === 2
            ? Math.min(
                ...(sidesByElevationGroup.get(side.elevationGroup + 1) ?? [])
                  .map((nextSide) => {
                    const nextCell = cells[nextSide.cellIndex]!;
                    return nextCell.points[nextSide.startCorner]![2]!;
                  }),
              )
            : null;
        const successorBottomZ = successor
          ? cells[successor.cellIndex]!.points[successor.startCorner]![2]!
          : closedRunSuccessorBottomZ;
        if (successorBottomZ != null && Number.isFinite(successorBottomZ)) {
          // Keep the tread slab's own side above, then close only the vertical
          // air gap up to the following slab. UNBC stair 1460781 has a 0.412 ft
          // rise and a 0.164 ft tread body; without this 0.248 ft closure the
          // valid curved wall behind it reads as a body poking through the
          // stair even though the Autodesk GLB shows a closed riser. When the
          // next profile is a distant native transition, the run's persisted
          // begin/end-riser flags certify the same closure without inventing
          // it for an open or evidence-poor stair.
          emitExtendedSide(side, side.topZ, successorBottomZ);
        }
      }
      return;
    }
    if (sides.length > 2) {
      for (const side of sides) emitIndependentSide(side);
      return;
    }

    // Equal-height cells are pieces of one physical tread, so their shared side
    // is internal. Between different tread elevations, one riser spans from the
    // lower slab's underside to the upper tread. It is split at both slabs'
    // horizontal faces so no edge terminates in the middle of a large triangle.
    const sorted = [...sides].sort((left, right) => left.topZ - right.topZ);
    const lower = sorted[0]!;
    const upper = sorted.at(-1)!;
    if (upper.topZ - lower.topZ < MIN_PRISM_THICKNESS_FEET) return;
    const upperCell = cells[upper.cellIndex]!;
    const lowerCell = cells[lower.cellIndex]!;
    const upperStartKey = pointKey(upperCell.tread[upper.startCorner]!);
    const lowerStartCorner =
      pointKey(lowerCell.tread[lower.startCorner]!) === upperStartKey
        ? lower.startCorner
        : lower.endCorner;
    const lowerEndCorner =
      lowerStartCorner === lower.startCorner
        ? lower.endCorner
        : lower.startCorner;
    const lowerBase = lower.cellIndex * 8;
    const upperBase = upper.cellIndex * 8;
    const riserStops = [
      {
        z: lowerCell.points[lowerStartCorner]![2]!,
        start: lowerBase + lowerStartCorner,
        end: lowerBase + lowerEndCorner,
      },
      {
        z: lower.topZ,
        start: lowerBase + lowerStartCorner + 4,
        end: lowerBase + lowerEndCorner + 4,
      },
      {
        z: upperCell.points[upper.startCorner]![2]!,
        start: upperBase + upper.startCorner,
        end: upperBase + upper.endCorner,
      },
      {
        z: upper.topZ,
        start: upperBase + upper.startCorner + 4,
        end: upperBase + upper.endCorner + 4,
      },
    ]
      .sort((left, right) => left.z - right.z)
      .filter((stop, index, orderedStops) =>
        index === 0 ||
        stop.z - orderedStops[index - 1]!.z >= MIN_PRISM_THICKNESS_FEET);
    for (let index = 0; index + 1 < riserStops.length; index += 1) {
      const bottom = riserStops[index]!;
      const top = riserStops[index + 1]!;
      indices.push(
        bottom.start, top.start, top.end,
        bottom.start, top.end, bottom.end,
      );
    }
  };

  for (const sides of sidesByEdge.values()) {
    // The same plan edge may recur several storeys apart in a spiral or
    // switchback. Only equal or consecutive tread elevations are neighbours.
    const ordered = [...sides].sort((left, right) =>
      left.elevationGroup - right.elevationGroup);
    let cluster: Side[] = [];
    for (const side of ordered) {
      const previous = cluster.at(-1);
      if (
        previous &&
        side.elevationGroup - previous.elevationGroup > 1
      ) {
        emitSides(cluster);
        cluster = [];
      }
      cluster.push(side);
    }
    if (cluster.length) emitSides(cluster);
  }

  // Transition and winder polygons are triangulated independently. Their
  // consecutive outer profiles can therefore describe the same native riser
  // as several partial collinear edges rather than one byte-identical edge.
  // The exact-key pass above correctly handles ordinary treads; close only the
  // remaining overlap between boundary edges of consecutive elevations.
  const boundarySidesByElevation = new Map<number, Side[]>();
  for (const sides of sidesByEdge.values()) {
    const byElevation = new Map<number, Side[]>();
    for (const side of sides) {
      const group = byElevation.get(side.elevationGroup) ?? [];
      group.push(side);
      byElevation.set(side.elevationGroup, group);
    }
    for (const [elevationGroup, sameElevation] of byElevation) {
      // A triangulated interior edge occurs twice. Only a single occurrence is
      // an exposed boundary that can provide independent riser evidence.
      if (sameElevation.length !== 1) continue;
      const boundary = boundarySidesByElevation.get(elevationGroup) ?? [];
      boundary.push(sameElevation[0]!);
      boundarySidesByElevation.set(elevationGroup, boundary);
    }
  }

  const collinearOverlap = (
    lower: Side,
    upper: Side,
  ): [Point3, Point3] | null => {
    const [lowerStart, lowerEnd] = sidePoints(lower);
    const [upperStart, upperEnd] = sidePoints(upper);
    const dx = lowerEnd[0] - lowerStart[0];
    const dy = lowerEnd[1] - lowerStart[1];
    const length = Math.hypot(dx, dy);
    const upperDx = upperEnd[0] - upperStart[0];
    const upperDy = upperEnd[1] - upperStart[1];
    const upperLength = Math.hypot(upperDx, upperDy);
    if (
      length < MIN_PRISM_THICKNESS_FEET ||
      upperLength < MIN_PRISM_THICKNESS_FEET ||
      Math.abs(dx * upperDy - dy * upperDx) >
        1e-4 * length * upperLength
    ) {
      return null;
    }
    const nx = -dy / length;
    const ny = dx / length;
    if (
      Math.abs(
        (upperStart[0] - lowerStart[0]) * nx +
        (upperStart[1] - lowerStart[1]) * ny,
      ) > 1e-4 ||
      Math.abs(
        (upperEnd[0] - lowerStart[0]) * nx +
        (upperEnd[1] - lowerStart[1]) * ny,
      ) > 1e-4
    ) {
      return null;
    }
    const tx = dx / length;
    const ty = dy / length;
    const upperParameters = [upperStart, upperEnd].map((point) =>
      (point[0] - lowerStart[0]) * tx +
      (point[1] - lowerStart[1]) * ty
    );
    const overlapStart = Math.max(0, Math.min(...upperParameters));
    const overlapEnd = Math.min(length, Math.max(...upperParameters));
    if (overlapEnd - overlapStart < MIN_PRISM_THICKNESS_FEET) return null;
    return [
      [
        lowerStart[0] + tx * overlapStart,
        lowerStart[1] + ty * overlapStart,
        lower.topZ,
      ],
      [
        lowerStart[0] + tx * overlapEnd,
        lowerStart[1] + ty * overlapEnd,
        lower.topZ,
      ],
    ];
  };

  for (let elevationGroup = 0;
    elevationGroup + 1 < elevationGroupByKey.size;
    elevationGroup += 1) {
    const lowerSides = boundarySidesByElevation.get(elevationGroup) ?? [];
    const upperSides = boundarySidesByElevation.get(elevationGroup + 1) ?? [];
    const candidates: Array<{
      overlap: [Point3, Point3];
      lower: Side;
      upper: Side;
    }> = [];
    for (const lower of lowerSides) {
      for (const upper of upperSides) {
        const [lowerStart, lowerEnd] = sidePoints(lower);
        const [upperStart, upperEnd] = sidePoints(upper);
        if (edgeKey(lowerStart, lowerEnd) === edgeKey(upperStart, upperEnd)) {
          continue;
        }
        const overlap = collinearOverlap(lower, upper);
        if (!overlap) continue;
        const upperCell = cells[upper.cellIndex]!;
        if (
          upperCell.points[upper.startCorner]![2]! - lower.topZ >=
            MIN_PRISM_THICKNESS_FEET
        ) {
          candidates.push({ overlap, lower, upper });
        }
      }
    }

    const groups: typeof candidates[] = [];
    for (const candidate of candidates) {
      const existing = groups.find((group) => {
        const reference = group[0]!.overlap;
        const [candidateStart, candidateEnd] = candidate.overlap;
        const referenceDx = reference[1][0] - reference[0][0];
        const referenceDy = reference[1][1] - reference[0][1];
        const candidateDx = candidateEnd[0] - candidateStart[0];
        const candidateDy = candidateEnd[1] - candidateStart[1];
        const referenceLength = Math.hypot(referenceDx, referenceDy);
        const candidateLength = Math.hypot(candidateDx, candidateDy);
        if (
          Math.abs(referenceDx * candidateDy - referenceDy * candidateDx) >
            1e-4 * referenceLength * candidateLength
        ) {
          return false;
        }
        const nx = -referenceDy / referenceLength;
        const ny = referenceDx / referenceLength;
        return (
          Math.abs(
            (candidateStart[0] - reference[0][0]) * nx +
            (candidateStart[1] - reference[0][1]) * ny,
          ) <= 1e-4
        );
      });
      if (existing) existing.push(candidate);
      else groups.push([candidate]);
    }

    const mergeIntervals = (intervals: Array<[number, number]>) => {
      const ordered = intervals
        .map(([start, end]) => [Math.min(start, end), Math.max(start, end)] as [number, number])
        .sort((left, right) => left[0] - right[0]);
      const merged: Array<[number, number]> = [];
      for (const interval of ordered) {
        const previous = merged.at(-1);
        if (!previous || interval[0] - previous[1] > 1e-4) {
          merged.push([...interval]);
        } else {
          previous[1] = Math.max(previous[1], interval[1]);
        }
      }
      return merged;
    };
    for (const group of groups) {
      const reference = group[0]!.overlap;
      const dx = reference[1][0] - reference[0][0];
      const dy = reference[1][1] - reference[0][1];
      const length = Math.hypot(dx, dy);
      const tx = dx / length;
      const ty = dy / length;
      const parameter = (point: Point3) =>
        (point[0] - reference[0][0]) * tx +
        (point[1] - reference[0][1]) * ty;
      const onSupportingLine = (side: Side) => {
        const [start, end] = sidePoints(side);
        const nx = -ty;
        const ny = tx;
        return (
          Math.abs(
            (start[0] - reference[0][0]) * nx +
            (start[1] - reference[0][1]) * ny,
          ) <= 1e-4 &&
          Math.abs(
            (end[0] - reference[0][0]) * nx +
            (end[1] - reference[0][1]) * ny,
          ) <= 1e-4
        );
      };
      const sideIntervals = (sides: Side[]) => mergeIntervals(
        sides.filter(onSupportingLine).map((side) => {
          const [start, end] = sidePoints(side);
          return [parameter(start), parameter(end)];
        }),
      );
      const overlapIntervals = mergeIntervals(group.map(({ overlap }) => [
        parameter(overlap[0]),
        parameter(overlap[1]),
      ]));
      if (overlapIntervals.length !== 1) continue;
      const [overlapStart, overlapEnd] = overlapIntervals[0]!;
      const coversCompleteChain = (intervals: Array<[number, number]>) =>
        intervals.some(([start, end]) =>
          Math.abs(start - overlapStart) <= 1e-4 &&
          Math.abs(end - overlapEnd) <= 1e-4
        );
      if (
        !coversCompleteChain(sideIntervals(lowerSides)) &&
        !coversCompleteChain(sideIntervals(upperSides))
      ) {
        continue;
      }
      const bottomZ = group[0]!.lower.topZ;
      const upper = group[0]!.upper;
      const upperCell = cells[upper.cellIndex]!;
      const capTopZ = upperCell.points[upper.startCorner]![2]!;
      const start: Point3 = [
        reference[0][0] + tx * overlapStart,
        reference[0][1] + ty * overlapStart,
        bottomZ,
      ];
      const end: Point3 = [
        reference[0][0] + tx * overlapEnd,
        reference[0][1] + ty * overlapEnd,
        bottomZ,
      ];
      const base = positions.length / 3;
      positions.push(
        start[0] - origin.x, start[1] - origin.y, bottomZ - origin.z,
        end[0] - origin.x, end[1] - origin.y, bottomZ - origin.z,
        end[0] - origin.x, end[1] - origin.y, capTopZ - origin.z,
        start[0] - origin.x, start[1] - origin.y, capTopZ - origin.z,
      );
      indices.push(
        base, base + 1, base + 2,
        base, base + 2, base + 3,
      );
    }
  }

  return [{ positions, indices }];
}

/** Extrude a recovered centerline into a visible prism. */
function extrude(segment: Segment, origin: Vec3, thickness: number, height: number) {
  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * thickness * 0.5;
  const ny = (dx / length) * thickness * 0.5;
  const z0 = Math.min(segment.z0, segment.z1);
  const z1 = z0 + height;
  const points = [
    [segment.x0 + nx, segment.y0 + ny, z0],
    [segment.x0 - nx, segment.y0 - ny, z0],
    [segment.x1 - nx, segment.y1 - ny, z0],
    [segment.x1 + nx, segment.y1 + ny, z0],
    [segment.x0 + nx, segment.y0 + ny, z1],
    [segment.x0 - nx, segment.y0 - ny, z1],
    [segment.x1 - nx, segment.y1 - ny, z1],
    [segment.x1 + nx, segment.y1 + ny, z1],
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: BOX_INDICES,
  };
}

export function buildMeshes(
  segments: Segment[],
  origin: Vec3,
  thickness: number,
  height: number,
): MeshData[] {
  const meshes: MeshData[] = [];
  for (let start = 0; start < segments.length; start += MESH_BATCH_SIZE) {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const batch = segments.slice(start, start + MESH_BATCH_SIZE);
    let vertexOffset = 0;
    for (const segment of batch) {
      const box = extrude(segment, origin, thickness, height);
      positions.push(...box.positions);
      indices.push(...box.indices.map((index) => index + vertexOffset));
      vertexOffset += 8;
      const level = Math.max(0, Math.min(1, (segment.z0 - origin.z + 10) / 80));
      for (let vertex = 0; vertex < 8; vertex += 1) {
        colors.push(0.2 + level * 0.18, 0.68 + level * 0.12, 0.78 + level * 0.16);
      }
    }
    meshes.push({
      name: `Recovered geometry ${meshes.length + 1}`,
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      colors: new Float32Array(colors),
      materialIndex: 0,
    });
  }
  return meshes;
}

/**
 * How tall the drawn scene is, ignoring the extremes.
 *
 * A handful of misparsed envelopes land thousands of feet from the building —
 * `framingBoundsOfRecords` exists for the same reason — so the raw z extent is
 * not the model's height. The same one-part-in-a-thousand trim is used here so
 * the shade ramp is scaled by the building, not by its worst record.
 */
function elevationSpanFeet(records: ElementBoundsRecord[]): number {
  if (!records.length) return 0;
  const bases = records.map((record) => record.boundsFeet.min.z).sort((a, b) => a - b);
  const tail = Math.floor(bases.length * 0.001);
  return bases[bases.length - 1 - tail]! - bases[tail]!;
}

export function buildBoundsMeshes(
  records: ElementBoundsRecord[],
  origin: Vec3,
  openingWrappers: readonly ElementBoundsRecord[] = [],
  materialIndexByElement: ReadonlyMap<number, number> = new Map(),
  hostedOpeningsByWall: ReadonlyMap<
    number,
    readonly ElementBoundsRecord[]
  > = new Map(),
): MeshData[] {
  const meshes: MeshData[] = [];
  // The elevation shade spans the model's own height rather than a fixed 80 ft
  // window with a 10 ft lead-in. Those two numbers were this building's — 62 ft
  // tall, so the ramp happened to land in a reasonable place — but a taller
  // model saturated at the top and a single-storey one used a sliver of the
  // range. Measuring it here keeps the same effect on any model. The tiny floor
  // stops a division by zero on a perfectly flat scene.
  const shadeSpanFeet = Math.max(1, elevationSpanFeet(records));
  // Batch by decoded Revit category when one is available so the model browser
  // lists real categories; otherwise fall back to the record-code display role.
  const grouped = new Map<
    string,
    {
      label: string;
      role: DisplayRole;
      materialIndex: number;
      records: ElementBoundsRecord[];
    }
  >();
  for (const record of records) {
    const resolved = displayRole(record);
    // An unclassified record is drawn under its own neutral batch, so it is
    // visible in the model without claiming a category the file did not give.
    // `selectDisplayBounds` is the only gate on wrappers now: one that reaches
    // here was released because nothing was found standing in its place, and
    // skipping it a second time here would put the hole straight back.
    const role: DisplayRole = resolved === "unknown"
      ? "unclassified"
      : resolved === "wrapper"
        ? (record.categoryId != null ? CATEGORY_DISPLAY_ROLE[record.categoryId] ?? "native" : "wall")
        : resolved;
    const label = record.categoryName
      ?? (role === "unclassified"
        ? "Uncategorised elements"
        : `${role[0]!.toUpperCase()}${role.slice(1)} proxies`);
    // A proxy can still have an exact persisted material assignment. Keep it
    // in a separate draw batch so transparent glass uses Revit's own opacity
    // instead of inheriting the category fallback merely because its native
    // face mesh was not admitted.
    const materialIndex = materialIndexByElement.get(record.elementId)
      ?? DISPLAY_MATERIAL_INDEX[role];
    const groupKey = `${label}\0${materialIndex}`;
    const group = grouped.get(groupKey) ?? {
      label,
      role,
      materialIndex,
      records: [],
    };
    group.records.push(record);
    grouped.set(groupKey, group);
  }
  for (const { label, role, materialIndex, records: roleRecords } of grouped.values()) {
    for (let start = 0; start < roleRecords.length; start += MESH_BATCH_SIZE) {
      const positions: number[] = [];
      const indices: number[] = [];
      const colors: number[] = [];
      let vertexOffset = 0;
      const batch = roleRecords.slice(start, start + MESH_BATCH_SIZE);
      const drawnIds: number[] = [];
      for (const record of batch) {
        // Prefer the element's own reconstructed geometry — its sketch boundary
        // if it has one, then its faces, then its rebuilt solid — and fall back
        // to the envelope.
        const prism = record.loops?.length
          ? prismGeometry(record.loops, record.boundsFeet, origin)
          : [];
        // An element can be built from several solids — a wall run modelled in
        // segments. Every one of them is drawn: they are all the element's own
        // rebuilt geometry, and picking indexes by triangle rather than by box.
        const recoveredSolids =
          record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
        const wallOpenings = role === "wall"
          ? [
              ...openingWrappers,
              ...(hostedOpeningsByWall.get(record.elementId) ?? []),
            ]
          : [];
        const solids = role === "wall"
          ? recoveredSolids.flatMap((solid) =>
            cutSolidAroundWrappers(solid, wallOpenings))
          : recoveredSolids;
        // A swept railing wins over its own envelope, which is the rectangle the
        // path spans rather than anything the railing occupies.
        const rail = record.railPath ? railGeometry(record.railPath, origin) : [];
        const stair = record.stairTreads?.length
          ? stairTreadGeometry(
              record.stairTreads,
              record.boundsFeet.min.z,
              record.boundsFeet.max.z,
              origin,
              record.stairTreadThicknessFeet,
              record.stairBeginWithRiser,
              record.stairEndWithRiser,
            )
          : [];
        // Native faces used to outrank both the rebuilt solid and the
        // element's own envelope. Measured against the paired export across
        // every class that owns them, they lose to the envelope for 168 of the
        // 225 elements concerned — walls by 31.84 ft against 0.00, stair
        // flights by 5.99 against 2.59 — because a face set is usually a
        // fragment of the element rather than a shape. An earlier measurement
        // said the opposite; it compared against a truth map that kept one box
        // per Revit id, so an element the exporter split was compared with a
        // piece of itself.
        // A curved wall has no straight location line, so it reaches neither
        // the solid route nor the sketch route and would otherwise be drawn as
        // the rectangle enclosing its whole bulge.
        const arcs = record.arcs?.length ? record.arcs.map((arc) => arcGeometry(arc, origin)) : [];
        const curtainPanelSurfaces = record.curtainPanelSurfaceQuads?.map(
          (quad) => surfaceQuadGeometry(quad, origin),
        ) ?? [];
        const items = stair.length
          ? stair
          : rail.length
          ? rail
          : prism.length
          ? prism
          : record.inferredCurtainPanelGeometry
            ? [inferredGeometry(record.inferredCurtainPanelGeometry, origin)]
          : curtainPanelSurfaces.length
            ? curtainPanelSurfaces
          : record.orientedBox
            ? [cornersGeometry(record.orientedBox, origin)]
            : solids.length
              ? solids.map((solid) => solidGeometry(solid, origin))
              : arcs.length
                ? arcs
                : [boxGeometry(record.boundsFeet, origin)];
        // Keep a little elevation shading so storeys stay legible, but let the
        // element's own category decide the hue.
        const elevation = Math.max(
          0,
          Math.min(1, (record.boundsFeet.min.z - origin.z) / shadeSpanFeet),
        );
        const shade = 0.88 + elevation * 0.22;
        const [tintR, tintG, tintB] = ROLE_TINT[role];
        for (const item of items) {
          const vertices = item.positions.length / 3;
          positions.push(...item.positions);
          indices.push(...item.indices.map((index) => index + vertexOffset));
          vertexOffset += vertices;
          for (let triangle = 0; triangle < item.indices.length / 3; triangle += 1) {
            drawnIds.push(record.elementId);
          }
          for (let vertex = 0; vertex < vertices; vertex += 1) {
            colors.push(tintR * shade, tintG * shade, tintB * shade);
          }
        }
      }
      meshes.push({
        name: `${label} ${Math.floor(start / MESH_BATCH_SIZE) + 1}`,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        colors: new Float32Array(colors),
        materialIndex,
        source: "display-proxy",
        // One entry per triangle: drawn items vary in size, so the face index
        // picking reports is the only thing that indexes them all.
        elementIds: Uint32Array.from(drawnIds),
      });
    }
  }
  return meshes;
}

/** Footprint outlines used by the plan view and the SVG export. */
export function boundsPlanSegments(records: ElementBoundsRecord[]): Segment[] {
  return records.flatMap(({ boundsFeet: { min, max } }) => [
    { x0: min.x, y0: min.y, z0: min.z, x1: max.x, y1: min.y, z1: min.z },
    { x0: max.x, y0: min.y, z0: min.z, x1: max.x, y1: max.y, z1: min.z },
    { x0: max.x, y0: max.y, z0: min.z, x1: min.x, y1: max.y, z1: min.z },
    { x0: min.x, y0: max.y, z0: min.z, x1: min.x, y1: min.y, z1: min.z },
  ]);
}

/**
 * Elevation bands, when the file gives no levels of its own.
 *
 * This is a histogram of where elements start in z, not a storey list: a band
 * is one 0.5 ft bucket that many elements happen to share. It stands in only
 * when `Element.m_assocLevelId` did not decode, because a dense bucket is the
 * last available evidence that a storey is there at all.
 *
 * Where the relations *do* decode, `levelsFromRelations` is used instead and
 * this is not called. The old 8-band cap is gone with it — a cap sized to one
 * building silently truncates a taller one, and a model's storey count is not
 * something this module gets to decide.
 */
export function levelsForBounds(records: ElementBoundsRecord[]): LevelBand[] {
  const bands = new Map<number, number>();
  for (const record of records) {
    const elevation = Math.round(record.boundsFeet.min.z * 2) / 2;
    bands.set(elevation, (bands.get(elevation) ?? 0) + 1);
  }
  return [...bands.entries()]
    .map(([elevation, candidates]) => ({ elevation, candidates, source: "elevation-band" as const }))
    .sort((a, b) => a.elevation - b.elevation);
}

/**
 * Members a decoded level needs before it is reported as a storey.
 *
 * Revit keeps levels that host nothing an element in the model refers to —
 * reference planes, a survey datum, a level left behind by a deleted storey.
 * On the supplied model 6 of the 18 decoded level ids hold fewer than 20
 * elements between them and four hold one or two, all at z 0; the twelve above
 * the floor are the building. The floor is deliberately low: it exists to drop
 * stubs, not to rank storeys by popularity the way the old histogram did.
 */
const MIN_LEVEL_MEMBERS = 20;

/**
 * Storeys, from the file's own element-to-level relationships.
 *
 * Revit persists `Element.m_assocLevelId` on every element that is placed on a
 * level, and `level-relations.ts` decodes it without consulting names, IFC, or
 * proximity. That is the model's own answer to "what level is this on", and it
 * is strictly better than guessing from a z histogram: the histogram cannot
 * tell a storey from a run of elements that merely share a starting height, it
 * has no level identity to join anything else to, and it invents a band
 * wherever a big enough pile lands.
 *
 * Each level's elevation is the **median** of its members' base heights rather
 * than the minimum, so one mis-parsed envelope thousands of feet out cannot
 * move a storey. Elevation is reported in the same raw record feet the bands
 * used, so existing consumers do not have to change frames.
 */
export function levelsFromRelations(
  records: ElementBoundsRecord[],
  relations: readonly { elementId: number; levelId: number }[],
): LevelBand[] {
  const baseByElement = new Map<number, number>();
  for (const record of records) {
    const z = record.boundsFeet.min.z;
    const previous = baseByElement.get(record.elementId);
    if (previous == null || z < previous) baseByElement.set(record.elementId, z);
  }

  const membersByLevel = new Map<number, number[]>();
  for (const relation of relations) {
    const base = baseByElement.get(relation.elementId);
    if (base == null) continue;
    const members = membersByLevel.get(relation.levelId) ?? [];
    members.push(base);
    membersByLevel.set(relation.levelId, members);
  }

  const levels: LevelBand[] = [];
  for (const [levelId, members] of membersByLevel) {
    if (members.length < MIN_LEVEL_MEMBERS) continue;
    members.sort((a, b) => a - b);
    levels.push({
      elevation: members[Math.floor(members.length / 2)]!,
      candidates: members.length,
      levelId,
      source: "assoc-level-id",
    });
  }
  return levels.sort((a, b) => a.elevation - b.elevation);
}
