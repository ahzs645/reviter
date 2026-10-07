import {
  nativeStairRunTreads,
  nativeStairRunEndpoints,
} from "./indoor-stair-run-surfaces.ts";
import { nativeStairLandings } from "./indoor-stair-landings.ts";
import polygonClipping from "polygon-clipping";
import {nativeStairLandingContact} from './native-stair-landing-contact.ts';
import type { ConvertResult } from "./types.ts";
import { nativeRampTriangles } from "./indoor-ramps.ts";
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
  const points = [
    ...flight.treads.flatMap((t) => t.ringFeet),
    ...(flight.landings ?? []).flatMap((l) => l.ringsFeet.flat()),
  ];
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  return (model.elementBounds ?? [])
    .filter(
      (r) =>
        r.categoryId === -2000032 &&
        r.loops?.length &&
        Math.abs(r.boundsFeet.max.z - flight.floorElevationFeet) < 0.15 &&
        r.boundsFeet.min.x <= box[2] &&
        r.boundsFeet.max.x >= box[0] &&
        r.boundsFeet.min.y <= box[3] &&
        r.boundsFeet.max.y >= box[1],
    )
    .map((r) => ({
      nativeElementId: r.elementId,
      elevationFeet: r.boundsFeet.max.z,
      ringsFeet: r.loops!.map((ring) =>
        ring.map((p) => [p[0], p[1]] as RoomPoint),
      ),
    }))
    .filter((s) => s.ringsFeet.every((r) => r.length >= 3));
}

/** Bind complete native flights to stair places by physical floor endpoint and
 * actual tread overlap. Bounds alone never fill a landing or an atrium void.
 * This is deliberately independent of route eligibility and room repair. */
