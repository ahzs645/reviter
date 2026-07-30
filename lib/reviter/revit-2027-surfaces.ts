import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";

/** Surface source slots observed in `Face.m_pSurf` in the supplied 2027 RVT. */
export const REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT = 634;
export const REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT = 900;
export const REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT = 1144;
export const REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT = 4283;
export const REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT = 3859;

const POINT_2D_BYTES = 16;
const POINT_3D_BYTES = 24;
const DOUBLE_BYTES = 8;
const SURFACE_BASE_BYTES = POINT_2D_BYTES * 2 + 1;

export type RevitPoint2d = readonly [number, number];
export type RevitPoint3d = readonly [number, number, number];

export type Revit2027SurfaceBase = {
  envelope: {
    firstCorner: RevitPoint2d;
    secondCorner: RevitPoint2d;
  };
  orientFlag: boolean;
};

type Revit2027SurfaceCommon = {
  byteOffset: number;
  endOffset: number;
  sourceClassSlot: number;
  surface: Revit2027SurfaceBase;
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027PlaneSurface = Revit2027SurfaceCommon & {
  kind: "plane";
  sourceClassSlot: typeof REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT;
  origin: RevitPoint3d;
  xVector: RevitPoint3d;
  yVector: RevitPoint3d;
};

export type Revit2027ConeSurface = Revit2027SurfaceCommon & {
  kind: "cone";
  sourceClassSlot: typeof REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT;
  center: RevitPoint3d;
  xVector: RevitPoint3d;
  yVector: RevitPoint3d;
  zVector: RevitPoint3d;
  halfAngle: number;
};

export type Revit2027CylinderSurface = Revit2027SurfaceCommon & {
  kind: "cylinder";
  sourceClassSlot: typeof REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT;
  center: RevitPoint3d;
  xVector: RevitPoint3d;
  yVector: RevitPoint3d;
  zVector: RevitPoint3d;
  radius: number;
};

export type Revit2027SurfaceOfRevolution = Revit2027SurfaceCommon & {
  kind: "surface-of-revolution";
  sourceClassSlot:
    typeof REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT;
  center: RevitPoint3d;
  xVector: RevitPoint3d;
  yVector: RevitPoint3d;
  zVector: RevitPoint3d;
  profileCurve: CondInt16QueueEntry;
};

export type Revit2027RuledSurface = Revit2027SurfaceCommon & {
  kind: "ruled";
  sourceClassSlot: typeof REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT;
  profileCurve1: CondInt16QueueEntry;
  profileCurve2: CondInt16QueueEntry;
  point1: RevitPoint3d;
  point2: RevitPoint3d;
};

export type Revit2027AnalyticSurface =
  | Revit2027PlaneSurface
  | Revit2027ConeSurface
  | Revit2027CylinderSurface
  | Revit2027SurfaceOfRevolution
  | Revit2027RuledSurface;

export type Revit2027SurfaceDecodeResult =
  | { ok: true; value: Revit2027AnalyticSurface }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    Number.isSafeInteger(enclosingEndOffset) &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - byteLength
  );
}

function point2d(view: DataView, byteOffset: number): RevitPoint2d {
  return [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES, true),
  ];
}

