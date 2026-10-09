/** Separately preserved continuations of independently recovered finite native
 * frame members. These never turn a sill into a full-height wall or alter a door. */
import pc from "polygon-clipping";
import {
  nativePositiveMaterialBandsAcrossLevels,
  nativePositiveMaterialBandOverlapsParts,
} from "./native-positive-material-bands";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { NativeMaterialSections } from "./native-material-sections";
import {
  nativeWallPositionMaterialBinding,
  type NativeWallPositionRepairs,
} from "./native-wall-position-repairs";
type Point = [number, number];
type Parts = Point[][][];
export type NativeOriginalMemberSection = {
  nativeElementId: number;
  baseElevationFeet: number;
  topElevationFeet: number;
  partsFeet: Parts;
  sourceWidthFeet: number;
  sourceAxisDirectionFeet: Point;
  sourceCapFeet: Point[];
  evidenceSha256: string;
};
export type NativeDerivedFrameReturns = {
  version: 1;
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  sourceWallPositionRepairsSha256: string;
  geometrySha256: string;
  rows: {
    id: string;
    levelId: number;
    elevationFeet: number;
    sourceNativeElementId: number;
    targetNativeElementId: number;
    nativeSharedCurtainHostId: number;
    role: "walking-material" | "enclosure-context-only";
    originalSourceAnchorMemberNativeElementId?: number;
    originalSourceAnchorFloorIds?: number[];
    sourceFloorOuterContext?: {
      kind: "original-native-floor-outer-edge";
      sourceFloorIds: number[];
      sourceFloorBindings: {
        nativeElementId: number;
        elevationFeet: number;
        partsFeet: Parts;
      }[];
      sourceFloorPartsSha256: string;
      sourceFloorOuterPartsSha256: string;
      evidenceSha256: string;
      noWalkingMaterial: true;
    };
    baseElevationFeet: number;
    topElevationFeet: number;
    sourceWidthFeet: number;
    sourceAxisDirectionFeet: Point;
    sourceCapFeet: Point[];
    targetContactFeet: Point[];
    targetOriginalFiniteFaceChainFeet: Point[];
    partsFeet: Parts;
    sourceOriginalMaterialPartsFeet: Parts;
    targetOriginalMaterialPartsFeet: Parts;
    sourceFloorIds: number[];
    sourceFloorBindings: {
      nativeElementId: number;
      elevationFeet: number;
      partsFeet: Parts;
    }[];
    sourceFloorPartsSha256: string;
    contactPaddingFeet: number;
    completeOriginalPhysicalOwnerCensusSha256: string;
    evidenceSha256: string;
    [key: string]: unknown;
  }[];
};
type Data = {
  source?: { modelSha256: string };
  nativeMaterialSections?: NativeMaterialSections;
  nativeDerivedFrameReturns?: NativeDerivedFrameReturns;
  nativeWallPositionRepairs?: NativeWallPositionRepairs;
  walkingSupport?: {
    sourceModelSha256: string;
    floors: {
      nativeElementId: number;
      elevationFeet: number;
      ringsFeet: Point[][];
      partsFeet?: Parts;
    }[];
  };
};
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const point = (v: unknown): v is Point =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
  );
const parts = (v: unknown): v is Parts =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length < 10000 &&
  v.every(
    (p) =>
      Array.isArray(p) &&
      p.length > 0 &&
      p.every(
        (r) =>
          Array.isArray(r) &&
          r.length >= 3 &&
          r.length < 100000 &&
          r.every(point),
      ),
  );
const area = (ps: Parts) =>
  ps.reduce(
    (s, p) =>
      s +
      p.reduce(
        (a, r, i) =>
          a +
          ((i ? -1 : 1) *
            Math.abs(
              r.reduce((v, x, j) => {
                const y = r[(j + 1) % r.length];
                return v + x[0] * y[1] - y[0] * x[1];
              }, 0),
            )) /
            2,
        0,
      ),
    0,
  );
