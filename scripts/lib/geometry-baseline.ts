import { createHash } from "node:crypto";
import type { ConvertResult } from "../../lib/reviter/types.ts";

/** Same mesh-byte order as audit-rvt-semantic-integration's baseline snapshots. */
export function geometrySnapshot(result: ConvertResult) {
  const hash = createHash("sha256");
  for (const mesh of result.meshes) for (const key of ["positions", "indices", "colors", "elementIds"] as const) {
    const data = mesh[key];
    if (data) hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return {
    geometryHash: hash.digest("hex"),
    triangles: result.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
    meshes: result.meshes.length, bounds: result.elementBounds.length,
    origin: result.origin, bbox: result.bbox,
  };
}

export function compareGeometrySnapshot(actual: ReturnType<typeof geometrySnapshot>, baseline: Record<string, unknown>) {
  return Object.fromEntries((Object.keys(actual) as Array<keyof typeof actual>).map(key => [key, {
    expected: baseline[key] ?? null,
    actual: actual[key],
    matches: baseline[key] === undefined ? null : JSON.stringify(baseline[key]) === JSON.stringify(actual[key]),
  }]));
}
