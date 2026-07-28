/**
 * Browser-safe decoding of the scalar arrays behind Revit faceted topology.
 *
 * This deliberately starts *after* the RVT object/field framing. The supplied
 * native symbols and the file's own Formats/Latest schema establish the point,
 * facet, normal, offset and edge-visibility fields, but do not establish the
 * byte framing of those nested arrays. A caller must therefore supply measured
 * field offsets and counts; this function validates them and converts their
 * scalar storage into a neutral indexed mesh without guessing an outer record.
 */

export type FacetedScalarEncoding = "float32-le" | "float64-le";
export type FacetedIndexEncoding = "uint16-le" | "int32-le";
export type FacetedNormalBinding =
  | "common"
  | "per-face"
  | "per-vertex"
  | "per-corner";

export type FacetedVectorField = {
  byteOffset: number;
  encoding: FacetedScalarEncoding;
};

export type FacetedIndexField = {
  byteOffset: number;
  encoding: FacetedIndexEncoding;
};

export type FacetedNormalField = FacetedVectorField & {
  binding: FacetedNormalBinding;
};

export type FacetedTopologyFieldLayout = {
  vertexCount: number;
  triangleCount: number;
  points: FacetedVectorField;
  facets: FacetedIndexField;
  /**
   * Offset applied to every decoded point. Native
   * `OffsetFloatFacetedTopology` stores this separately from float points.
   */
  pointOffset?: readonly [number, number, number];
  normals?: FacetedNormalField;
  /**
   * Opaque edge visibility bytes. Their count is explicit because the symbols
   * prove an array exists but do not prove a release-independent cardinality.
   */
  edgeVisibility?: { byteOffset: number; byteCount: number };
};

export type NeutralFacetedMesh = {
  positions: Float64Array;
  indices: Uint32Array;
  normals?: Float32Array;
  normalBinding?: FacetedNormalBinding;
  edgeVisibility?: Uint8Array;
  degenerateTriangles: number;
  sourceStorage: {
    points: FacetedScalarEncoding;
    facets: FacetedIndexEncoding;
    pointOffsetApplied: boolean;
  };
};

export type FacetedTopologyDecodeResult =
  | { ok: true; mesh: NeutralFacetedMesh }
  | { ok: false; error: string };

export type FacetedTopologyDecodeOptions = {
  /** Hard allocation bound for untrusted local files. */
  maxVertices?: number;
  /** Hard allocation bound for untrusted local files. */
  maxTriangles?: number;
  /** Absolute model-coordinate bound after applying `pointOffset`. */
  maxCoordinate?: number;
};

const DEFAULT_MAX_VERTICES = 10_000_000;
const DEFAULT_MAX_TRIANGLES = 20_000_000;
const DEFAULT_MAX_COORDINATE = 10_000_000;

function scalarBytes(encoding: FacetedScalarEncoding): number {
  return encoding === "float32-le" ? 4 : 8;
}

function indexBytes(encoding: FacetedIndexEncoding): number {
  return encoding === "uint16-le" ? 2 : 4;
}

function validCount(value: number, limit: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= limit;
}

function fieldFits(data: Uint8Array, byteOffset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    byteOffset <= data.byteLength - byteLength
  );
}

function readScalar(
  view: DataView,
  byteOffset: number,
  encoding: FacetedScalarEncoding,
): number {
  return encoding === "float32-le"
    ? view.getFloat32(byteOffset, true)
    : view.getFloat64(byteOffset, true);
}

function readIndex(
  view: DataView,
  byteOffset: number,
  encoding: FacetedIndexEncoding,
): number {
  return encoding === "uint16-le"
    ? view.getUint16(byteOffset, true)
    : view.getInt32(byteOffset, true);
}

function normalVectorCount(
  binding: FacetedNormalBinding,
  vertexCount: number,
  triangleCount: number,
): number {
  if (binding === "common") return 1;
  if (binding === "per-face") return triangleCount;
  if (binding === "per-vertex") return vertexCount;
  return triangleCount * 3;
}

export type FacetedTopology8Body = {
  byteOffset: number;
  endOffset: number;
  byteLength: number;
  normalsFlag: 2;
  commonNormal: readonly [number, number, number];
  normalCount: number;
  vertexCount: number;
  triangleCount: number;
  layout: FacetedTopologyFieldLayout;
};

export type FacetedTopology8LocateResult =
  | { ok: true; body: FacetedTopology8Body }
  | { ok: false; error: string };

function readCountedField(
  data: Uint8Array,
  view: DataView,
  countOffset: number,
  itemByteLength: number,
  limit: number,
): { count: number; itemsOffset: number; endOffset: number } | null {
  if (!fieldFits(data, countOffset, 4)) return null;
  const count = view.getInt32(countOffset, true);
  if (!validCount(count, limit)) return null;
  const itemsOffset = countOffset + 4;
  const byteLength = count * itemByteLength;
  if (!fieldFits(data, itemsOffset, byteLength)) return null;
  return { count, itemsOffset, endOffset: itemsOffset + byteLength };
}

