import * as DMath from "./deterministic-math.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  nativeRationalScalarToIEEE,
  NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay";
import {
  add as a,
  sub as s,
  mul as m,
  div as d,
  compare,
} from "./vendor/native-rational-overlay-arithmetic.mjs";

type P = NativeRationalPoint;
type N = [number, number];
export type NativeContainedDisplayParts = N[][][];
export const NATIVE_CONTAINED_DISPLAY_VERSION =
  "exact-vertical-cells-contained-render-v1";
export interface NativeContainedDisplay {
  /** Drawing only. Source booleans, hit tests and routing retain exactParts. */
  partsFeet: NativeContainedDisplayParts;
  exactParts: NativeRationalParts;
  /** Every positive portion absent from partsFeet, with no size cutoff. */
  exactResidualParts: NativeRationalParts;
  unchangedIEEEAnchorsFeet: N[];
  faces: {
    sourcePartIndex: number;
    exactCells: number;
    numericPieces: number;
    unrepresentablePositiveCells: number;
    exactResidualParts: number;
    numericPieceStartIndex: number;
    exactResidualStartIndex: number;
    unchangedIEEEAnchorsFeet: N[];
  }[];
  certificate: {
    version: string;
    kernelVersion: string;
    renderOnly: true;
    exactDecompositionEqualsSource: true;
    numericOutsideSourceEmpty: true;
    completeExactAuthorityRetained: true;
    positiveResidualsRetained: true;
    originalIEEEAnchorsUnchanged: true;
    maximumGeneratedMovementFeet: number;
  };
}
const add = (x: Rational, y: Rational) => rational(a(x, y));
const sub = (x: Rational, y: Rational) => rational(s(x, y));
const mul = (x: Rational, y: Rational) => rational(m(x, y));
const div = (x: Rational, y: Rational) => rational(d(x, y));
const eq = (x: Rational, y: Rational) => compare(x, y) === 0;
const key = (x: Rational) => `${x.n}/${x.d}`;
const same = (x: P, y: P) => eq(x[0], y[0]) && eq(x[1], y[1]);
const side = (x: P, y: P, p: P) =>
  sub(
    mul(sub(y[0], x[0]), sub(p[1], x[1])),
    mul(sub(y[1], x[1]), sub(p[0], x[0])),
  );
const area = (ring: P[]) =>
  ring.reduce(
    (sum, p, i) =>
      add(
        sum,
        sub(
          mul(p[0], ring[(i + 1) % ring.length][1]),
          mul(ring[(i + 1) % ring.length][0], p[1]),
        ),
      ),
    rational(0),
  );
const ieee = new DataView(new ArrayBuffer(8));
function adjacent(x: number, direction: 1 | -1) {
  if (x === 0) return direction * Number.MIN_VALUE;
  ieee.setFloat64(0, x, false);
  let bits = ieee.getBigUint64(0, false);
  bits += (x > 0 ? direction : -direction) === 1 ? 1n : -1n;
  ieee.setBigUint64(0, bits, false);
  return ieee.getFloat64(0, false);
}
function neighbors(x: number) {
  const out = [x];
  let lo = x,
    hi = x;
  for (let i = 0; i < 4; i++) {
    lo = adjacent(lo, -1);
    hi = adjacent(hi, 1);
    out.push(lo, hi);
  }
  return out;
}

/** Exact parity cells, with adjacent slabs coalesced only when the same two
 * original finite edges bound them. Artificial grids and numeric triangulation
 * are not used. Both exact differences must be empty before any display. */
