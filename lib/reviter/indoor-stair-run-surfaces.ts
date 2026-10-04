import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import { roomArea, type RoomPoint } from "./room-directory.ts";
type Tread = NonNullable<
  IndoorDataset["stairDisplay"]
>["flights"][number]["treads"][number];
const values = (a: unknown): number[] =>
  Array.isArray(a)
    ? a
    : ArrayBuffer.isView(a)
      ? Array.from(a as unknown as ArrayLike<number>)
      : a && typeof a === "object"
        ? Object.values(a)
        : [];
/** Native faces resolve analytic sketch riser offsets. Only full horizontal
 * walking faces of the run qualify; narrow underside/support lips do not. */
export function nativeStairRunTreads(
  model: Partial<ConvertResult>,
): Map<number, Tread[]> {
  const runs = new Map(
    model.elementBounds
      ?.filter((e) => e.categoryId === -2000919)
      .map((e) => [e.elementId, e]),
  );
  const groups = new Map<number, Map<number, RoomPoint[][]>>();
  if (!model.origin) return new Map();
  for (const mesh of model.meshes ?? []) {
    if (mesh.source !== "native-brep" || !mesh.elementIds) continue;
    const ids = values(mesh.elementIds);
    if (!ids.some((id) => runs.has(id))) continue;
    const p = values(mesh.positions),
      ix = values(mesh.indices);
    for (const [i, id] of ids.entries()) {
      if (!runs.has(id)) continue;
      const t = ix
        .slice(i * 3, i * 3 + 3)
        .map((j) => [
          p[j * 3]! + model.origin!.x,
          p[j * 3 + 1]! + model.origin!.y,
          p[j * 3 + 2]! + model.origin!.z,
        ]);
      if (
        t.length !== 3 ||
        t.some((q) => !q.every(Number.isFinite)) ||
        Math.max(...t.map((q) => q[2]!)) - Math.min(...t.map((q) => q[2]!)) >
          0.002
      )
        continue;
      const [a, b, c] = t,
        nz =
          (b![0]! - a![0]!) * (c![1]! - a![1]!) -
          (b![1]! - a![1]!) * (c![0]! - a![0]!);
      if (nz <= 1e-8) continue;
      const z = Math.round(t[0]![2]! * 1e4) / 1e4,
        byZ = groups.get(id) ?? new Map<number, RoomPoint[][]>();
      byZ.set(z, [
        ...(byZ.get(z) ?? []),
        t.map((q) => [q[0]!, q[1]!] as RoomPoint),
      ]);
      groups.set(id, byZ);
    }
  }
  const out = new Map<number, Tread[]>();
  for (const [id, byZ] of groups) {
    const r = runs.get(id)!;
    const expectedAreas =
      r.stairTreads
        ?.map((t) => roomArea(t.map((q) => [q[0], q[1]] as RoomPoint)))
        .filter((a) => a > 0.01) ?? [];
    const minArea = expectedAreas.length
      ? Math.min(...expectedAreas) * 0.5
      : 0.2;
    const treads = [...byZ]
      .flatMap(([elevationFeet, triangles]) => {
        const polys = triangles.map(
          (t) => [[...t, t[0]!]] as polygonClipping.Polygon,
        );
        return polygonClipping
          .union(polys[0]!, ...polys.slice(1))
          .filter((p) => p.length === 1 && roomArea(p[0]!) >= minArea)
          .map((p) => ({
            runElementId: id,
            elevationFeet,
            ...(r.stairTreadThicknessFeet
              ? { thicknessFeet: r.stairTreadThicknessFeet }
              : {}),
            ringFeet: nativeProfileOrder(
              p[0]!.slice(0, -1) as RoomPoint[],
              r.stairTreads,
            ),
          }));
      })
      .sort((a, b) => a.elevationFeet - b.elevationFeet);
    // A partial native replay cannot silently delete steps from the sketch.
    if (
      treads.length &&
      (!r.stairTreads?.length || treads.length === r.stairTreads.length)
    )
      out.set(id, treads);
  }
  return out;
}
export function nativeStairRunEndpoints(
  model: Partial<ConvertResult>,
  treads: Tread[],
) {
  const elements = new Map(model.elementBounds?.map((r) => [r.elementId, r]));
  return [...new Set(treads.map((t) => t.runElementId))].flatMap((id) => {
    const r = elements.get(id);
    if (!r?.stairTreads?.length) return [];
    const topElevationFeet = Math.max(
      ...treads
        .filter((t) => t.runElementId === id)
        .map((t) => t.elevationFeet),
      r.boundsFeet.max.z + (r.stairTreadThicknessFeet ?? 0),
    );
    return [
      {
        runElementId: id,
        bottomElevationFeet: r.boundsFeet.min.z,
        topElevationFeet,
        beginWithRiser: r.stairBeginWithRiser === true,
        endWithRiser: r.stairEndWithRiser === true,
      },
    ];
  });
}

/** Preserve the native sketch's bottom/top edge order using the BRep vertices.
 * A polygon union's arbitrary first vertex must not move a terminal riser. */
function nativeProfileOrder(
  ring: RoomPoint[],
  profiles: ConvertResult["elementBounds"][number]["stairTreads"],
): RoomPoint[] {
  for (const profile of profiles ?? []) {
    if (profile.length !== ring.length) continue;
    const matched = profile.map(
      (p) =>
        ring
          .map((q) => ({ q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) }))
          .sort((a, b) => a.d - b.d)[0]!,
    );
    if (
      matched.every((m) => m.d < 0.002) &&
      new Set(matched.map((m) => m.q)).size === ring.length
    )
      return matched.map((m) => m.q);
  }
  return ring;
}