/**
 * Validate bytes against the complete selector-free body shape of the Revit
 * 2026 `FacetedTopology8` form.
 *
 * The release schema and native inheritance establish this exact order:
 *
 * `normalsFlag:i32`, `commonNormal:f32[3]`, counted face normals,
 * counted float points, counted u16 triangle facets, counted edge bytes.
 *
 * This deliberately requires normals mode `2` and one-normal/one-edge-byte
 * per face. Structural validity alone does not prove the bytes are topology:
 * real `GStyle`/`GFlipControl` replays in the UNBC model produce the same byte
 * shape. Callers must establish the queued-property and owner context before
 * emitting geometry.
 */
export function locateFacetedTopology8Body(
  data: Uint8Array,
  byteOffset: number,
  options: FacetedTopologyDecodeOptions = {},
): FacetedTopology8LocateResult {
  const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
  if (!fieldFits(data, byteOffset, 20)) {
    return { ok: false, error: "FacetedTopology8 header is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const normalsFlag = view.getInt32(byteOffset, true);
  if (normalsFlag !== 2) {
    return {
      ok: false,
      error: "FacetedTopology8 normalsFlag is not the corroborated per-face mode 2",
    };
  }
  const commonNormal: [number, number, number] = [
    view.getFloat32(byteOffset + 4, true),
    view.getFloat32(byteOffset + 8, true),
    view.getFloat32(byteOffset + 12, true),
  ];
  if (
    commonNormal.some(
      (value) => !Number.isFinite(value) || Math.abs(value) > 1.0001,
    )
  ) {
    return { ok: false, error: "FacetedTopology8 common normal is invalid" };
  }

  const normals = readCountedField(
    data,
    view,
    byteOffset + 16,
    3 * 4,
    maxTriangles,
  );
  if (!normals) {
    return { ok: false, error: "FacetedTopology8 normals array is invalid" };
  }
  const points = readCountedField(
    data,
    view,
    normals.endOffset,
    3 * 4,
    maxVertices,
  );
  if (!points || points.count < 3) {
    return { ok: false, error: "FacetedTopology8 points array is invalid" };
  }
  const facets = readCountedField(
    data,
    view,
    points.endOffset,
    3 * 2,
    maxTriangles,
  );
  if (!facets || facets.count < 1) {
    return { ok: false, error: "FacetedTopology8 facets array is invalid" };
  }
  if (normals.count !== facets.count) {
    return {
      ok: false,
      error: "FacetedTopology8 face-normal count does not match facet count",
    };
  }
  const edgeVisibility = readCountedField(
    data,
    view,
    facets.endOffset,
    1,
    maxTriangles,
  );
  if (!edgeVisibility || edgeVisibility.count !== facets.count) {
    return {
      ok: false,
      error: "FacetedTopology8 edge-visibility count does not match facet count",
    };
  }

  const layout: FacetedTopologyFieldLayout = {
    vertexCount: points.count,
    triangleCount: facets.count,
    normals: {
      byteOffset: normals.itemsOffset,
      encoding: "float32-le",
      binding: "per-face",
    },
    points: {
      byteOffset: points.itemsOffset,
      encoding: "float32-le",
    },
    facets: {
      byteOffset: facets.itemsOffset,
      encoding: "uint16-le",
    },
    edgeVisibility: {
      byteOffset: edgeVisibility.itemsOffset,
      byteCount: edgeVisibility.count,
    },
  };
  const decoded = decodeFacetedTopologyFields(data, layout, options);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error };
  }

  return {
    ok: true,
    body: {
      byteOffset,
      endOffset: edgeVisibility.endOffset,
      byteLength: edgeVisibility.endOffset - byteOffset,
      normalsFlag: 2,
      commonNormal,
      normalCount: normals.count,
      vertexCount: points.count,
      triangleCount: facets.count,
      layout,
    },
  };
}

/**
 * Decode already-located faceted topology arrays into a neutral mesh.
 *
 * It returns an error rather than throwing so a corrupt candidate in a large
 * partition scan is cheap to reject. No output allocation occurs before every
 * field range and count has passed its bounds checks.
 */
