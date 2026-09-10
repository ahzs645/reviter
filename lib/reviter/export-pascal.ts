/**
 * Pascal build-JSON export of Reviter's recovered model.
 *
 * Pascal (https://github.com/pascalorg/editor) stores a scene as a flat
 * dictionary of typed nodes — `{ nodes, rootNodeIds }` — and its editor loads
 * exactly that shape through **Load Build**, the same door its own IFC
 * converter and hand-edited files come through. So the shortest honest route
 * from an RVT to Pascal is not a format conversion at all: it is to write
 * Pascal's own nodes out of the evidence Reviter already decoded.
 *
 * That matters because the alternative loses information. Pascal's IFC importer
 * reconstructs a wall's centreline from an `IfcShapeRepresentation` axis and its
 * thickness from an extruded profile, and falls back to editor defaults when
 * neither is present. Reviter does not have to reconstruct any of it: a wall's
 * location line, thickness, and base/top elevations come out of the file's own
 * plane triples, a floor's outline out of its own sketch loops, a door's host
 * out of the persisted `InsertableInst.m_hostId`, and a storey out of
 * `Element.m_assocLevelId`. Every one of those is written here directly.
 *
 * ## Coordinates
 *
 * Revit is Z-up and works in decimal feet; Pascal is Y-up and works in metres,
 * and stores plan positions as `[x, z]`. The mapping is
 *
 *     pascal.x =  (revit.x - origin.x) * 0.3048
 *     pascal.y =  (revit.z - origin.z) * 0.3048     // up
 *     pascal.z = -(revit.y - origin.y) * 0.3048
 *
 * The negation on Y is deliberate and is the one place this exporter does not
 * follow Pascal's own IFC importer, which copies IFC +Y straight into Pascal +Z.
 * That copy flips handedness — the determinant of the basis change is -1 — so a
 * building imported that way is mirrored: its stairs turn the wrong way and its
 * plan reads backwards. Negating Y keeps the determinant at +1 and puts north at
 * -Z, which is also what a plan drawn with north up looks like in a top view.
 * {@link PascalExportOptions.mirrorPlan} restores the IFC importer's convention
 * for anyone comparing the two imports of one building side by side.
 *
 * Because that mapping reverses the sign of a ring's signed area, every polygon
 * is rewound here rather than left for the consumer to guess at.
 *
 * ## Levels
 *
 * Pascal stacks levels: a level's plane sits at the running total of the storey
 * heights below it, plus its own `baseElevation`. Writing the Revit elevations
 * into that model therefore means giving the lowest level a `baseElevation` and
 * every level a `height` equal to the gap above it, after which each plane lands
 * on its measured elevation and `baseElevation` is zero the rest of the way up.
 *
 * Elements are placed against their own level's plane, not the datum, because
 * that is the frame Pascal renders their children in.
 */
import type { WallArc, WallSolid } from "./native-geometry.ts";
import type { Point3 } from "./sketch-curves.ts";
import type { Bounds3, ConvertResult, ElementBoundsRecord } from "./types.ts";

const METRES_PER_FOOT = 0.3048;

/**
 * Pascal's sentinel support host (`GROUND_SUPPORT_ID`). A wall carrying it is
 * placed at its level's plane plus `supportOffset` instead of being lifted onto
 * whichever slab the editor elects under it — which is what a faithful import
 * wants, because the RVT already states where the wall's base is.
 */
const GROUND_SUPPORT_ID = "ground";

/** Storey height used above the topmost level when the model states none. */
const FALLBACK_TOP_STOREY_METRES = 3;

/** Pascal's stock glazing finish, given to the walls that stand in for panels. */
const CURTAIN_PANEL_SLOT = "library:preset-glass";

/**
 * Vertical extent above which a recovered surface is a slope, not a plate.
 *
 * Pascal's `slab` and `ceiling` are flat: a polygon at one height. Most of what
 * reaches them really is flat — in the supplied model every drawn floor, ceiling
 * and landing has an extent of 0.20 m or less — but a pitched roof and a ramp do
 * not, and their extent is mostly rise. Taking that extent as a thickness turns a
 * 3.54 m roof into a solid block standing proud of the building at the ridge.
 */
const SURFACE_PLATE_LIMIT_METRES = 0.6;

/**
 * Depth of the flat plate that stands in for a sloped surface.
 *
 * Where the plate sits was measured rather than assumed. Against the paired
 * Autodesk export, anchoring it at the middle of the recovered extent scores
 * 99.65% / 99.16% surface agreement, and beats anchoring it at the top
 * (99.47% / 99.00%), at the bottom (99.56% / 99.00%), and keeping the full
 * extent as a thickness (99.32% / 99.02%). Dropping these surfaces altogether
 * buys a better one-way figure (99.74%) by leaving a hole, and is worse the
 * other way (98.84%). The middle is where a plane best approximates a slope in
 * both directions, which is what the numbers say too.
 */
const SLOPED_SURFACE_PLATE_METRES = 0.3;

