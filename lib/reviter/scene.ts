/**
 * Turning recovered records into renderable batches.
 *
 * Nothing here decodes the file — it decides how already-recovered evidence is
 * shown: which envelopes belong in the default scene, how they are grouped and
 * shaded, and the display materials that stand in for undecoded Revit materials.
 */
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
  return [
    fallback("Unclassified display proxy", [0.58, 0.68, 0.79, 1]),
    fallback("Wall display proxy", [0.68, 0.75, 0.83, 1], 0.9),
    fallback("Door display proxy", [0.72, 0.55, 0.34, 1], 0.74),
    fallback("Panel display proxy", [0.62, 0.75, 0.84, 1], 0.68),
    fallback("Frame display proxy", [0.24, 0.32, 0.41, 1], 0.58),
    fallback("Structural display proxy", [0.52, 0.60, 0.69, 1], 0.86),
    fallback("Railing display proxy", [0.32, 0.39, 0.47, 1], 0.6),
    fallback("Slab and roof display proxy", [0.72, 0.77, 0.82, 1], 0.93),
    fallback("Covering display proxy", [0.76, 0.78, 0.76, 1], 0.9),
    fallback("Glazing display proxy", [0.55, 0.76, 0.85, 0.72], 0.42),
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
 * Display role per native Revit category. Categories outside this table still
 * carry their decoded id and name; they simply fall back to the record-code
 * heuristic for shading.
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
  [-2000170]: "panel",
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
      for (const record of batch) {
        const box = boxGeometry(record.boundsFeet, origin);
        positions.push(...box.positions);
        indices.push(...box.indices.map((index) => index + vertexOffset));
        vertexOffset += 8;
        const elevation = Math.max(0, Math.min(1, (record.boundsFeet.min.z - origin.z + 10) / 80));
        for (let vertex = 0; vertex < 8; vertex += 1) {
          colors.push(0.18 + elevation * 0.2, 0.72 + elevation * 0.1, 0.74 + elevation * 0.18);
        }
      }
      meshes.push({
        name: `${label} ${Math.floor(start / MESH_BATCH_SIZE) + 1}`,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        colors: new Float32Array(colors),
        materialIndex: DISPLAY_MATERIAL_INDEX[role],
        elementIds: Uint32Array.from(batch.map((record) => record.elementId)),
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
