import type { Bounds3, MeshData } from "./types.ts";

const TRIANGLE_KEY_TOLERANCE_FEET = 1e-5;
const OPENING_PADDING_FEET = 0.01;
const AREA_EPSILON = 1e-12;
const REF_STRIDE = 0x1_0000_0000;

type Vertex = {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
};

export type NativeMeshCleanupOptions = {
  /** Opening envelopes in the same origin-relative coordinates as MeshData. */
  hostedOpeningsByWall?: ReadonlyMap<number, readonly Bounds3[]>;
  /** Compound-layer materials are stronger evidence than a default face style. */
  preferredMaterialIdsByElement?: ReadonlyMap<number, ReadonlySet<number>>;
};

export type NativeMeshCleanupResult = {
  meshes: MeshData[];
  inputTriangles: number;
  outputTriangles: number;
  duplicateTrianglesRemoved: number;
  crossMaterialDuplicateTrianglesRemoved: number;
  hostTrianglesClipped: number;
  hostTrianglesGenerated: number;
};

function vertexAt(mesh: MeshData, vertexIndex: number): Vertex {
  const offset = vertexIndex * 3;
  return {
    x: mesh.positions[offset]!,
    y: mesh.positions[offset + 1]!,
    z: mesh.positions[offset + 2]!,
    r: mesh.colors[offset] ?? 1,
    g: mesh.colors[offset + 1] ?? 1,
    b: mesh.colors[offset + 2] ?? 1,
  };
}

function coordinate(vertex: Vertex, axis: 0 | 1 | 2): number {
  return axis === 0 ? vertex.x : axis === 1 ? vertex.y : vertex.z;
}

function interpolate(left: Vertex, right: Vertex, amount: number): Vertex {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    z: left.z + (right.z - left.z) * amount,
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  };
}

function splitPolygon(
  polygon: readonly Vertex[],
  axis: 0 | 1 | 2,
  boundary: number,
  keepGreater: boolean,
): { inside: Vertex[]; outside: Vertex[] } {
  const inside: Vertex[] = [];
  const outside: Vertex[] = [];
  const accepts = (value: number) => keepGreater
    ? value >= boundary
    : value <= boundary;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    const currentValue = coordinate(current, axis);
    const nextValue = coordinate(next, axis);
    const currentInside = accepts(currentValue);
    const nextInside = accepts(nextValue);
    (currentInside ? inside : outside).push(current);
    if (currentInside === nextInside) continue;
    const denominator = nextValue - currentValue;
    if (Math.abs(denominator) < Number.EPSILON) continue;
    const crossing = interpolate(
      current,
      next,
      Math.max(0, Math.min(1, (boundary - currentValue) / denominator)),
    );
    inside.push(crossing);
    outside.push(crossing);
  }
  return { inside, outside };
}

function subtractBox(
  triangle: readonly [Vertex, Vertex, Vertex],
  bounds: Bounds3,
): Vertex[][] {
  let candidates: Vertex[][] = [[...triangle]];
  const retained: Vertex[][] = [];
  const planes: readonly [0 | 1 | 2, number, boolean][] = [
    [0, bounds.min.x, true],
    [0, bounds.max.x, false],
    [1, bounds.min.y, true],
    [1, bounds.max.y, false],
    [2, bounds.min.z, true],
    [2, bounds.max.z, false],
  ];
  for (const [axis, boundary, keepGreater] of planes) {
    const nextCandidates: Vertex[][] = [];
    for (const polygon of candidates) {
      const split = splitPolygon(polygon, axis, boundary, keepGreater);
      if (split.outside.length >= 3) retained.push(split.outside);
      if (split.inside.length >= 3) nextCandidates.push(split.inside);
    }
    candidates = nextCandidates;
    if (!candidates.length) break;
  }
  // Anything still in `candidates` lies inside all six half-spaces and is the
  // part occupied by the hosted insert. It is deliberately discarded.
  return retained;
}

