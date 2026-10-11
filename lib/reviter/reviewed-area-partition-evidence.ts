import type { IndoorDataset } from "./indoor-contract.ts";
import { NATIVE_EXACT_GEOS_BINDING } from "./native-exact-geos-overlay.ts";

/**
 * Local physical evidence of one reviewed area partition.
 *
 * A partition certifies a logical line at one place. Its binding covers the
 * evidence that the line meets, ends on or runs beside: every source row of the
 * level whose plan geometry intersects the partition's evidence window (its
 * point bounds expanded by REVIEWED_PARTITION_EVIDENCE_MARGIN_FEET), plus the
 * partition's own geometry and evidence. Rows elsewhere on the level, and
 * level-wide descriptor digests, are outside the binding.
 *
 * Polygon evidence is reduced to its exact trace on the window: the ring edges
 * that intersect the closed window, plus the even-odd membership of the four
 * window corners for each ring. Together they decide membership of every point
 * of the window exactly (walk from a corner to the point inside the convex
 * window; only window edges can be crossed), so a far vertex never enters the
 * binding while every local change does. Coordinates are serialised exactly
 * (shortest round-trip doubles); edges are undirected and every collection is
 * sorted, so source order, ring start vertex and direction do not matter.
 */
export const REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE =
  "logical-area-partition-local-evidence-v1" as const;
export const REVIEWED_PARTITION_EVIDENCE_MARGIN_FEET = 6;
/** Plan cuts read for a level span its elevation up to 4 ft above it. */
export const REVIEWED_PARTITION_EVIDENCE_BAND_FEET = 4;

type Point = [number, number];
export type ReviewedAreaPartitionEvidenceWindow = [
  number,
  number,
  number,
  number,
];
export type ReviewedAreaPartitionEvidenceRecord = {
  collection: string;
  key: string;
  value: string;
};
export type ReviewedAreaPartitionLocalEvidence = {
  rule: typeof REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE;
  windowFeet: ReviewedAreaPartitionEvidenceWindow;
  sha256: string;
  records: ReviewedAreaPartitionEvidenceRecord[];
};
type PartitionShape = {
  id: string;
  levelId: number;
  elevationFeet: number;
  kind: string;
  pointsFeet: Point[];
  closed: boolean;
  evidence: { kind: string; nativeElementIds: number[]; reason: string };
};

export function reviewedAreaPartitionEvidenceWindow(
  p: Pick<PartitionShape, "pointsFeet">,
): ReviewedAreaPartitionEvidenceWindow {
  const m = REVIEWED_PARTITION_EVIDENCE_MARGIN_FEET;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of p.pointsFeet) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!(x0 <= x1 && y0 <= y1))
    throw new Error("Logical boundary has no evidence window.");
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

const isPoint = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  (v.length === 2 || v.length === 3) &&
  v.every((n) => typeof n === "number");
const isChain = (v: unknown): v is number[][] =>
  Array.isArray(v) && v.length > 0 && v.every(isPoint);
const compare = (a: number[], b: number[]) =>
  a[0]! - b[0]! || a[1]! - b[1]! || (a[2] ?? 0) - (b[2] ?? 0);