export const nativeDerivedFrameHash = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export const nativeDerivedFramePlacementHash = (
  repairs: NativeWallPositionRepairs | undefined,
) => nativeDerivedFrameHash(nativeWallPositionMaterialBinding(repairs) ?? null);
export function nativeDerivedFrameReturnsHash(
  value:
    | Omit<NativeDerivedFrameReturns, "geometrySha256">
    | NativeDerivedFrameReturns,
) {
  return nativeDerivedFrameHash(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "geometrySha256"),
    ),
  );
}
export function validateNativeOriginalMemberSection(
  v: NativeOriginalMemberSection,
) {
  if (
    !v ||
    !Number.isSafeInteger(v.nativeElementId) ||
    v.nativeElementId <= 0 ||
    !Number.isFinite(v.baseElevationFeet) ||
    !Number.isFinite(v.topElevationFeet) ||
    v.topElevationFeet <= v.baseElevationFeet ||
    !parts(v.partsFeet) ||
    !Number.isFinite(v.sourceWidthFeet) ||
    v.sourceWidthFeet <= 0 ||
    !point(v.sourceAxisDirectionFeet) ||
    Math.abs(Math.hypot(...v.sourceAxisDirectionFeet) - 1) > 1e-6 ||
    !Array.isArray(v.sourceCapFeet) ||
    v.sourceCapFeet.length !== 2 ||
    !v.sourceCapFeet.every(point) ||
    Math.abs(
      Math.hypot(
        v.sourceCapFeet[1][0] - v.sourceCapFeet[0][0],
        v.sourceCapFeet[1][1] - v.sourceCapFeet[0][1],
      ) - v.sourceWidthFeet,
    ) > 1e-6 ||
    !digest(v.evidenceSha256)
  )
    throw new Error("Invalid original finite native member profile.");
}
export function validateNativeDerivedFrameReturns(
  value: NativeDerivedFrameReturns | undefined,
  model?: string,
) {
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    !digest(value.sourceModelSha256) ||
    (model && value.sourceModelSha256 !== model) ||
    !digest(value.sourceMaterialGeometrySha256) ||
    !digest(value.sourceWallPositionRepairsSha256) ||
    !digest(value.geometrySha256) ||
    !Array.isArray(value.rows) ||
    !value.rows.length ||
    value.rows.length > 10000
  )
    throw new Error("Invalid separately derived native frame source binding.");
  const ids = new Set<string>();
  for (const r of value.rows) {
    if (
      !r ||
      !r.id ||
      ids.has(r.id) ||
      ![
        r.levelId,
        r.sourceNativeElementId,
        r.targetNativeElementId,
        r.nativeSharedCurtainHostId,
      ].every((n) => Number.isSafeInteger(n) && n > 0) ||
      r.sourceNativeElementId === r.targetNativeElementId ||
      ![
        r.elevationFeet,
        r.baseElevationFeet,
        r.topElevationFeet,
        r.sourceWidthFeet,
      ].every(Number.isFinite) ||
      r.topElevationFeet <= r.baseElevationFeet ||
      r.sourceWidthFeet <= 0 ||
      !point(r.sourceAxisDirectionFeet) ||
      Math.abs(Math.hypot(...r.sourceAxisDirectionFeet) - 1) > 1e-6 ||
      ![r.sourceCapFeet, r.targetContactFeet].every(
        (a) => Array.isArray(a) && a.length === 2 && a.every(point),
      ) ||
      !Array.isArray(r.targetOriginalFiniteFaceChainFeet) ||
      r.targetOriginalFiniteFaceChainFeet.length < 2 ||
      !r.targetOriginalFiniteFaceChainFeet.every(point) ||
      ![
        r.partsFeet,
        r.sourceOriginalMaterialPartsFeet,
        r.targetOriginalMaterialPartsFeet,
      ].every(parts) ||
      r.contactPaddingFeet <= 0 ||
      r.contactPaddingFeet > 0.0002 ||
      !digest(r.sourceFloorPartsSha256) ||
      !digest(r.completeOriginalPhysicalOwnerCensusSha256) ||
      !digest(r.evidenceSha256) ||
      !Array.isArray(r.sourceFloorIds) ||
      (r.role !== "walking-material" && r.role !== "enclosure-context-only") ||
      (r.role === "walking-material" && !r.sourceFloorIds.length) ||
      (r.role === "enclosure-context-only" && r.sourceFloorIds.length !== 0) ||
      new Set(r.sourceFloorIds).size !== r.sourceFloorIds.length ||
      !Array.isArray(r.sourceFloorBindings) ||
      r.sourceFloorBindings.length !== r.sourceFloorIds.length ||
      r.sourceFloorBindings.some(
        (f) =>
          !r.sourceFloorIds.includes(f.nativeElementId) ||
          !Number.isFinite(f.elevationFeet) ||
          !parts(f.partsFeet),
      )
    )
      throw new Error("Invalid finite native frame continuation evidence.");
    ids.add(r.id);
    const outer = r.sourceFloorOuterContext;
    if (
      outer &&
      (r.role !== "enclosure-context-only" ||
        outer.kind !== "original-native-floor-outer-edge" ||
        outer.noWalkingMaterial !== true ||
        !digest(outer.sourceFloorPartsSha256) ||
        !digest(outer.sourceFloorOuterPartsSha256) ||
        !digest(outer.evidenceSha256) ||
        !Array.isArray(outer.sourceFloorIds) ||
        !outer.sourceFloorIds.length ||
        new Set(outer.sourceFloorIds).size !== outer.sourceFloorIds.length ||
        !outer.sourceFloorIds.every(
          (id) => Number.isSafeInteger(id) && id > 0,
        ) ||
        !Array.isArray(outer.sourceFloorBindings) ||
        outer.sourceFloorBindings.length !== outer.sourceFloorIds.length ||
        outer.sourceFloorBindings.some(
          (f) =>
            !outer.sourceFloorIds.includes(f.nativeElementId) ||
            !Number.isFinite(f.elevationFeet) ||
            !parts(f.partsFeet),
        ) ||
        r.originalSourceAnchorMemberNativeElementId !== undefined ||
        r.originalSourceAnchorFloorIds !== undefined)
    )
      throw new Error(
        "Invalid original native floor outer-edge context binding.",
      );
  }
}
const bbox = (ps: Parts) => {
  const q = ps.flat(2);
  return [
    Math.min(...q.map((p) => p[0])),
    Math.min(...q.map((p) => p[1])),
    Math.max(...q.map((p) => p[0])),
    Math.max(...q.map((p) => p[1])),
  ];
};
const nearby = (a: Parts, b: Parts) => {
  const x = bbox(a),
    y = bbox(b);
  return x[0] <= y[2] && x[2] >= y[0] && x[1] <= y[3] && x[3] >= y[1];
};
const sameParts = (a: Parts, b: Parts) => area(pc.xor(a, b) as Parts) < 1e-9;
const translate = (p: Parts, d: Point) =>
  p.map((rs) =>
    rs.map((r) => r.map((q) => [q[0] + d[0], q[1] + d[1]] as Point)),
  );
