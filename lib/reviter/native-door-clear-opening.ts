import type { IndoorDataset } from "./indoor-contract";
export type NativeDoorClearOpeningProfile = {
  nativeDoorElementId: number;
  hostWallNativeElementId: number;
  sourceMemberNativeElementIds: number[];
  sourceBodyBaseFeet: number;
  sourceBodyTopFeet: number;
  originalJambPartsFeet: [number, number][][][];
  sourceOwnedBodySha256: string;
  sourceFaceTokens: number[];
  evidenceSha256: string;
};
type Point = [number, number];
const digest = (s: unknown) =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export function validateNativeDoorClearOpeningProfile(
  p: NativeDoorClearOpeningProfile,
) {
  if (
    !p ||
    !Number.isSafeInteger(p.nativeDoorElementId) ||
    p.nativeDoorElementId <= 0 ||
    !Number.isSafeInteger(p.hostWallNativeElementId) ||
    p.hostWallNativeElementId <= 0 ||
    !Array.isArray(p.sourceMemberNativeElementIds) ||
    !p.sourceMemberNativeElementIds.includes(p.nativeDoorElementId) ||
    p.sourceMemberNativeElementIds.length > 1000 ||
    new Set(p.sourceMemberNativeElementIds).size !==
      p.sourceMemberNativeElementIds.length ||
    p.sourceMemberNativeElementIds.some(
      (n) => !Number.isSafeInteger(n) || n <= 0,
    ) ||
    !Number.isFinite(p.sourceBodyBaseFeet) ||
    !Number.isFinite(p.sourceBodyTopFeet) ||
    p.sourceBodyTopFeet <= p.sourceBodyBaseFeet ||
    !digest(p.sourceOwnedBodySha256) ||
    !digest(p.evidenceSha256) ||
    !Array.isArray(p.sourceFaceTokens) ||
    !p.sourceFaceTokens.length ||
    p.sourceFaceTokens.length > 100000 ||
    new Set(p.sourceFaceTokens).size !== p.sourceFaceTokens.length ||
    p.sourceFaceTokens.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Array.isArray(p.originalJambPartsFeet) ||
    p.originalJambPartsFeet.length !== 4 ||
    p.originalJambPartsFeet.some(
      (q) =>
        !Array.isArray(q) ||
        q.length !== 1 ||
        q[0].length !== 4 ||
        new Set(q[0].map((v) => v?.join(","))).size !== 4 ||
        q[0].some(
          (x) =>
            !Array.isArray(x) ||
            x.length !== 2 ||
            x.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7),
        ),
    )
  )
    throw new Error(
      "Invalid independently recovered original doorway jamb profile.",
    );
}
/** Recompute the clear width from four finite original jamb faces. No stored
 * body/portal is changed and no floor geometry participates in this derivation.
 * Only the independently recovered ankle cut can narrow an outer frame box. */
