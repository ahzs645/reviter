/** Additive positive subsets of an independently bounded native affine body.
 * These never certify complete owner geometry or absence. */
type Point = [number, number];
type FractionPair = [string, string];
export type NativePositiveMaterialBand = {
  nativeElementId: number;
  categoryId: number;
  kind: "wall" | "window" | "column";
  baseElevationFeet: number;
  topElevationFeet: number;
  sourceBandBaseExactFraction: string;
  sourceBandTopExactFraction: string;
  positiveSubsetOnly: true;
  profileRule: "exact-common-contained-profile-of-affine-band";
  originalOwnedBodySha256: string;
  originalFaceLoopEvidenceSha256: string;
  independentContainmentProofSha256: string;
  evidenceSha256: string;
  cells: {
    partsFeet: Point[][][];
    sourceLowerProfileExactFractions: FractionPair[];
    sourceUpperProfileExactFractions: FractionPair[];
    sourceSurfaceEnvelopeHalfspacesExactFractions: [string, string, string][];
  }[];
};
type Q = [bigint, bigint];
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const rational = (n: bigint, d: bigint): Q => {
  if (!d) throw new Error("Zero exact native material denominator.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return [n / g, d / g];
};
const add = (a: Q, b: Q): Q => rational(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a: Q, b: Q): Q => rational(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q): Q => rational(a[0] * b[0], a[1] * b[1]);
const div = (a: Q, b: Q): Q => rational(a[0] * b[1], a[1] * b[0]);
const nonnegative = (a: Q) => a[0] >= 0n;
const parse = (v: string): Q => {
  if (typeof v !== "string" || v.length > 512 || !/^-?\d+(?:\/\d+)?$/.test(v))
    throw new Error("Invalid exact native positive-material constraint.");
  const [n, d = "1"] = v.split("/");
  const q: Q = [BigInt(n), BigInt(d)];
  if (q[1] <= 0n)
    throw new Error("Invalid exact native positive-material denominator.");
  return q;
};
const ieee = (n: number): Q => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, n);
  const bits = b.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  let numerator = (exponent ? 1n << 52n : 0n) + fraction;
  const shift = (exponent ? exponent - 1023 : -1022) - 52;
  if (bits >> 63n) numerator = -numerator;
  return shift >= 0
    ? [numerator << BigInt(shift), 1n]
    : [numerator, 1n << BigInt(-shift)];
};
const side = (a: Q[], b: Q[], p: Q[]) =>
  sub(
    mul(sub(b[0], a[0]), sub(p[1], a[1])),
    mul(sub(b[1], a[1]), sub(p[0], a[0])),
  );
const convex = (ring: Q[][]) => {
  if (ring.length < 3 || ring.length > 128)
    throw new Error("Invalid bounded native positive-material ring.");
  let area: Q = [0n, 1n];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    area = add(area, sub(mul(a[0], b[1]), mul(b[0], a[1])));
    if (ring.some((p) => !nonnegative(side(a, b, p))))
      throw new Error(
        "Native positive material must preserve its convex contained source cell.",
      );
  }
  if (area[0] <= 0n)
    throw new Error("Native positive material has no exact positive area.");
};
const digest = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateNativePositiveMaterialBand(
  b: NativePositiveMaterialBand,
) {
  if (
    !b ||
    !Number.isSafeInteger(b.nativeElementId) ||
    b.nativeElementId <= 0 ||
    !Number.isSafeInteger(b.categoryId) ||
    !["wall", "window", "column"].includes(b.kind) ||
    !Number.isFinite(b.baseElevationFeet) ||
    !Number.isFinite(b.topElevationFeet) ||
    b.topElevationFeet <= b.baseElevationFeet ||
    b.positiveSubsetOnly !== true ||
    b.profileRule !== "exact-common-contained-profile-of-affine-band" ||
    ![
      b.originalOwnedBodySha256,
      b.originalFaceLoopEvidenceSha256,
      b.independentContainmentProofSha256,
      b.evidenceSha256,
    ].every(digest) ||
    !Array.isArray(b.cells) ||
    !b.cells.length ||
    b.cells.length > 128
  )
    throw new Error("Invalid additive positive native material authority.");
  const sourceBase = parse(b.sourceBandBaseExactFraction),
    sourceTop = parse(b.sourceBandTopExactFraction);
  if (
    !nonnegative(sub(ieee(b.baseElevationFeet), sourceBase)) ||
    !nonnegative(sub(sourceTop, ieee(b.topElevationFeet))) ||
    sub(sourceTop, sourceBase)[0] <= 0n
  )
    throw new Error(
      "Published native positive interval exceeds its original critical heights.",
    );
  for (const c of b.cells) {
    if (
      !Array.isArray(c.sourceLowerProfileExactFractions) ||
      !Array.isArray(c.sourceUpperProfileExactFractions) ||
      !Array.isArray(c.sourceSurfaceEnvelopeHalfspacesExactFractions) ||
      !c.sourceSurfaceEnvelopeHalfspacesExactFractions.length ||
      c.sourceSurfaceEnvelopeHalfspacesExactFractions.length > 512 ||
      !Array.isArray(c.partsFeet) ||
      c.partsFeet.length !== 1 ||
      c.partsFeet[0].length !== 1
    )
      throw new Error("Invalid exact source-domain positive material cell.");
    const source = [
      c.sourceLowerProfileExactFractions,
      c.sourceUpperProfileExactFractions,
    ].map((r) =>
      r.map((p) => {
        if (!Array.isArray(p) || p.length !== 2)
          throw new Error("Invalid source positive material vertex.");
        return p.map(parse);
      }),
    );
    source.forEach(convex);
    const domains = c.sourceSurfaceEnvelopeHalfspacesExactFractions.map((h) => {
      if (!Array.isArray(h) || h.length !== 3)
        throw new Error("Invalid native surface-domain halfspace.");
      return h.map(parse);
    });
    const ring = c.partsFeet[0][0];
    if (
      !Array.isArray(ring) ||
      ring.length < 4 ||
      ring.length > 129 ||
      ring.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7),
      ) ||
      ring[0][0] !== ring.at(-1)![0] ||
      ring[0][1] !== ring.at(-1)![1]
    )
      throw new Error("Invalid published positive native cell.");
    const points = ring.slice(0, -1).map((p) => p.map(ieee));
    convex(points);
    for (const p of points) {
      if (
        source.some((r) =>
          r.some((a, i) => !nonnegative(side(a, r[(i + 1) % r.length], p))),
        ) ||
        domains.some(
          (h) => !nonnegative(add(add(mul(h[0], p[0]), mul(h[1], p[1])), h[2])),
        )
      )
        throw new Error(
          "Published native positive material leaves original trim or surface-domain authority.",
        );
    }
  }
}
/** A constant guaranteed core of a varying body, not either endpoint profile.
 * Exact finite membership is required for every actual requested cut. */
