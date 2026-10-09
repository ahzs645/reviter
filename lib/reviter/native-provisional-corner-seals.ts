/** Reversible human assumptions at independently measured native corners.
 * These are newly assumed finite opaque bodies, never source-axis continuations,
 * translated native walls, or source-verified construction. */
import pc from "polygon-clipping";
import {
  nativePositiveMaterialBandsAcrossLevels,
  nativePositiveMaterialBandOverlapsParts,
} from "./native-positive-material-bands";
import {
  nativeDerivedFrameHash,
  nativeDerivedFramePlacementHash,
} from "./native-derived-frame-returns";
import type { NativeMaterialSections } from "./native-material-sections";
import type { NativeWallPositionRepairs } from "./native-wall-position-repairs";
import { exactNativeDoorFloorDifference } from "./native-door-exact-overlay";
type P2 = [number, number];
type P3 = [number, number, number];
type Parts = P2[][][];
export type NativeProvisionalCornerSeals = {
  version: 1;
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  sourceWallPositionRepairsSha256: string;
  geometrySha256: string;
  completeOriginalPhysicalOwnerCensusSha256: string;
  nonPhysicalCurtainHostNativeElementIds?: number[];
  foreignBodies: {
    nativeElementId: number;
    boundsFeet: { min: P3; max: P3 };
    partsFeet?: Parts;
    evidenceSha256: string;
  }[];
  rows: {
    id: string;
    levelId: number;
    elevationFeet: number;
    baseElevationFeet: number;
    topElevationFeet: number;
    state: "proposed" | "applied" | "restored";
    carrierContactNativeElementIds: number[];
    targetNativeElementId: number;
    carrierContactFaceFeet: [P2, P2];
    nearestCarrierContactFeet: P2;
    nearestTargetContactFeet: P2;
    contactPaddingFeet: number;
    partsFeet: Parts;
    sourceFloorIds: number[];
    sourceFloorBindings: {
      nativeElementId: number;
      elevationFeet: number;
      partsFeet: Parts;
    }[];
    sourceFloorPartsSha256: string;
    materialRole?: "enclosure-context-only";
    reviewedConstructionShape?: {
      kind: "finite-face-fragment-bridge" | "native-corner-points-bridge";
      carrierFragmentFeet: [P2, P2];
      targetFragmentFeet: [P2, P2];
      paddingDirectionFeet: P2;
      evidenceSha256: string;
      sourceAxisCertified: false;
      sourceFullMemberWidthCertified: false;
    };
    sourceFloorOuterContext?: {
      kind: "original-native-floor-outer-edge";
      sourceFloorOuterPartsSha256: string;
      evidenceSha256: string;
      noWalkingMaterial: true;
    };
    assumption: {
      kind: "human-authorized-construction-assumption";
      authorizationRecorded: boolean;
      authorizationEvidenceSha256: string;
      revisitRequired: true;
      sourceVerified: false;
      evidenceSha256: string;
    };
    evidenceSha256: string;
  }[];
};
type Data = {
  source?: { modelSha256: string };
  nativeMaterialSections?: NativeMaterialSections;
  nativeWallPositionRepairs?: NativeWallPositionRepairs;
  nativeProvisionalCornerSeals?: NativeProvisionalCornerSeals;
  walkingSupport?: {
    sourceModelSha256: string;
    floors: {
      nativeElementId: number;
      elevationFeet: number;
      ringsFeet: P2[][];
      partsFeet?: Parts;
    }[];
  };
  nativeIndoorEnvelopes?: {
    levels: {
      levelId: number;
      elevationFeet: number;
      cutElevationsFeet?: number[];
      provisionalCornerGeometrySha256?: string;
      provisionalCornerIds?: string[];
    }[];
  };
  doors?: { nativeElementId: number; footprintFeet?: P2[]; id: string }[];
  edges?: { id: string; kind: string; enabled: boolean; pointsFeet: P3[] }[];
};
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ids = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 100000 &&
  new Set(v).size === v.length &&
  v.every((n) => Number.isSafeInteger(n) && n > 0);