export function nativeDoorClearOpening(
  data: IndoorDataset,
  door: NonNullable<IndoorDataset["doors"]>[number],
  z: number,
): Point[] | undefined {
  const mat = data.nativeMaterialSections;
  if (
    !mat ||
    mat.sourceModelSha256 !== data.source.modelSha256 ||
    !door.normalFeet ||
    !door.footprintFeet
  )
    return;
  const rows = mat.levels.filter(
    (r) =>
      Math.abs(r.elevationFeet - z) < 0.05 &&
      Math.abs(r.cutElevationFeet - (z + 0.1)) < 1e-6,
  );
  const profiles = rows.flatMap((r) =>
    (r.originalDoorClearOpeningProfiles ?? [])
      .filter((p) => p.nativeDoorElementId === door.nativeElementId)
      .map((p) => ({ p, r })),
  );
  if (
    !profiles.length ||
    new Set(profiles.map(({ p }) => p.hostWallNativeElementId)).size !== 1
  )
    return;
  let result: Point[] | undefined;
  for (const { p, r } of profiles) {
    try {
      validateNativeDoorClearOpeningProfile(p);
    } catch {
      return;
    }
    if (
      (door.hostWallNativeElementId !== undefined &&
        p.hostWallNativeElementId !== door.hostWallNativeElementId) ||
      z + 0.1 < p.sourceBodyBaseFeet ||
      z + 0.1 >= p.sourceBodyTopFeet ||
      !r.originalNativeHostRelations?.some(
        (h) =>
          h.hostNativeElementId === p.hostWallNativeElementId &&
          h.physicalDoorNativeElementIds.includes(p.nativeDoorElementId),
      )
    )
      return;
    const length = Math.hypot(...door.normalFeet),
      origin = door.pointFeet;
    if (!length || !origin) return;
    const n: Point = [door.normalFeet[0] / length, door.normalFeet[1] / length],
      t: Point = [-n[1], n[0]];
    const project = (v: Point, axis: Point) =>
      (v[0] - origin[0]) * axis[0] + (v[1] - origin[1]) * axis[1];
    // This bound only recognizes analytical parallel/identical source faces;
    // it neither closes source gaps nor extends the derived clear opening.
    const eps =
      8 *
      Number.EPSILON *
      Math.max(
        1,
        ...door.footprintFeet.flat().map(Math.abs),
        ...p.originalJambPartsFeet.flat(2).flat().map(Math.abs),
      );
    const boxes = p.originalJambPartsFeet.map((q) => {
      const vs = q[0],
        ns = vs.map((v) => project(v, n)),
        ts = vs.map((v) => project(v, t));
      return {
        vs,
        ns,
        ts,
        n0: Math.min(...ns),
        n1: Math.max(...ns),
        t0: Math.min(...ts),
        t1: Math.max(...ts),
      };
    });
    if (
      boxes.some(
        (b) =>
          b.n1 <= b.n0 ||
          b.t1 <= b.t0 ||
          new Set(
            b.ns.map(
              (x, i) =>
                `${Math.abs(x - b.n0) <= eps ? 0 : 1}:${Math.abs(b.ts[i] - b.t0) <= eps ? 0 : 1}`,
            ),
          ).size !== 4 ||
          b.ns.some(
            (x) => Math.min(Math.abs(x - b.n0), Math.abs(x - b.n1)) > eps,
          ) ||
          b.ts.some(
            (x) => Math.min(Math.abs(x - b.t0), Math.abs(x - b.t1)) > eps,
          ),
      )
    )
      return;
    const low = boxes.filter((b) => b.t1 < 0),
      high = boxes.filter((b) => b.t0 > 0);
    if (low.length !== 2 || high.length !== 2) return;
    const lo = Math.max(...low.map((b) => b.t1)),
      hi = Math.min(...high.map((b) => b.t0));
    if (
      hi <= lo ||
      Math.max(...low.map((b) => b.t1)) - Math.min(...low.map((b) => b.t1)) >
        eps ||
      Math.max(...high.map((b) => b.t0)) - Math.min(...high.map((b) => b.t0)) >
        eps
    )
      return;
    const ns = door.footprintFeet.map((v) => project(v, n)),
      n0 = Math.min(...ns),
      n1 = Math.max(...ns);
    if (
      ![low, high].every(
        (bs) =>
          bs.some((b) => Math.abs(b.n0 - n0) <= eps) &&
          bs.some((b) => Math.abs(b.n1 - n1) <= eps),
      )
    )
      return;
    // Sutherland-Hodgman half-plane clipping along original inner jamb faces.
    const clip = (ring: Point[], bound: number, greater: boolean) => {
      const out: Point[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          av = project(a, t),
          bv = project(b, t),
          ai = greater ? av >= bound : av <= bound,
          bi = greater ? bv >= bound : bv <= bound;
        if (ai) out.push(a);
        if (ai !== bi) {
          const u = (bound - av) / (bv - av);
          out.push([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]);
        }
      }
      return out;
    };
    const clipped = clip(clip(door.footprintFeet, lo, true), hi, false);
    if (clipped.length < 3) return;
    if (result && JSON.stringify(result) !== JSON.stringify(clipped)) return;
    result = clipped;
  }
  return result;
}
