/** Closed DWG outlines that the registered boundary reference does not carry: CIRCLE entities and
 * closed polylines (closed flag, coincident ends, or a casing whose closing edge lies on a raw LINE).
 * Each is transformed by its section's registration, verified against the registered wall segments,
 * and tessellated deterministically. The result is separate, receipt-bound evidence that keeps each
 * raw entity handle; it never edits the source drawing, its extract or any package. */
import * as DMath from "./deterministic-math.ts";
import { nativeDerivedFrameHash } from "./native-derived-frame-returns.ts";
import {
  dwgDerivedOutlinesHash,
  validateDwgDerivedOutlines,
  type DwgDerivedOutlines,
} from "./native-provisional-corner-seals.ts";

type P2 = [number, number];
export type DwgRawExtractEntity = {
  h: string;
  t: string;
  l: string;
  c?: number[];
  r?: number;
  v?: number[][];
  p?: number[][];
  closed?: boolean;
};
export type DwgSectionRegistration = { re: number; im: number; t: [number, number] };
type BoundarySection = {
  sectionId: string;
  levelId: number;
  wallSegments: [P2, P2][];
  doorSegments?: [P2, P2][];
};

const cross = (a: P2, b: P2, c: P2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function minimumWidth(ring: P2[]) {
  const pts = [...ring].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: P2[]) => {
    const h: P2[] = [];
    for (const p of ps) {
      while (h.length >= 2 && cross(h.at(-2)!, h.at(-1)!, p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!,
      b = hull[(i + 1) % hull.length]!,
      l = DMath.hypot(b[0] - a[0], b[1] - a[1]);
    if (l) best = Math.min(best, Math.max(...hull.map((p) => Math.abs(cross(a, b, p)) / l)));
  }
  return best;
}
const segmentDistance = (p: P2, [a, b]: [P2, P2]) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return DMath.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Raw polyline vertices with bulge arcs tessellated (raw units). */
function polylinePoints(v: number[][], closed: boolean, perQuarter: number): P2[] {
  const out: P2[] = [];
  const m = v.length;
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const p = v[i]!,
      q = v[(i + 1) % m]!,
      b = p[2] ?? 0;
    out.push([p[0]!, p[1]!]);
    if (!b) continue;
    const dx = q[0]! - p[0]!,
      dy = q[1]! - p[1]!,
      L = DMath.hypot(dx, dy);
    if (!L) continue;
    const sweep = 4 * DMath.atan(b),
      off = (L / 2) * ((1 - b * b) / (2 * b)),
      c: P2 = [(p[0]! + q[0]!) / 2 - (dy / L) * off, (p[1]! + q[1]!) / 2 + (dx / L) * off],
      r = DMath.hypot(p[0]! - c[0], p[1]! - c[1]),
      a0 = DMath.atan2(p[1]! - c[1], p[0]! - c[0]),
      n = Math.max(1, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * perQuarter));
    for (let k = 1; k < n; k++)
      out.push([c[0] + r * DMath.cos(a0 + (sweep * k) / n), c[1] + r * DMath.sin(a0 + (sweep * k) / n)]);
  }
  if (!closed) out.push([v[m - 1]![0]!, v[m - 1]![1]!]);
  return out;
}

export function buildDwgDerivedOutlines(input: {
  sourceDwgSha256: string;
  rawExtract: { file: string; sha256: string }[];
  layers: string[];
  entities: DwgRawExtractEntity[];
  boundaryReference: { sourceSha256: string; sections: BoundarySection[] };
  registrations: Record<string, DwgSectionRegistration>;
  circleSegments?: number;
  arcSegmentsPerQuarterTurn?: number;
  maxOutlineWidthFeet?: number;
  registrationToleranceFeet?: number;
  minimumMatchedFraction?: number;
}): DwgDerivedOutlines {
  const circleSegments = input.circleSegments ?? 64,
    perQuarter = input.arcSegmentsPerQuarterTurn ?? 16,
    maxWidth = input.maxOutlineWidthFeet ?? 4,
    tol = input.registrationToleranceFeet ?? 1e-6,
    minFraction = input.minimumMatchedFraction ?? 0.25;
  if (input.boundaryReference.sourceSha256 !== input.sourceDwgSha256)
    throw new Error("Derived DWG outlines must come from the registered drawing.");
  const entities = input.entities.filter((e) => input.layers.includes(e.l));
  const sections: DwgDerivedOutlines["sections"] = [];
  for (const section of input.boundaryReference.sections) {
    const reg = input.registrations[section.sectionId];
    if (!reg) continue;
    const f = (x: number, y: number): P2 => [reg.re * x - reg.im * y + reg.t[0], reg.im * x + reg.re * y + reg.t[1]];
    const d = reg.re * reg.re + reg.im * reg.im;
    const inv = ([X, Y]: P2): P2 => {
      const x = X - reg.t[0],
        y = Y - reg.t[1];
      return [(reg.re * x + reg.im * y) / d, (-reg.im * x + reg.re * y) / d];
    };
    const raw = section.wallSegments.flatMap((s) => s.map(inv));
    if (!raw.length) continue;
    const pad = 1 / Math.sqrt(d); // one foot in raw units
    const box = [
      Math.min(...raw.map((p) => p[0])) - pad,
      Math.min(...raw.map((p) => p[1])) - pad,
      Math.max(...raw.map((p) => p[0])) + pad,
      Math.max(...raw.map((p) => p[1])) + pad,
    ];
    const inside = (pts: number[][]) =>
      pts.every((p) => p[0]! >= box[0]! && p[0]! <= box[2]! && p[1]! >= box[1]! && p[1]! <= box[3]!);
    const extent = (e: DwgRawExtractEntity): number[][] | undefined =>
      e.t === "CIRCLE" && e.c && e.r !== undefined
        ? [
            [e.c[0]! - e.r, e.c[1]! - e.r],
            [e.c[0]! + e.r, e.c[1]! + e.r],
          ]
        : e.t === "LINE"
          ? e.p
          : e.t === "LWPOLYLINE" || e.t === "POLYLINE2D"
            ? e.v
            : undefined;
    const local = entities.filter((e) => {
      const x = extent(e);
      return x !== undefined && inside(x);
    });
    // Registration receipt: raw LINEs that reproduce registered wall segments, both endpoints.
    // Raw straight pieces: LINE entities and the unbulged edges of polylines.
    const lines = local.flatMap((e) =>
      e.t === "LINE" && e.p
        ? [{ h: e.h, s: [f(e.p[0]![0]!, e.p[0]![1]!), f(e.p[1]![0]!, e.p[1]![1]!)] as [P2, P2] }]
        : (e.t === "LWPOLYLINE" || e.t === "POLYLINE2D") && e.v
          ? e.v.slice(0, -1).flatMap((p, k) =>
              p[2] ? [] : [{ h: e.h, s: [f(p[0]!, p[1]!), f(e.v![k + 1]![0]!, e.v![k + 1]![1]!)] as [P2, P2] }],
            )
          : [],
    );
    const key = (p: P2) => `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;
    const byEnd = new Map<string, [P2, P2][]>();
    for (const { s } of lines) for (const p of s) byEnd.set(key(p), [...(byEnd.get(key(p)) ?? []), s]);
    let matched = 0,
      maxError = 0;
    for (const g of section.wallSegments) {
      const errors = (byEnd.get(key(g[0])) ?? []).map((s) =>
        Math.min(
          Math.max(DMath.hypot(g[0][0] - s[0][0], g[0][1] - s[0][1]), DMath.hypot(g[1][0] - s[1][0], g[1][1] - s[1][1])),
          Math.max(DMath.hypot(g[0][0] - s[1][0], g[0][1] - s[1][1]), DMath.hypot(g[1][0] - s[0][0], g[1][1] - s[0][1])),
        ),
      );
      const e = errors.length ? Math.min(...errors) : Infinity;
      if (e <= tol) {
        matched++;
        maxError = Math.max(maxError, e);
      }
    }
    if (matched < minFraction * section.wallSegments.length) continue;
    const outlines: DwgDerivedOutlines["sections"][number]["outlines"] = [];
    for (const e of local) {
      let ring: P2[] | undefined,
        closure: "circle" | "closed-polyline" | "closing-edge-on-raw-line" | undefined,
        closingLineHandle: string | undefined;
      if (e.t === "CIRCLE" && e.c && e.r) {
        ring = Array.from({ length: circleSegments }, (_, k) => {
          const a = (2 * Math.PI * k) / circleSegments;
          return f(e.c![0]! + e.r! * DMath.cos(a), e.c![1]! + e.r! * DMath.sin(a));
        });
        closure = "circle";
      } else if ((e.t === "LWPOLYLINE" || e.t === "POLYLINE2D") && e.v && e.v.length >= 3) {
        const v = e.v,
          first = v[0]!,
          last = v[v.length - 1]!,
          coincident = first[0] === last[0] && first[1] === last[1];
        const pts = polylinePoints(coincident ? v.slice(0, -1) : v, !!e.closed || coincident, perQuarter).map(
          (p) => f(p[0], p[1]),
        );
        if (e.closed || coincident) {
          ring = pts;
          closure = "closed-polyline";
        } else {
          const closing: [P2, P2] = [pts.at(-1)!, pts[0]!];
          const on = lines.find((l) => closing.every((p) => segmentDistance(p, l.s) <= tol));
          if (on) {
            ring = pts;
            closure = "closing-edge-on-raw-line";
            closingLineHandle = on.h;
          }
        }
      }
      if (!ring || !closure || ring.length < 3) continue;
      const width = minimumWidth(ring);
      if (!(width > 0) || width > maxWidth) continue;
      outlines.push({ handle: e.h, entityType: e.t, layer: e.l, closure, ...(closingLineHandle ? { closingLineHandle } : {}), ringFeet: ring, firstSegment: 0 });
    }
    outlines.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
    const outlineSegments: [P2, P2][] = [];
    for (const o of outlines) {
      o.firstSegment = outlineSegments.length;
      o.ringFeet.forEach((p, k) => outlineSegments.push([p, o.ringFeet[(k + 1) % o.ringFeet.length]!]));
    }
    sections.push({
      sectionId: section.sectionId,
      levelId: section.levelId,
      boundarySectionSha256: nativeDerivedFrameHash([input.boundaryReference.sourceSha256, section]),
      registration: reg,
      registrationCheck: { matchedSegments: matched, maxEndpointErrorFeet: maxError },
      outlines,
      outlineSegments,
    });
  }
  const value: Omit<DwgDerivedOutlines, "geometrySha256"> = {
    format: "reviter-dwg-derived-outlines",
    version: 1,
    sourceDwgSha256: input.sourceDwgSha256,
    derivation: {
      rawExtract: input.rawExtract,
      layers: input.layers,
      circleSegments,
      arcSegmentsPerQuarterTurn: perQuarter,
      maxOutlineWidthFeet: maxWidth,
      registrationToleranceFeet: tol,
      math: "reviter-deterministic-math",
    },
    sections,
  };
  const out = { ...value, geometrySha256: dwgDerivedOutlinesHash(value) } as DwgDerivedOutlines;
  validateDwgDerivedOutlines(out, input.boundaryReference);
  return out;
}
