import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import { roomArea, type RoomPoint } from "./room-directory.ts";

type Landing = NonNullable<
  IndoorDataset["stairDisplay"]
>["flights"][number]["landings"];
const values = (a: unknown): number[] =>
  Array.isArray(a)
    ? a
    : ArrayBuffer.isView(a)
      ? Array.from(a as unknown as ArrayLike<number>)
      : a && typeof a === "object"
        ? Object.values(a)
        : [];

/** The element table retains landing ownership even when the stair frame
 * collector has omitted a landing. Geometry/proximity never establishes it. */
export function nativeStairLandings(
  model: Partial<ConvertResult>,
): Map<number, NonNullable<Landing>> {
  const assemblies = new Map(
    model.nativeStairAssemblies?.map((a) => [a.stairElementId, a]),
  );
  const parents = new Map(
    model.elementOwnership?.records.map((r) => [
      r.elementId,
      r.owningElementId,
    ]),
  );
  const owners = new Map<number, number>();
  const elements = new Map(model.elementBounds?.map((e) => [e.elementId, e]));
  for (const e of elements.values()) {
    if (e.categoryId !== -2000920) continue;
    const explicit = [...assemblies.values()].filter((a) =>
      a.runAndLandingIds.includes(e.elementId),
    );
    let id: number | null | undefined = e.elementId;
    const seen = new Set<number>();
    while (id != null && !seen.has(id) && !assemblies.has(id)) {
      seen.add(id);
      id = parents.get(id);
    }
    const owner =
      id != null && assemblies.has(id)
        ? id
        : explicit.length === 1
          ? explicit[0]!.stairElementId
          : undefined;
    if (
      owner !== undefined &&
      !explicit.some((a) => a.stairElementId !== owner)
    )
      owners.set(e.elementId, owner);
  }
  const triangles = new Map<number, RoomPoint[][]>();
  if (!model.origin) return new Map();
  // Index all landing faces once, rather than rescanning a campus mesh per stair.
  for (const mesh of model.meshes ?? []) {
    if (mesh.source !== "native-brep" || !mesh.elementIds) continue;
    const ids = values(mesh.elementIds);
    if (!ids.some((id) => owners.has(id))) continue;
    const positions = values(mesh.positions),
      indices = values(mesh.indices);
    for (const [i, id] of ids.entries()) {
      if (!owners.has(id)) continue;
      const e = elements.get(id)!;
      const points = indices
        .slice(i * 3, i * 3 + 3)
        .map((j) => [
          positions[j * 3]! + model.origin!.x,
          positions[j * 3 + 1]! + model.origin!.y,
          positions[j * 3 + 2]! + model.origin!.z,
        ]);
      if (
        points.length !== 3 ||
        points.some(
          (p) =>
            !p.every(Number.isFinite) ||
            Math.abs(p[2]! - e.boundsFeet.max.z) > 0.002,
        )
      )
        continue;
      const [a, b, c] = points;
      const normalZ =
        (b![0]! - a![0]!) * (c![1]! - a![1]!) -
        (b![1]! - a![1]!) * (c![0]! - a![0]!);
      if (normalZ <= 1e-8) continue; // Exclude underside, risers and support faces.
      const ring = points.map((p) => [p[0]!, p[1]!] as RoomPoint);
      triangles.set(id, [...(triangles.get(id) ?? []), ring]);
    }
  }
  const result = new Map<number, NonNullable<Landing>>();
  for (const [id, rings] of triangles) {
    const e = elements.get(id)!,
      owner = owners.get(id)!;
    const thicknessFeet = e.boundsFeet.max.z - e.boundsFeet.min.z;
    if (!(thicknessFeet > 0)) continue;
    const polys = rings.map((r) => [[...r, r[0]!]] as polygonClipping.Polygon);
    const union = polygonClipping.union(polys[0]!, ...polys.slice(1));
    const surfaces = union
      .filter((p) => roomArea(p[0]!) > 0.01)
      .map((p) => ({
        nativeElementId: id,
        elevationFeet: e.boundsFeet.max.z,
        thicknessFeet,
        ringsFeet: p.map((r) => r.slice(0, -1) as RoomPoint[]),
      }));
    result.set(owner, [...(result.get(owner) ?? []), ...surfaces]);
  }
  return result;
}
