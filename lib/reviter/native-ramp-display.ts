import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import { containsRoomPoint } from "./room-directory.ts";
import { nativeRampTriangles } from "./indoor-ramps.ts";

/** Measured ramps remain visible after regeneration. This inventory creates
 * no node, edge, accessibility review or permission to cross another surface. */
export function prepareNativeRampDisplay(
  model: ConvertResult,
  data: IndoorDataset,
) {
  data.rampDisplay ??= {
    version: 1,
    sourceModelSha256: data.source.modelSha256,
    ramps: [],
  };
  for (const record of model.elementBounds.filter(
    (r) => r.categoryId === -2000180 && r.renderGeometryProvenance === "native",
  )) {
    const trianglesFeet = nativeRampTriangles(model, record.elementId);
    if (!trianglesFeet.length) continue;
    const low = Math.min(...trianglesFeet.flat().map((p) => p[2]));
    const high = Math.max(...trianglesFeet.flat().map((p) => p[2]));
    const levelIds = data.nativeLevels
      .filter(
        (l) => l.elevationFeet >= low - 0.05 && l.elevationFeet <= high + 0.05,
      )
      .map((l) => l.id);
    if (!levelIds.length) continue;
    const rooms = data.records.filter(
      (r) =>
        levelIds.includes(r.levelId) &&
        trianglesFeet.some((t) => {
          const q: [number, number] = [
            t.reduce((n, p) => n + p[0] / 3, 0),
            t.reduce((n, p) => n + p[1] / 3, 0),
          ];
          return (
            containsRoomPoint(q, r.ringsFeet[0]!) &&
            !r.ringsFeet.slice(1).some((h) => containsRoomPoint(q, h))
          );
        }),
    );
    const buildings = [...new Set(rooms.map((r) => r.building))];
    const existing = data.rampDisplay.ramps.find(
      (r) => r.nativeElementId === record.elementId,
    );
    const circulation =
      !!existing?.edgeId ||
      rooms.some((r) => r.circulation && r.walkable && r.access !== "staff");
    if (existing) {
      existing.buildings = buildings;
      existing.circulation = circulation;
      continue;
    }
    const first = trianglesFeet[0]!;
    data.rampDisplay.ramps.push({
      displayOnly: true,
      nativeElementId: record.elementId,
      levelIds,
      buildings,
      circulation,
      anchorPointFeet: [0, 1, 2].map((i) =>
        first.reduce((n, p) => n + p[i]! / 3, 0),
      ) as [number, number, number],
      trianglesFeet,
    });
  }
}
