import { nativeRationalOverlay } from "./native-rational-overlay.ts";
import { nativeRationalFootprintSupported } from "./native-exact-planar-topology.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

type P = [number, number];
type Jamb = { index: number; points: [P, P] };
export type ReviewedOpenBay = {
  levelId: number;
  hostWallId: number;
  hostRingsFeet: P[][];
  sectionId: string;
  drawingSha256: string;
  jambs: [Jamb, Jamb];
};
type Drawing = {
  sourceSha256: string;
  sections: { sectionId: string; levelId: number; wallSegments: P[][] }[];
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function verifyOpenBayDrawing(b: ReviewedOpenBay, drawing: unknown) {
  const d = drawing as Drawing | undefined;
  const s = d?.sections?.find(
    (x) => x.sectionId === b.sectionId && x.levelId === b.levelId,
  );
  if (
    !s ||
    d?.sourceSha256 !== b.drawingSha256 ||
    !b.jambs.every((j) => {
      const segment = s.wallSegments[j.index];
      return (
        same(segment, j.points) || same(segment, [j.points[1], j.points[0]])
      );
    })
  )
    throw new Error("Open bay does not match both registered drawing jambs.");
}
export function validBay(b: ReviewedOpenBay) {
  const pt = (p: P) =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((v) => Number.isFinite(v) && Math.abs(v) < 1e7);
  return (
    !!b &&
    Number.isSafeInteger(b.levelId) &&
    Number.isSafeInteger(b.hostWallId) &&
    b.hostWallId > 0 &&
    typeof b.sectionId === "string" &&
    b.sectionId.length > 0 &&
    /^[a-f0-9]{64}$/.test(b.drawingSha256) &&
    Array.isArray(b.hostRingsFeet) &&
    b.hostRingsFeet.length === 1 &&
    b.hostRingsFeet[0]!.length === 4 &&
    b.hostRingsFeet[0]!.every(pt) &&
    Array.isArray(b.jambs) &&
    b.jambs.length === 2 &&
    b.jambs[0]!.index !== b.jambs[1]!.index &&
    b.jambs.every(
      (j) =>
        Number.isSafeInteger(j.index) &&
        j.index >= 0 &&
        Array.isArray(j.points) &&
        j.points.length === 2 &&
        j.points.every(pt),
    )
  );
}
export function checkedBayMask(
  data: IndoorDataset,
  b: ReviewedOpenBay,
  from: IndoorDataset["nodes"][number],
  to: IndoorDataset["nodes"][number],
  known: ReadonlySet<number>,
) {
  if (
    !validBay(b) ||
    from.kind !== "arrival" ||
    to.kind !== "arrival" ||
    from.roomKey === to.roomKey ||
    from.levelId !== b.levelId ||
    to.levelId !== b.levelId ||
    known.has(b.hostWallId)
  )
    throw new Error(
      "Open bay requires two distinct arrivals and a source fallback wall on their level.",
    );
  const hosts = data.walls.filter(
    (w) => w.levelId === b.levelId && w.nativeElementId === b.hostWallId,
  );
  if (
    hosts.length !== 1 ||
    hosts[0]!.approximate ||
    hosts[0]!.reviewPatchId ||
    hosts[0]!.kind !== "wall" ||
    !same(hosts[0]!.ringsFeet, b.hostRingsFeet) ||
    data.doors?.some((d) => d.hostWallNativeElementId === b.hostWallId)
  )
    throw new Error("Open bay host geometry or hosted doors changed.");
  const [u, v] = b.jambs.map((j) => j.points) as [[P, P], [P, P]];
  const dist = (a: P, c: P) => {
    const dx = a[0] - c[0];
    const dy = a[1] - c[1];
    return Math.sqrt(dx * dx + dy * dy);
  };
  const depth = dist(u[0], u[1]),
    width = dist(u[0], v[0]);
  if (
    depth < 0.1 ||
    depth > 2 ||
    width < 1 ||
    width > 10 ||
    Math.abs(depth - dist(v[0], v[1])) > 0.01 ||
    Math.abs(width - dist(u[1], v[1])) > 0.01
  )
    throw new Error("Invalid open bay jamb dimensions.");
  const vx = u[1][0] - u[0][0],
    vy = u[1][1] - u[0][1];
  if (
    Math.abs((v[0][0] - u[0][0]) * vx + (v[0][1] - u[0][1]) * vy) >
      0.01 * depth * width ||
    Math.abs(v[1][0] - v[0][0] - vx) > 0.01 ||
    Math.abs(v[1][1] - v[0][1] - vy) > 0.01
  )
    throw new Error("Open bay jamb frame is not rectangular.");
  const side = (q: number[]) =>
    ((q[0]! - u[0][0]) * vx + (q[1]! - u[0][1]) * vy) / depth;
  if (!(side(from.pointFeet) < 0 && side(to.pointFeet) > depth))
    throw new Error("Open bay arrivals must stand on opposite sides.");
  // The plan's jambs and fallback wall can differ slightly in depth. Extend
  // each jamb only across its registered host and then clip to the host itself.
  const extra = 0.15 / depth,
    at = (j: [P, P], t: number): P => [
      j[0][0] + t * (j[1][0] - j[0][0]),
      j[0][1] + t * (j[1][1] - j[0][1]),
    ];
  const frame = [
    [at(u, -extra), at(u, 1 + extra), at(v, 1 + extra), at(v, -extra)],
  ];
  const cut = nativeRationalOverlay("intersection", [frame], [b.hostRingsFeet]);
  const z = from.pointFeet[2];
  const envelopes =
    data.nativeIndoorEnvelopes?.levels
      .filter((l) => Math.abs(l.elevationFeet - z) < 0.05)
      .flatMap((l) => l.partsFeet) ?? [];
  const floor =
    data.walkingSupport?.floors
      .filter((f) => Math.abs(f.elevationFeet - z) < 0.05)
      .flatMap((f) => f.partsFeet ?? [f.ringsFeet]) ?? [];
  if (
    !cut.length ||
    !nativeRationalFootprintSupported(
      cut,
      nativeRationalOverlay("intersection", [frame], floor, envelopes),
    )
  )
    throw new Error("Open bay lacks native slab or indoor-envelope coverage.");
  return cut;
}