export function prepareIndoorStairDisplay(
  model: Pick<ConvertResult, "levels"> & Partial<ConvertResult>,
  data: Pick<IndoorDataset, "source" | "records">,
  sourceRooms: readonly DirectoryRoom[] = [],
): NonNullable<IndoorDataset["stairDisplay"]> {
  const landingInventory = nativeStairLandings(model);
  const nativeTreads = nativeStairRunTreads(model);
  const elements = new Map(model.elementBounds?.map((r) => [r.elementId, r]));
  const flights: NonNullable<IndoorDataset["stairDisplay"]>["flights"] = [];
  const sourceFlights: NonNullable<
    NonNullable<IndoorDataset["stairDisplay"]>["sourceFlights"]
  > = [];
  const close = (r: RoomPoint[]) => [...r, r[0]!];
  const area = (ps: RoomPoint[][][]) =>
    ps.reduce(
      (s, p) =>
        s + roomArea(p[0]!) - p.slice(1).reduce((h, r) => h + roomArea(r), 0),
      0,
    );
  const recoveredTreads = (id: number) => {
    const groups = new Map<number, RoomPoint[][]>();
    for (const triangle of nativeRampTriangles(model as ConvertResult, id)) {
      if (
        Math.max(...triangle.map((p) => p[2])) -
          Math.min(...triangle.map((p) => p[2])) >
        0.002
      )
        continue;
      const ring = triangle.map((p) => [p[0], p[1]] as RoomPoint);
      if (roomArea(ring) < 0.2) continue;
      const z = Math.round(triangle[0]![2] * 1e6) / 1e6;
      groups.set(z, [...(groups.get(z) ?? []), ring]);
    }
    return [...groups].flatMap(([elevationFeet, rings]) => {
      const parts = polygonClipping.union(
        ...(rings.map((r) => [close(r)]) as [
          polygonClipping.Polygon,
          ...polygonClipping.Polygon[],
        ]),
      ) as RoomPoint[][][];
      return parts
        .filter((p) => p.length === 1)
        .map((p) => ({
          runElementId: id,
          elevationFeet,
          ringFeet: p[0]!.slice(0, -1),
        }));
    });
  };
  for (const assembly of model.nativeStairAssemblies ?? []) {
    const landings = landingInventory.get(assembly.stairElementId) ?? [];
    const runs = assembly.runAndLandingIds
      .map((id) => elements.get(id))
      .filter((r) => !!r && r.categoryId !== -2000920);
    if (!runs.length) continue;
    const low = Math.min(...runs.map((r) => r!.boundsFeet.min.z));
    const high = Math.max(...runs.map((r) => r!.boundsFeet.max.z));
    let recovered = runs.some((r) => nativeTreads.has(r!.elementId));
    const treads = runs
      .flatMap((r) =>
        nativeTreads.has(r!.elementId)
          ? nativeTreads.get(r!.elementId)!
          : r!.stairTreads?.length
            ? r!.stairTreads!.map((t) => ({
                runElementId: r!.elementId,
                ...(r!.stairTreadThicknessFeet != null &&
                Number.isFinite(r!.stairTreadThicknessFeet) &&
                r!.stairTreadThicknessFeet > 0
                  ? { thicknessFeet: r!.stairTreadThicknessFeet }
                  : {}),
                elevationFeet: t.reduce((s, p) => s + p[2] / t.length, 0),
                ringFeet: t.map((p) => [p[0], p[1]] as RoomPoint),
              }))
            : (() => {
                const treads = recoveredTreads(r!.elementId);
                recovered ||= !!treads.length;
                return treads;
              })(),
      )
      .filter((t) => roomArea(t.ringFeet) > 0.01);
    if (!treads.length) continue;
    // Source geometry remains visible even if a drawing outline misses a run.
    // Inventory membership grants no arrival, stair edge or served stop.
    const levels = model.levels.filter(
      (l) => l.levelId != null && Number.isFinite(l.elevation),
    );
    const base = elements.get(assembly.stairElementId)?.boundsFeet.min.z ?? low;
    const bottom = [...levels].sort(
      (a, b) => Math.abs(a.elevation - base) - Math.abs(b.elevation - base),
    )[0];
    const top = [...levels].sort(
      (a, b) => Math.abs(a.elevation - high) - Math.abs(b.elevation - high),
    )[0];
    if (bottom && top) {
      const levelIds = levels
        .filter(
          (l) =>
            l.elevation >= bottom.elevation - 0.05 &&
            l.elevation <= top.elevation + 0.05,
        )
        .map((l) => l.levelId!);
      const points = treads.flatMap((t) => t.ringFeet);
      const centre: RoomPoint = [
        points.reduce((n, p) => n + p[0] / points.length, 0),
        points.reduce((n, p) => n + p[1] / points.length, 0),
      ];
      const nearby = data.records
        .filter((r) => levelIds.includes(r.levelId))
        .map((r) => ({
          r,
          distance: Math.min(
            ...r.ringsFeet
              .flat()
              .map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])),
          ),
        }))
        .sort((a, b) => a.distance - b.distance);
      const buildings = [
        ...new Set(
          nearby
            .filter((n) => n.distance <= Math.max(15, nearby[0]?.distance ?? 0))
            .map((n) => n.r.building),
        ),
      ];
      sourceFlights.push({
        stairElementId: assembly.stairElementId,
        levelIds,
        buildings,
        floorElevationFeet: bottom.elevation,
        sourceGeometry: recovered ? "native-brep" : "native-cache",
        treads,
        runs: nativeStairRunEndpoints(model, treads),
        landings,
      });
    }
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
        nativeContact: (() => {
          const source=sourceRooms.find(s=>s.key===r.key);
          return !!source&&nativeStairLandingContact(model,source,assembly.stairElementId,runs as NonNullable<typeof runs[number]>[],Math.abs(r.elevationFeet-low)<=Math.abs(r.elevationFeet-high)?'bottom':'top');
        })(),
        overlap: area(
          polygonClipping.intersection(
            native,
            r.ringsFeet.map(close),
          ) as RoomPoint[][][],
        ),
      }))
      .filter((c) => c.overlap > 0.5||c.nativeContact);
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
        .sort((a, b) => Number(b.nativeContact)-Number(a.nativeContact)||b.overlap - a.overlap);
      if(matches[0]?.nativeContact&&matches[1]?.nativeContact)continue;
      if (!matches[0]!.nativeContact&&matches[1] && matches[1].overlap >= matches[0]!.overlap * 0.8)
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
        runs: nativeStairRunEndpoints(model, treads),
        landings,
      });
    }
  }
  for (const flight of flights)
    flight.floorOccluders = stairFloorOccluders(model, flight);
  return {
    version: 1,
    generator: "reviter/native-stair-display-1",
    sourceModelSha256: data.source.modelSha256,
    sourceFlights,
    flights,
  };
}