const byJson = (a: unknown, b: unknown) => {
  const x = JSON.stringify(a),
    y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Geometry predicates against one closed axis-aligned window. */
function windowGeometry(w: ReviewedAreaPartitionEvidenceWindow) {
  const [x0, y0, x1, y1] = w;
  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const inside = (p: number[]) =>
    p[0]! >= x0 && p[0]! <= x1 && p[1]! >= y0 && p[1]! <= y1;
  const segment = (a: number[], b: number[]) => {
    if (inside(a) || inside(b)) return true;
    if (
      Math.max(a[0]!, b[0]!) < x0 ||
      Math.min(a[0]!, b[0]!) > x1 ||
      Math.max(a[1]!, b[1]!) < y0 ||
      Math.min(a[1]!, b[1]!) > y1
    )
      return false;
    // Bounds overlap: the segment meets the window unless every corner lies
    // strictly on one side of its line.
    let positive = false,
      negative = false;
    for (const c of corners) {
      const s =
        (b[0]! - a[0]!) * (c[1] - a[1]!) - (b[1]! - a[1]!) * (c[0] - a[0]!);
      if (s >= 0) positive = true;
      if (s <= 0) negative = true;
    }
    return positive && negative;
  };
  /** Even-odd membership of a window corner in one ring. */
  const contains = (ring: number[][], q: Point) => {
    let odd = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!,
        b = ring[j]!;
      if (
        a[1]! > q[1] !== b[1]! > q[1] &&
        q[0] < ((b[0]! - a[0]!) * (q[1] - a[1]!)) / (b[1]! - a[1]!) + a[0]!
      )
        odd = !odd;
    }
    return odd;
  };
  /** Exact window trace of a ring (or a polyline treated as closed). */
  const ring = (r: number[][], role: "o" | "h") => {
    let rx0 = Infinity,
      ry0 = Infinity,
      rx1 = -Infinity,
      ry1 = -Infinity;
    for (const p of r) {
      rx0 = Math.min(rx0, p[0]!);
      ry0 = Math.min(ry0, p[1]!);
      rx1 = Math.max(rx1, p[0]!);
      ry1 = Math.max(ry1, p[1]!);
    }
    // Disjoint bounds: no window edge and no window corner inside.
    if (rx1 < x0 || rx0 > x1 || ry1 < y0 || ry0 > y1) return undefined;
    const edges: number[][][] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!,
        b = r[(i + 1) % r.length]!;
      if (r.length > 2 || i === 0)
        if (segment(a, b)) edges.push(compare(a, b) <= 0 ? [a, b] : [b, a]);
    }
    const mask =
      r.length > 2
        ? corners.reduce((m, c, i) => m | (contains(r, c) ? 1 << i : 0), 0)
        : 0;
    if (!edges.length && !mask) return undefined;
    edges.sort((a, b) => compare(a[0]!, b[0]!) || compare(a[1]!, b[1]!));
    return [role, mask, edges] as const;
  };
  /** Window trace of any nested plan geometry; undefined when nothing is local. */
  const trace = (v: unknown): unknown => {
    if (isPoint(v)) return inside(v) ? v : undefined;
    if (isChain(v)) return v.length === 1 ? trace(v[0]) : ring(v, "o");
    if (!Array.isArray(v)) return undefined;
    const rings = v.length > 0 && v.every(isChain);
    const out = v
      .map((x, i) =>
        rings
          ? (x as number[][]).length === 1
            ? trace((x as number[][])[0])
            : ring(x as number[][], i === 0 ? "o" : "h")
          : trace(x),
      )
      .filter((x) => x !== undefined);
    return out.length ? out.sort(byJson) : undefined;
  };
  return { trace };
}

/** Directions, translations and elevations are values, not plan positions. */
const VECTOR_KEY = /normal|direction|elevation|translation/i;
/** Copies a source row, replacing every plan geometry by its window trace.
 * Authoring notes are never evidence. Returns undefined when no geometry is local. */
function localRow(
  row: unknown,
  trace: (v: unknown) => unknown,
  omit: readonly string[] = [],
): unknown {
  let local = false;
  const walk = (v: unknown, key: string): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (key.endsWith("Feet") && !VECTOR_KEY.test(key)) {
      const geometry =
        key === "boundsFeet" && !Array.isArray(v)
          ? (() => {
              const b = v as { min: number[]; max: number[] };
              return [
                [b.min[0], b.min[1]],
                [b.max[0], b.min[1]],
                [b.max[0], b.max[1]],
                [b.min[0], b.max[1]],
              ];
            })()
          : v;
      const t = trace(geometry);
      if (t !== undefined) local = true;
      return t ?? null;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => k !== "notes" && !omit.includes(k))
        .sort()
        .map((k) => [k, walk((v as Record<string, unknown>)[k], k)]),
    );
  };
  const value = walk(row, "");
  return local ? value : undefined;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.15;
