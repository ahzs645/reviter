/**
 * Turning recovered records into renderable batches.
 *
 * Nothing here decodes the file — it decides how already-recovered evidence is
 * shown: which envelopes belong in the default scene, how they are grouped and
 * shaded, and the display materials that stand in for undecoded Revit materials.
 */
import type { SurfaceQuad, WallSolid } from "./native-geometry.ts";
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

/** Token thickness given to a face so it can be drawn as a pickable box. */
const FACE_THICKNESS_FEET = 0.02;

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
  | "native";

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
  // A curtain-wall container stays a wrapper even once its category is known,
  // so its child panels and mullions are not swallowed by one large envelope.
  const isWrapper = code === 30 && count != null && count >= 8 && count <= 10;
  if (!isWrapper && record.categoryId != null) {
    return CATEGORY_DISPLAY_ROLE[record.categoryId] ?? "native";
  }
  if (code === 30 && count === 5) return "wall";
  if (code === 30 && count != null && count >= 8 && count <= 10) return "wrapper";
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
  omittedUnknownCount: number;
};

/**
 * Choose the envelopes that belong in the default scene. Wrappers and
 * unclassified records stay in the audit and the exports, and a single
 * building-sized container is set aside so it cannot hide everything behind it.
 */
export function selectDisplayBounds(records: ElementBoundsRecord[]): DisplaySelection {
  let classified = records.filter((record) => displayRole(record) !== "unknown" && displayRole(record) !== "wrapper");
  const omittedWrapperCount = records.filter((record) => displayRole(record) === "wrapper").length;
  let omittedUnknownCount = records.length - classified.length - omittedWrapperCount;
  if (!classified.length) {
    classified = records;
    omittedUnknownCount = 0;
  }
  if (classified.length < 2) {
    return { records: classified, omittedContainerCount: 0, omittedWrapperCount, omittedUnknownCount };
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
    return { records: classified, omittedContainerCount: 0, omittedWrapperCount, omittedUnknownCount };
  }
  return {
    records: classified.filter((record) => record !== largest.record),
    omittedContainerCount: 1,
    omittedWrapperCount,
    omittedUnknownCount,
  };
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

/**
 * A trimmed plane, drawn as a thin slab. Picking maps a hit triangle to an
 * element by dividing the face index by 12, so every drawn item has to be a
 * 12-triangle box; a face is therefore given a token thickness rather than
 * being emitted as a bare quad.
 */
function quadGeometry(quad: SurfaceQuad, origin: Vec3) {
  const [a, b, c] = quad.corners;
  const ux = b![0] - a![0];
  const uy = b![1] - a![1];
  const uz = b![2] - a![2];
  const vx = c![0] - b![0];
  const vy = c![1] - b![1];
  const vz = c![2] - b![2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  const half = FACE_THICKNESS_FEET / 2;
  nx = (nx / length) * half;
  ny = (ny / length) * half;
  nz = (nz / length) * half;
  const points = [
    ...quad.corners.map(([x, y, z]) => [x - nx, y - ny, z - nz]),
    ...quad.corners.map(([x, y, z]) => [x + nx, y + ny, z + nz]),
  ];
  return {
    positions: points.flatMap(([x, y, z]) => [x! - origin.x, y! - origin.y, z! - origin.z]),
    indices: BOX_INDICES,
  };
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
    const role = displayRole(record);
    if (role === "unknown" || role === "wrapper") continue;
    const label = record.categoryName ?? `${role[0]!.toUpperCase()}${role.slice(1)} proxies`;
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
        const items = prism.length
          ? prism
          : record.orientedBox
            ? [cornersGeometry(record.orientedBox, origin)]
            : record.quads?.length
              ? record.quads.map((quad) => quadGeometry(quad, origin))
              : [record.solid ? solidGeometry(record.solid, origin) : boxGeometry(record.boundsFeet, origin)];
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
