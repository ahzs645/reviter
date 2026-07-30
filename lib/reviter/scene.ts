/**
 * Turning recovered records into renderable batches.
 *
 * Nothing here decodes the file — it decides how already-recovered evidence is
 * shown: which envelopes belong in the default scene, how they are grouped and
 * shaded, and the display materials that stand in for undecoded Revit materials.
 */
import { MIN_SOLID_SPAN_FEET } from "./bounds-records.ts";
import type { WallArc, WallSolid } from "./native-geometry.ts";
import { groupRings, triangulate, type Point2 } from "./polygon.ts";
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
    fallback("Railing display proxy", [0.28, 0.34, 0.41, 1], 0.58),
    fallback("Slab and roof display proxy", [0.86, 0.85, 0.82, 1], 0.95),
    fallback("Covering display proxy", [0.70, 0.72, 0.68, 1], 0.9),
    fallback("Glazing display proxy", [0.36, 0.66, 0.82, 0.55], 0.3),
  ];
}

export type DisplayRole =
  | "wall"
  | "door"
  | "panel"
  | "frame"
  | "structure"
  | "railing"
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
  [-2000919]: "railing",
  [-2000920]: "railing",
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
};

export function displayRole(record: ElementBoundsRecord): DisplayRole | "wrapper" | "unknown" {
  const code = record.recordCode;
  const count = record.recordCount;
  const hasNamedAnalyticSolid =
    !!record.typeName && (!!record.solid || (record.solids?.length ?? 0) > 0);
  // A curtain-wall container stays a wrapper even once its category is known,
  // so its child panels and mullions are not swallowed by one large envelope.
  // Whether a wrapper is actually held back is decided by `selectDisplayBounds`,
  // which checks that a facade is there to stand in its place.
  // A named wall whose own planes rebuilt a solid is not merely a container.
  // The UNBC IFC corroborates all 11 such records as drawable wall products;
  // treating them as wrappers hid valid solids whenever nearby facade elements
  // happened to stand inside their envelopes.
  const isWrapper =
    !hasNamedAnalyticSolid && code === 30 && count != null && count >= 8 && count <= 10;
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
 */
const PROXY_ONLY_HELPER_CATEGORY_IDS = new Set([
  -2000954, // Railing Rail Path Extension Lines
  -2000938, // Stairs Paths
  -2000067, // Stairs Sketch Boundary Lines
  -2000045, // Sketch Lines
]);

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
  >,
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
  return (
    (record.categoryId != null &&
      PROXY_ONLY_HELPER_CATEGORY_IDS.has(record.categoryId)) ||
    record.categoryName === "Railing Rail Path Extension Lines" ||
    record.categoryName === "Stairs Paths" ||
    record.categoryName === "Stairs Sketch Boundary Lines" ||
    record.categoryName === "Sketch Lines"
  );
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
 * Record code of the companion record holding a stair run's own elevations.
 * `convert.ts` hands that box to the run one id below; what is left here is a
 * record the export names in none of its 111 cases, sitting on top of a stair
 * part that is now drawn correctly. It is held back only when that owner exists,
 * so a companion whose stair part was never recovered stays as its only trace.
 */
const STAIR_COMPANION_CODE = 169_671;

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
 */
const NO_CLASS_RECORD_CODE = 0xffff_ffff;

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
export function selectDisplayBounds(records: ElementBoundsRecord[]): DisplaySelection {
  const held = heldBackWrappers(records);
  const withoutWrappers = records.filter((record) => !held.has(record));
  const omittedWrapperCount = held.size;
  const byId = new Map(records.map((record) => [record.elementId, record]));
  const classified = withoutWrappers.filter((record) => !isSheet(record, byId, withoutWrappers));
  const omittedSheetCount = withoutWrappers.length - classified.length;
  const unclassifiedCount = classified.filter((record) => displayRole(record) === "unknown").length;
  if (classified.length < 2) {
    return { records: classified, omittedContainerCount: 0, omittedWrapperCount, unclassifiedCount, omittedSheetCount };
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
    return { records: classified, omittedContainerCount: 0, omittedWrapperCount, unclassifiedCount, omittedSheetCount };
  }
  return {
    records: classified.filter((record) => record !== largest.record),
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
  const points = [
    [solid.start.x + nx, solid.start.y + ny, z0],
    [solid.start.x - nx, solid.start.y - ny, z0],
    [solid.end.x - nx, solid.end.y - ny, z0],
    [solid.end.x + nx, solid.end.y + ny, z0],
    [solid.start.x + nx, solid.start.y + ny, z1],
    [solid.start.x - nx, solid.start.y - ny, z1],
    [solid.end.x - nx, solid.end.y - ny, z1],
    [solid.end.x + nx, solid.end.y + ny, z1],
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: BOX_INDICES,
  };
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
 * Each tread becomes the top of a contiguous vertical cell. The cells meet
 * exactly in plan and rise from the run's independently decoded base, producing
 * a closed selectable mesh with the recovered step profile.
 */
function stairTreadGeometry(
  treads: [Point3, Point3, Point3, Point3][],
  baseZ: number,
  origin: Vec3,
) {
  return treads.flatMap((tread) => {
    const topZ = tread[0][2];
    if (topZ - baseZ < MIN_PRISM_THICKNESS_FEET) return [];
    const points = [
      ...tread.map(([x, y]) => [x, y, baseZ]),
      ...tread,
    ];
    return [{
      positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
      indices: BOX_INDICES,
    }];
  });
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

export function buildBoundsMeshes(records: ElementBoundsRecord[], origin: Vec3): MeshData[] {
  const meshes: MeshData[] = [];
  // Batch by decoded Revit category when one is available so the model browser
  // lists real categories; otherwise fall back to the record-code display role.
  const grouped = new Map<string, { role: DisplayRole; records: ElementBoundsRecord[] }>();
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
    const group = grouped.get(label) ?? { role, records: [] };
    group.records.push(record);
    grouped.set(label, group);
  }
  for (const [label, { role, records: roleRecords }] of grouped) {
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
        const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
        // A swept railing wins over its own envelope, which is the rectangle the
        // path spans rather than anything the railing occupies.
        const rail = record.railPath ? railGeometry(record.railPath, origin) : [];
        const stair = record.stairTreads?.length
          ? stairTreadGeometry(record.stairTreads, record.boundsFeet.min.z, origin)
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
        const items = stair.length
          ? stair
          : rail.length
          ? rail
          : prism.length
          ? prism
          : record.orientedBox
            ? [cornersGeometry(record.orientedBox, origin)]
            : solids.length
              ? solids.map((solid) => solidGeometry(solid, origin))
              : arcs.length
                ? arcs
                : [boxGeometry(record.boundsFeet, origin)];
        // Keep a little elevation shading so storeys stay legible, but let the
        // element's own category decide the hue.
        const elevation = Math.max(0, Math.min(1, (record.boundsFeet.min.z - origin.z + 10) / 80));
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
        materialIndex: DISPLAY_MATERIAL_INDEX[role],
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

export function levelsForBounds(records: ElementBoundsRecord[]): LevelBand[] {
  const bands = new Map<number, number>();
  for (const record of records) {
    const elevation = Math.round(record.boundsFeet.min.z * 2) / 2;
    bands.set(elevation, (bands.get(elevation) ?? 0) + 1);
  }
  return [...bands.entries()]
    .map(([elevation, candidates]) => ({ elevation, candidates }))
    .sort((a, b) => b.candidates - a.candidates)
    .slice(0, 8);
}