/** Revit `BuiltInCategory` ids this exporter recognises. */
const CATEGORY = {
  walls: -2_000_011,
  floors: -2_000_032,
  roofs: -2_000_035,
  ceilings: -2_000_038,
  doors: -2_000_023,
  windows: -2_000_014,
  columns: -2_000_100,
  structuralColumns: -2_001_330,
  stairs: -2_000_120,
  runs: -2_000_919,
  landings: -2_000_920,
  ramps: -2_000_180,
  curtainPanels: -2_000_170,
} as const;

const SLAB_CATEGORIES: ReadonlySet<number> = new Set([
  CATEGORY.floors,
  CATEGORY.landings,
  CATEGORY.ramps,
  CATEGORY.roofs,
]);

const COLUMN_CATEGORIES: ReadonlySet<number> = new Set([
  CATEGORY.columns,
  CATEGORY.structuralColumns,
]);

/**
 * How much of the model beyond Pascal's own building vocabulary is written.
 *
 * - `none` — only elements with a direct Pascal equivalent: walls, doors,
 *   windows, slabs, ceilings, columns and stairs.
 * - `curtain-panels` — the above plus curtain panels, written as thin `wall`
 *   nodes. A curtain-wall building loses its whole façade without them, and a
 *   flat vertical panel *is* a wall as far as Pascal's geometry is concerned,
 *   so this stays inside the node kinds every published Pascal knows.
 * - `all` — the above plus every other element with recoverable geometry —
 *   mullions, railings, furniture — as `block` solids. `block` is Pascal's
 *   general editable mass and is newer than the current npm release, so a file
 *   written this way needs an editor built from the Pascal repository; on an
 *   older one those nodes are rejected as an unknown type.
 */
export type PascalExtraElements = "none" | "curtain-panels" | "all";

export type PascalExportOptions = {
  /** See {@link PascalExtraElements}. Defaults to `"curtain-panels"`. */
  extras?: PascalExtraElements;
  /**
   * Copy Revit +Y into Pascal +Z, as Pascal's IFC importer does, instead of
   * negating it. This mirrors the building; see the module comment.
   */
  mirrorPlan?: boolean;
  /** Name given to the site and building nodes. Defaults to the file name. */
  projectName?: string;
};

/** A Pascal node. Structural only — Pascal's own zod schemas are authoritative. */
export type PascalNode = {
  object: "node";
  id: string;
  type: string;
  name?: string;
  parentId: string | null;
  visible: boolean;
  children?: string[];
  metadata?: Record<string, unknown>;
  [field: string]: unknown;
};

export type PascalSceneStats = {
  levels: number;
  walls: number;
  curvedWalls: number;
  /** Curtain panels, included in `walls` and written as thin wall nodes. */
  curtainPanels: number;
  doors: number;
  windows: number;
  slabs: number;
  ceilings: number;
  columns: number;
  stairs: number;
  blocks: number;
  /** Elements that carried usable geometry but no Pascal node was written for. */
  skipped: number;
  /** Elements held back because the conversion's own display scene omits them. */
  notDrawn: number;
  /** Sloped surfaces — pitched roofs, ramps — written as one flat plate. */
  flattenedSlopes: number;
};

export type PascalScene = {
  nodes: Record<string, PascalNode>;
  rootNodeIds: string[];
  stats: PascalSceneStats;
};

type Plan = [number, number];

type LevelPlacement = {
  id: string;
  ordinal: number;
  /** Level plane, in metres above the export datum. */
  elevation: number;
  revitLevelId?: number;
};

/** One straight run of one Revit wall, as it was written into the scene. */
type WallPlacement = {
  id: string;
  start: Plan;
  end: Plan;
  /** Wall base, in metres above the export datum. */
  base: number;
  height: number;
  levelId: string;
};

// ─── Geometry helpers ────────────────────────────────────────────────────────

function ringArea(points: readonly Plan[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** Drop the repeated closing point and rewind to the requested orientation. */
function normaliseRing(points: Plan[], counterClockwise: boolean): Plan[] {
  const ring = points.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length > 3 &&
    first &&
    last &&
    Math.abs(first[0] - last[0]) < 1e-9 &&
    Math.abs(first[1] - last[1]) < 1e-9
  ) {
    ring.pop();
  }
  if (ring.length < 3) return ring;
  const area = ringArea(ring);
  if (area === 0) return ring;
  if (area > 0 !== counterClockwise) ring.reverse();
  return ring;
}

/**
 * Rotation about Y that carries a Pascal node's local +X onto `direction`.
 *
 * Three.js rotates local +X to `(cos θ, 0, -sin θ)`, so the angle that lands on
 * a plan direction `(x, z)` is `atan2(-z, x)` rather than the `atan2(z, x)` a
 * plan-space reading suggests.
 */
function rotationForPlanDirection(x: number, z: number): number {
  return Math.atan2(-z, x);
}

function planDistanceToSegment(point: Plan, start: Plan, end: Plan): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz));
}

// ─── Element evidence ────────────────────────────────────────────────────────