function verticalCells(part: P[][]): NativeRationalParts {
  const edges: { a: P; b: P }[] = [];
  const events = new Map<
    string,
    { x: Rational; add: number[]; remove: number[] }
  >();
  const event = (x: Rational) => {
    const k = key(x);
    let ev = events.get(k);
    if (!ev) {
      ev = { x, add: [], remove: [] };
      events.set(k, ev);
    }
    return ev;
  };
  for (const input of part) {
    const ring =
      input.length > 1 && same(input[0], input[input.length - 1])
        ? input.slice(0, -1)
        : input;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length];
      if (eq(p[0], q[0])) {
        event(p[0]);
        continue;
      }
      const id = edges.length;
      edges.push({ a: p, b: q });
      const forwards = compare(p[0], q[0]) < 0;
      event(forwards ? p[0] : q[0]).add.push(id);
      event(forwards ? q[0] : p[0]).remove.push(id);
    }
  }
  const y = (id: number, x: Rational) => {
    const e = edges[id];
    return add(
      e.a[1],
      div(mul(sub(x, e.a[0]), sub(e.b[1], e.a[1])), sub(e.b[0], e.a[0])),
    );
  };
  type Cell = { lo: Rational; hi: Rational; lower: number; upper: number };
  const cells: NativeRationalParts = [],
    open = new Map<string, Cell>(),
    active = new Set<number>();
  const close = (c: Cell) => {
    const ring: P[] = [
      [c.lo, y(c.lower, c.lo)],
      [c.hi, y(c.lower, c.hi)],
      [c.hi, y(c.upper, c.hi)],
      [c.lo, y(c.upper, c.lo)],
    ];
    if (
      compare(ring[1][1], ring[2][1]) > 0 ||
      compare(ring[0][1], ring[3][1]) > 0
    )
      throw Error("Source boundaries cross inside an exact display cell");
    const clean = ring.filter((p, i) => i === 0 || !same(p, ring[i - 1]));
    if (clean.length > 1 && same(clean[0], clean[clean.length - 1]))
      clean.pop();
    if (clean.length < 3 || compare(area(clean), rational(0)) === 0) return;
    clean.push(clean[0]);
    cells.push([clean]);
  };
  const ordered = [...events.values()].sort((x, y) => compare(x.x, y.x));
  for (let i = 0; i < ordered.length - 1; i++) {
    const ev = ordered[i],
      next = ordered[i + 1];
    for (const id of ev.remove) active.delete(id);
    for (const id of ev.add) active.add(id);
    const mid = div(add(ev.x, next.x), rational(2));
    const crossings = [...active]
      .map((id) => ({ id, y: y(id, mid) }))
      .sort((x, y) => compare(x.y, y.y) || x.id - y.id);
    const boundaries: typeof crossings = [];
    for (let j = 0; j < crossings.length; ) {
      let k = j + 1;
      while (k < crossings.length && eq(crossings[j].y, crossings[k].y)) k++;
      if ((k - j) % 2) boundaries.push(crossings[j]);
      j = k;
    }
    if (boundaries.length % 2)
      throw Error("Source finite-edge parity is not closed");
    const current = new Set<string>();
    for (let j = 0; j < boundaries.length; j += 2) {
      const lower = boundaries[j].id,
        upper = boundaries[j + 1].id,
        k = `${lower}:${upper}`;
      current.add(k);
      const c = open.get(k);
      if (c) c.hi = next.x;
      else open.set(k, { lo: ev.x, hi: next.x, lower, upper });
    }
    for (const [k, c] of open)
      if (!current.has(k)) {
        close(c);
        open.delete(k);
      }
  }
  for (const c of open.values()) close(c);
  if (
    nativeRationalOverlay("difference", cells, [part]).length ||
    nativeRationalOverlay("difference", [part], cells).length
  )
    throw Error(
      "Exact display cells do not reproduce the complete source face",
    );
  return cells;
}

/** All published numeric vertices satisfy every convex source halfspace as
 * exact dyadic rationals. Convexity then certifies whole edges and interior. */