function triangleArea(left: Vertex, middle: Vertex, right: Vertex): number {
  const abx = middle.x - left.x;
  const aby = middle.y - left.y;
  const abz = middle.z - left.z;
  const acx = right.x - left.x;
  const acy = right.y - left.y;
  const acz = right.z - left.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return Math.hypot(cx, cy, cz) * 0.5;
}

function triangleBounds(triangle: readonly Vertex[]): Bounds3 {
  return {
    min: {
      x: Math.min(...triangle.map((point) => point.x)),
      y: Math.min(...triangle.map((point) => point.y)),
      z: Math.min(...triangle.map((point) => point.z)),
    },
    max: {
      x: Math.max(...triangle.map((point) => point.x)),
      y: Math.max(...triangle.map((point) => point.y)),
      z: Math.max(...triangle.map((point) => point.z)),
    },
  };
}

function intersects(left: Bounds3, right: Bounds3): boolean {
  return !(
    left.max.x < right.min.x || left.min.x > right.max.x ||
    left.max.y < right.min.y || left.min.y > right.max.y ||
    left.max.z < right.min.z || left.min.z > right.max.z
  );
}

function padded(bounds: Bounds3): Bounds3 {
  return {
    min: {
      x: bounds.min.x - OPENING_PADDING_FEET,
      y: bounds.min.y - OPENING_PADDING_FEET,
      z: bounds.min.z - OPENING_PADDING_FEET,
    },
    max: {
      x: bounds.max.x + OPENING_PADDING_FEET,
      y: bounds.max.y + OPENING_PADDING_FEET,
      z: bounds.max.z + OPENING_PADDING_FEET,
    },
  };
}

function triangulate(polygons: readonly Vertex[][]): [Vertex, Vertex, Vertex][] {
  const triangles: [Vertex, Vertex, Vertex][] = [];
  for (const polygon of polygons) {
    for (let index = 1; index + 1 < polygon.length; index += 1) {
      const triangle: [Vertex, Vertex, Vertex] = [
        polygon[0]!,
        polygon[index]!,
        polygon[index + 1]!,
      ];
      if (triangleArea(...triangle) > AREA_EPSILON) triangles.push(triangle);
    }
  }
  return triangles;
}

function cutHostedOpenings(
  meshes: readonly MeshData[],
  openingsByWall: ReadonlyMap<number, readonly Bounds3[]>,
): { meshes: MeshData[]; clipped: number; generated: number } {
  if (!openingsByWall.size) {
    return { meshes: [...meshes], clipped: 0, generated: 0 };
  }
  const expanded = new Map(
    [...openingsByWall].map(([elementId, openings]) => [
      elementId,
      openings.map(padded),
    ]),
  );
  let clipped = 0;
  let generated = 0;
  const result: MeshData[] = [];

  for (const mesh of meshes) {
    const triangleCount = mesh.indices.length / 3;
    const nextIndices: number[] = [];
    const nextElementIds: number[] = [];
    const appendedPositions: number[] = [];
    const appendedColors: number[] = [];
    const originalVertexCount = mesh.positions.length / 3;
    let changed = false;

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const elementId = mesh.elementIds?.[triangleIndex];
      const openings = elementId == null ? undefined : expanded.get(elementId);
      const indexOffset = triangleIndex * 3;
      const sourceIndices = [
        mesh.indices[indexOffset]!,
        mesh.indices[indexOffset + 1]!,
        mesh.indices[indexOffset + 2]!,
      ] as const;
      if (!openings?.length) {
        nextIndices.push(...sourceIndices);
        if (elementId != null) nextElementIds.push(elementId);
        continue;
      }

      const source = sourceIndices.map((index) => vertexAt(mesh, index)) as [
        Vertex,
        Vertex,
        Vertex,
      ];
      let fragments: [Vertex, Vertex, Vertex][] = [source];
      for (const opening of openings) {
        const next: [Vertex, Vertex, Vertex][] = [];
        for (const fragment of fragments) {
          if (!intersects(triangleBounds(fragment), opening)) {
            next.push(fragment);
            continue;
          }
          next.push(...triangulate(subtractBox(fragment, opening)));
        }
        fragments = next;
        if (!fragments.length) break;
      }
      const untouched = fragments.length === 1 && fragments[0] === source;
      if (untouched) {
        nextIndices.push(...sourceIndices);
        nextElementIds.push(elementId!);
        continue;
      }

      changed = true;
      clipped += 1;
      generated += fragments.length;
      for (const fragment of fragments) {
        const first = originalVertexCount + appendedPositions.length / 3;
        for (const vertex of fragment) {
          appendedPositions.push(vertex.x, vertex.y, vertex.z);
          appendedColors.push(vertex.r, vertex.g, vertex.b);
        }
        nextIndices.push(first, first + 1, first + 2);
        nextElementIds.push(elementId!);
      }
    }

    if (!changed) {
      result.push(mesh);
      continue;
    }
    const positions = new Float32Array(mesh.positions.length + appendedPositions.length);
    positions.set(mesh.positions);
    positions.set(appendedPositions, mesh.positions.length);
    const colors = new Float32Array(mesh.colors.length + appendedColors.length);
    colors.set(mesh.colors);
    colors.set(appendedColors, mesh.colors.length);
    if (!nextIndices.length) continue;
    result.push({
      ...mesh,
      positions,
      colors,
      indices: Uint32Array.from(nextIndices),
      elementIds: Uint32Array.from(nextElementIds),
    });
  }
  return { meshes: result, clipped, generated };
}