const point = (v: unknown, n = 2): boolean =>
  Array.isArray(v) &&
  v.length === n &&
  v.every(
    (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e7,
  );
const parts = (v: unknown): v is Parts =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 10000 &&
  v.every(
    (p) =>
      Array.isArray(p) &&
      p.length > 0 &&
      p.every(
        (r) =>
          Array.isArray(r) &&
          r.length >= 3 &&
          r.length <= 100000 &&
          r.every((p) => point(p)),
      ),
  );
const area = (ps: Parts) =>
  ps.reduce(
    (sum, p) =>
      sum +
      p.reduce(
        (s, r, i) =>
          s +
          ((i ? -1 : 1) *
            Math.abs(
              r.reduce((s, a, j) => {
                const b = r[(j + 1) % r.length];
                // A common ring origin avoids losing tiny true contact area at
                // large native model coordinates; no coordinate is changed.
                const o = r[0];
                return (
                  s +
                  (a[0] - o[0]) * (b[1] - o[1]) -
                  (b[0] - o[0]) * (a[1] - o[1])
                );
              }, 0),
            )) /
            2,
        0,
      ),
    0,
  );
export const nativeProvisionalCornerSealsHash = (
  v:
    | NativeProvisionalCornerSeals
    | Omit<NativeProvisionalCornerSeals, "geometrySha256">,
) =>
  nativeDerivedFrameHash(
    Object.fromEntries(
      Object.entries(v).filter(([k]) => k !== "geometrySha256"),
    ),
  );
export function provisionalCornerFootprint(
  face: [P2, P2],
  carrier: P2,
  target: P2,
  padding: number,
): Parts {
  const [a, b] = face,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy),
    gx = target[0] - carrier[0],
    gy = target[1] - carrier[1],
    gap = Math.hypot(gx, gy);
  if (
    !length ||
    !gap ||
    gap > 0.1 ||
    padding <= 0 ||
    padding > 0.0002 ||
    Math.abs(dx * gy - dy * gx) <= 0
  )
    throw Error("Invalid finite measured provisional corner span.");
  const u: [number, number] = [dx / length, dy / length],
    g: [number, number] = [gx / gap, gy / gap];
  const atA = JSON.stringify(carrier) === JSON.stringify(a),
    atB = JSON.stringify(carrier) === JSON.stringify(b);
  if (!atA && !atB)
    throw Error(
      "Provisional corner contact must be the original finite face endpoint.",
    );
  // Only the independently measured contact endpoint receives tangent padding.
  // The opposite original endpoint stays exact, preserving adjacent members.
  const ap = atA ? padding : 0,
    bp = atB ? padding : 0;
  return [
    [
      [
        [a[0] - ap * u[0] - padding * g[0], a[1] - ap * u[1] - padding * g[1]],
        [b[0] + bp * u[0] - padding * g[0], b[1] + bp * u[1] - padding * g[1]],
        [
          b[0] + gx + bp * u[0] + padding * g[0],
          b[1] + gy + bp * u[1] + padding * g[1],
        ],
        [
          a[0] + gx - ap * u[0] + padding * g[0],
          a[1] + gy - ap * u[1] + padding * g[1],
        ],
      ],
    ],
  ];
}
/** Explicit construction assumptions from finite original contacts. This helper
 * does not reuse, enlarge or certify the existing source-axis corner contract. */
