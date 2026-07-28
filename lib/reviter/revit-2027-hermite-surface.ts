/** Exact Revit 2027 source slot for `HermiteSurf`. */
export const REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT = 2414;

const SURFACE_BASE_BYTES = 33;
const SPLINE_SURFACE_NODE_BYTES = 96;
const DEFAULT_MAX_ITEMS = 1_000_000;

type Point2d = readonly [number, number];
type Point3d = readonly [number, number, number];

export type Revit2027SplineSurfaceNode = {
  point: Point3d;
  tangents: readonly [Point3d, Point3d];
  mixedDerivative: Point3d;
};

export type Revit2027HermiteSurface = {
  byteOffset: number;
  endOffset: number;
  envelope: {
    firstCorner: Point2d;
    secondCorner: Point2d;
  };
  orientFlag: boolean;
  periodic: readonly [boolean, boolean];
  constructedOk: boolean;
  nodes: readonly Revit2027SplineSurfaceNode[];
  uParameters: readonly number[];
  vParameters: readonly number[];
};

export type Revit2027HermiteSurfaceDecodeResult =
  | { ok: true; value: Revit2027HermiteSurface }
  | { ok: false; error: string };

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function point3(view: DataView, offset: number): Point3d {
  return [
    view.getFloat64(offset, true),
    view.getFloat64(offset + 8, true),
    view.getFloat64(offset + 16, true),
  ];
}

/**
 * Decode one count-bounded Revit 2027 `HermiteSurf`.
 *
 * The common `Surface` base is two 2D envelope corners and an orientation
 * boolean. The exact schema then declares two periodic booleans,
 * `m_constructedOK`, an array of 96-byte `SplineSrfNode` values, and counted
 * float64 U/V parameter arrays. A node is point3 + two tangent3 values +
 * mixed-derivative3.
 *
 * This decoder reconstructs persistence only. General Hermite-surface
 * evaluation/tessellation remains outside the certified browser tessellator.
 */
export function decodeRevit2027HermiteSurface(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxItems?: number } = {},
): Revit2027HermiteSurfaceDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf decoding requires release 2027",
    };
  }
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf item limit is invalid",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    byteOffset < 0 ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - (SURFACE_BASE_BYTES + 7)
  ) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf prefix is truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const firstCorner = [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + 8, true),
  ] as const;
  const secondCorner = [
    view.getFloat64(byteOffset + 16, true),
    view.getFloat64(byteOffset + 24, true),
  ] as const;
  if (!finite([...firstCorner, ...secondCorner])) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf envelope is non-finite",
    };
  }
  const orient = data[byteOffset + 32]!;
  const periodicU = data[byteOffset + 33]!;
  const periodicV = data[byteOffset + 34]!;
  const constructedOk = data[byteOffset + 35]!;
  if (
    ![orient, periodicU, periodicV, constructedOk].every(
      (value) => value === 0 || value === 1,
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf contains a non-boolean flag",
    };
  }

  const nodeCount = view.getInt32(byteOffset + 36, true);
  if (nodeCount < 0 || nodeCount > maxItems) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf node count is outside the safety bound",
    };
  }
  let cursor = byteOffset + 40;
  const nodeBytes = nodeCount * SPLINE_SURFACE_NODE_BYTES;
  if (
    !Number.isSafeInteger(nodeBytes) ||
    cursor > enclosingEndOffset - nodeBytes
  ) {
    return {
      ok: false,
      error: "Revit 2027 HermiteSurf nodes exceed the replay boundary",
    };
  }
  const nodes: Revit2027SplineSurfaceNode[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const point = point3(view, cursor);
    const tangentU = point3(view, cursor + 24);
    const tangentV = point3(view, cursor + 48);
    const mixedDerivative = point3(view, cursor + 72);
    if (
      !finite([
        ...point,
        ...tangentU,
        ...tangentV,
        ...mixedDerivative,
      ])
    ) {
      return {
        ok: false,
        error: "Revit 2027 HermiteSurf contains a non-finite node scalar",
      };
    }
    nodes.push({
      point,
      tangents: [tangentU, tangentV],
      mixedDerivative,
    });
    cursor += SPLINE_SURFACE_NODE_BYTES;
  }

  function readParameters(
    label: "U" | "V",
  ):
    | { ok: true; values: number[] }
    | { ok: false; error: string } {
    if (cursor > enclosingEndOffset - 4) {
      return {
        ok: false,
        error: `Revit 2027 HermiteSurf ${label} parameter count is truncated`,
      };
    }
    const count = view.getInt32(cursor, true);
    cursor += 4;
    if (count < 0 || count > maxItems || cursor > enclosingEndOffset - count * 8) {
      return {
        ok: false,
        error:
          `Revit 2027 HermiteSurf ${label} parameter count is outside the ` +
          "bounded body",
      };
    }
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = view.getFloat64(cursor, true);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: `Revit 2027 HermiteSurf ${label} parameter is non-finite`,
        };
      }
      if (index > 0 && value < values[index - 1]!) {
        return {
          ok: false,
          error: `Revit 2027 HermiteSurf ${label} parameters are not ordered`,
        };
      }
      values.push(value);
      cursor += 8;
    }
    return { ok: true, values };
  }

  const uParameters = readParameters("U");
  if (!uParameters.ok) return uParameters;
  const vParameters = readParameters("V");
  if (!vParameters.ok) return vParameters;
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: cursor,
      envelope: { firstCorner, secondCorner },
      orientFlag: orient === 1,
      periodic: [periodicU === 1, periodicV === 1],
      constructedOk: constructedOk === 1,
      nodes,
      uParameters: uParameters.values,
      vParameters: vParameters.values,
    },
  };
}