const edgeDistance = (p: Point, ps: Parts) =>
  Math.min(
    ...ps.flatMap((rs) =>
      rs.flatMap((r) =>
        r.map((a, i) => {
          const b = r[(i + 1) % r.length],
            dx = b[0] - a[0],
            dy = b[1] - a[1],
            t = Math.max(
              0,
              Math.min(
                1,
                ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                  (dx * dx + dy * dy || 1),
              ),
            );
          return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        }),
      ),
    ),
  );
/** Recover the full-width continuation from original cap rays and the first
 * consecutive finite target faces; payload geometry cannot widen the member. */
function checkedAxisContinuation(
  r: NativeDerivedFrameReturns["rows"][number],
  source: NativeOriginalMemberSection,
  shift: Point,
) {
  const u = r.sourceAxisDirectionFeet,
    t: Point = [-u[1], u[0]],
    origin = r.sourceCapFeet[0];
  const local = (p: Point): Point => [
    (p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1],
    (p[0] - origin[0]) * t[0] + (p[1] - origin[1]) * t[1],
  ];
  const actual = source.partsFeet
    .flat(2)
    .map((p) => local([p[0] + shift[0], p[1] + shift[1]]));
  const maxAxis = Math.max(...actual.map((p) => p[0])),
    minSide = Math.min(...actual.map((p) => p[1])),
    maxSide = Math.max(...actual.map((p) => p[1]));
  if (
    Math.abs(maxAxis) > 1e-7 ||
    Math.abs(maxSide - minSide - r.sourceWidthFeet) > 1e-7 ||
    r.sourceCapFeet.some((p) => {
      const q = local(p);
      return (
        Math.abs(q[0]) > 1e-7 ||
        Math.min(Math.abs(q[1] - minSide), Math.abs(q[1] - maxSide)) > 1e-7
      );
    })
  )
    throw new Error(
      `Frame continuation ${r.id} uses a different original full-width end cap.`,
    );
  const a = local(r.sourceCapFeet[0]),
    b = local(r.sourceCapFeet[1]),
    lo = Math.min(a[1], b[1]),
    hi = Math.max(a[1], b[1]);
  if (
    Math.abs(a[0] - b[0]) > 1e-7 ||
    Math.abs(hi - lo - r.sourceWidthFeet) > 1e-7
  )
    throw new Error(
      "Native member axis is not orthogonal to its full original width.",
    );
  const chain = r.targetOriginalFiniteFaceChainFeet.map(local),
    sorted = [...chain].sort((p, q) => p[1] - q[1]);
  if (
    Math.abs(sorted[0][1] - lo) > 1e-7 ||
    Math.abs(sorted[sorted.length - 1][1] - hi) > 1e-7 ||
    chain.some((p) => p[0] <= 0 || p[1] < lo - 1e-7 || p[1] > hi + 1e-7)
  )
    throw new Error(
      "Target finite faces do not cover the original member width.",
    );
  const xsAt = (parts: Parts, y: number) =>
    parts
      .flatMap((p) =>
        p.flatMap((r) =>
          r.flatMap((a, i) => {
            const b = r[(i + 1) % r.length],
              x = local(a),
              z = local(b);
            if (Math.abs(x[1] - z[1]) < 1e-12) return [];
            const q = (y - x[1]) / (z[1] - x[1]);
            return q >= -1e-9 && q <= 1 + 1e-9
              ? [x[0] + q * (z[0] - x[0])]
              : [];
          }),
        ),
      )
      .filter((x) => x > 0);
  const ys = [
    lo,
    hi,
    ...sorted.map((p) => p[1]),
    ...r.targetOriginalMaterialPartsFeet
      .flatMap((p) => p.flatMap((r) => r.map((p) => local(p)[1])))
      .filter((y) => y > lo && y < hi),
  ].sort((a, b) => a - b);
  for (const y of [...ys, ...ys.slice(1).map((y, i) => (y + ys[i]) / 2)]) {
    const edge = sorted
      .slice(1)
      .map((p, i) => [sorted[i], p] as const)
      .find(
        ([a, b]) => y >= a[1] - 1e-9 && y <= b[1] + 1e-9 && b[1] - a[1] > 1e-12,
      );
    const actual = xsAt(r.targetOriginalMaterialPartsFeet, y);
    if (!edge || !actual.length)
      throw new Error("Original target has an unclosed lateral interval.");
    const [c, d] = edge,
      x = c[0] + ((y - c[1]) / (d[1] - c[1])) * (d[0] - c[0]);
    if (Math.abs(x - Math.min(...actual)) > 1e-7)
      throw new Error(
        "Frame continuation bypasses the first original finite target contact.",
      );
  }
  const world = (x: number, y: number): Point => [
      origin[0] + x * u[0] + y * t[0],
      origin[1] + x * u[1] + y * t[1],
    ],
    pad = r.contactPaddingFeet;
  const expected: Parts = [
    [
      [
        world(-pad, lo),
        world(-pad, hi),
        ...sorted
          .slice()
          .reverse()
          .map((p) => world(p[0] + pad, p[1])),
      ],
    ],
  ];
  if (!sameParts(expected, r.partsFeet))
    throw new Error(
      "Derived frame does not equal the independently measured full-width axis continuation.",
    );
}
/** Build once for an immutable snapshot; all coordinates and source ownership,
 * physical placements and exact floor parts are checked before any cut is used. */