function numericCore(
  input: P[],
  maximumMovement: number,
): { ring: N[]; movement: number } {
  const ring = same(input[0], input[input.length - 1])
    ? input.slice(0, -1)
    : input;
  const out: N[] = [];
  let movement = 0;
  // Integer halfspaces avoid repeated rational normalization during the bounded
  // IEEE candidate search; they retain exactly the same source edge equations.
  const halfspaces = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length],
      dx = sub(q[0], p[0]),
      dy = sub(q[1], p[1]);
    const A = mul(dy, rational(-1)),
      B = dx,
      C = sub(mul(dy, p[0]), mul(dx, p[1]));
    return [A.n * B.d * C.d, B.n * A.d * C.d, C.n * A.d * B.d] as const;
  });
  const inside = (p: P) =>
    halfspaces.every(
      ([A, B, C]) =>
        A * p[0].n * p[1].d + B * p[1].n * p[0].d + C * p[0].d * p[1].d >= 0n,
    );
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      near: N = [
        nativeRationalScalarToIEEE(p[0]),
        nativeRationalScalarToIEEE(p[1]),
      ];
    if (same(p, [rational(near[0]), rational(near[1])])) {
      out.push(near);
      continue;
    }
    const select = (
      center: N,
      limit: number,
    ): { point: N; movement: number } | undefined => {
      let best: { point: N; error: Rational; score: Rational } | undefined;
      const bound = mul(rational(limit), rational(limit));
      for (const x of neighbors(center[0]))
        for (const y of neighbors(center[1])) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const q: P = [rational(x), rational(y)];
          if (!inside(q)) continue;
          const dx = sub(q[0], p[0]),
            dy = sub(q[1], p[1]),
            error = add(mul(dx, dx), mul(dy, dy));
          if (compare(error, bound) > 0) continue;
          const cx = sub(q[0], rational(center[0])),
            cy = sub(q[1], rational(center[1])),
            score = add(mul(cx, cx), mul(cy, cy));
          if (
            !best ||
            compare(score, best.score) < 0 ||
            (compare(score, best.score) === 0 && compare(error, best.error) < 0)
          )
            best = { point: [x, y], error, score };
        }
      return best
        ? {
            point: best.point,
            movement: Math.sqrt(nativeRationalScalarToIEEE(best.error)),
          }
        : undefined;
    };
    const ulpBound =
      4 * Number.EPSILON * Math.max(1, Math.abs(near[0]), Math.abs(near[1]));
    const first = select(near, Math.min(maximumMovement, ulpBound));
    if (first) {
      out.push(first.point);
      movement = Math.max(movement, first.movement);
      continue;
    }
    const previous = ring[(i + ring.length - 1) % ring.length],
      next = ring[(i + 1) % ring.length];
    const va: N = [
        nativeRationalScalarToIEEE(sub(previous[0], p[0])),
        nativeRationalScalarToIEEE(sub(previous[1], p[1])),
      ],
      vb: N = [
        nativeRationalScalarToIEEE(sub(next[0], p[0])),
        nativeRationalScalarToIEEE(sub(next[1], p[1])),
      ];
    const la = DMath.hypot(...va),
      lb = DMath.hypot(...vb),
      limit = Math.min(maximumMovement, la / 4, lb / 4);
    if (!la || !lb) continue;
    for (let step = ulpBound * 2; step <= limit; step *= 2) {
      const candidates = (
        [
          [0.75, 0.25],
          [0.25, 0.75],
        ] as const
      ).map(([wa, wb]) =>
        select(
          [
            near[0] + step * ((wa * va[0]) / la + (wb * vb[0]) / lb),
            near[1] + step * ((wa * va[1]) / la + (wb * vb[1]) / lb),
          ],
          Math.min(limit, step * 2),
        ),
      );
      if (candidates[0] && candidates[1]) {
        out.push(candidates[0].point, candidates[1].point);
        movement = Math.max(
          movement,
          candidates[0].movement,
          candidates[1].movement,
        );
        break;
      }
    }
  }
  // The selected points are all exactly source-contained. Their convex interior
  // cover is consequently source-contained too; this orders render points only,
  // and does not replace or expand any original source face.
  const unique = new Map<string, N>();
  for (const p of out) unique.set(`${p[0]},${p[1]}`, p);
  const ordered = [...unique.values()].sort(
    (p, q) => p[0] - q[0] || p[1] - q[1],
  );
  const turn = (p: N, q: N, r: N) =>
    compare(
      side(
        [rational(p[0]), rational(p[1])],
        [rational(q[0]), rational(q[1])],
        [rational(r[0]), rational(r[1])],
      ),
      rational(0),
    );
  const chain = (points: N[]) => {
    const result: N[] = [];
    for (const p of points) {
      while (
        result.length > 1 &&
        turn(result[result.length - 2], result[result.length - 1], p) < 0
      )
        result.pop();
      result.push(p);
    }
    return result;
  };
  const lower = chain(ordered),
    upper = chain(ordered.slice().reverse());
  const clean = lower.slice(0, -1).concat(upper.slice(0, -1));
  const exact = clean.map((p) => [rational(p[0]), rational(p[1])] as P);
  if (exact.length < 3 || compare(area(exact), rational(0)) <= 0)
    return { ring: [], movement };
  if (
    exact.some(
      (p, i) =>
        compare(
          side(p, exact[(i + 1) % exact.length], exact[(i + 2) % exact.length]),
          rational(0),
        ) < 0,
    )
  )
    throw Error("Numeric display interior cover is not convex");
  clean.push(clean[0]);
  return { ring: clean, movement };
}

