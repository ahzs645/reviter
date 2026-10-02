import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import {
  roomArea,
  type DirectoryRoom,
  type RoomPoint,
} from "./room-directory.ts";

/** Use native slab loops, including real holes; projected stairs do not cut slabs. */
export function stairFloorOccluders(
  model: Partial<ConvertResult>,
  flight: NonNullable<IndoorDataset["stairDisplay"]>["flights"][number],
) {
  const points=flight.treads.flatMap(t=>t.ringFeet);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  return (model.elementBounds??[]).filter(r=>
    r.categoryId===-2000032 && r.loops?.length &&
    Math.abs(r.boundsFeet.max.z-flight.floorElevationFeet)<0.15 &&
    r.boundsFeet.min.x<=box[2] && r.boundsFeet.max.x>=box[0] &&
    r.boundsFeet.min.y<=box[3] && r.boundsFeet.max.y>=box[1]
  ).map(r=>({
    nativeElementId:r.elementId,elevationFeet:r.boundsFeet.max.z,
    ringsFeet:r.loops!.map(ring=>ring.map(p=>[p[0],p[1]] as RoomPoint)),
  })).filter(s=>s.ringsFeet.every(r=>r.length>=3));
}

/** Bind complete native flights to stair places by physical floor endpoint and
 * actual tread overlap. Bounds alone never fill a landing or an atrium void.
 * This is deliberately independent of route eligibility and room repair. */
export function prepareIndoorStairDisplay(
  model: Pick<ConvertResult, "levels"> & Partial<ConvertResult>,
  data: Pick<IndoorDataset, "source" | "records">,
  sourceRooms: readonly DirectoryRoom[] = [],
): NonNullable<IndoorDataset["stairDisplay"]> {
  const elements = new Map(model.elementBounds?.map((r) => [r.elementId, r]));
  const flights: NonNullable<IndoorDataset["stairDisplay"]>["flights"] = [];
  const close = (r: RoomPoint[]) => [...r, r[0]!];
  const area = (ps: RoomPoint[][][]) =>
    ps.reduce(
      (s, p) =>
        s + roomArea(p[0]!) - p.slice(1).reduce((h, r) => h + roomArea(r), 0),
      0,
    );
  for (const assembly of model.nativeStairAssemblies ?? []) {
    const runs = assembly.runAndLandingIds
      .map((id) => elements.get(id))
      .filter((r) => r?.stairTreads?.length);
    if (!runs.length) continue;
    const low = Math.min(...runs.map((r) => r!.boundsFeet.min.z));
    const high = Math.max(...runs.map((r) => r!.boundsFeet.max.z));
    const treads = runs
      .flatMap((r) =>
        r!.stairTreads!.map((t) => ({
          runElementId: r!.elementId,
          ...(r!.stairTreadThicknessFeet != null &&
          Number.isFinite(r!.stairTreadThicknessFeet) &&
          r!.stairTreadThicknessFeet > 0
            ? { thicknessFeet: r!.stairTreadThicknessFeet }
            : {}),
          elevationFeet: t.reduce((s, p) => s + p[2] / t.length, 0),
          ringFeet: t.map((p) => [p[0], p[1]] as RoomPoint),
        })),
      )
      .filter((t) => roomArea(t.ringFeet) > 0.01);
    if (!treads.length) continue;
    const polygons = treads.map((t) => [close(t.ringFeet)]);
    const native = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
    const candidates = data.records
      .filter(
        (r) =>
          (r.stair ||
            sourceRooms
              .find((s) => s.key === r.key)
              ?.stairDisplayOnlyFlightIds?.includes(assembly.stairElementId)) &&
          r.walkable &&
          (Math.abs(r.elevationFeet - low) <= 1 ||
            Math.abs(r.elevationFeet - high) <= 1),
      )
      .map((r) => ({
        r,
        overlap: area(
          polygonClipping.intersection(
            native,
            r.ringsFeet.map(close),
          ) as RoomPoint[][][],
        ),
      }))
      .filter((c) => c.overlap > 0.5);
    // One owner per physical endpoint; similarly overlapping duplicate records
    // remain unresolved rather than assigning the same visible flight twice.
    for (const endpoint of [
      ...new Set(
        candidates.map((c) =>
          Math.abs(c.r.elevationFeet - low) <=
          Math.abs(c.r.elevationFeet - high)
            ? "low"
            : "high",
        ),
      ),
    ]) {
      const matches = candidates
        .filter(
          (c) =>
            (Math.abs(c.r.elevationFeet - low) <=
            Math.abs(c.r.elevationFeet - high)
              ? "low"
              : "high") === endpoint,
        )
        .sort((a, b) => b.overlap - a.overlap);
      if (matches[1] && matches[1].overlap >= matches[0]!.overlap * 0.8)
        continue;
      const r = matches[0]!.r;
      flights.push({
        roomKey: r.key,
        levelId: r.levelId,
        floorElevationFeet: r.elevationFeet,
        sourceGeometryKey: JSON.stringify([
          r.levelId,
          r.elevationFeet,
          r.ringsFeet,
        ]),
        stairElementId: assembly.stairElementId,
        ...(!r.stair ? { displayOnly: true as const } : {}),
        treads,
      });
    }
  }
  for(const flight of flights)flight.floorOccluders=stairFloorOccluders(model,flight);
  return {
    version: 1,
    generator: "reviter/native-stair-display-1",
    sourceModelSha256: data.source.modelSha256,
    flights,
  };
}