export function createNativeDerivedFrameReturnIndex(data: Data) {
  const v = data.nativeDerivedFrameReturns;
  validateNativeDerivedFrameReturns(v, data.source?.modelSha256);
  if (!v)
    return {
      rows: [] as NativeDerivedFrameReturns["rows"],
      partsAt: (_cut: number) => [] as { outer: Point[]; holes: Point[][] }[],
    };
  const mat = data.nativeMaterialSections;
  if (
    !mat ||
    mat.sourceModelSha256 !== v.sourceModelSha256 ||
    mat.geometrySha256 !== v.sourceMaterialGeometrySha256 ||
    nativeDerivedFrameReturnsHash(v) !== v.geometrySha256 ||
    nativeDerivedFramePlacementHash(data.nativeWallPositionRepairs) !==
      v.sourceWallPositionRepairsSha256
  )
    throw new Error(
      "Native frame returns are stale against original material or physical placement.",
    );
  const positiveBands = nativePositiveMaterialBandsAcrossLevels(mat.levels);
  const shifts = new Map(
    data.nativeWallPositionRepairs?.walls.map((r) => [
      r.nativeElementId,
      [
        r.ringsFeet[0][0][0] - r.originalRingsFeet[0][0][0],
        r.ringsFeet[0][0][1] - r.originalRingsFeet[0][0][1],
      ] as Point,
    ]) ?? [],
  );
  for (const r of v.rows) {
    const levels = mat.levels.filter(
      (l) =>
        l.levelId === r.levelId &&
        Math.abs(l.elevationFeet - r.elevationFeet) < 1e-7,
    );
    const profiles = levels.flatMap(
      (l) => l.originalNativeMemberSections ?? [],
    );
    const source = profiles.find(
      (p) =>
        p.nativeElementId === r.sourceNativeElementId &&
        Math.abs(p.baseElevationFeet - r.baseElevationFeet) < 1e-7 &&
        Math.abs(p.topElevationFeet - r.topElevationFeet) < 1e-7,
    );
    if (!source)
      throw new Error(
        "Derived frame member lacks independently preserved original finite body.",
      );
    validateNativeOriginalMemberSection(source);
    checkedAxisContinuation(
      r,
      source,
      shifts.get(r.sourceNativeElementId) ?? [0, 0],
    );
    const shift = shifts.get(r.sourceNativeElementId) ?? [0, 0],
      sourceParts = translate(source.partsFeet, shift);
    const targetSections = levels
      .flatMap((l) => l.sections)
      .filter(
        (s) =>
          s.nativeElementId === r.targetNativeElementId &&
          s.baseElevationFeet <= r.baseElevationFeet + 1e-7 &&
          s.topElevationFeet >= r.topElevationFeet - 1e-7,
      );
    const finiteTarget = levels
      .flatMap((l) => l.originalFiniteMaterialSections ?? [])
      .find(
        (s) =>
          s.nativeElementId === r.targetNativeElementId &&
          Math.abs(s.baseElevationFeet - r.baseElevationFeet) < 1e-7 &&
          Math.abs(s.topElevationFeet - r.topElevationFeet) < 1e-7,
      );
    const targetParts =
      finiteTarget?.partsFeet ?? targetSections.flatMap((s) => s.partsFeet);
    const targetShift = shifts.get(r.targetNativeElementId) ?? [0, 0];
    if (
      !targetParts.length ||
      !sameParts(sourceParts, r.sourceOriginalMaterialPartsFeet) ||
      !sameParts(
        translate(targetParts, targetShift),
        r.targetOriginalMaterialPartsFeet,
      ) ||
      Math.abs(source.sourceWidthFeet - r.sourceWidthFeet) > 1e-7 ||
      Math.abs(
        source.sourceAxisDirectionFeet[0] * r.sourceAxisDirectionFeet[1] -
          source.sourceAxisDirectionFeet[1] * r.sourceAxisDirectionFeet[0],
      ) > 1e-7 ||
      r.sourceCapFeet.some((p) => edgeDistance(p, sourceParts) > 1e-7) ||
      r.targetOriginalFiniteFaceChainFeet.some(
        (p) => edgeDistance(p, r.targetOriginalMaterialPartsFeet) > 1e-7,
      )
    )
      throw new Error(
        `Derived frame continuation ${r.id} no longer meets its original finite material faces.`,
      );
    if (
      area(pc.intersection(r.partsFeet, sourceParts) as Parts) <= 1e-12 ||
      area(
        pc.intersection(
          r.partsFeet,
          r.targetOriginalMaterialPartsFeet,
        ) as Parts,
      ) <= 1e-12
    )
      throw new Error(
        "Derived frame must overlap both original contacts at measured width.",
      );
    const persisted = levels
      .flatMap((l) => l.originalNativeHostRelations ?? [])
      .filter((h) => h.hostNativeElementId === r.nativeSharedCurtainHostId);
    if (
      !persisted.some((h) =>
        h.memberNativeElementIds.includes(r.sourceNativeElementId),
      )
    )
      throw new Error(
        "Derived frame member lacks an independently persisted original curtain host.",
      );
    if (r.role === "enclosure-context-only") {
      const outer = r.sourceFloorOuterContext;
      if (outer) {
        const floors =
          data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
            ? data.walkingSupport.floors
                .filter((f) => outer.sourceFloorIds.includes(f.nativeElementId))
                .map((f) => ({
                  nativeElementId: f.nativeElementId,
                  elevationFeet: f.elevationFeet,
                  partsFeet: f.partsFeet ?? [f.ringsFeet],
                }))
                .sort((a, b) => a.nativeElementId - b.nativeElementId)
            : [];
        if (
          floors.length !== outer.sourceFloorIds.length ||
          nativeDerivedFrameHash(floors) !== outer.sourceFloorPartsSha256 ||
          JSON.stringify(floors) !==
            JSON.stringify(outer.sourceFloorBindings) ||
          floors.some(
            (f) =>
              Math.abs(f.elevationFeet - r.elevationFeet) > 0.05 ||
              f.elevationFeet > r.baseElevationFeet + 1e-10,
          )
        )
          throw new Error(
            "Native outer-edge enclosure context source floor binding changed.",
          );
        const floorParts = floors.flatMap((f) => f.partsFeet);
        const outerParts: Parts = floorParts.map((p) => [p[0]]);
        if (
          nativeDerivedFrameHash(outerParts) !==
          outer.sourceFloorOuterPartsSha256
        )
          throw new Error(
            "Native outer-edge enclosure context original outer loops changed.",
          );
        const holes = pc.difference(outerParts, floorParts) as Parts;
        const unsupported = pc.difference(r.partsFeet, floorParts) as Parts;
        if (
          area(pc.intersection(r.partsFeet, floorParts) as Parts) <= 0 ||
          area(unsupported) <= 0 ||
          area(pc.intersection(unsupported, outerParts) as Parts) > 0 ||
          area(pc.intersection(r.partsFeet, holes) as Parts) > 0 ||
          r.sourceFloorPartsSha256 !== nativeDerivedFrameHash([]) ||
          r.sourceFloorBindings.length ||
          r.unsupportedContextHeightNoWalkingFloorClaim !== true
        )
          throw new Error(
            "Native enclosure context must cross only the original floor outer edge, never an inner aperture.",
          );
      } else {
        const anchor = v.rows.find(
          (a) =>
            a.role === "walking-material" &&
            a.sourceNativeElementId ===
              r.originalSourceAnchorMemberNativeElementId &&
            a.nativeSharedCurtainHostId === r.nativeSharedCurtainHostId &&
            a.targetNativeElementId === r.targetNativeElementId,
        );
        if (
          !anchor ||
          JSON.stringify(anchor.sourceFloorIds) !==
            JSON.stringify(r.originalSourceAnchorFloorIds) ||
          r.sourceFloorPartsSha256 !== nativeDerivedFrameHash([]) ||
          r.sourceFloorBindings.length ||
          r.unsupportedContextHeightNoWalkingFloorClaim !== true
        )
          throw new Error(
            "Upper native frame context lacks a checked original floor-supported sibling.",
          );
      }
    }
    if (r.role === "walking-material") {
      const floors =
        data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
          ? data.walkingSupport.floors
              .filter((f) => r.sourceFloorIds.includes(f.nativeElementId))
              .map((f) => ({
                nativeElementId: f.nativeElementId,
                elevationFeet: f.elevationFeet,
                partsFeet: f.partsFeet ?? [f.ringsFeet],
              }))
              .sort((a, b) => a.nativeElementId - b.nativeElementId)
          : [];
      if (
        floors.length !== r.sourceFloorIds.length ||
        nativeDerivedFrameHash(floors) !== r.sourceFloorPartsSha256 ||
        JSON.stringify(floors) !== JSON.stringify(r.sourceFloorBindings)
      )
        throw new Error(
          "Derived native frame exact source floor binding changed.",
        );
      const floorParts = floors.flatMap((f) => f.partsFeet);
      const introduced = pc.difference(
        r.partsFeet,
        sourceParts,
        r.targetOriginalMaterialPartsFeet,
      ) as Parts;
      if (area(pc.difference(introduced, floorParts) as Parts) > 1e-9)
        throw new Error(
          "Derived frame continuation crosses unsupported floor or a real opening.",
        );
    }
    const introduced = pc.difference(
      r.partsFeet,
      sourceParts,
      r.targetOriginalMaterialPartsFeet,
    ) as Parts;
    const own = new Set([
      r.sourceNativeElementId,
      r.targetNativeElementId,
      r.nativeSharedCurtainHostId,
      ...persisted.flatMap((h) => h.memberNativeElementIds),
      ...levels
        .flatMap((l) => l.sections)
        .filter(
          (s) =>
            s.nativeElementId === r.nativeSharedCurtainHostId &&
            s.sourceNativeHostRelationsVerified,
        )
        .flatMap((s) => s.sourceAssemblyChildIds ?? []),
    ]);
    const cutForeign = levels
      .filter(
        (l) =>
          l.cutElevationFeet > r.baseElevationFeet &&
          l.cutElevationFeet < r.topElevationFeet,
      )
      .flatMap((l) => l.sections)
      .filter((s) => !own.has(s.nativeElementId))
      .flatMap((s) =>
        translate(s.partsFeet, shifts.get(s.nativeElementId) ?? [0, 0]),
      );
    // Finite-band witnesses are original source material throughout the
    // declared height interval, unlike a cross-section at another storey.
    const finiteForeign = levels
      .flatMap((l) => l.originalFiniteMaterialSections ?? [])
      .filter(
        (s) =>
          !own.has(s.nativeElementId) &&
          s.baseElevationFeet < r.topElevationFeet &&
          s.topElevationFeet > r.baseElevationFeet,
      )
      .flatMap((s) =>
        translate(s.partsFeet, shifts.get(s.nativeElementId) ?? [0, 0]),
      );
    for (const band of positiveBands) {
      if (
        !own.has(band.nativeElementId) &&
        band.baseElevationFeet < r.topElevationFeet &&
        band.topElevationFeet > r.baseElevationFeet &&
        nativePositiveMaterialBandOverlapsParts(
          band,
          introduced,
          shifts.get(band.nativeElementId) ?? [0, 0],
        )
      )
        throw new Error(
          `Derived frame continuation ${r.id} intersects exact positive original native material owner ${band.nativeElementId}.`,
        );
    }
    const foreign = [...cutForeign, ...finiteForeign];
    const closeForeign = foreign.filter((p) => nearby(introduced, [p]));
    if (
      closeForeign.length &&
      area(pc.intersection(introduced, closeForeign) as Parts) > 1e-9
    )
      throw new Error(
        `Derived frame continuation ${r.id} intersects foreign original native material.`,
      );
  }
  return {
    rows: v.rows,
    partsAt: (cut: number) =>
      v.rows
        .filter(
          (r) =>
            !r.sourceFloorOuterContext &&
            r.baseElevationFeet <= cut &&
            r.topElevationFeet > cut,
        )
        .flatMap((r) =>
          r.partsFeet.map((p) => ({ outer: p[0], holes: p.slice(1) })),
        ),
  };
}
export function nativeDerivedFrameReturnParts(data: Data, cut: number) {
  return createNativeDerivedFrameReturnIndex(data).partsAt(cut);
}
export function verifyNativeDerivedFrameReturns(data: Data) {
  createNativeDerivedFrameReturnIndex(data);
}