export function decodeFacetedTopologyFields(
  data: Uint8Array,
  layout: FacetedTopologyFieldLayout,
  options: FacetedTopologyDecodeOptions = {},
): FacetedTopologyDecodeResult {
  const maxVertices = options.maxVertices ?? DEFAULT_MAX_VERTICES;
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
  const maxCoordinate = options.maxCoordinate ?? DEFAULT_MAX_COORDINATE;
  const { vertexCount, triangleCount } = layout;

  if (!validCount(vertexCount, maxVertices) || vertexCount < 3) {
    return { ok: false, error: "vertexCount is outside the allowed range" };
  }
  if (!validCount(triangleCount, maxTriangles) || triangleCount < 1) {
    return { ok: false, error: "triangleCount is outside the allowed range" };
  }
  if (!Number.isFinite(maxCoordinate) || maxCoordinate <= 0) {
    return { ok: false, error: "maxCoordinate must be a positive finite number" };
  }

  const pointScalars = vertexCount * 3;
  const pointBytes = pointScalars * scalarBytes(layout.points.encoding);
  const indexScalars = triangleCount * 3;
  const facetBytes = indexScalars * indexBytes(layout.facets.encoding);
  if (!fieldFits(data, layout.points.byteOffset, pointBytes)) {
    return { ok: false, error: "point field extends past the supplied bytes" };
  }
  if (!fieldFits(data, layout.facets.byteOffset, facetBytes)) {
    return { ok: false, error: "facet field extends past the supplied bytes" };
  }

  let normalCount = 0;
  if (layout.normals) {
    normalCount = normalVectorCount(layout.normals.binding, vertexCount, triangleCount);
    const normalBytes = normalCount * 3 * scalarBytes(layout.normals.encoding);
    if (!fieldFits(data, layout.normals.byteOffset, normalBytes)) {
      return { ok: false, error: "normal field extends past the supplied bytes" };
    }
  }

  if (
    layout.edgeVisibility &&
    (!validCount(layout.edgeVisibility.byteCount, data.byteLength) ||
      !fieldFits(
        data,
        layout.edgeVisibility.byteOffset,
        layout.edgeVisibility.byteCount,
      ))
  ) {
    return { ok: false, error: "edge-visibility field extends past the supplied bytes" };
  }

  const pointOffset = layout.pointOffset ?? [0, 0, 0];
  if (
    pointOffset.length !== 3 ||
    pointOffset.some((value) => !Number.isFinite(value) || Math.abs(value) > maxCoordinate)
  ) {
    return { ok: false, error: "pointOffset is not a finite three-vector" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const positions = new Float64Array(pointScalars);
  const pointStride = scalarBytes(layout.points.encoding);
  for (let index = 0; index < pointScalars; index += 1) {
    const value =
      readScalar(
        view,
        layout.points.byteOffset + index * pointStride,
        layout.points.encoding,
      ) + pointOffset[index % 3]!;
    if (!Number.isFinite(value) || Math.abs(value) > maxCoordinate) {
      return { ok: false, error: `point scalar ${index} is outside the model-coordinate bound` };
    }
    positions[index] = value;
  }

  const indices = new Uint32Array(indexScalars);
  const facetStride = indexBytes(layout.facets.encoding);
  let degenerateTriangles = 0;
  for (let index = 0; index < indexScalars; index += 1) {
    const value = readIndex(
      view,
      layout.facets.byteOffset + index * facetStride,
      layout.facets.encoding,
    );
    if (value < 0 || value >= vertexCount) {
      return { ok: false, error: `facet index ${value} is outside vertexCount ${vertexCount}` };
    }
    indices[index] = value;
    if (
      index % 3 === 2 &&
      (indices[index - 2] === indices[index - 1] ||
        indices[index - 1] === indices[index] ||
        indices[index] === indices[index - 2])
    ) {
      degenerateTriangles += 1;
    }
  }

  let normals: Float32Array | undefined;
  if (layout.normals) {
    normals = new Float32Array(normalCount * 3);
    const normalStride = scalarBytes(layout.normals.encoding);
    for (let index = 0; index < normals.length; index += 1) {
      const value = readScalar(
        view,
        layout.normals.byteOffset + index * normalStride,
        layout.normals.encoding,
      );
      if (!Number.isFinite(value) || Math.abs(value) > 1.0001) {
        return { ok: false, error: `normal scalar ${index} is not a finite unit-vector component` };
      }
      normals[index] = value;
    }
    for (let index = 0; index < normalCount; index += 1) {
      const x = normals[index * 3]!;
      const y = normals[index * 3 + 1]!;
      const z = normals[index * 3 + 2]!;
      const length = Math.hypot(x, y, z);
      if (Math.abs(length - 1) > 1e-4) {
        return { ok: false, error: `normal vector ${index} is not unit length` };
      }
    }
  }

  const edgeVisibility = layout.edgeVisibility
    ? data.slice(
        layout.edgeVisibility.byteOffset,
        layout.edgeVisibility.byteOffset + layout.edgeVisibility.byteCount,
      )
    : undefined;

  return {
    ok: true,
    mesh: {
      positions,
      indices,
      normals,
      normalBinding: layout.normals?.binding,
      edgeVisibility,
      degenerateTriangles,
      sourceStorage: {
        points: layout.points.encoding,
        facets: layout.facets.encoding,
        pointOffsetApplied: layout.pointOffset != null,
      },
    },
  };
}