function point3d(view: DataView, byteOffset: number): RevitPoint3d {
  return [
    view.getFloat64(byteOffset, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES, true),
    view.getFloat64(byteOffset + DOUBLE_BYTES * 2, true),
  ];
}

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function decodeBase(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
):
  | {
      ok: true;
      value: {
        endOffset: number;
        view: DataView;
        surface: Revit2027SurfaceBase;
      };
    }
  | { ok: false; error: string } {
  if (!bounded(data, byteOffset, SURFACE_BASE_BYTES, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 Surface base is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const firstCorner = point2d(view, byteOffset);
  const secondCorner = point2d(view, byteOffset + POINT_2D_BYTES);
  if (!finite([...firstCorner, ...secondCorner])) {
    return { ok: false, error: "Revit 2027 Surface envelope is not finite" };
  }
  const orientByte = data[byteOffset + POINT_2D_BYTES * 2];
  if (orientByte !== 0 && orientByte !== 1) {
    return { ok: false, error: "Revit 2027 Surface orientation is not boolean" };
  }
  return {
    ok: true,
    value: {
      endOffset: byteOffset + SURFACE_BASE_BYTES,
      view,
      surface: {
        envelope: { firstCorner, secondCorner },
        orientFlag: orientByte === 1,
      },
    },
  };
}

/**
 * Decode the schema-complete analytic-surface bodies reached from Revit 2027
 * `Face`.
 *
 * The decoder mirrors the native base-to-derived call order:
 * `Surface` envelope/orientation first, then the selected derived fields.
 * It intentionally accepts only the four source slots whose complete
 * representations are proven in the exact UNBC file.
 */
export function decodeRevit2027AnalyticSurface(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  sourceClassSlot: number,
): Revit2027SurfaceDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 Surface decoding requires release 2027",
    };
  }
  const base = decodeBase(data, byteOffset, enclosingEndOffset);
  if (!base.ok) return base;
  const { surface, view } = base.value;
  let cursor = base.value.endOffset;

  if (sourceClassSlot === REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT) {
    if (!bounded(data, cursor, POINT_3D_BYTES * 3, enclosingEndOffset)) {
      return { ok: false, error: "Revit 2027 Plane fields are truncated" };
    }
    const origin = point3d(view, cursor);
    const xVector = point3d(view, cursor + POINT_3D_BYTES);
    const yVector = point3d(view, cursor + POINT_3D_BYTES * 2);
    if (!finite([...origin, ...xVector, ...yVector])) {
      return { ok: false, error: "Revit 2027 Plane fields are not finite" };
    }
    cursor += POINT_3D_BYTES * 3;
    return {
      ok: true,
      value: {
        kind: "plane",
        sourceClassSlot,
        byteOffset,
        endOffset: cursor,
        surface,
        origin,
        xVector,
        yVector,
        queuedProperties: [],
      },
    };
  }

  if (
    sourceClassSlot === REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT ||
    sourceClassSlot === REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT
  ) {
    const fieldBytes = POINT_3D_BYTES * 4 + DOUBLE_BYTES;
    if (!bounded(data, cursor, fieldBytes, enclosingEndOffset)) {
      return {
        ok: false,
        error:
          sourceClassSlot === REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT
            ? "Revit 2027 ConeSurf fields are truncated"
            : "Revit 2027 CylSurf fields are truncated",
      };
    }
    const center = point3d(view, cursor);
    const xVector = point3d(view, cursor + POINT_3D_BYTES);
    const yVector = point3d(view, cursor + POINT_3D_BYTES * 2);
    const zVector = point3d(view, cursor + POINT_3D_BYTES * 3);
    const scalar = view.getFloat64(cursor + POINT_3D_BYTES * 4, true);
    if (!finite([...center, ...xVector, ...yVector, ...zVector, scalar])) {
      return {
        ok: false,
        error:
          sourceClassSlot === REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT
            ? "Revit 2027 ConeSurf fields are not finite"
            : "Revit 2027 CylSurf fields are not finite",
      };
    }
    cursor += fieldBytes;
    if (sourceClassSlot === REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT) {
      return {
        ok: true,
        value: {
          kind: "cone",
          sourceClassSlot,
          byteOffset,
          endOffset: cursor,
          surface,
          center,
          xVector,
          yVector,
          zVector,
          halfAngle: scalar,
          queuedProperties: [],
        },
      };
    }
    return {
      ok: true,
      value: {
        kind: "cylinder",
        sourceClassSlot,
        byteOffset,
        endOffset: cursor,
        surface,
        center,
        xVector,
        yVector,
        zVector,
        radius: scalar,
        queuedProperties: [],
      },
    };
  }

  if (
    sourceClassSlot ===
    REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT
  ) {
    const vectorBytes = POINT_3D_BYTES * 4;
    if (!bounded(data, cursor, vectorBytes + 4, enclosingEndOffset)) {
      return {
        ok: false,
        error: "Revit 2027 SurfRev fields are truncated",
      };
    }
    const center = point3d(view, cursor);
    const xVector = point3d(view, cursor + POINT_3D_BYTES);
    const yVector = point3d(view, cursor + POINT_3D_BYTES * 2);
    const zVector = point3d(view, cursor + POINT_3D_BYTES * 3);
    if (!finite([...center, ...xVector, ...yVector, ...zVector])) {
      return {
        ok: false,
        error: "Revit 2027 SurfRev fields are not finite",
      };
    }
    cursor += vectorBytes;
    const profileCurve = decodeCondInt16PropertyDescriptor(data, cursor);
    if (!profileCurve.ok) {
      return {
        ok: false,
        error: `Revit 2027 SurfRev profile curve: ${profileCurve.error}`,
      };
    }
    if (profileCurve.descriptor.endOffset > enclosingEndOffset) {
      return {
        ok: false,
        error: "Revit 2027 SurfRev profile curve exceeds the enclosing body",
      };
    }
    cursor = profileCurve.descriptor.endOffset;
    return {
      ok: true,
      value: {
        kind: "surface-of-revolution",
        sourceClassSlot,
        byteOffset,
        endOffset: cursor,
        surface,
        center,
        xVector,
        yVector,
        zVector,
        profileCurve: profileCurve.descriptor,
        queuedProperties:
          profileCurve.descriptor.token === 0
            ? []
            : [profileCurve.descriptor],
      },
    };
  }

  if (sourceClassSlot === REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT) {
    const profileCurve1 = decodeCondInt16PropertyDescriptor(data, cursor);
    if (!profileCurve1.ok) {
      return {
        ok: false,
        error: `Revit 2027 RuledSurf profile curve 1: ${profileCurve1.error}`,
      };
    }
    cursor = profileCurve1.descriptor.endOffset;
    const profileCurve2 = decodeCondInt16PropertyDescriptor(data, cursor);
    if (!profileCurve2.ok) {
      return {
        ok: false,
        error: `Revit 2027 RuledSurf profile curve 2: ${profileCurve2.error}`,
      };
    }
    cursor = profileCurve2.descriptor.endOffset;
    if (!bounded(data, cursor, POINT_3D_BYTES * 2, enclosingEndOffset)) {
      return { ok: false, error: "Revit 2027 RuledSurf points are truncated" };
    }
    const point1 = point3d(view, cursor);
    const point2 = point3d(view, cursor + POINT_3D_BYTES);
    if (!finite([...point1, ...point2])) {
      return { ok: false, error: "Revit 2027 RuledSurf points are not finite" };
    }
    cursor += POINT_3D_BYTES * 2;
    return {
      ok: true,
      value: {
        kind: "ruled",
        sourceClassSlot,
        byteOffset,
        endOffset: cursor,
        surface,
        profileCurve1: profileCurve1.descriptor,
        profileCurve2: profileCurve2.descriptor,
        point1,
        point2,
        queuedProperties: [
          profileCurve1.descriptor,
          profileCurve2.descriptor,
        ].filter((entry) => entry.token !== 0),
      },
    };
  }

  return {
    ok: false,
    error: `unsupported Revit 2027 Face surface source slot ${sourceClassSlot}`,
  };
}