/** Run in the existing geometry worker. Rational residuals must be explicitly
 * encoded by the exact-topology carrier, never JSON-rounded into source masks.
 * maximumGeneratedMovementFeet is a drawing error bound, not contact tolerance. */
export function createNativeContainedDisplay(
  exactParts: NativeRationalParts,
  options: { maximumGeneratedMovementFeet?: number } = {},
): NativeContainedDisplay {
  const maximumMovement = options.maximumGeneratedMovementFeet ?? 1e-7;
  if (!Number.isFinite(maximumMovement) || maximumMovement < 0)
    throw Error("Invalid contained-display movement bound");
  const partsFeet: NativeContainedDisplayParts = [],
    exactResidualParts: NativeRationalParts = [],
    faces: NativeContainedDisplay["faces"] = [],
    anchors = new Map<string, N>();
  let maximumGeneratedMovementFeet = 0;
  for (const part of exactParts)
    for (const ring of part)
      for (const p of ring) {
        const x = nativeRationalScalarToIEEE(p[0]),
          y = nativeRationalScalarToIEEE(p[1]);
        if (same(p, [rational(x), rational(y)]))
          anchors.set(`${key(p[0])},${key(p[1])}`, [x, y]);
      }
  for (let i = 0; i < exactParts.length; i++) {
    const part = exactParts[i],
      cells = verticalCells(part),
      numeric: NativeContainedDisplayParts = [];
    let unrepresentablePositiveCells = 0;
    for (const cell of cells) {
      const core = numericCore(cell[0], maximumMovement);
      maximumGeneratedMovementFeet = Math.max(
        maximumGeneratedMovementFeet,
        core.movement,
      );
      if (core.ring.length) numeric.push([core.ring]);
      else unrepresentablePositiveCells++;
    }
    if (nativeRationalOverlay("difference", numeric, [part]).length)
      throw Error("Numeric display leaves its exact source face");
    const residual = numeric.length
      ? nativeRationalOverlay("difference", [part], numeric)
      : [part];
    const numericPieceStartIndex = partsFeet.length,
      exactResidualStartIndex = exactResidualParts.length;
    const faceAnchors = new Map<string, N>();
    for (const ring of part)
      for (const p of ring) {
        const x = nativeRationalScalarToIEEE(p[0]),
          y = nativeRationalScalarToIEEE(p[1]);
        if (same(p, [rational(x), rational(y)]))
          faceAnchors.set(`${key(p[0])},${key(p[1])}`, [x, y]);
      }
    partsFeet.push(...numeric);
    exactResidualParts.push(...residual);
    faces.push({
      sourcePartIndex: i,
      exactCells: cells.length,
      numericPieces: numeric.length,
      unrepresentablePositiveCells,
      exactResidualParts: residual.length,
      numericPieceStartIndex,
      exactResidualStartIndex,
      unchangedIEEEAnchorsFeet: [...faceAnchors.values()],
    });
  }
  return {
    partsFeet,
    exactParts,
    exactResidualParts,
    unchangedIEEEAnchorsFeet: [...anchors.values()],
    faces,
    certificate: {
      version: NATIVE_CONTAINED_DISPLAY_VERSION,
      kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
      renderOnly: true,
      exactDecompositionEqualsSource: true,
      numericOutsideSourceEmpty: true,
      completeExactAuthorityRetained: true,
      positiveResidualsRetained: true,
      originalIEEEAnchorsUnchanged: true,
      maximumGeneratedMovementFeet,
    },
  };
}