export function nativePositiveMaterialBandPartsAt(
  b: NativePositiveMaterialBand,
  cut: number,
): [number, number][][][] {
  if (!Number.isFinite(cut))
    throw new Error("Native positive material cut must be finite.");
  return cut >= b.baseElevationFeet && cut < b.topElevationFeet
    ? b.cells.flatMap((c) => c.partsFeet)
    : [];
}

/** Exact IEEE input arrangement: clip each oriented outer/hole ring against a
 * convex positive source cell, then subtract exact hole area. Clipped concave
 * rings can include cancelling boundary bridges; their signed integral still
 * preserves every disconnected intersection. No floating area cutoff or noding. */
export function exactPositiveConvexMaterialOverlap(
  cell: Point[],
  parts: Point[][][],
): boolean {
  const points = (r: Point[]) => {
    if (r.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n))))
      throw new Error("Invalid finite exact material intersection vertex.");
    const q = r.map((p) => p.map(ieee));
    if (q.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1])
      q.pop();
    return q;
  };
  const twiceArea = (r: Q[][]): Q =>
    r.reduce(
      (a, p, i) => {
        const b = r[(i + 1) % r.length];
        return add(a, sub(mul(p[0], b[1]), mul(b[0], p[1])));
      },
      [0n, 1n] as Q,
    );
  let boundary = points(cell);
  const orientation = twiceArea(boundary);
  if (!orientation[0])
    throw new Error("Exact positive material cell has zero area.");
  if (orientation[0] < 0n) boundary = boundary.reverse();
  convex(boundary);
  const clippedArea = (ring: Point[]): Q => {
    let subject = points(ring);
    for (let i = 0; i < boundary.length && subject.length; i++) {
      const a = boundary[i],
        b = boundary[(i + 1) % boundary.length];
      const next: Q[][] = [];
      for (let j = 0; j < subject.length; j++) {
        const p = subject[j],
          q = subject[(j + 1) % subject.length];
        const dp = side(a, b, p),
          dq = side(a, b, q);
        const pin = nonnegative(dp),
          qin = nonnegative(dq);
        if (pin) next.push(p);
        if (pin !== qin) {
          const t = div(dp, sub(dp, dq));
          next.push([
            add(p[0], mul(t, sub(q[0], p[0]))),
            add(p[1], mul(t, sub(q[1], p[1]))),
          ]);
        }
      }
      subject = next;
    }
    const area = twiceArea(subject);
    return area[0] < 0n ? [-area[0], area[1]] : area;
  };
  for (const p of parts) {
    if (!p.length) continue;
    const area = p
      .slice(1)
      .reduce((a, hole) => sub(a, clippedArea(hole)), clippedArea(p[0]));
    if (area[0] < 0n)
      throw new Error(
        "Exact material intersection has invalid outer/hole topology.",
      );
    if (area[0] > 0n) return true;
  }
  return false;
}
/** Metadata may occur on multiple cut rows. It remains positive subset evidence,
 * independent of the complete evaluated-owner census and nominal level. */
export function nativePositiveMaterialBandsAcrossLevels(
  levels: { originalPositiveMaterialBands?: NativePositiveMaterialBand[] }[],
): NativePositiveMaterialBand[] {
  const unique = new Map<string, NativePositiveMaterialBand>();
  for (const level of levels)
    for (const band of level.originalPositiveMaterialBands ?? []) {
      const key = JSON.stringify(band);
      if (!unique.has(key)) {
        validateNativePositiveMaterialBand(band);
        unique.set(key, band);
      }
    }
  return [...unique.values()];
}
export function nativePositiveMaterialBandOverlapsParts(
  band: NativePositiveMaterialBand,
  parts: Point[][][],
  shift: Point = [0, 0],
): boolean {
  return band.cells.some((c) => {
    const ring = c.partsFeet[0][0].map(
      (p) => [p[0] + shift[0], p[1] + shift[1]] as Point,
    );
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const local = parts.filter(
      (p) =>
        p[0].some(
          (q) => q[0] <= maxX && q[0] >= minX && q[1] <= maxY && q[1] >= minY,
        ) ||
        !(
          Math.max(...p[0].map((q) => q[0])) < minX ||
          Math.min(...p[0].map((q) => q[0])) > maxX ||
          Math.max(...p[0].map((q) => q[1])) < minY ||
          Math.min(...p[0].map((q) => q[1])) > maxY
        ),
    );
    return local.length > 0 && exactPositiveConvexMaterialOverlap(ring, local);
  });
}