function quantized(value: number): number {
  return Math.round(value / TRIANGLE_KEY_TOLERANCE_FEET);
}

function triangleKey(mesh: MeshData, triangleIndex: number): string {
  const offset = triangleIndex * 3;
  const vertices = [0, 1, 2].map((corner) => {
    const vertexOffset = mesh.indices[offset + corner]! * 3;
    return [
      quantized(mesh.positions[vertexOffset]!),
      quantized(mesh.positions[vertexOffset + 1]!),
      quantized(mesh.positions[vertexOffset + 2]!),
    ] as const;
  }).sort((left, right) =>
    left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
  return vertices.map((vertex) => vertex.join(",")).join("|");
}

function materialKey(mesh: MeshData): string {
  return mesh.nativeMaterialElementId == null
    ? `unresolved:${mesh.materialIndex}`
    : `native:${mesh.nativeMaterialElementId}`;
}

function materialPreference(
  mesh: MeshData,
  elementId: number,
  preferred: ReadonlyMap<number, ReadonlySet<number>> | undefined,
): number {
  return mesh.nativeMaterialElementId != null &&
      preferred?.get(elementId)?.has(mesh.nativeMaterialElementId)
    ? 1
    : 0;
}

function deduplicateTriangles(
  meshes: readonly MeshData[],
  preferred: ReadonlyMap<number, ReadonlySet<number>> | undefined,
): { meshes: MeshData[]; removed: number; crossMaterial: number } {
  const refsByElement = new Map<number, number[]>();
  const materialAreaByElement = new Map<number, Map<string, number>>();
  const keep = meshes.map((mesh) => {
    const flags = new Uint8Array(mesh.indices.length / 3);
    flags.fill(1);
    return flags;
  });

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]!;
    const key = materialKey(mesh);
    for (let triangleIndex = 0; triangleIndex < mesh.indices.length / 3; triangleIndex += 1) {
      const elementId = mesh.elementIds?.[triangleIndex];
      if (elementId == null) continue;
      const refs = refsByElement.get(elementId) ?? [];
      refs.push(meshIndex * REF_STRIDE + triangleIndex);
      refsByElement.set(elementId, refs);
      const offset = triangleIndex * 3;
      const area = triangleArea(
        vertexAt(mesh, mesh.indices[offset]!),
        vertexAt(mesh, mesh.indices[offset + 1]!),
        vertexAt(mesh, mesh.indices[offset + 2]!),
      );
      const areas = materialAreaByElement.get(elementId) ?? new Map<string, number>();
      areas.set(key, (areas.get(key) ?? 0) + area);
      materialAreaByElement.set(elementId, areas);
    }
  }

  let removed = 0;
  let crossMaterial = 0;
  for (const [elementId, refs] of refsByElement) {
    const seen = new Map<string, number>();
    const support = materialAreaByElement.get(elementId)!;
    for (const packed of refs) {
      const meshIndex = Math.floor(packed / REF_STRIDE);
      const triangleIndex = packed - meshIndex * REF_STRIDE;
      const mesh = meshes[meshIndex]!;
      const key = triangleKey(mesh, triangleIndex);
      const previous = seen.get(key);
      if (previous == null) {
        seen.set(key, packed);
        continue;
      }
      const previousMeshIndex = Math.floor(previous / REF_STRIDE);
      const previousTriangleIndex = previous - previousMeshIndex * REF_STRIDE;
      const previousMesh = meshes[previousMeshIndex]!;
      const currentMaterial = materialKey(mesh);
      const previousMaterial = materialKey(previousMesh);
      const currentPreferred = materialPreference(mesh, elementId, preferred);
      const previousPreferred = materialPreference(previousMesh, elementId, preferred);
      const currentSupport = support.get(currentMaterial) ?? 0;
      const previousSupport = support.get(previousMaterial) ?? 0;
      const currentId = mesh.nativeMaterialElementId ?? -1;
      const previousId = previousMesh.nativeMaterialElementId ?? -1;
      const currentWins =
        currentPreferred > previousPreferred ||
        (currentPreferred === previousPreferred && currentSupport > previousSupport + AREA_EPSILON) ||
        (currentPreferred === previousPreferred &&
          Math.abs(currentSupport - previousSupport) <= AREA_EPSILON &&
          currentId > previousId);
      if (currentWins) {
        keep[previousMeshIndex]![previousTriangleIndex] = 0;
        seen.set(key, packed);
      } else {
        keep[meshIndex]![triangleIndex] = 0;
      }
      removed += 1;
      if (currentMaterial !== previousMaterial) crossMaterial += 1;
    }
  }

  if (!removed) return { meshes: [...meshes], removed, crossMaterial };
  const result: MeshData[] = [];
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]!;
    const flags = keep[meshIndex]!;
    if (flags.every((flag) => flag === 1)) {
      result.push(mesh);
      continue;
    }
    const indices: number[] = [];
    const elementIds: number[] = [];
    for (let triangleIndex = 0; triangleIndex < flags.length; triangleIndex += 1) {
      if (!flags[triangleIndex]) continue;
      const offset = triangleIndex * 3;
      indices.push(
        mesh.indices[offset]!,
        mesh.indices[offset + 1]!,
        mesh.indices[offset + 2]!,
      );
      if (mesh.elementIds) elementIds.push(mesh.elementIds[triangleIndex]!);
    }
    if (!indices.length) continue;
    result.push({
      ...mesh,
      indices: Uint32Array.from(indices),
      ...(mesh.elementIds ? { elementIds: Uint32Array.from(elementIds) } : {}),
    });
  }
  return { meshes: result, removed, crossMaterial };
}

export function cleanNativeMeshScene(
  meshes: readonly MeshData[],
  options: NativeMeshCleanupOptions = {},
): NativeMeshCleanupResult {
  const inputTriangles = meshes.reduce(
    (total, mesh) => total + mesh.indices.length / 3,
    0,
  );
  const cut = cutHostedOpenings(
    meshes,
    options.hostedOpeningsByWall ?? new Map(),
  );
  const deduplicated = deduplicateTriangles(
    cut.meshes,
    options.preferredMaterialIdsByElement,
  );
  const outputTriangles = deduplicated.meshes.reduce(
    (total, mesh) => total + mesh.indices.length / 3,
    0,
  );
  return {
    meshes: deduplicated.meshes,
    inputTriangles,
    outputTriangles,
    duplicateTrianglesRemoved: deduplicated.removed,
    crossMaterialDuplicateTrianglesRemoved: deduplicated.crossMaterial,
    hostTrianglesClipped: cut.clipped,
    hostTrianglesGenerated: cut.generated,
  };
}
