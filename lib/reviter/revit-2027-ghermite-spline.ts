import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source slot for `GHermiteSpline`. */
export const REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT = 2259;

const GINFO_BYTES = 20;
const END_PARAMETERS_BYTES = 16;
const PERIODIC_BYTES = 1;
const NODE_COUNT_BYTES = 4;
const SPLINE_NODE_BYTES = 56;
const FIXED_PREFIX_BYTES =
  GINFO_BYTES + END_PARAMETERS_BYTES + PERIODIC_BYTES + NODE_COUNT_BYTES;
const DEFAULT_MAX_NODES = 1_000_000;

export type Revit2027SplineNode = {
  point: readonly [number, number, number];
  tangent: readonly [number, number, number];
  parameter: number;
};

export type Revit2027GHermiteSpline = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  endParameters: readonly [number, number];
  periodic: boolean;
  nodes: readonly Revit2027SplineNode[];
};

export type Revit2027GHermiteSplineDecodeResult =
  | { ok: true; value: Revit2027GHermiteSpline }
  | { ok: false; error: string };

/**
 * Decode one count-bounded Revit 2027 `GHermiteSpline` body.
 *
 * The `GCurve` base contributes GInfo and its float64 end-parameter pair.
 * `Formats/Latest` then persists `m_Periodic`, followed by a counted
 * `m_NodeArray`. Every inline `SplineNode` is exactly a point triple, tangent
 * triple, and float64 parameter (56 bytes).
 */
export function decodeRevit2027GHermiteSpline(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxNodes?: number } = {},
): Revit2027GHermiteSplineDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline decoding requires release 2027",
    };
  }
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline node limit is invalid",
    };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    byteOffset < 0 ||
    enclosingEndOffset > data.byteLength ||
    byteOffset > enclosingEndOffset - FIXED_PREFIX_BYTES
  ) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline prefix is truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endParameters = [
    view.getFloat64(byteOffset + GINFO_BYTES, true),
    view.getFloat64(byteOffset + GINFO_BYTES + 8, true),
  ] as const;
  const periodicOffset = byteOffset + GINFO_BYTES + END_PARAMETERS_BYTES;
  const periodic = data[periodicOffset]!;
  if (periodic !== 0 && periodic !== 1) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline periodic flag is not boolean",
    };
  }
  const countOffset = periodicOffset + PERIODIC_BYTES;
  const nodeCount = view.getInt32(countOffset, true);
  if (nodeCount < 0 || nodeCount > maxNodes) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline node count is outside the safety bound",
    };
  }
  const byteLength = FIXED_PREFIX_BYTES + nodeCount * SPLINE_NODE_BYTES;
  const endOffset = byteOffset + byteLength;
  if (!Number.isSafeInteger(endOffset) || endOffset > enclosingEndOffset) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline nodes exceed the replay boundary",
    };
  }
  if (!endParameters.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 GHermiteSpline has non-finite end parameters",
    };
  }

  const nodes: Revit2027SplineNode[] = [];
  let cursor = countOffset + NODE_COUNT_BYTES;
  let previousParameter = -Infinity;
  for (let index = 0; index < nodeCount; index += 1) {
    const point = [
      view.getFloat64(cursor, true),
      view.getFloat64(cursor + 8, true),
      view.getFloat64(cursor + 16, true),
    ] as const;
    const tangent = [
      view.getFloat64(cursor + 24, true),
      view.getFloat64(cursor + 32, true),
      view.getFloat64(cursor + 40, true),
    ] as const;
    const parameter = view.getFloat64(cursor + 48, true);
    if (
      !point.every(Number.isFinite) ||
      !tangent.every(Number.isFinite) ||
      !Number.isFinite(parameter)
    ) {
      return {
        ok: false,
        error: "Revit 2027 GHermiteSpline contains a non-finite node scalar",
      };
    }
    if (parameter < previousParameter) {
      return {
        ok: false,
        error: "Revit 2027 GHermiteSpline node parameters are not ordered",
      };
    }
    nodes.push({ point, tangent, parameter });
    previousParameter = parameter;
    cursor += SPLINE_NODE_BYTES;
  }

  return {
    ok: true,
    value: {
      byteOffset,
      endOffset,
      gInfo: {
        gStyleElementId: view.getBigInt64(byteOffset, true),
        tag: view.getInt32(byteOffset + 8, true),
        controlCommand: view.getInt32(byteOffset + 12, true),
        flags: view.getUint32(byteOffset + 16, true),
      },
      endParameters,
      periodic: periodic === 1,
      nodes,
    },
  };
}