export function reviewedFiniteContactFootprint(
  shape: NonNullable<
    NativeProvisionalCornerSeals["rows"][number]["reviewedConstructionShape"]
  >,
  padding: number,
): Parts {
  const [a, b] = shape.carrierFragmentFeet,
    [c, d] = shape.targetFragmentFeet;
  if (
    padding <= 0 ||
    padding > 0.0002 ||
    Math.max(
      Math.hypot(c[0] - a[0], c[1] - a[1]),
      Math.hypot(d[0] - b[0], d[1] - b[1]),
    ) >
      1 / 3
  )
    throw Error(
      "Reviewed finite construction span exceeds its separate bounded contract.",
    );
  if (shape.kind === "native-corner-points-bridge") {
    if (!same(a, b) || !same(c, d) || a[0] === c[0] || a[1] === c[1])
      throw Error(
        "Reviewed corner bridge must retain two distinct exact original corner contacts.",
      );
    return [
      [
        [
          [Math.min(a[0], c[0]) - padding, Math.min(a[1], c[1]) - padding],
          [Math.max(a[0], c[0]) + padding, Math.min(a[1], c[1]) - padding],
          [Math.max(a[0], c[0]) + padding, Math.max(a[1], c[1]) + padding],
          [Math.min(a[0], c[0]) - padding, Math.max(a[1], c[1]) + padding],
        ],
      ],
    ];
  }
  const u = shape.paddingDirectionFeet;
  if (
    Math.abs(Math.hypot(...u) - 1) > Number.EPSILON * 16 ||
    same(a, b) ||
    same(c, d) ||
    [
      [a, c],
      [b, d],
    ].some(
      ([x, y]) =>
        Math.abs((y[0] - x[0]) * u[1] - (y[1] - x[1]) * u[0]) >
        64 *
          Number.EPSILON *
          Math.max(1, ...x.map(Math.abs), ...y.map(Math.abs)),
    )
  )
    throw Error(
      "Reviewed finite contact endpoints are not on their declared construction direction.",
    );
  return [
    [
      [
        [a[0] - padding * u[0], a[1] - padding * u[1]],
        [b[0] - padding * u[0], b[1] - padding * u[1]],
        [d[0] + padding * u[0], d[1] + padding * u[1]],
        [c[0] + padding * u[0], c[1] + padding * u[1]],
      ],
    ],
  ];
}
export function validateNativeProvisionalCornerSeals(
  v: NativeProvisionalCornerSeals | undefined,
  model?: string,
) {
  if (v === undefined) return;
  if (
    !v ||
    v.version !== 1 ||
    !digest(v.sourceModelSha256) ||
    (model && model !== v.sourceModelSha256) ||
    !digest(v.sourceMaterialGeometrySha256) ||
    !digest(v.sourceWallPositionRepairsSha256) ||
    !digest(v.geometrySha256) ||
    !digest(v.completeOriginalPhysicalOwnerCensusSha256) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 1000 ||
    new Set(v.rows.map((r) => r.id)).size !== v.rows.length ||
    !Array.isArray(v.foreignBodies) ||
    v.foreignBodies.length > 100000 ||
    new Set(v.foreignBodies.map((b) => b.nativeElementId)).size !==
      v.foreignBodies.length
  )
    throw Error("Invalid provisional native corner source binding.");
  if (
    v.nonPhysicalCurtainHostNativeElementIds !== undefined &&
    v.nonPhysicalCurtainHostNativeElementIds.length &&
    !ids(v.nonPhysicalCurtainHostNativeElementIds)
  )
    throw Error("Invalid provisional corner original host census.");
  for (const b of v.foreignBodies)
    if (
      !Number.isSafeInteger(b.nativeElementId) ||
      b.nativeElementId <= 0 ||
      !point(b.boundsFeet?.min, 3) ||
      !point(b.boundsFeet?.max, 3) ||
      b.boundsFeet.min.some((x, i) => x > b.boundsFeet.max[i]) ||
      !digest(b.evidenceSha256) ||
      (b.partsFeet !== undefined && !parts(b.partsFeet))
    )
      throw Error("Invalid original provisional-corner foreign-body evidence.");
  for (const r of v.rows)
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      !Number.isSafeInteger(r.levelId) ||
      !Number.isFinite(r.elevationFeet) ||
      !Number.isFinite(r.baseElevationFeet) ||
      !Number.isFinite(r.topElevationFeet) ||
      r.topElevationFeet <= r.baseElevationFeet ||
      r.baseElevationFeet < r.elevationFeet ||
      !["proposed", "applied", "restored"].includes(r.state) ||
      !ids(r.carrierContactNativeElementIds) ||
      !Number.isSafeInteger(r.targetNativeElementId) ||
      r.carrierContactNativeElementIds.includes(r.targetNativeElementId) ||
      !Array.isArray(r.carrierContactFaceFeet) ||
      r.carrierContactFaceFeet.length !== 2 ||
      !r.carrierContactFaceFeet.every((p) => point(p)) ||
      !point(r.nearestCarrierContactFeet) ||
      !point(r.nearestTargetContactFeet) ||
      !parts(r.partsFeet) ||
      !ids(r.sourceFloorIds) ||
      !Array.isArray(r.sourceFloorBindings) ||
      !digest(r.sourceFloorPartsSha256) ||
      (r.materialRole !== undefined &&
        r.materialRole !== "enclosure-context-only") ||
      (r.reviewedConstructionShape !== undefined &&
        (r.materialRole !== "enclosure-context-only" ||
          ![
            "finite-face-fragment-bridge",
            "native-corner-points-bridge",
          ].includes(r.reviewedConstructionShape.kind) ||
          !digest(r.reviewedConstructionShape.evidenceSha256) ||
          r.reviewedConstructionShape.sourceAxisCertified !== false ||
          r.reviewedConstructionShape.sourceFullMemberWidthCertified !==
            false ||
          ![
            r.reviewedConstructionShape.carrierFragmentFeet,
            r.reviewedConstructionShape.targetFragmentFeet,
          ].every(
            (f) =>
              Array.isArray(f) && f.length === 2 && f.every((p) => point(p)),
          ) ||
          !point(r.reviewedConstructionShape.paddingDirectionFeet))) ||
      (r.sourceFloorOuterContext !== undefined &&
        (r.sourceFloorOuterContext.kind !==
          "original-native-floor-outer-edge" ||
          !digest(r.sourceFloorOuterContext.sourceFloorOuterPartsSha256) ||
          !digest(r.sourceFloorOuterContext.evidenceSha256) ||
          r.sourceFloorOuterContext.noWalkingMaterial !== true)) ||
      !digest(r.evidenceSha256) ||
      "literalAuthorization" in (r.assumption ?? {}) ||
      "statement" in (r.assumption ?? {}) ||
      r.assumption?.kind !== "human-authorized-construction-assumption" ||
      r.assumption.revisitRequired !== true ||
      r.assumption.sourceVerified !== false ||
      !digest(r.assumption.evidenceSha256) ||
      !digest(r.assumption.authorizationEvidenceSha256) ||
      typeof r.assumption.authorizationRecorded !== "boolean" ||
      (r.state === "applied" && r.assumption.authorizationRecorded !== true)
    )
      throw Error("Invalid explicit provisional native corner assumption.");
}
export function validateNativeProvisionalEnclosureBinding(data: Data) {
  const v = data.nativeProvisionalCornerSeals;
  for (const level of data.nativeIndoorEnvelopes?.levels ?? []) {
    if (
      level.provisionalCornerGeometrySha256 === undefined &&
      level.provisionalCornerIds === undefined
    )
      continue;
    const cuts = level.cutElevationsFeet ?? [];
    const bound = Array.isArray(level.provisionalCornerIds)
      ? level.provisionalCornerIds.map((id) => v?.rows.find((r) => r.id === id))
      : [];
    if (
      !v ||
      level.provisionalCornerGeometrySha256 !== v.geometrySha256 ||
      !Array.isArray(level.provisionalCornerIds) ||
      !level.provisionalCornerIds.length ||
      new Set(level.provisionalCornerIds).size !==
        level.provisionalCornerIds.length ||
      !cuts.length ||
      bound.some(
        (r) =>
          !r ||
          r.state !== "applied" ||
          !cuts.some((z) => z >= r.baseElevationFeet && z < r.topElevationFeet),
      )
    )
      throw Error(
        "Provisional native enclosure assumption is missing or stale.",
      );
  }
}
const distance = (p: P2, a: P2, b: P2) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l))
      : 0;
  return {
    point: [a[0] + t * dx, a[1] + t * dy] as P2,
    distance: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy),
  };
};
const segments = (ps: Parts) =>
  ps.flatMap((p) =>
    p.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]] as [P2, P2])),
  );
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function createNativeProvisionalCornerSealIndex(
  data: Data,
  options?: { reviewProposed?: boolean },
) {
  const v = data.nativeProvisionalCornerSeals;
  validateNativeProvisionalCornerSeals(v, data.source?.modelSha256);
  validateNativeProvisionalEnclosureBinding(data);
  if (!v)
    return {
      rows: [] as NativeProvisionalCornerSeals["rows"],
      partsAt: (_cut: number) => [] as { outer: P2[]; holes: P2[][] }[],
    };
  const material = data.nativeMaterialSections;
  if (
    v.geometrySha256 !== nativeProvisionalCornerSealsHash(v) ||
    !material ||
    material.sourceModelSha256 !== v.sourceModelSha256 ||
    v.sourceMaterialGeometrySha256 !== material.geometrySha256 ||
    material.geometrySha256 !==
      nativeDerivedFrameHash([
        material.version,
        material.sourceModelSha256,
        material.levels,
      ]) ||
    v.sourceWallPositionRepairsSha256 !==
      nativeDerivedFramePlacementHash(data.nativeWallPositionRepairs) ||
    v.completeOriginalPhysicalOwnerCensusSha256 !==
      nativeDerivedFrameHash(v.foreignBodies)
  )
    throw Error("Provisional native corner physical evidence changed.");
  const positiveBands = nativePositiveMaterialBandsAcrossLevels(
    material.levels,
  );
  const shifts = new Map(
    data.nativeWallPositionRepairs?.walls.map((r) => [
      r.nativeElementId,
      [
        r.ringsFeet[0][0][0] - r.originalRingsFeet[0][0][0],
        r.ringsFeet[0][0][1] - r.originalRingsFeet[0][0][1],
      ] as P2,
    ]) ?? [],
  );
  const census = new Map(v.foreignBodies.map((b) => [b.nativeElementId, b]));
  if (
    material.levels.some((l) =>
      l.sourceElementIds.some((id) => !census.has(id)),
    )
  )
    throw Error(
      "Provisional corner foreign physical-owner census is incomplete.",
    );
  const hostSkip = new Set<number>();
  for (const id of v.nonPhysicalCurtainHostNativeElementIds ?? []) {
    const hosts = material.levels
        .flatMap((l) => l.originalNativeHostRelations ?? [])
        .filter((h) => h.hostNativeElementId === id),
      assemblies = material.levels
        .flatMap((l) => l.sections)
        .filter(
          (s) =>
            s.nativeElementId === id &&
            s.sourceNativeHostRelationsVerified === true,
        );
    if (
      !census.has(id) ||
      !hosts.length ||
      !assemblies.length ||
      hosts.some(
        (h) =>
          h.memberNativeElementIds.some((x) => !census.has(x)) ||
          h.physicalDoorNativeElementIds.some((x) => !census.has(x)),
      ) ||
      assemblies.some((s) =>
        s.sourceAssemblyChildIds?.some((x) => !census.has(x)),
      )
    )
      throw Error(
        "Provisional corner nonphysical host lacks complete original physical children.",
      );
    hostSkip.add(id);
  }
  const finite = material.levels.flatMap(
    (l) => l.originalFiniteMaterialSections ?? [],
  );
  const rows = v.rows.filter(
    (r) =>
      r.state === "applied" ||
      (options?.reviewProposed && r.state === "proposed"),
  );
  for (const r of rows) {
    const contacts = [
        ...r.carrierContactNativeElementIds,
        r.targetNativeElementId,
      ],
      profiles = new Map<number, typeof finite>();
    for (const id of contacts) {
      const ps = finite.filter(
        (p) =>
          p.nativeElementId === id &&
          p.baseElevationFeet < r.topElevationFeet &&
          p.topElevationFeet > r.baseElevationFeet,
      );
      if (!ps.length || !census.has(id))
        throw Error(
          "Provisional corner has no independently original finite contact body.",
        );
      profiles.set(id, ps);
    }
    const carrierProfiles = r.carrierContactNativeElementIds.flatMap(
        (id) => profiles.get(id)!,
      ),
      targetProfiles = profiles.get(r.targetNativeElementId)!;
    const planes = [
      r.baseElevationFeet,
      r.topElevationFeet,
      ...carrierProfiles.flatMap((p) => [
        p.baseElevationFeet,
        p.topElevationFeet,
      ]),
      ...targetProfiles.flatMap((p) => [
        p.baseElevationFeet,
        p.topElevationFeet,
      ]),
    ]
      .filter((z) => z >= r.baseElevationFeet && z <= r.topElevationFeet)
      .sort((a, b) => a - b);
    const originalContactBands: Parts[] = [];
    for (let i = 1; i < planes.length; i++) {
      if (planes[i] === planes[i - 1]) continue;
      const z = (planes[i] + planes[i - 1]) / 2,
        cp = carrierProfiles.filter(
          (p) => p.baseElevationFeet <= z && p.topElevationFeet >= z,
        ),
        tp = targetProfiles.filter(
          (p) => p.baseElevationFeet <= z && p.topElevationFeet >= z,
        );
      if (r.reviewedConstructionShape) {
        const ownedContactParts = [...cp, ...tp].map((p) => p.partsFeet);
        if (!ownedContactParts.length)
          throw Error(
            "Reviewed construction has no finite original contact band.",
          );
        originalContactBands.push(
          pc.union(
            ownedContactParts[0],
            ...ownedContactParts.slice(1),
          ) as Parts,
        );
        const shape = r.reviewedConstructionShape;
        const fragments = [shape.carrierFragmentFeet, shape.targetFragmentFeet];
        const bind = (profile: (typeof finite)[number], fragment: [P2, P2]) => {
          const on = (p: P2) =>
            segments(profile.partsFeet).some(
              (e) =>
                distance(p, ...e).distance <=
                32 *
                  Number.EPSILON *
                  Math.max(1, ...p.map(Math.abs), ...e.flat().map(Math.abs)),
            );
          return (
            fragment.every(on) &&
            on([
              (fragment[0][0] + fragment[1][0]) / 2,
              (fragment[0][1] + fragment[1][1]) / 2,
            ])
          );
        };
        if (
          !cp.length ||
          !tp.length ||
          !cp.every((p) => bind(p, fragments[0])) ||
          !tp.every((p) => bind(p, fragments[1])) ||
          cp.some(
            (p) =>
              area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
          ) ||
          tp.some(
            (p) =>
              area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
          )
        )
          throw Error(
            "Reviewed construction does not retain positive complete finite original contact fragments: " +
              r.id +
              " " +
              JSON.stringify({
                z,
                carrierBindings: cp.map((p) => bind(p, fragments[0])),
                targetBindings: tp.map((p) => bind(p, fragments[1])),
                carrierContacts: cp.map((p) =>
                  area(pc.intersection(r.partsFeet, p.partsFeet) as Parts),
                ),
                targetContacts: tp.map((p) =>
                  area(pc.intersection(r.partsFeet, p.partsFeet) as Parts),
                ),
              }),
          );
        if (
          shape.kind === "native-corner-points-bridge" &&
          (!cp.every((p) =>
            p.partsFeet.flat(2).some((q) => same(q, fragments[0][0])),
          ) ||
            !tp.every((p) =>
              p.partsFeet.flat(2).some((q) => same(q, fragments[1][0])),
            ))
        )
          throw Error(
            "Reviewed point bridge is not bound to exact original finite corner vertices.",
          );
        if (shape.kind === "finite-face-fragment-bridge") {
          const u = shape.paddingDirectionFeet;
          for (let k = 0; k < 2; k++) {
            const a = fragments[0][k],
              wanted = fragments[1][k];
            for (const profile of tp) {
              const hits = segments(profile.partsFeet)
                .flatMap(([c, d]) => {
                  const vx = d[0] - c[0],
                    vy = d[1] - c[1],
                    den = u[0] * vy - u[1] * vx;
                  if (!den) return [];
                  const cx = c[0] - a[0],
                    cy = c[1] - a[1];
                  const t = (cx * vy - cy * vx) / den,
                    q = (cx * u[1] - cy * u[0]) / den;
                  const round =
                    (64 *
                      Number.EPSILON *
                      Math.max(
                        1,
                        ...a.map(Math.abs),
                        ...c.map(Math.abs),
                        ...d.map(Math.abs),
                      )) /
                    Math.hypot(vx, vy);
                  return t >= 0 && q >= -round && q <= 1 + round
                    ? [
                        [
                          c[0] + Math.max(0, Math.min(1, q)) * vx,
                          c[1] + Math.max(0, Math.min(1, q)) * vy,
                        ] as P2,
                      ]
                    : [];
                })
                .sort(
                  (c, d) =>
                    Math.hypot(c[0] - a[0], c[1] - a[1]) -
                    Math.hypot(d[0] - a[0], d[1] - a[1]),
                );
              const first = hits[0];
              if (
                !first ||
                first.some(
                  (x, j) =>
                    Math.abs(x - wanted[j]) >
                    64 *
                      Number.EPSILON *
                      Math.max(1, Math.abs(x), Math.abs(wanted[j])),
                )
              )
                throw Error(
                  "Reviewed partial bridge does not end at the first actual finite target face.",
                );
            }
          }
        } else {
          for (const c of cp)
            for (const t of tp) {
              const gaps = segments(c.partsFeet)
                .flatMap((e) =>
                  segments(t.partsFeet).flatMap((f) => [
                    ...e.map((a) => ({
                      a,
                      b: distance(a, ...f).point,
                      d: distance(a, ...f).distance,
                    })),
                    ...f.map((b) => ({
                      a: distance(b, ...e).point,
                      b,
                      d: distance(b, ...e).distance,
                    })),
                  ]),
                )
                .sort((a, b) => a.d - b.d);
              const nearest = gaps[0];
              if (
                !nearest ||
                !same(nearest.a, fragments[0][0]) ||
                !same(nearest.b, fragments[1][0])
              )
                throw Error(
                  "Reviewed point bridge is not the nearest actual original finite corner contact.",
                );
            }
        }
        continue;
      }
      if (
        !cp.length ||
        !tp.length ||
        !cp.every((p) =>
          segments(p.partsFeet).some(
            (e) =>
              same(e, r.carrierContactFaceFeet) ||
              same([...e].reverse(), r.carrierContactFaceFeet),
          ),
        )
      )
        throw Error(
          "Provisional seal is not bound to the complete finite original contact faces.",
        );
      const targetEdges = tp.flatMap((p) => segments(p.partsFeet));
      const candidates = targetEdges
          .flatMap((e) => {
            const aa = distance(r.carrierContactFaceFeet[0], ...e),
              bb = distance(r.carrierContactFaceFeet[1], ...e);
            const cc = distance(e[0], ...r.carrierContactFaceFeet),
              dd = distance(e[1], ...r.carrierContactFaceFeet);
            return [
              { a: r.carrierContactFaceFeet[0], b: aa.point, d: aa.distance },
              { a: r.carrierContactFaceFeet[1], b: bb.point, d: bb.distance },
              { a: cc.point, b: e[0], d: cc.distance },
              { a: dd.point, b: e[1], d: dd.distance },
            ];
          })
          .sort((a, b) => a.d - b.d),
        nearest = candidates[0];
      if (
        !nearest ||
        !same(nearest.a, r.nearestCarrierContactFeet) ||
        !same(nearest.b, r.nearestTargetContactFeet)
      )
        throw Error(
          "Provisional native corner is not the current first measured original contact.",
        );
      if (
        cp.some(
          (p) => area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
        ) ||
        tp.some(
          (p) => area(pc.intersection(r.partsFeet, p.partsFeet) as Parts) <= 0,
        )
      )
        throw Error(
          "Provisional native corner lacks positive finite source contacts.",
        );
    }
    const expected = r.reviewedConstructionShape
      ? reviewedFiniteContactFootprint(
          r.reviewedConstructionShape,
          r.contactPaddingFeet,
        )
      : provisionalCornerFootprint(
          r.carrierContactFaceFeet,
          r.nearestCarrierContactFeet,
          r.nearestTargetContactFeet,
          r.contactPaddingFeet,
        );
    if (area(pc.xor(expected, r.partsFeet) as Parts) > 0)
      throw Error(
        "Provisional corner geometry changed from its declared measured native faces.",
      );
    const floors =
      data.walkingSupport?.sourceModelSha256 === v.sourceModelSha256
        ? data.walkingSupport.floors
            .filter((f) => r.sourceFloorIds.includes(f.nativeElementId))
            .map((f) => ({
              nativeElementId: f.nativeElementId,
              elevationFeet: f.elevationFeet,
              partsFeet: f.partsFeet ?? [f.ringsFeet],
            }))
        : [];
    if (
      floors.length !== r.sourceFloorIds.length ||
      !same(floors, r.sourceFloorBindings) ||
      nativeDerivedFrameHash(floors) !== r.sourceFloorPartsSha256 ||
      floors.some((f) => Math.abs(f.elevationFeet - r.elevationFeet) > 0.05) ||
      (!r.sourceFloorOuterContext &&
        r.partsFeet.some(
          (p) =>
            exactNativeDoorFloorDifference(
              p,
              floors.flatMap((f) => f.partsFeet),
            ).length,
        ))
    )
      throw Error(
        "Provisional corner crosses unsupported native floor or an original opening.",
      );
    if (r.sourceFloorOuterContext) {
      const full = floors.flatMap((f) => f.partsFeet);
      const outer = full.map((p) => [p[0]]) as Parts;
      const holes = pc.difference(outer, full) as Parts;
      const unsupported = r.partsFeet.flatMap((p) =>
        exactNativeDoorFloorDifference(p, full),
      ) as Parts;
      if (
        nativeDerivedFrameHash(outer) !==
          r.sourceFloorOuterContext.sourceFloorOuterPartsSha256 ||
        !unsupported.length ||
        area(pc.intersection(unsupported, outer) as Parts) > 0 ||
        area(pc.intersection(r.partsFeet, holes) as Parts) > 0
      )
        throw Error(
          "Provisional context must lie only beyond original floor outer edges, never an inner aperture.",
        );
    }
    const ps = r.partsFeet.flat(2),
      box = {
        min: [
          Math.min(...ps.map((p) => p[0])),
          Math.min(...ps.map((p) => p[1])),
          r.baseElevationFeet,
        ],
        max: [
          Math.max(...ps.map((p) => p[0])),
          Math.max(...ps.map((p) => p[1])),
          r.topElevationFeet,
        ],
      };
    // Only the new explicitly reviewed construction contract may subtract
    // material already occupied by independently original contact bodies at
    // EVERY finite-height band. Physical foreign members are never exempted
    // by common host alone. The approved older corner behavior stays unchanged.
    const commonOriginalContacts = originalContactBands.length
      ? originalContactBands
          .slice(1)
          .reduce(
            (common, p) => pc.intersection(common, p) as Parts,
            originalContactBands[0],
          )
      : [];
    const foreignFoot = r.reviewedConstructionShape
      ? (pc.difference(r.partsFeet, commonOriginalContacts) as Parts)
      : r.partsFeet;
    for (const band of positiveBands) {
      if (
        !contacts.includes(band.nativeElementId) &&
        !hostSkip.has(band.nativeElementId) &&
        band.baseElevationFeet < r.topElevationFeet &&
        band.topElevationFeet > r.baseElevationFeet &&
        nativePositiveMaterialBandOverlapsParts(
          band,
          foreignFoot,
          shifts.get(band.nativeElementId) ?? [0, 0],
        )
      )
        throw Error(
          "Provisional corner intersects exact positive original foreign material: " +
            r.id +
            " owner " +
            band.nativeElementId,
        );
    }
    for (const b of v.foreignBodies) {
      if (
        contacts.includes(b.nativeElementId) ||
        hostSkip.has(b.nativeElementId) ||
        (r.reviewedConstructionShape &&
          (b.boundsFeet.max[2] <= r.baseElevationFeet ||
            b.boundsFeet.min[2] >= r.topElevationFeet)) ||
        b.boundsFeet.max.some((x, i) => x < box.min[i]) ||
        b.boundsFeet.min.some((x, i) => x > box.max[i])
      )
        continue;
      if (
        !b.partsFeet ||
        area(pc.intersection(foreignFoot, b.partsFeet) as Parts) > 0
      )
        throw Error(
          "Provisional corner intersects unknown or actual original foreign material: " +
            r.id +
            " owner " +
            b.nativeElementId,
        );
    }
    for (const door of data.doors ?? []) {
      const e = data.edges?.find((e) => e.id === door.id);
      if (
        e?.enabled &&
        e.kind === "door" &&
        door.footprintFeet &&
        e.pointsFeet.some(
          (p) => p[2] >= r.baseElevationFeet && p[2] <= r.topElevationFeet,
        ) &&
        area(pc.intersection(r.partsFeet, [door.footprintFeet]) as Parts) > 0
      )
        throw Error(
          "Provisional corner intersects a preserved physical doorway.",
        );
    }
  }
  return {
    rows,
    partsAt: (cut: number) =>
      rows
        .filter(
          (r) =>
            r.state === "applied" &&
            !r.sourceFloorOuterContext &&
            !r.materialRole &&
            r.baseElevationFeet <= cut &&
            r.topElevationFeet > cut,
        )
        .flatMap((r) =>
          r.partsFeet.map((p) => ({ outer: p[0], holes: p.slice(1) })),
        ),
  };
}
export async function verifyNativeProvisionalCornerSeals(data: Data) {
  createNativeProvisionalCornerSealIndex(data);
}
