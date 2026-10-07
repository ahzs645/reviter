import type { BoundarySection, BoundarySegment } from "./room-boundaries.ts";
import type { RoomPoint } from "./room-directory.ts";

export type RegisteredSingleDoorSwing = {
  arcSegmentIndices: number[];
  leafSegmentIndices: number[];
  supportingWallSegmentIndices: number[];
  hingeFeet: RoomPoint;
  radiusFeet: number;
  closedLeafFeet: BoundarySegment;
  thresholdSegments: BoundarySegment[];
};
const distance = (a: RoomPoint, b: RoomPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: RoomPoint, b: RoomPoint) => a[0] * b[1] - a[1] * b[0];
const key = (p: RoomPoint) =>
  `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;

/** Recognise tessellated quarter-circle door symbols only when a straight
 * open leaf and wall continuation on BOTH jamb sides prove the closed position.
 * Curved walls, isolated curves and ambiguous swing directions remain unchanged.
 * The result is visual evidence, never a door, access grant or routing edge. */
export function registeredSingleDoorSwings(
  section: BoundarySection,
): RegisteredSingleDoorSwing[] {
  const lines = section.wallSegments.map((ps, id) => ({
    ps,
    id,
    len: distance(...ps),
  }));
  const short = lines.filter((l) => l.len >= 0.02 && l.len <= 0.65);
  const nodes = new Map<string, typeof short>();
  for (const l of short)
    for (const p of l.ps) {
      const k = key(p);
      nodes.set(k, [...(nodes.get(k) ?? []), l]);
    }
  const used = new Set<number>(),
    result: RegisteredSingleDoorSwing[] = [];
  const turn = (a: RoomPoint, b: RoomPoint, c: RoomPoint) =>
    Math.atan2(
      cross([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]),
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]),
    );
  for (const seed of short) {
    if (used.has(seed.id)) continue;
    const ps: RoomPoint[] = [...seed.ps],
      ids = [seed.id];
    let sign = 0;
    for (const reverse of [false, true]) {
      if (reverse) {
        ps.reverse();
        ids.reverse();
        sign = -sign;
      }
      for (let step = 0; step < 150; step++) {
        const a = ps.at(-2)!,
          b = ps.at(-1)!;
        const next = (nodes.get(key(b)) ?? [])
          .filter((l) => !ids.includes(l.id))
          .map((l) => {
            const q = key(l.ps[0]) === key(b) ? l.ps[1] : l.ps[0];
            return { l, q, t: turn(a, b, q) };
          })
          .filter(
            (v) =>
              Math.abs(v.t) >= 0.005 &&
              Math.abs(v.t) <= 0.25 &&
              (!sign || Math.sign(v.t) === sign),
          );
        if (next.length !== 1) break;
        const v = next[0]!;
        sign = Math.sign(v.t);
        ps.push(v.q);
        ids.push(v.l.id);
      }
    }
    for (const id of ids) used.add(id);
    if (ids.length < 8) continue;
    const fits = [];
    // Swing symbols have short frame/cap strokes tangent to the arc. Exclude
    // at most two end strokes; the circular interior must still cover a quarter.
    for (let head = 0; head <= 2; head++)
      for (let tail = 0; tail <= 2; tail++) {
        const points = ps.slice(head, tail ? -tail : undefined),
          arcIds = ids.slice(head, tail ? -tail : undefined);
        if (arcIds.length < 8) continue;
        const a = points[0]!,
          b = points[Math.floor(points.length / 2)]!,
          c = points.at(-1)!;
        const u: RoomPoint = [b[0] - a[0], b[1] - a[1]],
          v: RoomPoint = [c[0] - a[0], c[1] - a[1]],
          det = 2 * cross(u, v);
        if (Math.abs(det) < 1e-8) continue;
        const uu = u[0] ** 2 + u[1] ** 2,
          vv = v[0] ** 2 + v[1] ** 2;
        const hinge: RoomPoint = [
            a[0] + (uu * v[1] - vv * u[1]) / det,
            a[1] + (u[0] * vv - v[0] * uu) / det,
          ],
          radius = distance(a, hinge);
        if (
          radius < 0.9 ||
          radius > 8 ||
          points.some((p) => Math.abs(distance(p, hinge) - radius) > 0.01)
        )
          continue;
        const sweep = points.slice(1).reduce((s, p, i) => {
          const q = points[i]!,
            u: RoomPoint = [q[0] - hinge[0], q[1] - hinge[1]],
            v: RoomPoint = [p[0] - hinge[0], p[1] - hinge[1]];
          return (
            s + Math.abs(Math.atan2(cross(u, v), u[0] * v[0] + u[1] * v[1]))
          );
        }, 0);
        if (sweep < (Math.PI / 180) * 82 || sweep > (Math.PI / 180) * 98)
          continue;
        fits.push({ a, c, hinge, radius, arcIds });
      }
    const fit = fits.sort((a, b) => b.arcIds.length - a.arcIds.length)[0];
    if (!fit) continue;
    const { a, c, hinge, radius, arcIds } = fit;
    const ends = [a, c];
    const support = ends.map((end) => {
      const radial: RoomPoint = [
        (end[0] - hinge[0]) / radius,
        (end[1] - hinge[1]) / radius,
      ];
      const aligned = lines
        .filter(
          (l) => l.len > 1 && l.ps.some((p) => distance(p, hinge) < radius + 3),
        )
        .map((l) => {
          let axis: RoomPoint = [
            (l.ps[1][0] - l.ps[0][0]) / l.len,
            (l.ps[1][1] - l.ps[0][1]) / l.len,
          ];
          if (axis[0] * radial[0] + axis[1] * radial[1] < 0)
            axis = [-axis[0], -axis[1]];
          return { axis, error: Math.abs(cross(axis, radial)) };
        })
        .filter((v) => v.error < 0.08)
        .sort((a, b) => a.error - b.error);
      const axis = aligned[0]?.axis ?? radial;
      let left = 0,
        right = 0;
      const supporting: number[] = [],
        offsets = new Set<number>();
      for (const l of lines) {
        if (ids.includes(l.id) || l.len < 0.4) continue;
        const dir: RoomPoint = [
          l.ps[1][0] - l.ps[0][0],
          l.ps[1][1] - l.ps[0][1],
        ];
        if (Math.abs(cross(axis, dir)) / l.len > 0.01) continue;
        const from: RoomPoint = [l.ps[0][0] - hinge[0], l.ps[0][1] - hinge[1]],
          off = cross(axis, from);
        if (Math.abs(off) > 0.5) continue;
        const ts = l.ps.map(
            (p) => (p[0] - hinge[0]) * axis[0] + (p[1] - hinge[1]) * axis[1],
          ),
          lo = Math.min(...ts),
          hi = Math.max(...ts);
        const before = Math.max(0, Math.min(hi, -0.2) - Math.max(lo, -3)),
          after = Math.max(
            0,
            Math.min(hi, radius + 3) - Math.max(lo, radius + 0.2),
          );
        left += before;
        right += after;
        if (before > 0 || after > 0) {
          supporting.push(l.id);
          offsets.add(Math.round(off * 10000) / 10000);
        }
      }
      return {
        axis,
        left,
        right,
        supporting,
        offsets,
        score: Math.min(left, right) * 10 + left + right,
      };
    });
    const closed = support[0]!.score > support[1]!.score ? 0 : 1,
      s = support[closed]!;
    if (
      s.supporting.length < 2 ||
      s.left < 0.4 ||
      s.right < 0.4 ||
      s.score < 5 ||
      Math.abs(s.score - support[1 - closed]!.score) < 1
    )
      continue;
    const open = ends[1 - closed]!;
    let openAxis: RoomPoint = [-s.axis[1], s.axis[0]];
    if (
      (open[0] - hinge[0]) * openAxis[0] + (open[1] - hinge[1]) * openAxis[1] <
      0
    )
      openAxis = [-openAxis[0], -openAxis[1]];
    const leaves = lines.filter(
      (l) =>
        !ids.includes(l.id) &&
        l.len >= radius * 0.6 &&
        l.ps.every((p) => {
          const d: RoomPoint = [p[0] - hinge[0], p[1] - hinge[1]],
            t = d[0] * openAxis[0] + d[1] * openAxis[1];
          return (
            Math.abs(cross(openAxis, d)) < 0.25 &&
            t >= -0.15 &&
            t <= radius + 0.15
          );
        }),
    );
    if (!leaves.length) continue;
    const end: RoomPoint = [
        hinge[0] + s.axis[0] * radius,
        hinge[1] + s.axis[1] * radius,
      ],
      n: RoomPoint = [-s.axis[1], s.axis[0]];
    const thresholds = [...s.offsets].map(
      (off) =>
        [
          [
            hinge[0] - s.axis[0] * 0.6 + n[0] * off,
            hinge[1] - s.axis[1] * 0.6 + n[1] * off,
          ],
          [
            end[0] + s.axis[0] * 0.6 + n[0] * off,
            end[1] + s.axis[1] * 0.6 + n[1] * off,
          ],
        ] as BoundarySegment,
    );
    result.push({
      arcSegmentIndices: arcIds,
      leafSegmentIndices: leaves.map((l) => l.id),
      supportingWallSegmentIndices: s.supporting,
      hingeFeet: hinge,
      radiusFeet: radius,
      closedLeafFeet: [hinge, end],
      thresholdSegments: thresholds,
    });
  }
  return result;
}

export function sectionWithClosedSingleDoorSwings(section: BoundarySection) {
  const swings = registeredSingleDoorSwings(section),
    removed = new Set(swings.flatMap((s) => s.arcSegmentIndices));
  return {
    swings,
    section: {
      ...section,
      wallSegments: section.wallSegments.filter((_, i) => !removed.has(i)),
      doorSegments: [
        ...section.doorSegments,
        ...swings.flatMap((s) => s.thresholdSegments),
      ],
    },
  };
}