/**
 * The elements that actually reached the display scene.
 *
 * This is the same gate the GLB and IFC exports pass through — both build their
 * products out of `result.meshes` — and the Pascal export has to honour it too.
 * A conversion recovers evidence for more elements than it is willing to draw:
 * stair paths, rail-path extension lines and unnamed storey-sized plates all
 * carry bounds, and all of them are excluded from the display scene on purpose
 * (see `docs/unbc-drawn-but-not-elements-2026-07-28.md`). Three such plates in
 * the supplied model measure 83 m by 52 m and 100 mm thick; exporting them puts
 * the scene's extents 24 m outside the building.
 *
 * An empty set means no display scene was built at all — a bounds-only
 * conversion — and there is then nothing to gate against.
 */
function drawnElements(result: ConvertResult): Set<number> {
  const drawn = new Set<number>();
  for (const mesh of result.meshes) {
    for (const elementId of mesh.elementIds ?? []) drawn.add(elementId);
  }
  return drawn;
}

/**
 * The best record for each element id.
 *
 * A conversion can leave several records for one element — a bounds envelope
 * and, later, a rebuilt solid — and the semantic export wants whichever carries
 * real geometry. Solids and sketch loops outrank an oriented box, and an
 * oriented box outranks a bare envelope.
 */
function bestRecordByElement(
  records: readonly ElementBoundsRecord[],
): Map<number, ElementBoundsRecord> {
  const rank = (record: ElementBoundsRecord): number => {
    if (record.solids?.length || record.solid) return 5;
    if (record.loops?.length) return 5;
    if (record.stairTreads?.length) return 4;
    if (record.arcs?.length) return 4;
    if (record.orientedBox) return 3;
    if (record.quads?.length) return 2;
    return 1;
  };
  const best = new Map<number, ElementBoundsRecord>();
  for (const record of records) {
    const previous = best.get(record.elementId);
    if (!previous || rank(record) > rank(previous)) best.set(record.elementId, record);
  }
  return best;
}

function elementName(record: ElementBoundsRecord, fallback: string): string {
  return record.typeName ?? record.familyName ?? record.categoryName ?? fallback;
}

function elementMetadata(record: ElementBoundsRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: "reviter",
    revitElementId: record.elementId,
  };
  if (record.categoryId != null) metadata.revitCategoryId = record.categoryId;
  if (record.categoryName) metadata.revitCategory = record.categoryName;
  if (record.categorySource) metadata.revitCategoryEvidence = record.categorySource;
  if (record.typeId != null) metadata.revitTypeId = record.typeId;
  if (record.typeName) metadata.revitTypeName = record.typeName;
  if (record.familyName) metadata.revitFamilyName = record.familyName;
  if (record.renderGeometryProvenance) {
    metadata.revitGeometryProvenance = record.renderGeometryProvenance;
  }
  return metadata;
}

// ─── The exporter ────────────────────────────────────────────────────────────

/**
 * Build a Pascal scene graph from a completed conversion.
 *
 * The returned object is what Pascal's `validateBuildJson` accepts, plus a
 * `stats` field it ignores; {@link makePascalSceneJson} serialises only the two
 * fields the format defines.
 */