async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical local evidence records and their digest for one partition. */
export async function reviewedAreaPartitionLocalEvidence(
  data: IndoorDataset,
  p: PartitionShape,
): Promise<ReviewedAreaPartitionLocalEvidence> {
  const level = data.nativeLevels.find((l) => l.id === p.levelId);
  if (!level) throw new Error("Logical boundary level is absent.");
  const windowFeet = reviewedAreaPartitionEvidenceWindow(p);
  const { trace } = windowGeometry(windowFeet);
  const z = level.elevationFeet,
    top = z + REVIEWED_PARTITION_EVIDENCE_BAND_FEET;
  const banded = (r: {
    levelId?: number;
    baseElevationFeet?: number;
    topElevationFeet?: number;
  }) =>
    r.levelId === p.levelId ||
    (typeof r.baseElevationFeet === "number" &&
      typeof r.topElevationFeet === "number" &&
      r.baseElevationFeet <= top &&
      r.topElevationFeet >= z);
  const records: ReviewedAreaPartitionEvidenceRecord[] = [];
  const localIds = new Set<number>();
  const add = (
    collection: string,
    rows: readonly unknown[] | undefined,
    key: (row: never) => unknown,
    omit: readonly string[] = [],
  ) => {
    for (const row of rows ?? []) {
      const value = localRow(row, trace, omit);
      if (value === undefined) continue;
      const id = (row as { nativeElementId?: unknown }).nativeElementId;
      if (typeof id === "number") localIds.add(id);
      records.push({
        collection,
        key: String(key(row as never)),
        value: JSON.stringify(value),
      });
    }
  };
  const strict = !!data.nativeIndoorEnvelopes;
  add(
    "walls",
    data.walls.filter((w) => w.levelId === p.levelId),
    (w: IndoorDataset["walls"][number]) =>
      `${w.nativeElementId}${w.reviewPatchId ? `:${w.reviewPatchId}` : ""}`,
  );
  add(
    "doors",
    data.doors?.filter((d) => d.levelId === p.levelId),
    (d: { id?: string; nativeElementId: number }) => d.id ?? d.nativeElementId,
  );
  add(
    "floors",
    data.walkingSupport?.floors.filter((f) => near(f.elevationFeet, z)),
    (f: { nativeElementId: number }) => f.nativeElementId,
  );
  add(
    "fixtures",
    data.circulationGeometry?.fixtures?.filter((f) =>
      f.levelIds.includes(p.levelId),
    ),
    (f: { id?: string }) => f.id ?? "",
  );
  add(
    "exclusions",
    data.indoorExclusions?.areas.filter((a) => near(a.elevationFeet, z)),
    (a: { id?: string }) => a.id ?? "",
  );
  if (!strict)
    add(
      "floorOpenings",
      data.records
        .filter((r) => r.levelId === p.levelId)
        .map((r) => ({
          key: r.key,
          floorOpeningsFeet: r.properties.floorOpeningsFeet ?? [],
        })),
      (r: { key: string }) => r.key,
    );
  add(
    "doorBoundaryClosures",
    data.nativeDoorBoundaryClosures?.doors.filter(
      (d) => d.levelId === p.levelId,
    ),
    (d: { id: string }) => d.id,
  );
  add(
    "wallPositionRepairs",
    data.nativeWallPositionRepairs?.walls.filter(
      (w) => w.levelId === p.levelId,
    ),
    (w: { id: string }) => w.id,
  );
  add(
    "contactRepairs",
    data.nativeSelectionContactRepairs?.repairs.filter(
      (r) => r.levelId === p.levelId,
    ),
    (r: { id: string }) => r.id,
  );
  add(
    "selectionDoorThresholds",
    data.selectionDoorThresholds?.doors.filter((d) => d.levelId === p.levelId),
    (d: { nativeElementId: number }) => d.nativeElementId,
  );
  if (strict) {
    // Level containers carry level-wide digests and censuses; only their
    // window trace and the census entries of local owners are local evidence.
    const containers = <
      T extends {
        levelId: number;
        elevationFeet: number;
        cutElevationFeet?: number;
      },
    >(
      rows: readonly T[] | undefined,
    ) =>
      (rows ?? []).filter(
        (l) =>
          l.levelId === p.levelId ||
          near(l.elevationFeet, z) ||
          (typeof l.cutElevationFeet === "number" &&
            l.cutElevationFeet >= z &&
            l.cutElevationFeet <= top),
      );
    const material = containers(data.nativeMaterialSections?.levels);
    for (const l of material) {
      const at = `${l.levelId}@${l.elevationFeet}/${l.cutElevationFeet}`;
      add(
        `materialSections:${at}`,
        l.sections,
        (s: { nativeElementId: number }) => s.nativeElementId,
      );
      for (const field of [
        "originalPositiveMaterialBands",
        "originalDoorClearOpeningProfiles",
        "originalNativeMemberSections",
        "originalFiniteMaterialSections",
      ] as const)
        add(
          `materialSections:${at}:${field}`,
          l[field] as readonly unknown[] | undefined,
          (s: { nativeElementId?: number; evidenceSha256?: string }) =>
            s.nativeElementId ?? s.evidenceSha256 ?? "",
        );
    }
    const supplement = containers(data.nativeMaterialSectionSupplement?.levels);
    for (const l of supplement)
      add(
        `materialSectionSupplement:${l.levelId}@${l.elevationFeet}/${l.cutElevationFeet}`,
        l.sections,
        (s: { nativeElementId: number }) => s.nativeElementId,
      );
    add(
      "derivedFrameReturns",
      data.nativeDerivedFrameReturns?.rows.filter(banded),
      (r: { id: string }) => r.id,
    );
    add(
      "provisionalCornerSeals",
      data.nativeProvisionalCornerSeals?.rows.filter(banded),
      (r: { id: string }) => r.id,
    );
    add(
      "foreignBodies",
      data.nativeProvisionalCornerSeals?.foreignBodies.filter(
        (b) => b.boundsFeet.min[2]! <= top && b.boundsFeet.max[2]! >= z,
      ),
      (b: { nativeElementId: number }) => b.nativeElementId,
    );
    const envelopes = containers(data.nativeIndoorEnvelopes?.levels);
    add(
      "envelopes",
      envelopes.map((l) => ({
        levelId: l.levelId,
        elevationFeet: l.elevationFeet,
        cutElevationsFeet: l.cutElevationsFeet,
        partsFeet: l.partsFeet,
      })),
      (l: { levelId: number; elevationFeet: number }) =>
        `${l.levelId}@${l.elevationFeet}`,
    );
    let apertures: { levelId?: number; id?: string }[] = [];
    try {
      const parsed = JSON.parse(
        data.doorAperturePatchState?.sourceGeometryKey ?? "[]",
      );
      if (Array.isArray(parsed)) apertures = parsed;
    } catch {
      records.push({
        collection: "doorApertures",
        key: "unreadable",
        value: JSON.stringify(data.doorAperturePatchState?.sourceGeometryKey),
      });
    }
    add(
      "doorApertures",
      apertures.filter((a) => a.levelId === p.levelId),
      (a: { id?: string }) => a.id ?? "",
    );
    // Censuses (presence/absence of an owner) and host relations, for local owners only.
    for (const l of material) {
      const at = `${l.levelId}@${l.elevationFeet}/${l.cutElevationFeet}`;
      records.push({
        collection: `materialSections:${at}:census`,
        key: "",
        value: JSON.stringify(
          [
            ...new Set(l.sourceElementIds.filter((id) => localIds.has(id))),
          ].sort((a, b) => a - b),
        ),
      });
      for (const r of l.originalNativeHostRelations ?? [])
        if (
          localIds.has(r.hostNativeElementId) ||
          r.memberNativeElementIds.some((id) => localIds.has(id))
        )
          records.push({
            collection: `materialSections:${at}:hostRelations`,
            key: String(r.hostNativeElementId),
            value: JSON.stringify([
              r.hostNativeElementId,
              r.memberNativeElementIds,
              r.physicalDoorNativeElementIds,
              r.evidenceSha256,
            ]),
          });
    }
    for (const l of envelopes)
      records.push({
        collection: "envelopes:census",
        key: `${l.levelId}@${l.elevationFeet}`,
        value: JSON.stringify(
          [
            ...new Set(l.sourceElementIds.filter((id) => localIds.has(id))),
          ].sort((a, b) => a - b),
        ),
      });
    records.push({
      collection: "nonPhysicalCurtainHosts",
      key: "",
      value: JSON.stringify(
        [
          ...new Set(
            (
              data.nativeProvisionalCornerSeals
                ?.nonPhysicalCurtainHostNativeElementIds ?? []
            ).filter((id) => localIds.has(id)),
          ),
        ].sort((a, b) => a - b),
      ),
    });
  }
  // The partition's own geometry and cited evidence. Authoring label/notes and
  // review status stay outside, so applying a boundary cannot stale it.
  records.push({
    collection: "partition",
    key: p.id,
    value: JSON.stringify({
      levelId: p.levelId,
      elevationFeet: p.elevationFeet,
      kind: p.kind,
      pointsFeet: p.pointsFeet,
      closed: p.closed,
      evidence: {
        kind: p.evidence.kind,
        nativeElementIds: p.evidence.nativeElementIds,
        reason: p.evidence.reason,
      },
    }),
  });
  for (const id of p.evidence.nativeElementIds)
    records.push({
      collection: "cited",
      key: String(id),
      value: JSON.stringify(localIds.has(id)),
    });
  records.sort(
    (a, b) =>
      (a.collection < b.collection
        ? -1
        : a.collection > b.collection
          ? 1
          : 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
  const header = {
    sourceModelSha256: data.source.modelSha256,
    level,
    walkingSupportSourceModelSha256: data.walkingSupport?.sourceModelSha256,
    strict,
    ...(strict
      ? {
          geos: NATIVE_EXACT_GEOS_BINDING,
          doorAperturesRegenerated: data.doorAperturePatchState?.regenerated,
        }
      : {}),
  };
  return {
    rule: REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE,
    windowFeet,
    sha256: await sha256(
      JSON.stringify([
        REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE,
        REVIEWED_PARTITION_EVIDENCE_MARGIN_FEET,
        REVIEWED_PARTITION_EVIDENCE_BAND_FEET,
        windowFeet,
        header,
        records.map((r) => [r.collection, r.key, r.value]),
      ]),
    ),
    records,
  };
}

export type ReviewedAreaPartitionEvidenceDifference = {
  collection: string;
  key: string;
  change: "added" | "removed" | "changed";
};
/** Which local elements differ between two evidence snapshots of one partition. */
export function diffReviewedAreaPartitionEvidence(
  before: readonly ReviewedAreaPartitionEvidenceRecord[],
  after: readonly ReviewedAreaPartitionEvidenceRecord[],
): ReviewedAreaPartitionEvidenceDifference[] {
  const group = (rs: readonly ReviewedAreaPartitionEvidenceRecord[]) => {
    const m = new Map<string, string[]>();
    for (const r of rs) {
      const k = JSON.stringify([r.collection, r.key]);
      m.set(k, [...(m.get(k) ?? []), r.value]);
    }
    for (const v of m.values()) v.sort();
    return m;
  };
  const a = group(before),
    b = group(after);
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((k) => {
    const [collection, key] = JSON.parse(k) as [string, string];
    const x = a.get(k),
      y = b.get(k);
    if (x && y && JSON.stringify(x) === JSON.stringify(y)) return [];
    return [
      {
        collection,
        key,
        change: !x ? "added" : !y ? "removed" : "changed",
      } as const,
    ];
  });
}
