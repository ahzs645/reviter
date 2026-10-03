import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import {
  cleanRoomBoundary,
  containsRoomPoint,
  validRoomBoundary,
} from "./room-directory.ts";

type Point = [number, number];
type Segment = [Point, Point];
const PRECISION = 0.0001; // 0.0305 mm: tessellation roundoff, not a wall-gap repair.
const categories = new Set([-2000011, -2000170, -2000171, -2000100, -2000133]);
// JSON-decoded caches serialize typed arrays as indexed objects. Live models
// retain their typed-array length. The coordinates and triangle ownership agree.
const length = (array: ArrayLike<number>) =>
  array.length ?? Object.keys(array).length;

/** A closed cross-section of certified native BRep material, with per-triangle
 * element ownership. Display proxies, reconstructed families, unknown owners,
 * dangling cuts and non-manifold cuts cannot supply barrier evidence. No convex
 * hull, bounding box, source contour or long-gap closure is used. */
export function nativeMeshBarrierCuts(
  model: ConvertResult,
  levelId: number,
  cutElevationFeet: number,
): IndoorDataset["walls"] {
  // Older converted caches can omit meshes. Without native mesh evidence,
  // retain the existing boundaries rather than attempting a mesh recovery.
  if (!Number.isFinite(cutElevationFeet) || !model.meshes?.length) return [];
  const owners = new Map(
    model.elementBounds
      .filter(
        (r) =>
          categories.has(r.categoryId!) &&
          r.renderGeometryProvenance === "native",
      )
      .map((r) => [r.elementId, r]),
  );
  const segments = new Map<number, Segment[]>();
  for (const mesh of model.meshes) {
    if (mesh.source !== "native-brep" || !mesh.elementIds) continue;
    const count = Math.min(
      length(mesh.elementIds),
      Math.floor(length(mesh.indices) / 3),
    );
    for (let triangle = 0; triangle < count; triangle++) {
      const id = mesh.elementIds[triangle]!;
      if (!owners.has(id)) continue;
      const ps = [0, 1, 2].map((k) => {
        const v = mesh.indices[triangle * 3 + k]! * 3;
        return [
          mesh.positions[v]! + model.origin.x,
          mesh.positions[v + 1]! + model.origin.y,
          mesh.positions[v + 2]! + model.origin.z,
        ];
      });
      if (ps.some((p) => p.some((n) => !Number.isFinite(n)))) continue;
      const hits: Point[] = [];
      for (let k = 0; k < 3; k++) {
        const a = ps[k]!,
          b = ps[(k + 1) % 3]!;
        // Half-open plane intersection includes a vertex only once and skips
        // coplanar triangles. Cut evidence comes from the vertical shell.
        if (a[2]! < cutElevationFeet === b[2]! < cutElevationFeet) continue;
        const t = (cutElevationFeet - a[2]!) / (b[2]! - a[2]!);
        hits.push([a[0]! + t * (b[0]! - a[0]!), a[1]! + t * (b[1]! - a[1]!)]);
      }
      if (
        hits.length !== 2 ||
        Math.hypot(hits[0]![0] - hits[1]![0], hits[0]![1] - hits[1]![1]) < 1e-8
      )
        continue;
      const list = segments.get(id) ?? [];
      list.push([hits[0]!, hits[1]!]);
      segments.set(id, list);
    }
  }
  const walls: IndoorDataset["walls"] = [];
  for (const [id, lines] of segments) {
    const nodes: { point: Point; adjacent: Set<number> }[] = [],
      bins = new Map<string, number[]>();
    const node = (p: Point) => {
      const x = Math.floor(p[0] / PRECISION),
        y = Math.floor(p[1] / PRECISION);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const i of bins.get(`${x + dx}:${y + dy}`) ?? [])
            if (
              Math.hypot(
                nodes[i]!.point[0] - p[0],
                nodes[i]!.point[1] - p[1],
              ) <= PRECISION
            )
              return i;
      const i = nodes.length,
        key = `${x}:${y}`;
      nodes.push({ point: p, adjacent: new Set() });
      bins.set(key, [...(bins.get(key) ?? []), i]);
      return i;
    };
    for (const [a, b] of lines) {
      const i = node(a),
        j = node(b);
      if (i !== j) {
        nodes[i]!.adjacent.add(j);
        nodes[j]!.adjacent.add(i);
      }
    }
    // Every cut edge must belong to a closed, unbranched shell. A polygonizer
    // that silently discards dangling parts would overstate native evidence.
    if (nodes.some((n) => n.adjacent.size !== 2)) continue;
    const used = new Set<number>(),
      loops: Point[][] = [];
    for (let start = 0; start < nodes.length; start++) {
      if (used.has(start)) continue;
      let previous = -1,
        current = start;
      const loop: Point[] = [];
      do {
        if (used.has(current)) break;
        used.add(current);
        loop.push(nodes[current]!.point);
        const next = [...nodes[current]!.adjacent].find((n) => n !== previous)!;
        previous = current;
        current = next;
      } while (current !== start);
      const ring = cleanRoomBoundary(loop);
      if (current !== start || !validRoomBoundary(ring, 1e-7)) {
        loops.length = 0;
        break;
      }
      loops.push(ring);
    }
    // Disconnected solids and nested holes remain separate. An aperture is
    // never filled by taking the convex hull of an element's cross-section.
    const depth = (ring: Point[]) =>
      loops.filter(
        (other) => other !== ring && containsRoomPoint(ring[0]!, other),
      ).length;
    for (const outer of loops.filter((r) => depth(r) % 2 === 0)) {
      const holes = loops.filter(
        (r) => depth(r) === depth(outer) + 1 && containsRoomPoint(r[0]!, outer),
      );
      walls.push({
        levelId,
        nativeElementId: id,
        kind: [-2000100, -2000133].includes(owners.get(id)!.categoryId!)
          ? "column"
          : "wall",
        approximate: false,
        ringsFeet: [outer, ...holes],
      });
    }
  }
  return walls;
}