export function makePascalScene(
  result: ConvertResult,
  options: PascalExportOptions = {},
): PascalScene {
  const extras: PascalExtraElements = options.extras ?? "curtain-panels";
  const mirrorPlan = options.mirrorPlan === true;
  const projectName = options.projectName ?? result.fileName.replace(/\.[^.]+$/, "");

  const origin = result.origin;
  const planSign = mirrorPlan ? 1 : -1;
  const plan = (x: number, y: number): Plan => [
    (x - origin.x) * METRES_PER_FOOT,
    planSign * (y - origin.y) * METRES_PER_FOOT,
  ];
  const up = (z: number): number => (z - origin.z) * METRES_PER_FOOT;

  const nodes: Record<string, PascalNode> = {};
  const stats: PascalSceneStats = {
    levels: 0,
    walls: 0,
    curvedWalls: 0,
    curtainPanels: 0,
    doors: 0,
    windows: 0,
    slabs: 0,
    ceilings: 0,
    columns: 0,
    stairs: 0,
    blocks: 0,
    skipped: 0,
    notDrawn: 0,
    flattenedSlopes: 0,
  };

  const add = (node: PascalNode): PascalNode => {
    nodes[node.id] = node;
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    if (parent?.children) parent.children.push(node.id);
    return node;
  };

  // ── Site and building ──────────────────────────────────────────────────────

  const siteId = "site_reviter";
  const buildingId = "building_reviter";
  const halfWidth = Math.max(
    15,
    Math.abs(result.bbox.min.x) * METRES_PER_FOOT,
    Math.abs(result.bbox.max.x) * METRES_PER_FOOT,
  ) + 5;
  const halfDepth = Math.max(
    15,
    Math.abs(result.bbox.min.y) * METRES_PER_FOOT,
    Math.abs(result.bbox.max.y) * METRES_PER_FOOT,
  ) + 5;

  add({
    object: "node",
    id: siteId,
    type: "site",
    name: projectName,
    parentId: null,
    visible: true,
    polygon: {
      type: "polygon",
      points: [
        [-halfWidth, -halfDepth],
        [halfWidth, -halfDepth],
        [halfWidth, halfDepth],
        [-halfWidth, halfDepth],
      ],
    },
    children: [],
    metadata: {
      source: "reviter",
      revitFile: result.fileName,
      revitVersion: result.decoderCoverage.revitVersion ?? null,
    },
  });

  add({
    object: "node",
    id: buildingId,
    type: "building",
    name: projectName,
    parentId: siteId,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: [],
    metadata: { source: "reviter" },
  });

  // ── Levels ─────────────────────────────────────────────────────────────────

  const bands = result.levels.slice().sort((a, b) => a.elevation - b.elevation);
  const levels: LevelPlacement[] = [];
  const levelById = new Map<string, LevelPlacement>();
  const levelByRevitId = new Map<number, LevelPlacement>();

  bands.forEach((band, index) => {
    const elevation = up(band.elevation);
    const next = bands[index + 1];
    const height = next ? up(next.elevation) - elevation : FALLBACK_TOP_STOREY_METRES;
    const placement: LevelPlacement = {
      id: band.levelId == null ? `level_b${index}` : `level_r${band.levelId}`,
      ordinal: index,
      elevation,
      revitLevelId: band.levelId,
    };
    levels.push(placement);
    levelById.set(placement.id, placement);
    if (band.levelId != null) levelByRevitId.set(band.levelId, placement);

    add({
      object: "node",
      id: placement.id,
      type: "level",
      name: band.levelId == null
        ? `Level ${index + 1}`
        : `Level ${index + 1} (${band.levelId})`,
      parentId: buildingId,
      visible: true,
      level: index,
      // Pascal stacks storeys, so only the lowest level needs to state where
      // the stack starts; every level above lands on its own elevation once the
      // heights below it are the measured gaps.
      baseElevation: index === 0 ? elevation : 0,
      height: Math.max(height, 0.01),
      children: [],
      metadata: {
        source: "reviter",
        revitLevelId: band.levelId ?? null,
        revitElevationFeet: band.elevation,
        levelEvidence: band.source ?? "elevation-band",
      },
    });
    stats.levels += 1;
  });

  if (levels.length === 0) {
    // A model with no decoded storey still has to hang its elements somewhere.
    const placement: LevelPlacement = { id: "level_b0", ordinal: 0, elevation: 0 };
    levels.push(placement);
    levelById.set(placement.id, placement);
    add({
      object: "node",
      id: placement.id,
      type: "level",
      name: "Level 1",
      parentId: buildingId,
      visible: true,
      level: 0,
      baseElevation: 0,
      height: FALLBACK_TOP_STOREY_METRES,
      children: [],
      metadata: { source: "reviter", levelEvidence: "none" },
    });
    stats.levels += 1;
  }

  const associatedLevel = new Map<number, number>();
  for (const relation of result.nativeAssociatedLevelRelations ?? []) {
    associatedLevel.set(relation.elementId, relation.levelId);
  }

  /**
   * The level an element belongs to.
   *
   * The file's own `Element.m_assocLevelId` is preferred and is what the great
   * majority of elements resolve through; an element without one falls back to
   * the highest storey at or below where it actually sits.
   */
  const levelFor = (elementId: number, elevationMetres: number): LevelPlacement => {
    const associated = associatedLevel.get(elementId);
    if (associated != null) {
      const stated = levelByRevitId.get(associated);
      if (stated) return stated;
    }
    let chosen = levels[0]!;
    for (const level of levels) {
      if (level.elevation <= elevationMetres + 1e-6) chosen = level;
      else break;
    }
    return chosen;
  };

  // ── Walls ──────────────────────────────────────────────────────────────────

  const drawn = drawnElements(result);
  const records = bestRecordByElement(
    drawn.size === 0
      ? result.elementBounds
      : result.elementBounds.filter((record) => drawn.has(record.elementId)),
  );
  stats.notDrawn = drawn.size === 0
    ? 0
    : new Set(
        result.elementBounds
          .filter((record) => !drawn.has(record.elementId))
          .map((record) => record.elementId),
      ).size;
  const wallsByElement = new Map<number, WallPlacement[]>();

  const addWall = (
    record: ElementBoundsRecord,
    id: string,
    start: Plan,
    end: Plan,
    baseElevationFeet: number,
    topElevationFeet: number,
    thicknessFeet: number,
    extra: { curveOffset?: number; slots?: Record<string, string> } = {},
  ): void => {
    const base = up(baseElevationFeet);
    const height = (topElevationFeet - baseElevationFeet) * METRES_PER_FOOT;
    if (!(height > 0)) {
      stats.skipped += 1;
      return;
    }
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6) {
      // Pascal's import heals zero-length walls by dropping them; do not write
      // one in the first place.
      stats.skipped += 1;
      return;
    }
    const level = levelFor(record.elementId, base);
    add({
      object: "node",
      id,
      type: "wall",
      name: elementName(record, "Wall"),
      parentId: level.id,
      visible: true,
      start,
      end,
      thickness: Math.max(thicknessFeet * METRES_PER_FOOT, 0.01),
      height,
      ...(extra.curveOffset == null ? {} : { curveOffset: extra.curveOffset }),
      ...(extra.slots ? { slots: extra.slots } : {}),
      // The RVT states this wall's base, so pin it to the level plane rather
      // than letting the editor elect a slab under it and lift it.
      supportSlabId: GROUND_SUPPORT_ID,
      supportOffset: base - level.elevation,
      frontSide: "unknown",
      backSide: "unknown",
      children: [],
      metadata: elementMetadata(record),
    });
    stats.walls += 1;
    if (extra.curveOffset != null) stats.curvedWalls += 1;

    let placements = wallsByElement.get(record.elementId);
    if (!placements) {
      placements = [];
      wallsByElement.set(record.elementId, placements);
    }
    placements.push({ id, start, end, base, height, levelId: level.id });
  };

  const wallFromSolid = (record: ElementBoundsRecord, solid: WallSolid, id: string): void => {
    addWall(
      record,
      id,
      plan(solid.start.x, solid.start.y),
      plan(solid.end.x, solid.end.y),
      solid.baseElevation,
      solid.topElevation,
      solid.thickness,
    );
  };

  const wallFromArc = (record: ElementBoundsRecord, arc: WallArc, id: string): void => {
    const at = (angle: number): Plan => {
      const x = arc.centre.x + arc.radius * (Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x);
      const y = arc.centre.y + arc.radius * (Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y);
      return plan(x, y);
    };
    const start = at(arc.startAngle);
    const end = at(arc.endAngle);
    const middle = at((arc.startAngle + arc.endAngle) / 2);
    // Pascal bends a wall by the sagitta at its midpoint, signed against the
    // chord's left normal — the same quantity, measured rather than re-derived
    // from the sweep so a mirrored export keeps the bulge on the right side.
    const chordX = end[0] - start[0];
    const chordZ = end[1] - start[1];
    const chordLength = Math.hypot(chordX, chordZ);
    if (chordLength < 1e-9) {
      stats.skipped += 1;
      return;
    }
    const midpointX = (start[0] + end[0]) / 2;
    const midpointZ = (start[1] + end[1]) / 2;
    const curveOffset =
      ((middle[0] - midpointX) * -chordZ + (middle[1] - midpointZ) * chordX) / chordLength;
    addWall(record, id, start, end, arc.baseElevation, arc.topElevation, arc.thickness, {
      curveOffset,
    });
  };

  for (const record of records.values()) {
    if (record.categoryId !== CATEGORY.walls) continue;
    const solids = record.solids?.length
      ? record.solids
      : record.solid
        ? [record.solid]
        : [];
    if (solids.length > 0) {
      solids.forEach((solid, index) => {
        wallFromSolid(record, solid, `wall_e${record.elementId}${index === 0 ? "" : `_${index}`}`);
      });
      continue;
    }
    const arcs = record.arcs ?? [];
    if (arcs.length > 0) {
      arcs.forEach((arc, index) => {
        wallFromArc(record, arc, `wall_e${record.elementId}${index === 0 ? "" : `_${index}`}`);
      });
      continue;
    }
    stats.skipped += 1;
  }

  // ── Curtain panels ─────────────────────────────────────────────────────────

  if (extras !== "none") {
    for (const record of records.values()) {
      if (record.categoryId !== CATEGORY.curtainPanels) continue;
      const corners = record.orientedBox;
      if (!corners || corners.length < 8) {
        stats.skipped += 1;
        continue;
      }
      // The panel's base rectangle is long in the plane of the façade and thin
      // across it, so the longer edge is the run and the shorter the thickness.
      const [a, b, , d] = corners;
      if (!a || !b || !d) {
        stats.skipped += 1;
        continue;
      }
      const alongLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const acrossLength = Math.hypot(d[0] - a[0], d[1] - a[1]);
      const long = alongLength >= acrossLength ? b : d;
      const short = alongLength >= acrossLength ? d : b;
      const halfShort: [number, number] = [(short[0] - a[0]) / 2, (short[1] - a[1]) / 2];
      addWall(
        record,
        `wall_panel_e${record.elementId}`,
        plan(a[0] + halfShort[0], a[1] + halfShort[1]),
        plan(long[0] + halfShort[0], long[1] + halfShort[1]),
        record.boundsFeet.min.z,
        record.boundsFeet.max.z,
        Math.min(alongLength, acrossLength),
        { slots: { interior: CURTAIN_PANEL_SLOT, exterior: CURTAIN_PANEL_SLOT } },
      );
      stats.curtainPanels += 1;
    }
  }

  // ── Doors and windows ──────────────────────────────────────────────────────

  const hostByElement = new Map<number, number>();
  for (const relation of result.nativeHostRelations ?? []) {
    hostByElement.set(relation.elementId, relation.hostId);
  }

  /** Where an oriented box sits on one of its host wall's runs. */
  const openingOnWall = (
    corners: readonly [number, number, number][],
    walls: readonly WallPlacement[],
  ): { wall: WallPlacement; along: number; centreY: number; width: number; height: number } | null => {
    let sumX = 0;
    let sumY = 0;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      sumX += corner[0];
      sumY += corner[1];
      minZ = Math.min(minZ, corner[2]);
      maxZ = Math.max(maxZ, corner[2]);
    }
    const count = corners.length;
    if (count === 0) return null;
    const centre = plan(sumX / count, sumY / count);

    let best: WallPlacement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const wall of walls) {
      const distance = planDistanceToSegment(centre, wall.start, wall.end);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = wall;
      }
    }
    if (!best) return null;

    const axisX = best.end[0] - best.start[0];
    const axisZ = best.end[1] - best.start[1];
    const axisLength = Math.hypot(axisX, axisZ);
    if (axisLength < 1e-9) return null;
    const unitX = axisX / axisLength;
    const unitZ = axisZ / axisLength;

    // Measure the opening in the wall's own frame: a world-axis box conflates
    // an angled door's width with its thickness.
    let minAlong = Number.POSITIVE_INFINITY;
    let maxAlong = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      const point = plan(corner[0], corner[1]);
      const along = (point[0] - best.start[0]) * unitX + (point[1] - best.start[1]) * unitZ;
      minAlong = Math.min(minAlong, along);
      maxAlong = Math.max(maxAlong, along);
    }

    return {
      wall: best,
      along: Math.max(0, Math.min(axisLength, (minAlong + maxAlong) / 2)),
      centreY: up((minZ + maxZ) / 2),
      width: Math.max((maxAlong - minAlong), 0.05),
      height: Math.max((maxZ - minZ) * METRES_PER_FOOT, 0.05),
    };
  };

  for (const record of records.values()) {
    const isDoor = record.categoryId === CATEGORY.doors;
    const isWindow = record.categoryId === CATEGORY.windows;
    if (!isDoor && !isWindow) continue;

    const corners = record.orientedBox;
    const hostId = hostByElement.get(record.elementId);
    const hostWalls = hostId == null ? undefined : wallsByElement.get(hostId);
    if (!corners || !hostWalls?.length) {
      // A door hosted by a curtain-wall system, or one whose host wall carried
      // no recoverable solid, has nowhere to hang in Pascal's wall-child model.
      stats.skipped += 1;
      continue;
    }
    const placement = openingOnWall(corners, hostWalls);
    if (!placement) {
      stats.skipped += 1;
      continue;
    }

    const id = `${isDoor ? "door" : "window"}_e${record.elementId}`;
    add({
      object: "node",
      id,
      type: isDoor ? "door" : "window",
      name: elementName(record, isDoor ? "Door" : "Window"),
      parentId: placement.wall.id,
      visible: true,
      wallId: placement.wall.id,
      // Wall-local: along the wall from its start, then the opening's centre
      // height above the wall's base.
      position: [placement.along, placement.centreY - placement.wall.base, 0],
      rotation: [0, 0, 0],
      width: placement.width,
      height: placement.height,
      metadata: { ...elementMetadata(record), revitHostElementId: hostId },
    });
    if (isDoor) stats.doors += 1;
    else stats.windows += 1;
  }

  // ── Slabs and ceilings ─────────────────────────────────────────────────────

  const ringsToPlan = (loops: readonly Point3[][]): { polygon: Plan[]; holes: Plan[][] } | null => {
    const rings = loops
      .map((loop) => normaliseRing(loop.map((point) => plan(point[0], point[1])), true))
      .filter((ring) => ring.length >= 3);
    const outer = rings[0];
    if (!outer) return null;
    return {
      polygon: outer,
      // Pascal's surface systems triangulate the outline and subtract the
      // holes, so a hole is wound against its outline.
      holes: rings.slice(1).map((ring) => ring.slice().reverse()),
    };
  };

  const surfaceThickness = (bounds: Bounds3): number =>
    Math.max((bounds.max.z - bounds.min.z) * METRES_PER_FOOT, 0.01);

  for (const record of records.values()) {
    const categoryId = record.categoryId;
    if (categoryId == null) continue;
    const isCeiling = categoryId === CATEGORY.ceilings;
    if (!isCeiling && !SLAB_CATEGORIES.has(categoryId)) continue;
    if (!record.loops?.length) {
      stats.skipped += 1;
      continue;
    }
    const outline = ringsToPlan(record.loops);
    if (!outline) {
      stats.skipped += 1;
      continue;
    }

    const extent = surfaceThickness(record.boundsFeet);
    const sloped = extent > SURFACE_PLATE_LIMIT_METRES;
    const thickness = sloped ? Math.min(SLOPED_SURFACE_PLATE_METRES, extent) : extent;
    // A flat plate stands in for a slope at the middle of its extent, so the
    // error is shared between the high end and the low one.
    const top = up(record.boundsFeet.max.z) - (sloped ? (extent - thickness) / 2 : 0);
    const level = levelFor(record.elementId, top);
    const metadata = sloped
      ? { ...elementMetadata(record), revitExtentMetres: extent, flattenedSlope: true }
      : elementMetadata(record);

    if (isCeiling) {
      add({
        object: "node",
        id: `ceiling_e${record.elementId}`,
        type: "ceiling",
        name: elementName(record, "Ceiling"),
        parentId: level.id,
        visible: true,
        polygon: outline.polygon,
        holes: outline.holes,
        holeMetadata: [],
        height: Math.max(top - level.elevation, 0.01),
        autoFromWalls: false,
        children: [],
        metadata,
      });
      stats.ceilings += 1;
      continue;
    }

    add({
      object: "node",
      id: `slab_e${record.elementId}`,
      type: "slab",
      name: elementName(record, "Slab"),
      parentId: level.id,
      visible: true,
      polygon: outline.polygon,
      holes: outline.holes,
      holeMetadata: [],
      // Pascal's slab is anchored at its walking surface and grows downward.
      elevation: top - level.elevation,
      thickness,
      recessed: false,
      autoFromWalls: false,
      children: [],
      metadata,
    });
    stats.slabs += 1;
    if (sloped) stats.flattenedSlopes += 1;
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  for (const record of records.values()) {
    if (record.categoryId == null || !COLUMN_CATEGORIES.has(record.categoryId)) continue;
    const corners = record.orientedBox;
    if (!corners || corners.length < 8) {
      stats.skipped += 1;
      continue;
    }
    // The recovered box lists its four base corners first, in ring order.
    const base = corners.slice(0, 4).map((corner) => plan(corner[0], corner[1]));
    const a = base[0]!;
    const b = base[1]!;
    const d = base[3]!;
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const depth = Math.hypot(d[0] - a[0], d[1] - a[1]);
    const height = (record.boundsFeet.max.z - record.boundsFeet.min.z) * METRES_PER_FOOT;
    if (!(width > 0 && depth > 0 && height > 0)) {
      stats.skipped += 1;
      continue;
    }
    const centreX = base.reduce((total, point) => total + point[0], 0) / base.length;
    const centreZ = base.reduce((total, point) => total + point[1], 0) / base.length;
    const bottom = up(record.boundsFeet.min.z);
    const level = levelFor(record.elementId, bottom);

    add({
      object: "node",
      id: `column_e${record.elementId}`,
      type: "column",
      name: elementName(record, "Column"),
      parentId: level.id,
      visible: true,
      // Pascal anchors a column at the centre of its base.
      position: [centreX, bottom - level.elevation, centreZ],
      rotation: rotationForPlanDirection(b[0] - a[0], b[1] - a[1]),
      style: "plain",
      crossSection: "square",
      height,
      width,
      depth,
      radius: Math.max(Math.min(width, depth) / 2, 0.01),
      baseHeight: 0,
      capitalHeight: 0,
      metadata: elementMetadata(record),
    });
    stats.columns += 1;
  }

  // ── Stairs ─────────────────────────────────────────────────────────────────

  for (const record of records.values()) {
    if (record.categoryId !== CATEGORY.runs) continue;
    const treads = record.stairTreads;
    if (!treads?.length) {
      stats.skipped += 1;
      continue;
    }
    const centreOf = (tread: readonly Point3[]): { plan: Plan; z: number } => {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const point of tread) {
        x += point[0];
        y += point[1];
        z += point[2];
      }
      return { plan: plan(x / tread.length, y / tread.length), z: z / tread.length };
    };

    const ordered = treads
      .map((tread) => centreOf(tread))
      .sort((left, right) => left.z - right.z);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const travelX = last.plan[0] - first.plan[0];
    const travelZ = last.plan[1] - first.plan[1];
    const travel = Math.hypot(travelX, travelZ);
    const rise = up(record.boundsFeet.max.z) - up(record.boundsFeet.min.z);
    if (travel < 1e-6 || !(rise > 0)) {
      stats.skipped += 1;
      continue;
    }

    // The run's width is its tread, measured across the direction of travel.
    const unitX = travelX / travel;
    const unitZ = travelZ / travel;
    let width = 0;
    for (const tread of treads) {
      let minAcross = Number.POSITIVE_INFINITY;
      let maxAcross = Number.NEGATIVE_INFINITY;
      for (const point of tread) {
        const corner = plan(point[0], point[1]);
        const across = corner[0] * -unitZ + corner[1] * unitX;
        minAcross = Math.min(minAcross, across);
        maxAcross = Math.max(maxAcross, across);
      }
      width = Math.max(width, maxAcross - minAcross);
    }

    const steps = record.stairExpectedRiserCount ?? treads.length;
    const base = up(record.boundsFeet.min.z);
    const level = levelFor(record.elementId, base);
    const stairId = `stair_e${record.elementId}`;
    const treadDepth = travel / Math.max(treads.length - 1, 1);
    // Pascal's flight runs from the group origin along its local +Z, so the
    // anchor is the foot of the run rather than its centre, and the recovered
    // tread centres are half a tread short of the nosing at each end.
    const length = travel + treadDepth;
    const anchorX = first.plan[0] - unitX * treadDepth / 2;
    const anchorZ = first.plan[1] - unitZ * treadDepth / 2;

    add({
      object: "node",
      id: stairId,
      type: "stair",
      name: elementName(record, "Stair"),
      parentId: level.id,
      visible: true,
      position: [anchorX, base - level.elevation, anchorZ],
      // The flight travels along local +Z, so the rotation carries +Z, not +X,
      // onto the direction of travel.
      rotation: rotationForPlanDirection(unitZ, -unitX),
      stairType: "straight",
      width: Math.max(width, 0.1),
      totalRise: rise,
      stepCount: Math.max(Math.round(steps), 1),
      thickness: Math.max(
        (record.stairTreadThicknessFeet ?? 0.164) * METRES_PER_FOOT,
        0.02,
      ),
      fillToFloor: false,
      railingMode: "none",
      children: [],
      metadata: elementMetadata(record),
    });
    add({
      object: "node",
      id: `sseg_e${record.elementId}`,
      type: "stair-segment",
      name: "Flight",
      parentId: stairId,
      visible: true,
      position: [0, 0, 0],
      rotation: 0,
      segmentType: "stair",
      width: Math.max(width, 0.1),
      length,
      height: rise,
      stepCount: Math.max(Math.round(steps), 1),
      attachmentSide: "front",
      fillToFloor: false,
      metadata: { source: "reviter", revitElementId: record.elementId },
    });
    stats.stairs += 1;
  }

  // ── Everything else, as block solids ───────────────────────────────────────

  if (extras === "all") {
    const written = new Set<number>();
    for (const id of Object.keys(nodes)) {
      const revitId = (nodes[id]?.metadata as { revitElementId?: number } | undefined)
        ?.revitElementId;
      if (typeof revitId === "number") written.add(revitId);
    }

    for (const record of records.values()) {
      if (written.has(record.elementId)) continue;
      const corners = record.orientedBox;
      const bounds = record.boundsFeet;
      const height = (bounds.max.z - bounds.min.z) * METRES_PER_FOOT;
      if (!(height > 0)) {
        stats.skipped += 1;
        continue;
      }

      const footprint: Plan[] = corners?.length === 8
        ? corners.slice(0, 4).map((corner) => plan(corner[0], corner[1]))
        : [
            plan(bounds.min.x, bounds.min.y),
            plan(bounds.max.x, bounds.min.y),
            plan(bounds.max.x, bounds.max.y),
            plan(bounds.min.x, bounds.max.y),
          ];
      const ring = normaliseRing(footprint, true);
      if (ring.length < 3) {
        stats.skipped += 1;
        continue;
      }

      const bottom = up(bounds.min.z);
      const level = levelFor(record.elementId, bottom);
      const originX = ring.reduce((total, point) => total + point[0], 0) / ring.length;
      const originZ = ring.reduce((total, point) => total + point[1], 0) / ring.length;

      // A prism over the footprint: the base ring, the same ring lifted, and
      // one quad per side. Pascal keys faces and edges by id, so they are named
      // from their ring position and stay stable across re-exports.
      const vertices: { id: string; position: [number, number, number] }[] = [];
      ring.forEach((point, index) => {
        vertices.push({ id: `b${index}`, position: [point[0] - originX, 0, point[1] - originZ] });
      });
      ring.forEach((point, index) => {
        vertices.push({ id: `t${index}`, position: [point[0] - originX, height, point[1] - originZ] });
      });
      const edges: { id: string; vertexIds: [string, string] }[] = [];
      const faces: { id: string; vertexIds: string[]; materialSlot: string }[] = [
        { id: "base", vertexIds: ring.map((_, index) => `b${index}`).reverse(), materialSlot: "body" },
        { id: "top", vertexIds: ring.map((_, index) => `t${index}`), materialSlot: "body" },
      ];
      ring.forEach((_, index) => {
        const next = (index + 1) % ring.length;
        edges.push({ id: `be${index}`, vertexIds: [`b${index}`, `b${next}`] });
        edges.push({ id: `te${index}`, vertexIds: [`t${index}`, `t${next}`] });
        edges.push({ id: `ve${index}`, vertexIds: [`b${index}`, `t${index}`] });
        faces.push({
          id: `side${index}`,
          vertexIds: [`b${index}`, `b${next}`, `t${next}`, `t${index}`],
          materialSlot: "body",
        });
      });

      add({
        object: "node",
        id: `block_e${record.elementId}`,
        type: "block",
        name: elementName(record, "Element"),
        parentId: level.id,
        visible: true,
        position: [originX, bottom - level.elevation, originZ],
        rotation: 0,
        topology: { vertices, edges, faces },
        slots: {},
        slotNames: { body: "Body" },
        children: [],
        metadata: elementMetadata(record),
      });
      stats.blocks += 1;
    }
  }

  return { nodes, rootNodeIds: [siteId], stats };
}

/** The Pascal build JSON itself, as Load Build reads it. */
export function makePascalSceneJson(
  result: ConvertResult,
  options: PascalExportOptions = {},
): string {
  const scene = makePascalScene(result, options);
  return `${JSON.stringify({ nodes: scene.nodes, rootNodeIds: scene.rootNodeIds }, null, 1)}\n`;
}
